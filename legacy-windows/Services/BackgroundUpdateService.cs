using System.Text.Json;
using System.Security.Cryptography;

namespace PdfStudio.Services;

public enum BackgroundUpdateStatus { Idle, Downloading, Ready, Failed }

/// <summary>A read-only snapshot consumed by the progress window and the main form.</summary>
public sealed record BackgroundUpdateSnapshot(
    BackgroundUpdateStatus Status,
    UpdateInfo? Update = null,
    string? DownloadedPath = null,
    UpdateProgress Progress = default,
    string? Error = null);

/// <summary>
/// Owns automatic update downloads independently of any window. Closing the progress window never cancels a transfer;
/// only the application process ending interrupts a transfer. A fully verified update and its metadata are persisted,
/// so choosing Update later keeps the payload staged and makes it available again on the next launch.
/// </summary>
public static class BackgroundUpdateService
{
    private sealed record PendingUpdateRecord(UpdateInfo Update, DateTime CompletedUtc, string? DownloadedPath = null);

    private static readonly object Sync = new();
    private static readonly SemaphoreSlim DownloadGate = new(1, 1);
    private static readonly string MetadataPath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "PdfStudio", "pending-update.json");

    private static BackgroundUpdateSnapshot current = new(BackgroundUpdateStatus.Idle);
    private static CancellationTokenSource? activeCts;
    private static bool initialized;

    public static event Action<BackgroundUpdateSnapshot>? StateChanged;

    public static BackgroundUpdateSnapshot Current
    {
        get { lock (Sync) return current; }
    }

    /// <summary>Restore a previously verified update or discard an unmarked/incomplete .new file.</summary>
    public static void Initialize()
    {
        BackgroundUpdateSnapshot next;
        lock (Sync)
        {
            if (initialized) return;
            initialized = true;
            if (TryLoadPending(out var update, out var path))
                next = new BackgroundUpdateSnapshot(BackgroundUpdateStatus.Ready, update, path,
                    new UpdateProgress(1, update.Size, update.Size, UpdatePhase.Verifying, "The update is downloaded and verified."));
            else
            {
                TryDelete(MetadataPath);
                TryDelete(MetadataPath + ".tmp");
                TryDelete(UpdateService.StagedPath);
                next = new BackgroundUpdateSnapshot(BackgroundUpdateStatus.Idle);
            }
            current = next;
        }
        Notify(next);
    }

    /// <summary>Begin downloading a newer version without making the user keep a dialog open.</summary>
    public static void Start(UpdateInfo update)
    {
        Initialize();
        CancellationTokenSource source;
        BackgroundUpdateSnapshot next;
        lock (Sync)
        {
            if (current.Status == BackgroundUpdateStatus.Downloading && SameVersion(current.Update, update)) return;
            if (current.Status == BackgroundUpdateStatus.Ready && SameVersion(current.Update, update) &&
                !string.IsNullOrWhiteSpace(current.DownloadedPath) && File.Exists(current.DownloadedPath)) return;

            try { activeCts?.Cancel(); } catch { }
            source = new CancellationTokenSource();
            activeCts = source;

            // Remove the marker before touching the staged file. If the process exits mid-download, startup will not
            // mistake a partial executable for a completed update.
            TryDelete(MetadataPath);
            TryDelete(UpdateService.StagedPath);
            next = new BackgroundUpdateSnapshot(BackgroundUpdateStatus.Downloading, update, null,
                new UpdateProgress(0, 0, UpdateService.IsPlatformMigration(update) ? update.Size : update.DownloadSize, UpdatePhase.Downloading, "Starting the background download…"));
            current = next;
        }
        Notify(next);
        _ = Task.Run(() => DownloadInBackgroundAsync(update, source));
    }

    private static async Task DownloadInBackgroundAsync(UpdateInfo update, CancellationTokenSource source)
    {
        var token = source.Token;
        var ownsGate = false;
        try
        {
            await DownloadGate.WaitAsync(token).ConfigureAwait(false);
            ownsGate = true;
            token.ThrowIfCancellationRequested();

            var progress = new Progress<UpdateProgress>(p =>
            {
                BackgroundUpdateSnapshot next;
                lock (Sync)
                {
                    if (current.Status != BackgroundUpdateStatus.Downloading || !SameVersion(current.Update, update)) return;
                    next = current with { Progress = p };
                    current = next;
                }
                Notify(next);
            });

            var path = await UpdateService.DownloadAsync(update, progress, token).ConfigureAwait(false);
            token.ThrowIfCancellationRequested();

            var record = new PendingUpdateRecord(update, DateTime.UtcNow, path);
            Directory.CreateDirectory(Path.GetDirectoryName(MetadataPath)!);
            var temp = MetadataPath + ".tmp";
            await File.WriteAllTextAsync(temp, JsonSerializer.Serialize(record), token).ConfigureAwait(false);
            File.Move(temp, MetadataPath, true);

            BackgroundUpdateSnapshot ready;
            lock (Sync)
            {
                if (current.Status != BackgroundUpdateStatus.Downloading || !SameVersion(current.Update, update))
                {
                    // A newer request superseded this one. Do not publish stale state.
                    TryDelete(MetadataPath);
                    TryDelete(path);
                    return;
                }
                ready = new BackgroundUpdateSnapshot(BackgroundUpdateStatus.Ready, update, path,
                    new UpdateProgress(1, update.Size, update.Size, UpdatePhase.Verifying, "The update is downloaded and verified."));
                current = ready;
            }
            Notify(ready);
        }
        catch (OperationCanceledException)
        {
            // Cancellation is reserved for replacing a stale download with a newer version. Closing the window never
            // cancels this token or reaches this code path.
            BackgroundUpdateSnapshot? idle = null;
            lock (Sync)
            {
                if (current.Status == BackgroundUpdateStatus.Downloading && SameVersion(current.Update, update))
                {
                    idle = new BackgroundUpdateSnapshot(BackgroundUpdateStatus.Idle);
                    current = idle;
                }
            }
            if (idle is not null) Notify(idle);
        }
        catch (Exception ex)
        {
            TryDelete(UpdateService.StagedPath);
            TryDelete(MetadataPath);
            TryDelete(MetadataPath + ".tmp");
            BackgroundUpdateSnapshot? failed = null;
            lock (Sync)
            {
                if (current.Status == BackgroundUpdateStatus.Downloading && SameVersion(current.Update, update))
                {
                    failed = new BackgroundUpdateSnapshot(BackgroundUpdateStatus.Failed, update, null, current.Progress, ex.Message);
                    current = failed;
                }
            }
            if (failed is not null) Notify(failed);
        }
        finally
        {
            if (ownsGate) DownloadGate.Release();
            lock (Sync)
            {
                if (ReferenceEquals(activeCts, source)) activeCts = null;
            }
            source.Dispose();
        }
    }

    public static bool IsReadyFor(UpdateInfo update)
    {
        var state = Current;
        return state.Status == BackgroundUpdateStatus.Ready && SameVersion(state.Update, update) &&
               !string.IsNullOrWhiteSpace(state.DownloadedPath) && File.Exists(state.DownloadedPath);
    }

    /// <summary>Discard a staged executable that failed its final integrity check, allowing the next check to redownload it.</summary>
    public static void DiscardInvalidStagedUpdate(string path, string version)
    {
        BackgroundUpdateSnapshot? idle = null;
        var ownsStage = false;
        lock (Sync)
        {
            ownsStage = current.Status != BackgroundUpdateStatus.Downloading &&
                (current.Status is BackgroundUpdateStatus.Idle or BackgroundUpdateStatus.Failed ||
                 (current.Status == BackgroundUpdateStatus.Ready &&
                  string.Equals(current.DownloadedPath, path, StringComparison.OrdinalIgnoreCase) &&
                  string.Equals(current.Update?.Version, version, StringComparison.OrdinalIgnoreCase)));
            if (ownsStage && current.Status == BackgroundUpdateStatus.Ready)
            {
                idle = new BackgroundUpdateSnapshot(BackgroundUpdateStatus.Idle);
                current = idle;
            }
        }
        if (ownsStage)
        {
            TryDelete(MetadataPath);
            TryDelete(MetadataPath + ".tmp");
            TryDelete(path);
        }
        if (idle is not null) Notify(idle);
    }

    /// <summary>Remove the persisted marker only after the staged executable has successfully replaced the running one.</summary>
    public static void ClearPendingMarker()
    {
        TryDelete(MetadataPath);
    }

    private static bool TryLoadPending(out UpdateInfo update, out string path)
    {
        update = null!;
        path = UpdateService.StagedPath;
        try
        {
            if (!File.Exists(MetadataPath)) return false;
            var record = JsonSerializer.Deserialize<PendingUpdateRecord>(File.ReadAllText(MetadataPath));
            if (record?.Update is not { } candidate || string.IsNullOrWhiteSpace(candidate.Version)) return false;
            var expectedPath = UpdateService.IsPlatformMigration(candidate)
                ? UpdateService.MigrationPortablePath(candidate.Version)
                : UpdateService.StagedPath;
            // Only restore from the well-known staging location for the given update type; do not trust arbitrary
            // local paths from the persisted marker. Older marker files without DownloadedPath remain compatible.
            var storedPath = string.IsNullOrWhiteSpace(record.DownloadedPath) ? expectedPath : record.DownloadedPath!;
            if (!string.Equals(Path.GetFullPath(storedPath), Path.GetFullPath(expectedPath), StringComparison.OrdinalIgnoreCase)) return false;
            path = expectedPath;
            if (!File.Exists(path)) return false;
            if (candidate.Size > 0 && new FileInfo(path).Length != candidate.Size) return false;
            using (var stream = File.OpenRead(path))
            {
                var header = new byte[2];
                if (stream.Read(header, 0, header.Length) != header.Length || header[0] != (byte)'M' || header[1] != (byte)'Z') return false;
                if (!string.IsNullOrWhiteSpace(candidate.Sha256))
                {
                    stream.Position = 0;
                    var actual = Convert.ToHexString(SHA256.HashData(stream));
                    if (!string.Equals(actual, candidate.Sha256, StringComparison.OrdinalIgnoreCase)) return false;
                }
            }
            if (Version.TryParse(candidate.Version, out var offered) && Version.TryParse(UpdateService.CurrentVersion, out var installed) && offered <= installed)
                return false;
            update = candidate;
            return true;
        }
        catch { return false; }
    }

    private static bool SameVersion(UpdateInfo? a, UpdateInfo? b) =>
        a is not null && b is not null && string.Equals(a.Version, b.Version, StringComparison.OrdinalIgnoreCase);

    private static void Notify(BackgroundUpdateSnapshot state)
    {
        try { StateChanged?.Invoke(state); } catch { /* A window listener must never break an update download. */ }
    }

    private static void TryDelete(string path)
    {
        try { if (File.Exists(path)) File.Delete(path); } catch { }
    }
}
