using PdfStudio.UI;
using System.Buffers.Binary;
using System.Diagnostics;
using System.IO.Compression;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace PdfStudio.Services;

/// <summary>A newer version offered by the monitor server.</summary>
public sealed record UpdateInfo(
    string Version,
    string Notes,
    string DownloadUrl,
    long Size,
    string? Sha256,
    string? ZipUrl = null,
    long ZipSize = 0,
    string? ZipSha256 = null,
    string? DeltaManifestUrl = null,
    long DeltaManifestSize = 0,
    string? DeltaManifestSha256 = null)
{
    public bool Compressed => !string.IsNullOrEmpty(ZipUrl) && ZipSize > 0 && !string.IsNullOrEmpty(ZipSha256);
    public bool DeltaSupported => !string.IsNullOrEmpty(DeltaManifestUrl) && DeltaManifestSize > 0 && IsSha256(DeltaManifestSha256);
    public long DownloadSize => DeltaSupported ? 0 : Compressed ? ZipSize : Size;

    private static bool IsSha256(string? text) => text is { Length: 64 } && text.All(Uri.IsHexDigit);
}

/// <summary>Current updater operation, surfaced in the progress UI.</summary>
public enum UpdatePhase { PreparingDelta, Downloading, Verifying, Unpacking, ApplyingDelta, Fallback }

/// <summary>Fraction is overall progress from 0..1. Done/Total refer to the current transfer or operation.</summary>
public readonly record struct UpdateProgress(double Fraction, long Done, long Total, UpdatePhase Phase, string? Message = null);

/// <summary>Result of a check: Update is null when you are up to date; Error is set when the check itself failed.</summary>
public sealed record UpdateCheck(UpdateInfo? Update, string? Error);

/// <summary>
/// Steam-style, content-defined differential self-updater.
///
/// The monitor publishes a manifest of content-defined chunks for every new EXE. On update, this client chunks its
/// installed EXE, reuses matching SHA-256 chunks (even if their offsets moved), downloads only chunks that are new,
/// rebuilds the target EXE locally, and verifies the entire final EXE before it can be applied. If the differential
/// path is missing, damaged, or larger than a compressed full update, it falls back to the compressed package and
/// finally to the plain EXE. That preserves compatibility with older monitor data and keeps updates recoverable.
///
/// Chunking contract shared with src/delta.php:
///   64-byte rolling buzhash; min 64 KiB; mask 0x1FFFF; max 1 MiB; xorshift32 gear table seeded at 0x9E3779B9.
/// Differential payload format: ASCII "PSDDELTA", uint32 little-endian entry count, then repeated SHA-256 (32 raw
/// bytes), uint32 raw length, uint32 raw-DEFLATE length, and raw-DEFLATE bytes.
/// </summary>
public static class UpdateService
{
    private const string DeltaFormat = "psd-chunks-v1";
    private const string DeltaPayloadMagic = "PSDDELTA";
    private const int DeltaWindow = 64;
    private const int MinChunkSize = 65_536;
    private const uint AverageChunkMask = 0x1FFFF;
    private const int MaxChunkSize = 1_048_576;
    private const int MaxManifestBytes = 32 * 1024 * 1024;
    private const int MaxChunkCount = 10_000;

    private sealed record DeltaChunk(long Offset, int Size, string Sha256);
    private sealed record DeltaManifest(string Version, long Size, string Sha256, IReadOnlyList<DeltaChunk> Chunks);
    private sealed record LocalChunk(long Offset, int Size);

    public static string FormatSize(long bytes)
    {
        if (bytes <= 0) return "unknown size";
        if (bytes < 1024 * 1024) return $"{Math.Max(1, (bytes + 512) / 1024)} KB";
        var mb = bytes / 1048576.0;
        return mb >= 100 ? $"{mb:0} MB" : $"{mb:0.0} MB";
    }

    public static bool AutoCheck => AppSettings.GetBool("auto_update", true);
    public static string SkippedVersion { get => AppSettings.Get("update_skip"); set => AppSettings.Set("update_skip", value); }

    private static readonly HttpClient Http = CreateClient();

    private static HttpClient CreateClient()
    {
        var client = new HttpClient { Timeout = Timeout.InfiniteTimeSpan };
        client.DefaultRequestHeaders.UserAgent.ParseAdd($"PdfStudio/{AppInfo.Version}");
        client.DefaultRequestHeaders.TryAddWithoutValidation("ngrok-skip-browser-warning", "1");
        return client;
    }

    private static HttpRequestMessage Get(string url)
    {
        var request = new HttpRequestMessage(HttpMethod.Get, url);
        request.Headers.TryAddWithoutValidation("X-Api-Key", UsageTracker.ApiKey);
        return request;
    }

    private static string Endpoint(string query) => $"{UsageTracker.BaseUrl}/update.php?{query}";

    private static string? ExePath => Environment.ProcessPath;
    private static string NewPath => ExePath + ".new";
    /// <summary>Verified replacement executable staged beside the running executable for legacy same-format updates.</summary>
    public static string StagedPath => NewPath;
    private static string OldPath => ExePath + ".old";
    private static string ZipTempPath => ExePath + ".new.zip";
    private static string DeltaTempPath => ExePath + ".new.delta";
    private static string MigrationRoot => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "PdfStudio", "migration");
    private static string PortableRoot => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "PdfStudio", "Version3");
    private static string PortableFallbackPath => Path.Combine(PortableRoot, "PdfStudio.exe");
    private static string MigrationMarkerPath => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "PdfStudio", "migration-v3-portable-launched.txt");

    /// <summary>
    /// Version 3 is an Electron portable launcher. It can replace the legacy EXE in a writable portable folder;
    /// protected legacy folders fall back to a user-local copy without running an installer or requiring elevation.
    /// </summary>
    public static bool IsPlatformMigration(UpdateInfo update) => IsPlatformMigrationVersion(update.Version);

    private static bool IsPlatformMigrationVersion(string targetVersion)
    {
        return TryParse(CurrentVersion, out var current) && TryParse(targetVersion, out var target)
            && current.Major < 3 && target.Major >= 3;
    }

    public static bool IsPlatformMigrationInstalled => File.Exists(MigrationMarkerPath) && File.Exists(PortableFallbackPath);

    /// <summary>Download path for the checksum-verified standalone Version 3 portable EXE.</summary>
    public static string MigrationPortablePath(string version)
    {
        var safeVersion = string.Concat((version ?? "3.0.0").Select(c => char.IsAsciiLetterOrDigit(c) || c is '.' or '-' or '_' ? c : '_'));
        return Path.Combine(MigrationRoot, $"PDF-Studio-{safeVersion}-Portable.exe");
    }

    /// <summary>Called at startup by patched legacy C# builds after a protected-folder migration. Keeps old shortcuts useful.</summary>
    public static bool TryLaunchPortableMigration()
    {
        if (!IsPlatformMigrationInstalled || !TryParse(CurrentVersion, out var current) || current.Major >= 3) return false;
        try
        {
            var started = Process.Start(new ProcessStartInfo(PortableFallbackPath)
            {
                UseShellExecute = true,
                WorkingDirectory = PortableRoot
            });
            return started is not null;
        }
        catch { return false; }
    }

    private static bool IsDevHost(string? exe) =>
        string.IsNullOrEmpty(exe) || string.Equals(Path.GetFileNameWithoutExtension(exe), "dotnet", StringComparison.OrdinalIgnoreCase);

    public static string CurrentVersion
    {
        get
        {
            try
            {
                if (!IsDevHost(ExePath))
                {
                    var version = FileVersionInfo.GetVersionInfo(ExePath!);
                    if (version.FileMajorPart > 0 || version.FileMinorPart > 0 || version.FileBuildPart > 0)
                        return $"{version.FileMajorPart}.{version.FileMinorPart}.{version.FileBuildPart}";
                }
            }
            catch { }
            return AppInfo.Version;
        }
    }

    public static bool CanSelfUpdate(out string reason)
    {
        reason = "";
        var exe = ExePath;
        if (IsDevHost(exe))
        { reason = "This copy is running from the development environment, so it cannot replace itself."; return false; }
        try
        {
            var probe = Path.Combine(Path.GetDirectoryName(exe)!, ".write-test-" + Guid.NewGuid().ToString("N"));
            File.WriteAllText(probe, "x"); File.Delete(probe);
            return true;
        }
        catch
        {
            reason = "PDF Studio is installed in a folder that needs administrator rights (" + Path.GetDirectoryName(exe) + "). " +
                     "Move PdfStudio.exe to a normal folder such as your Documents or Desktop, or install the update manually.";
            return false;
        }
    }

    public static void CleanupLeftovers()
    {
        if (string.IsNullOrEmpty(ExePath)) return;
        var old = OldPath; var zip = ZipTempPath; var delta = DeltaTempPath;
        _ = Task.Run(async () =>
        {
            for (var i = 0; i < 10; i++)
            {
                try
                {
                    // Keep .new intact: a completed update may have been deliberately postponed.
                    // BackgroundUpdateService removes unmarked/incomplete .new files during startup.
                    TryDelete(old); TryDelete(zip); TryDelete(delta);
                    foreach (var dir in Directory.GetDirectories(Path.GetTempPath(), "PdfStudioDelta-*"))
                    {
                        try { if (Directory.GetCreationTimeUtc(dir) < DateTime.UtcNow.AddDays(-1)) Directory.Delete(dir, true); } catch { }
                    }
                    return;
                }
                catch { await Task.Delay(1000).ConfigureAwait(false); }
            }
        });
    }

    // ───────────────────────── 1. check ─────────────────────────

    private static bool TryParse(string text, out Version version)
    {
        text = text.Trim().TrimStart('v', 'V');
        var cut = text.IndexOfAny(new[] { '-', '+' });
        if (cut >= 0) text = text[..cut];
        if (Version.TryParse(text, out var parsed)) { version = new Version(parsed.Major, parsed.Minor, Math.Max(0, parsed.Build)); return true; }
        version = new Version(0, 0, 0); return false;
    }

    public static async Task<UpdateCheck> CheckAsync(CancellationToken ct = default)
    {
        try
        {
            using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            cts.CancelAfter(TimeSpan.FromSeconds(20));
            using var request = Get(Endpoint("action=latest&version=" + Uri.EscapeDataString(CurrentVersion)));
            request.Headers.TryAddWithoutValidation("Accept", "application/json");
            using var response = await Http.SendAsync(request, cts.Token).ConfigureAwait(false);
            switch (response.StatusCode)
            {
                case HttpStatusCode.Unauthorized:
                    return new UpdateCheck(null, "The update server did not accept this app's access key.");
                case HttpStatusCode.NotFound:
                    return new UpdateCheck(null, "The update server was reached, but it has no update service. Is the monitor up to date?");
            }
            response.EnsureSuccessStatusCode();
            using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync(cts.Token).ConfigureAwait(false));
            var root = document.RootElement;
            if (!root.TryGetProperty("latest", out var latest) || latest.ValueKind != JsonValueKind.Object)
                return new UpdateCheck(null, null);

            var version = latest.GetProperty("version").GetString() ?? "";
            if (!TryParse(version, out var newest)) return new UpdateCheck(null, $"The update server sent an unrecognised version ('{version}').");
            if (!TryParse(CurrentVersion, out var current) || newest <= current) return new UpdateCheck(null, null);
            // A successful protected-folder fallback writes this marker. Avoid repeatedly offering the same migration
            // while the user-local portable copy exists; when no marker/copy exists, allow another attempt.
            if (current.Major < 3 && newest.Major >= 3 && IsPlatformMigrationInstalled) return new UpdateCheck(null, null);
            var clean = $"{newest.Major}.{newest.Minor}.{newest.Build}";

            string? zipUrl = null; long zipSize = 0; string? zipSha = null;
            if (latest.TryGetProperty("package", out var package) && package.ValueKind == JsonValueKind.Object
                && string.Equals(package.TryGetProperty("format", out var format) ? format.GetString() : null, "zip", StringComparison.OrdinalIgnoreCase)
                && package.TryGetProperty("size", out var zipSizeElement) && zipSizeElement.TryGetInt64(out zipSize) && zipSize > 0
                && package.TryGetProperty("sha256", out var zipShaElement) && !string.IsNullOrEmpty(zipSha = zipShaElement.GetString()))
                zipUrl = Endpoint("action=download&format=zip&version=" + Uri.EscapeDataString(clean));
            else { zipSize = 0; zipSha = null; }

            string? deltaUrl = null; long manifestSize = 0; string? manifestSha = null;
            if (latest.TryGetProperty("delta", out var delta) && delta.ValueKind == JsonValueKind.Object
                && string.Equals(delta.TryGetProperty("format", out var deltaFormat) ? deltaFormat.GetString() : null, DeltaFormat, StringComparison.Ordinal)
                && delta.TryGetProperty("manifest_size", out var sizeElement) && sizeElement.TryGetInt64(out manifestSize) && manifestSize > 0 && manifestSize <= MaxManifestBytes
                && delta.TryGetProperty("manifest_sha256", out var shaElement) && IsSha256(manifestSha = shaElement.GetString()))
                deltaUrl = Endpoint("action=manifest&version=" + Uri.EscapeDataString(clean));
            else { deltaUrl = null; manifestSize = 0; manifestSha = null; }

            return new UpdateCheck(new UpdateInfo(
                clean,
                latest.TryGetProperty("notes", out var notes) ? notes.GetString() ?? "" : "",
                Endpoint("action=download&version=" + Uri.EscapeDataString(clean)),
                latest.TryGetProperty("size", out var exeSizeElement) && exeSizeElement.TryGetInt64(out var exeSize) ? exeSize : 0,
                latest.TryGetProperty("sha256", out var exeShaElement) ? exeShaElement.GetString() : null,
                zipUrl, zipSize, zipSha, deltaUrl, manifestSize, manifestSha), null);
        }
        catch (OperationCanceledException) { return new UpdateCheck(null, "The update server did not answer in time."); }
        catch (HttpRequestException) { return new UpdateCheck(null, "Could not reach the update server. Check your internet connection."); }
        catch (JsonException) { return new UpdateCheck(null, "The update server sent an unexpected reply."); }
        catch (Exception ex) { return new UpdateCheck(null, ex.Message); }
    }

    private static bool IsSha256(string? value) => value is { Length: 64 } && value.All(Uri.IsHexDigit);

    // ───────────────────────── 2. download / delta reconstruction ─────────────────────────

    public static async Task<string> DownloadAsync(UpdateInfo update, IProgress<UpdateProgress>? progress, CancellationToken ct)
    {
        if (IsPlatformMigration(update))
        {
            // Download the actual portable application launcher. Do not use the ZIP package, delta reconstruction,
            // NSIS, or an installer stub for a major-version migration; the raw EXE is what we hand off to Windows.
            var portablePath = MigrationPortablePath(update.Version);
            Directory.CreateDirectory(Path.GetDirectoryName(portablePath)!);
            TryDelete(portablePath);
            try
            {
                progress?.Report(new UpdateProgress(0, 0, update.Size, UpdatePhase.Downloading,
                    "Downloading the portable PDF Studio 3 app…"));
                await DownloadFileAsync(update.DownloadUrl, portablePath, update.Size, progress, 0.0, 1.0, ct).ConfigureAwait(false);
                await VerifyExeAsync(portablePath, update, ct).ConfigureAwait(false);
                progress?.Report(new UpdateProgress(1.0, update.Size, update.Size, UpdatePhase.Verifying,
                    "The PDF Studio 3 portable app is verified."));
                return portablePath;
            }
            catch
            {
                TryDelete(portablePath);
                throw;
            }
        }

        if (!CanSelfUpdate(out var reason)) throw new InvalidOperationException(reason);
        var target = NewPath;

        if (update.DeltaSupported)
        {
            try
            {
                var applied = await TryApplyDeltaAsync(update, target, progress, ct).ConfigureAwait(false);
                if (applied) return target;
            }
            catch (OperationCanceledException) { CleanupUpdateTemps(); throw; }
            catch
            {
                TryDelete(target); TryDelete(DeltaTempPath);
                progress?.Report(new UpdateProgress(0, 0, 0, UpdatePhase.Fallback,
                    "The smart update could not be used. Switching to the compressed update…"));
            }
        }

        if (update.Compressed)
        {
            try
            {
                await DownloadZipAsync(update, target, progress, ct).ConfigureAwait(false);
                return target;
            }
            catch (OperationCanceledException) { CleanupUpdateTemps(); throw; }
            catch
            {
                TryDelete(target); TryDelete(ZipTempPath);
                progress?.Report(new UpdateProgress(0, 0, 0, UpdatePhase.Fallback,
                    "The compressed package failed verification. Downloading the full executable…"));
            }
        }

        try
        {
            await DownloadFileAsync(update.DownloadUrl, target, update.Size, progress, 1.0, 0.0, ct).ConfigureAwait(false);
            await VerifyExeAsync(target, update, ct).ConfigureAwait(false);
            progress?.Report(new UpdateProgress(1.0, update.Size, update.Size, UpdatePhase.Verifying, "The update is verified."));
            return target;
        }
        catch (HttpRequestException)
        {
            TryDelete(target); CleanupUpdateTemps();
            throw new IOException("Could not download the update. Check your internet connection and try again.");
        }
        catch { TryDelete(target); CleanupUpdateTemps(); throw; }
    }

    private static async Task<bool> TryApplyDeltaAsync(UpdateInfo update, string target, IProgress<UpdateProgress>? progress, CancellationToken ct)
    {
        progress?.Report(new UpdateProgress(0, 0, update.Size, UpdatePhase.PreparingDelta, "Preparing the smart update…"));
        var manifest = await DownloadDeltaManifestAsync(update, progress, ct).ConfigureAwait(false);
        var exe = ExePath ?? throw new IOException("Could not locate the installed executable.");
        var localIndex = await Task.Run(() => BuildLocalChunkIndex(exe, progress, ct), ct).ConfigureAwait(false);

        var missing = new Dictionary<string, DeltaChunk>(StringComparer.OrdinalIgnoreCase);
        foreach (var chunk in manifest.Chunks)
        {
            if (!localIndex.TryGetValue(chunk.Sha256, out var local) || local.Size != chunk.Size)
                missing.TryAdd(chunk.Sha256, chunk);
        }
        long missingRawBytes = missing.Values.Sum(c => (long)c.Size);

        // If almost the whole app changed, the already-compressed full package is usually smaller and simpler.
        var fallbackThreshold = update.Compressed
            ? Math.Min(update.Size * 0.92, update.ZipSize * 1.75)
            : update.Size * 0.92;
        if (missingRawBytes >= fallbackThreshold)
        {
            progress?.Report(new UpdateProgress(0, missingRawBytes, update.Size, UpdatePhase.Fallback,
                "Most of the executable changed; the compressed full update is more efficient."));
            return false;
        }

        progress?.Report(new UpdateProgress(0.02, missingRawBytes, update.Size, UpdatePhase.PreparingDelta,
            $"Smart update: reusing unchanged parts; about {FormatSize(missingRawBytes)} of {FormatSize(update.Size)} needs updating."));

        var tempDirectory = Path.Combine(Path.GetTempPath(), "PdfStudioDelta-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(tempDirectory);
        try
        {
            if (missing.Count > 0)
            {
                await DownloadDeltaPackAsync(update, missing.Keys.ToArray(), progress, ct).ConfigureAwait(false);
                await Task.Run(() => ExtractDeltaPack(DeltaTempPath, missing, tempDirectory, progress, ct), ct).ConfigureAwait(false);
            }

            progress?.Report(new UpdateProgress(0.82, 0, update.Size, UpdatePhase.ApplyingDelta, "Rebuilding PDF Studio from the changed parts…"));
            await Task.Run(() => AssembleDelta(exe, target, manifest, localIndex, tempDirectory, progress, ct), ct).ConfigureAwait(false);
            await VerifyExeAsync(target, update, ct).ConfigureAwait(false);
            progress?.Report(new UpdateProgress(1.0, update.Size, update.Size, UpdatePhase.Verifying, "All update parts are verified."));
            return true;
        }
        finally
        {
            TryDelete(DeltaTempPath);
            try { if (Directory.Exists(tempDirectory)) Directory.Delete(tempDirectory, true); } catch { }
        }
    }

    private static async Task<DeltaManifest> DownloadDeltaManifestAsync(UpdateInfo update, IProgress<UpdateProgress>? progress, CancellationToken ct)
    {
        using var request = Get(update.DeltaManifestUrl!);
        using var response = await Http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct).ConfigureAwait(false);
        if (response.StatusCode == HttpStatusCode.NotFound) throw new IOException("The differential manifest is unavailable.");
        if (response.StatusCode == HttpStatusCode.Unauthorized) throw new IOException("The update server did not accept this app's access key.");
        response.EnsureSuccessStatusCode();

        await using var source = await response.Content.ReadAsStreamAsync(ct).ConfigureAwait(false);
        using var memory = new MemoryStream((int)Math.Clamp(update.DeltaManifestSize, 0, MaxManifestBytes));
        var buffer = new byte[64 * 1024]; int read; long total = 0;
        while ((read = await source.ReadAsync(buffer.AsMemory(0, buffer.Length), ct).ConfigureAwait(false)) > 0)
        {
            total += read;
            if (total > MaxManifestBytes) throw new IOException("The differential manifest is unexpectedly large.");
            memory.Write(buffer, 0, read);
            progress?.Report(new UpdateProgress(0, total, update.DeltaManifestSize, UpdatePhase.PreparingDelta, "Reading the update manifest…"));
        }
        if (update.DeltaManifestSize > 0 && total != update.DeltaManifestSize) throw new IOException("The differential manifest download is incomplete.");
        var bytes = memory.ToArray();
        var actualSha = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
        if (!string.Equals(actualSha, update.DeltaManifestSha256, StringComparison.OrdinalIgnoreCase))
            throw new IOException("The differential manifest failed its integrity check.");

        using var document = JsonDocument.Parse(bytes);
        var root = document.RootElement;
        if (!root.TryGetProperty("format", out var format) || format.GetString() != DeltaFormat)
            throw new IOException("The server sent an unsupported differential manifest.");
        var version = root.TryGetProperty("version", out var versionElement) ? versionElement.GetString() ?? "" : "";
        var size = root.TryGetProperty("size", out var sizeElement) && sizeElement.TryGetInt64(out var parsedSize) ? parsedSize : -1;
        var sha = root.TryGetProperty("sha256", out var shaElement) ? (shaElement.GetString() ?? "").ToLowerInvariant() : "";
        if (!string.Equals(version, update.Version, StringComparison.Ordinal) || size != update.Size
            || (!string.IsNullOrEmpty(update.Sha256) && !string.Equals(sha, update.Sha256, StringComparison.OrdinalIgnoreCase)))
            throw new IOException("The differential manifest does not match the announced release.");
        if (!root.TryGetProperty("chunks", out var chunksElement) || chunksElement.ValueKind != JsonValueKind.Array
            || chunksElement.GetArrayLength() < 1 || chunksElement.GetArrayLength() > MaxChunkCount)
            throw new IOException("The differential manifest has an invalid chunk list.");

        var chunks = new List<DeltaChunk>(chunksElement.GetArrayLength());
        long expectedOffset = 0;
        foreach (var item in chunksElement.EnumerateArray())
        {
            long offset = item.TryGetProperty("offset", out var offElement) && offElement.TryGetInt64(out var off) ? off : -1;
            int length = item.TryGetProperty("size", out var lenElement) && lenElement.TryGetInt32(out var len) ? len : -1;
            string hash = item.TryGetProperty("sha256", out var hashElement) ? (hashElement.GetString() ?? "").ToLowerInvariant() : "";
            if (offset != expectedOffset || length < 1 || length > MaxChunkSize || !IsSha256(hash))
                throw new IOException("The differential manifest contains an invalid chunk descriptor.");
            chunks.Add(new DeltaChunk(offset, length, hash));
            expectedOffset += length;
        }
        if (expectedOffset != update.Size) throw new IOException("The differential manifest does not cover the complete executable.");
        return new DeltaManifest(version, size, sha, chunks);
    }

    private static uint[] CreateGearTable()
    {
        var gear = new uint[256];
        uint x = 0x9E3779B9;
        unchecked
        {
            for (var i = 0; i < gear.Length; i++)
            {
                x ^= x << 13;
                x ^= x >> 17;
                x ^= x << 5;
                gear[i] = x;
            }
        }
        return gear;
    }

    private static uint RotateLeft1(uint value) => unchecked((value << 1) | (value >> 31));

    private static Dictionary<string, LocalChunk> BuildLocalChunkIndex(string path, IProgress<UpdateProgress>? progress, CancellationToken ct)
    {
        var gear = CreateGearTable();
        var window = new byte[DeltaWindow];
        var windowCount = 0; var windowPosition = 0; uint rollingHash = 0;
        var index = new Dictionary<string, LocalChunk>(StringComparer.OrdinalIgnoreCase);
        using var input = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 1024 * 1024, FileOptions.SequentialScan);
        using var currentChunk = new MemoryStream(MaxChunkSize);
        var buffer = new byte[1024 * 1024];
        long filePosition = 0; long totalRead = 0;
        int count;
        while ((count = input.Read(buffer, 0, buffer.Length)) > 0)
        {
            ct.ThrowIfCancellationRequested();
            var segmentStart = 0;
            for (var i = 0; i < count; i++)
            {
                var value = buffer[i];
                if (windowCount < DeltaWindow)
                {
                    rollingHash = RotateLeft1(rollingHash) ^ gear[value];
                    window[windowCount++] = value;
                }
                else
                {
                    var outgoing = window[windowPosition];
                    rollingHash = RotateLeft1(rollingHash) ^ gear[value] ^ gear[outgoing];
                    window[windowPosition] = value;
                    windowPosition = (windowPosition + 1) % DeltaWindow;
                }

                var candidateSize = checked((int)currentChunk.Length + i - segmentStart + 1);
                if (candidateSize >= MinChunkSize && ((rollingHash & AverageChunkMask) == 0 || candidateSize >= MaxChunkSize))
                {
                    var segmentLength = i - segmentStart + 1;
                    if (segmentLength > 0) currentChunk.Write(buffer, segmentStart, segmentLength);
                    AddLocalChunk(index, currentChunk, filePosition);
                    filePosition += currentChunk.Length;
                    currentChunk.SetLength(0);
                    segmentStart = i + 1;
                }
            }
            if (segmentStart < count) currentChunk.Write(buffer, segmentStart, count - segmentStart);
            totalRead += count;
            progress?.Report(new UpdateProgress(0, totalRead, input.Length, UpdatePhase.PreparingDelta, "Analyzing the installed executable…"));
        }
        if (currentChunk.Length > 0) AddLocalChunk(index, currentChunk, filePosition);
        return index;
    }

    private static void AddLocalChunk(Dictionary<string, LocalChunk> index, MemoryStream chunk, long offset)
    {
        var length = checked((int)chunk.Length);
        if (length < 1 || length > MaxChunkSize) throw new IOException("The installed executable produced an invalid chunk size.");
        var hash = Convert.ToHexString(SHA256.HashData(chunk.GetBuffer().AsSpan(0, length))).ToLowerInvariant();
        index.TryAdd(hash, new LocalChunk(offset, length));
    }

    private static async Task DownloadDeltaPackAsync(UpdateInfo update, string[] missingHashes, IProgress<UpdateProgress>? progress, CancellationToken ct)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, Endpoint("action=delta&version=" + Uri.EscapeDataString(update.Version)));
        request.Headers.TryAddWithoutValidation("X-Api-Key", UsageTracker.ApiKey);
        request.Content = new StringContent(JsonSerializer.Serialize(new { version = update.Version, chunks = missingHashes }), Encoding.UTF8, "application/json");
        using var response = await Http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct).ConfigureAwait(false);
        if (!response.IsSuccessStatusCode)
        {
            var body = "";
            try { body = await response.Content.ReadAsStringAsync(ct).ConfigureAwait(false); } catch { }
            if (response.StatusCode == HttpStatusCode.Unauthorized) throw new IOException("The update server did not accept this app's access key.");
            if (response.StatusCode == HttpStatusCode.NotFound) throw new IOException("The differential update is no longer available.");
            throw new IOException($"The server could not prepare the differential update (HTTP {(int)response.StatusCode}). {TrimServerError(body)}");
        }

        var total = response.Content.Headers.ContentLength ?? 0;
        await using var source = await response.Content.ReadAsStreamAsync(ct).ConfigureAwait(false);
        await using var target = new FileStream(DeltaTempPath, FileMode.Create, FileAccess.Write, FileShare.None, 128 * 1024, FileOptions.Asynchronous | FileOptions.SequentialScan);
        var buffer = new byte[128 * 1024]; long done = 0; int read;
        while ((read = await source.ReadAsync(buffer.AsMemory(0, buffer.Length), ct).ConfigureAwait(false)) > 0)
        {
            await target.WriteAsync(buffer.AsMemory(0, read), ct).ConfigureAwait(false);
            done += read;
            var fraction = total > 0 ? 0.78 * Math.Min(1.0, (double)done / total) : 0.10;
            progress?.Report(new UpdateProgress(fraction, done, total, UpdatePhase.Downloading, "Downloading changed parts…"));
        }
        await target.FlushAsync(ct).ConfigureAwait(false);
        if (total > 0 && done != total) throw new IOException("The differential update download is incomplete.");
        if (done < 12) throw new IOException("The server returned an invalid differential update.");
    }

    private static string TrimServerError(string body)
    {
        try
        {
            using var json = JsonDocument.Parse(body);
            if (json.RootElement.TryGetProperty("error", out var error)) return error.GetString() ?? "";
        }
        catch { }
        return body.Length > 180 ? body[..180] : body;
    }

    private static void ExtractDeltaPack(string packagePath, IReadOnlyDictionary<string, DeltaChunk> expectedChunks, string destinationDirectory, IProgress<UpdateProgress>? progress, CancellationToken ct)
    {
        using var input = new FileStream(packagePath, FileMode.Open, FileAccess.Read, FileShare.Read, 128 * 1024, FileOptions.SequentialScan);
        var header = ReadExactly(input, 12);
        if (!header.AsSpan(0, 8).SequenceEqual(Encoding.ASCII.GetBytes(DeltaPayloadMagic))) throw new IOException("The differential update has an invalid header.");
        var count = checked((int)BinaryPrimitives.ReadUInt32LittleEndian(header.AsSpan(8, 4)));
        if (count != expectedChunks.Count || count < 0 || count > MaxChunkCount) throw new IOException("The differential update contains an unexpected number of parts.");

        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        for (var i = 0; i < count; i++)
        {
            ct.ThrowIfCancellationRequested();
            var entryHeader = ReadExactly(input, 40);
            var hash = Convert.ToHexString(entryHeader.AsSpan(0, 32)).ToLowerInvariant();
            var rawLength = checked((int)BinaryPrimitives.ReadUInt32LittleEndian(entryHeader.AsSpan(32, 4)));
            var compressedLength = checked((int)BinaryPrimitives.ReadUInt32LittleEndian(entryHeader.AsSpan(36, 4)));
            if (!expectedChunks.TryGetValue(hash, out var descriptor) || !seen.Add(hash)) throw new IOException("The differential update contains an unrequested or duplicate part.");
            if (rawLength != descriptor.Size || rawLength < 1 || rawLength > MaxChunkSize || compressedLength < 1 || compressedLength > MaxChunkSize * 2)
                throw new IOException("The differential update contains an invalid part size.");
            var compressed = ReadExactly(input, compressedLength);
            var rawPath = Path.Combine(destinationDirectory, hash + ".chunk");
            long written = 0;
            using var compressedStream = new MemoryStream(compressed, writable: false);
            using var inflater = new DeflateStream(compressedStream, CompressionMode.Decompress, leaveOpen: false);
            using var output = new FileStream(rawPath, FileMode.CreateNew, FileAccess.Write, FileShare.None, 64 * 1024, FileOptions.SequentialScan);
            using var hasher = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
            var buffer = new byte[64 * 1024]; int read;
            while ((read = inflater.Read(buffer, 0, buffer.Length)) > 0)
            {
                written += read;
                if (written > rawLength) throw new IOException("A differential update part expands beyond its declared size.");
                output.Write(buffer, 0, read);
                hasher.AppendData(buffer, 0, read);
            }
            output.Flush();
            var sha = Convert.ToHexString(hasher.GetHashAndReset()).ToLowerInvariant();
            if (written != rawLength || !string.Equals(sha, hash, StringComparison.OrdinalIgnoreCase))
                throw new IOException("A changed part failed its SHA-256 integrity check.");
            progress?.Report(new UpdateProgress(0.80 + 0.02 * (i + 1) / Math.Max(1, count), i + 1, count, UpdatePhase.Verifying, "Verifying changed parts…"));
        }
        if (seen.Count != expectedChunks.Count || input.Position != input.Length) throw new IOException("The differential update is incomplete or contains trailing data.");
    }

    private static byte[] ReadExactly(Stream stream, int length)
    {
        if (length < 0 || length > MaxChunkSize * 2) throw new IOException("An update part has an invalid length.");
        var result = new byte[length]; var offset = 0;
        while (offset < length)
        {
            var read = stream.Read(result, offset, length - offset);
            if (read <= 0) throw new EndOfStreamException("The differential update ended unexpectedly.");
            offset += read;
        }
        return result;
    }

    private static void AssembleDelta(string sourcePath, string targetPath, DeltaManifest manifest, IReadOnlyDictionary<string, LocalChunk> localIndex,
        string tempDirectory, IProgress<UpdateProgress>? progress, CancellationToken ct)
    {
        using var source = new FileStream(sourcePath, FileMode.Open, FileAccess.Read, FileShare.Read, 128 * 1024, FileOptions.RandomAccess);
        using var output = new FileStream(targetPath, FileMode.Create, FileAccess.Write, FileShare.None, 128 * 1024, FileOptions.SequentialScan);
        var buffer = new byte[128 * 1024]; long assembled = 0;
        foreach (var chunk in manifest.Chunks)
        {
            ct.ThrowIfCancellationRequested();
            if (localIndex.TryGetValue(chunk.Sha256, out var local) && local.Size == chunk.Size)
            {
                source.Position = local.Offset;
                CopyExactly(source, output, chunk.Size, buffer, ct);
            }
            else
            {
                var chunkPath = Path.Combine(tempDirectory, chunk.Sha256 + ".chunk");
                if (!File.Exists(chunkPath)) throw new IOException("A required changed part is missing.");
                using var changed = new FileStream(chunkPath, FileMode.Open, FileAccess.Read, FileShare.Read, 64 * 1024, FileOptions.SequentialScan);
                if (changed.Length != chunk.Size) throw new IOException("A changed part has an unexpected size.");
                CopyExactly(changed, output, chunk.Size, buffer, ct);
            }
            assembled += chunk.Size;
            progress?.Report(new UpdateProgress(0.82 + 0.14 * Math.Min(1.0, (double)assembled / manifest.Size), assembled, manifest.Size,
                UpdatePhase.ApplyingDelta, "Rebuilding PDF Studio from the changed parts…"));
        }
        output.Flush(true);
        if (assembled != manifest.Size || output.Length != manifest.Size) throw new IOException("The rebuilt executable has an unexpected size.");
    }

    private static void CopyExactly(Stream source, Stream destination, int size, byte[] buffer, CancellationToken ct)
    {
        var remaining = size;
        while (remaining > 0)
        {
            ct.ThrowIfCancellationRequested();
            var read = source.Read(buffer, 0, Math.Min(buffer.Length, remaining));
            if (read <= 0) throw new EndOfStreamException("An update part was truncated.");
            destination.Write(buffer, 0, read);
            remaining -= read;
        }
    }

    private static async Task DownloadZipAsync(UpdateInfo update, string target, IProgress<UpdateProgress>? progress, CancellationToken ct)
    {
        await DownloadFileAsync(update.ZipUrl!, ZipTempPath, update.ZipSize, progress, 0.85, 0.0, ct).ConfigureAwait(false);
        progress?.Report(new UpdateProgress(0.87, update.ZipSize, update.ZipSize, UpdatePhase.Verifying, "Checking the compressed package…"));
        await using (var zipStream = File.OpenRead(ZipTempPath))
        {
            var actual = Convert.ToHexString(await SHA256.HashDataAsync(zipStream, ct).ConfigureAwait(false));
            if (!string.Equals(actual, update.ZipSha256, StringComparison.OrdinalIgnoreCase))
                throw new IOException("The downloaded package failed its integrity check.");
        }
        progress?.Report(new UpdateProgress(0.90, 0, 0, UpdatePhase.Unpacking, "Unpacking the update…"));
        await Task.Run(() =>
        {
            using var archive = ZipFile.OpenRead(ZipTempPath);
            var entry = archive.Entries.FirstOrDefault(e => string.Equals(e.Name, "PdfStudio.exe", StringComparison.OrdinalIgnoreCase))
                        ?? throw new IOException("The package does not contain PdfStudio.exe.");
            if (update.Size > 0 && entry.Length != update.Size) throw new IOException("The package holds an unexpected file.");
            ZipFileExtensions.ExtractToFile(entry, target, true);
        }, ct).ConfigureAwait(false);
        TryDelete(ZipTempPath);
        progress?.Report(new UpdateProgress(0.94, 0, 0, UpdatePhase.Verifying, "Checking the rebuilt executable…"));
        await VerifyExeAsync(target, update, ct).ConfigureAwait(false);
        progress?.Report(new UpdateProgress(1.0, 0, 0, UpdatePhase.Verifying, "The update is verified."));
    }

    private static async Task DownloadFileAsync(string url, string target, long expectedSize, IProgress<UpdateProgress>? progress,
        double scale, double offset, CancellationToken ct)
    {
        using var request = Get(url);
        using var response = await Http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct).ConfigureAwait(false);
        if (response.StatusCode == HttpStatusCode.NotFound) throw new IOException("This version is no longer available on the update server.");
        if (response.StatusCode == HttpStatusCode.Unauthorized) throw new IOException("The update server did not accept this app's access key.");
        response.EnsureSuccessStatusCode();
        var total = response.Content.Headers.ContentLength ?? expectedSize;
        await using (var source = await response.Content.ReadAsStreamAsync(ct).ConfigureAwait(false))
        await using (var destination = new FileStream(target, FileMode.Create, FileAccess.Write, FileShare.None, 128 * 1024, FileOptions.Asynchronous | FileOptions.SequentialScan))
        {
            var buffer = new byte[128 * 1024]; long done = 0; int read;
            while ((read = await source.ReadAsync(buffer.AsMemory(0, buffer.Length), ct).ConfigureAwait(false)) > 0)
            {
                await destination.WriteAsync(buffer.AsMemory(0, read), ct).ConfigureAwait(false);
                done += read;
                if (total > 0) progress?.Report(new UpdateProgress(offset + scale * Math.Min(1.0, (double)done / total), done, total, UpdatePhase.Downloading));
                else progress?.Report(new UpdateProgress(offset, done, 0, UpdatePhase.Downloading));
            }
            await destination.FlushAsync(ct).ConfigureAwait(false);
        }
        if (expectedSize > 0 && new FileInfo(target).Length != expectedSize) throw new IOException("The download is incomplete. Please try again.");
    }

    private static async Task VerifyExeAsync(string target, UpdateInfo update, CancellationToken ct)
    {
        if (update.Size > 0 && new FileInfo(target).Length != update.Size) throw new IOException("The rebuilt executable has an unexpected size.");
        await using var stream = File.OpenRead(target);
        var header = new byte[2];
        if (await stream.ReadAsync(header.AsMemory(0, 2), ct).ConfigureAwait(false) != 2 || header[0] != (byte)'M' || header[1] != (byte)'Z')
            throw new IOException("The downloaded file is not a Windows program.");
        if (!string.IsNullOrEmpty(update.Sha256))
        {
            stream.Position = 0;
            var actual = Convert.ToHexString(await SHA256.HashDataAsync(stream, ct).ConfigureAwait(false));
            if (!string.Equals(actual, update.Sha256, StringComparison.OrdinalIgnoreCase))
                throw new IOException("The rebuilt executable failed its integrity check and was discarded.");
        }
    }

    private static void VerifyPortableCopy(string path, UpdateInfo update)
    {
        var info = new FileInfo(path);
        if (!info.Exists || (update.Size > 0 && info.Length != update.Size))
            throw new IOException("The copied Version 3 portable executable has an unexpected size.");
        using var stream = File.OpenRead(path);
        var header = new byte[2];
        if (stream.Read(header, 0, header.Length) != header.Length || header[0] != (byte)'M' || header[1] != (byte)'Z')
            throw new IOException("The copied Version 3 file is not a valid Windows executable.");
        if (!string.IsNullOrWhiteSpace(update.Sha256))
        {
            stream.Position = 0;
            var actual = Convert.ToHexString(SHA256.HashData(stream));
            if (!string.Equals(actual, update.Sha256, StringComparison.OrdinalIgnoreCase))
                throw new IOException("The copied Version 3 portable executable failed its SHA-256 check.");
        }
    }

    private static void TryDelete(string path) { try { if (File.Exists(path)) File.Delete(path); } catch { } }

    private static void CleanupUpdateTemps()
    {
        TryDelete(NewPath); TryDelete(ZipTempPath); TryDelete(DeltaTempPath);
    }

    // ───────────────────────── 3. apply ─────────────────────────

    /// <summary>Revalidates the staged executable, swaps it into place and restarts only after the user confirms.</summary>
    public static void ApplyAndRestart(string newFile, UpdateInfo update)
    {
        if (!File.Exists(newFile))
        {
            BackgroundUpdateService.DiscardInvalidStagedUpdate(newFile, update.Version);
            throw new FileNotFoundException("The downloaded update is no longer available. Check for updates to download it again.", newFile);
        }
        var info = new FileInfo(newFile);
        if (update.Size > 0 && info.Length != update.Size)
        {
            BackgroundUpdateService.DiscardInvalidStagedUpdate(newFile, update.Version);
            throw new IOException("The staged update's size changed after download. The invalid file was removed; download it again before installing.");
        }
        using (var stream = File.OpenRead(newFile))
        {
            var header = new byte[2];
            if (stream.Read(header, 0, 2) != 2 || header[0] != (byte)'M' || header[1] != (byte)'Z')
            {
                BackgroundUpdateService.DiscardInvalidStagedUpdate(newFile, update.Version);
                throw new IOException("The staged update is not a valid Windows executable. The invalid file was removed; download it again before installing.");
            }
            if (!string.IsNullOrWhiteSpace(update.Sha256))
            {
                stream.Position = 0;
                var actual = Convert.ToHexString(SHA256.HashData(stream));
                if (!string.Equals(actual, update.Sha256, StringComparison.OrdinalIgnoreCase))
                {
                    BackgroundUpdateService.DiscardInvalidStagedUpdate(newFile, update.Version);
                    throw new IOException("The staged update failed its final SHA-256 integrity check. The invalid file was removed; download it again before installing.");
                }
            }
        }

        if (IsPlatformMigration(update))
        {
            var exe = ExePath ?? throw new InvalidOperationException("Cannot locate the running legacy executable.");
            var replacement = exe + ".v3.new";
            var old = OldPath;

            // Preferred path: replace the running legacy EXE with the verified portable launcher. Existing shortcuts
            // and the original portable folder keep working, and no installer or registry setup is involved.
            if (CanSelfUpdate(out _))
            {
                var movedOldAside = false;
                try
                {
                    TryDelete(replacement);
                    File.Copy(newFile, replacement, true);
                    VerifyPortableCopy(replacement, update);
                    TryDelete(old);
                    File.Move(exe, old);
                    movedOldAside = true;
                    try { File.Move(replacement, exe); }
                    catch
                    {
                        if (movedOldAside && !File.Exists(exe) && File.Exists(old)) File.Move(old, exe);
                        throw;
                    }

                    BackgroundUpdateService.ClearPendingMarker();
                    TryDelete(MigrationMarkerPath);
                    var started = Process.Start(new ProcessStartInfo(exe)
                    {
                        UseShellExecute = true,
                        WorkingDirectory = Path.GetDirectoryName(exe)!
                    });
                    if (started is null) throw new InvalidOperationException("Windows could not start the PDF Studio 3 portable app.");
                    if (!string.Equals(Path.GetFullPath(newFile), Path.GetFullPath(exe), StringComparison.OrdinalIgnoreCase)) TryDelete(newFile);
                    return;
                }
                catch
                {
                    TryDelete(replacement);
                    // If the second rename failed, restore the legacy file before trying the user-local fallback.
                    if (movedOldAside && File.Exists(old) && !File.Exists(exe))
                    {
                        try { File.Move(old, exe); } catch { }
                    }
                    // Continue into the fallback below; this is intentional for protected folders and antivirus locks.
                }
            }

            // Fallback: keep the legacy file untouched, save the portable app under LocalAppData, and launch it.
            // Program.Main redirects the old shortcut to this copy on later launches; no admin rights are required.
            Directory.CreateDirectory(PortableRoot);
            var fallbackTemp = PortableFallbackPath + ".new";
            TryDelete(fallbackTemp);
            File.Copy(newFile, fallbackTemp, true);
            VerifyPortableCopy(fallbackTemp, update);
            File.Move(fallbackTemp, PortableFallbackPath, true);
            var fallbackStarted = Process.Start(new ProcessStartInfo(PortableFallbackPath)
            {
                UseShellExecute = true,
                WorkingDirectory = PortableRoot
            });
            if (fallbackStarted is null) throw new InvalidOperationException("Windows could not start the portable PDF Studio 3 app.");
            Directory.CreateDirectory(Path.GetDirectoryName(MigrationMarkerPath)!);
            File.WriteAllText(MigrationMarkerPath, update.Version + Environment.NewLine);
            BackgroundUpdateService.ClearPendingMarker();
            if (!string.Equals(Path.GetFullPath(newFile), Path.GetFullPath(PortableFallbackPath), StringComparison.OrdinalIgnoreCase)) TryDelete(newFile);
            return;
        }

        var exe = ExePath ?? throw new InvalidOperationException("Cannot locate the running program.");
        var old = OldPath;
        try { if (File.Exists(old)) File.Delete(old); } catch { }
        File.Move(exe, old);
        try { File.Move(newFile, exe); }
        catch { try { File.Move(old, exe); } catch { } throw; }
        BackgroundUpdateService.ClearPendingMarker();
        Process.Start(new ProcessStartInfo(exe) { UseShellExecute = true, WorkingDirectory = Path.GetDirectoryName(exe)! });
    }
}
