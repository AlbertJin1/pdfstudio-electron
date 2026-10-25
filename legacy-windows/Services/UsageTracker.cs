using PdfStudio.UI;
using System.Diagnostics;
using System.Text.Json;

namespace PdfStudio.Services;

/// <summary>
/// Sends anonymous usage statistics (app opened, how long it stays open) and user reviews to the PDF Studio Monitor
/// web app (PHP) through its ngrok address. No files, file names or Windows user name are ever sent: only a random
/// install id, the app version, the Windows version, the open time and the PC's host name and local (LAN) IP address.
/// The host name lets the monitor recognise the same PC: if the settings file is lost and a new install id is generated,
/// the monitor answers with the PC's original install id and the app adopts it, so one PC stays one install.
///
/// Reliability: "open" and "close" events that cannot be delivered (offline, server down) are kept in a small queue file and
/// re-sent the next time the app starts. A "heartbeat" every minute carries the total open time, so even a crash or a
/// killed process still counts almost all of its time.
///
/// Settings (key=value lines in %LOCALAPPDATA%\PdfStudio\settings.txt):
///   usage_stats = 1 / 0      share anonymous usage statistics (default 1 = always on; the app has no checkbox for it, set 0 here only for testing)
///   monitor_url = https://…/pdfstudio-monitor/api   override the server address
///   monitor_key = …          override the API key (must equal 'api_key' in the server's config.php)
/// </summary>
public static class UsageTracker
{
    // ngrok serves HTTPS on the default port (443): ngrok forwards it to the PHP server that listens on :8080 on the host PC.
    public const string DefaultBaseUrl = "https://pdfstudio.shares.zrok.io/pdfstudio-monitor/api";
    // Must be the same value as 'api_key' in pdfstudio-monitor/config.php. Change both before you ship.
    private const string DefaultApiKey = "2YN0sJIeJZeGL33wip2xmN2YEvs4TzqV";

    private const int HeartbeatMs = 60_000;
    private const int MaxQueued = 100;

    private static readonly HttpClient Http = CreateClient();
    private static readonly object Gate = new();
    private static readonly Stopwatch Clock = new();
    private static readonly string SessionId = Guid.NewGuid().ToString("N");
    private static long startedAt;
    private static System.Threading.Timer? heartbeat, reviewRetry;
    private static bool started, stopped;
    private static int flushingQueue;

    // internal: UpdateService talks to the same monitor server with the same address and key.
    internal static string BaseUrl => AppSettings.Get("monitor_url", DefaultBaseUrl).Trim().TrimEnd('/');
    internal static string ApiKey => AppSettings.Get("monitor_key", DefaultApiKey).Trim();
    private static string QueuePath => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "PdfStudio", "usage-queue.jsonl");

    /// <summary>Whether anonymous usage statistics are shared. On by default and not exposed in the UI (reviews are sent when the user presses Send).</summary>
    public static bool Enabled => AppSettings.GetBool("usage_stats", true);
    public static void SetEnabled(bool on) => AppSettings.SetBool("usage_stats", on);

    /// <summary>True after the user has submitted a review or accepted saving it for later delivery.</summary>
    public static bool HasReviewed => AppSettings.GetBool("review_completed", false);
    public static bool ReviewPending => HasReviewed && AppSettings.GetBool("review_pending", false);

    private static void MarkReviewSubmitted(bool pending)
    {
        AppSettings.SetBool("review_completed", true);
        AppSettings.SetBool("review_pending", pending);
    }

    private static string InstallId
    {
        get
        {
            var id = AppSettings.Get("install_id");
            if (id.Length < 16) { id = Guid.NewGuid().ToString("N"); AppSettings.Set("install_id", id); }
            return id;
        }
    }

    /// <summary>The PC's name (Windows computer name). Used by the monitor to keep one install id per PC.</summary>
    private static string HostName
    {
        get
        {
            try
            {
                var h = Environment.MachineName?.Trim() ?? "";
                return h.Length > 64 ? h[..64] : h;
            }
            catch { return ""; }
        }
    }

    private static string? localIp;
    private static DateTime localIpAt;

    /// <summary>The PC's own IPv4 address on its active network (the monitor sees the public address by itself). Cached for 10 minutes.</summary>
    private static string LocalIp
    {
        get
        {
            if (localIp is not null && DateTime.UtcNow - localIpAt < TimeSpan.FromMinutes(10)) return localIp;
            var found = "";
            try
            {
                foreach (var nic in System.Net.NetworkInformation.NetworkInterface.GetAllNetworkInterfaces())
                {
                    if (nic.OperationalStatus != System.Net.NetworkInformation.OperationalStatus.Up) continue;
                    if (nic.NetworkInterfaceType is System.Net.NetworkInformation.NetworkInterfaceType.Loopback
                                                or System.Net.NetworkInformation.NetworkInterfaceType.Tunnel) continue;
                    var props = nic.GetIPProperties();
                    // only an adapter that has a default gateway is really connected to a network (skips virtual adapters)
                    if (!props.GatewayAddresses.Any(g => g.Address.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork
                                                         && !g.Address.Equals(System.Net.IPAddress.Any))) continue;
                    var ua = props.UnicastAddresses.FirstOrDefault(a => a.Address.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork);
                    if (ua is null) continue;
                    found = ua.Address.ToString();
                    break;
                }
            }
            catch { }
            localIp = found; localIpAt = DateTime.UtcNow;
            return found;
        }
    }

    /// <summary>The monitor answers with the install id it keeps for this PC; adopt it when it differs from ours.</summary>
    private static void AdoptInstallId(string responseBody)
    {
        try
        {
            using var doc = JsonDocument.Parse(responseBody);
            if (!doc.RootElement.TryGetProperty("install_id", out var e) || e.ValueKind != JsonValueKind.String) return;
            var id = (e.GetString() ?? "").Trim().ToLowerInvariant();
            if (id.Length is < 16 or > 64 || !id.All(c => (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return;
            if (!string.Equals(id, AppSettings.Get("install_id"), StringComparison.Ordinal)) AppSettings.Set("install_id", id);
        }
        catch { }
    }

    private static HttpClient CreateClient()
    {
        var c = new HttpClient { Timeout = TimeSpan.FromSeconds(10) };
        c.DefaultRequestHeaders.TryAddWithoutValidation("User-Agent", $"PdfStudio/{AppInfo.Version}");
        c.DefaultRequestHeaders.TryAddWithoutValidation("ngrok-skip-browser-warning", "1");   // skips ngrok's free-plan interstitial page
        c.DefaultRequestHeaders.TryAddWithoutValidation("Accept", "application/json");
        return c;
    }

    // ───────────────────────── session ─────────────────────────

    /// <summary>Call once when the main window is shown: records one "open" and starts the minute heartbeat.</summary>
    public static void Start()
    {
        if (started) return;
        started = true; stopped = false;
        // Reviews have their own retry path, even when anonymous usage statistics were disabled for testing.
        reviewRetry = new System.Threading.Timer(_ => { if (!stopped) _ = FlushQueueAsync(); }, null, HeartbeatMs, HeartbeatMs);
        _ = FlushQueueAsync();
        if (!Enabled) return;
        startedAt = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        Clock.Start();
        _ = Task.Run(async () =>
        {
            if (!await SendAsync(Build("open"), 8000).ConfigureAwait(false)) Enqueue(Build("open"));
            await FlushQueueAsync().ConfigureAwait(false);
        });
        heartbeat = new System.Threading.Timer(_ =>
        {
            if (stopped || !Enabled) return;
            _ = SendAsync(Build("heartbeat"), 8000);          // cumulative, so a missed one is harmless
            _ = FlushQueueAsync();                           // also retries pending reviews/events when connectivity returns
        }, null, HeartbeatMs, HeartbeatMs);
    }

    /// <summary>Call when the main window has closed: sends the final open time (waits at most ~3 s).</summary>
    public static void Stop()
    {
        if (!started || stopped) return;
        stopped = true;
        try { heartbeat?.Dispose(); reviewRetry?.Dispose(); } catch { }
        heartbeat = null; reviewRetry = null;
        if (!Enabled) return;
        Clock.Stop();
        var payload = Build("close");
        try { Task.Run(() => SendAsync(payload, 2500)).Wait(3000); } catch { }
        if (!sentClose) Enqueue(payload);      // not delivered in time: it is re-sent the next time the app starts
    }

    private static volatile bool sentClose;

    private static Dictionary<string, object?> Build(string kind) => new()
    {
        ["event"] = kind,
        ["session_id"] = SessionId,
        ["install_id"] = InstallId,
        ["version"] = AppInfo.Version,
        ["os"] = System.Runtime.InteropServices.RuntimeInformation.OSDescription,
        ["hostname"] = HostName,
        ["local_ip"] = LocalIp,
        ["started_at"] = startedAt,
        ["seconds"] = (long)Clock.Elapsed.TotalSeconds
    };

    // ───────────────────────── reviews ─────────────────────────

    /// <summary>Sends a review. Returns (true, "") on success or (false, message to show the user).</summary>
    public readonly record struct ReviewSubmitResult(bool Ok, bool Pending, string Error);

    /// <summary>Submits a review immediately, or saves it in the offline queue when the monitor cannot be reached.</summary>
    public static async Task<ReviewSubmitResult> SubmitReviewAsync(int rating, string name, string message)
    {
        var payload = new Dictionary<string, object?>
        {
            ["event"] = "review",
            ["review_id"] = Guid.NewGuid().ToString("N"),
            ["install_id"] = InstallId,
            ["version"] = AppInfo.Version,
            ["os"] = System.Runtime.InteropServices.RuntimeInformation.OSDescription,
            ["hostname"] = HostName,
            ["local_ip"] = LocalIp,
            ["rating"] = rating,
            ["name"] = name,
            ["message"] = message
        };
        try
        {
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(12));
            using var content = new StringContent(JsonSerializer.Serialize(payload), System.Text.Encoding.UTF8, "application/json");
            using var req = new HttpRequestMessage(HttpMethod.Post, BaseUrl + "/") { Content = content };
            req.Headers.TryAddWithoutValidation("X-Api-Key", ApiKey);
            using var res = await Http.SendAsync(req, cts.Token).ConfigureAwait(false);
            var body = await res.Content.ReadAsStringAsync(cts.Token).ConfigureAwait(false);
            if (res.IsSuccessStatusCode)
            {
                AdoptInstallId(body);
                MarkReviewSubmitted(false);
                return new ReviewSubmitResult(true, false, "");
            }
            if ((int)res.StatusCode >= 400 && (int)res.StatusCode < 500)
                return new ReviewSubmitResult(false, false, ServerError(body) ?? $"The server answered with an error ({(int)res.StatusCode}). Please try again later.");

            Enqueue(payload);
            MarkReviewSubmitted(true);
            return new ReviewSubmitResult(true, true, "");
        }
        catch (TaskCanceledException)
        {
            Enqueue(payload); MarkReviewSubmitted(true);
            return new ReviewSubmitResult(true, true, "");
        }
        catch (HttpRequestException)
        {
            Enqueue(payload); MarkReviewSubmitted(true);
            return new ReviewSubmitResult(true, true, "");
        }
        catch
        {
            // Treat unexpected transport failures like an offline condition; the review must not be lost.
            Enqueue(payload); MarkReviewSubmitted(true);
            return new ReviewSubmitResult(true, true, "");
        }
    }

    private static string? ServerError(string body)
    {
        try
        {
            using var doc = JsonDocument.Parse(body);
            return doc.RootElement.TryGetProperty("error", out var e) && e.ValueKind == JsonValueKind.String ? e.GetString() : null;
        }
        catch { return null; }
    }

    // ───────────────────────── transport ─────────────────────────

    private static async Task<bool> SendAsync(Dictionary<string, object?> payload, int timeoutMs)
    {
        try { return await SendJsonAsync(JsonSerializer.Serialize(payload), timeoutMs, payload.TryGetValue("event", out var ev) && ev as string == "close").ConfigureAwait(false); }
        catch { return false; }
    }

    private static async Task<bool> SendJsonAsync(string json, int timeoutMs, bool isClose = false)
    {
        try
        {
            using var cts = new CancellationTokenSource(timeoutMs);
            using var content = new StringContent(json, System.Text.Encoding.UTF8, "application/json");
            using var req = new HttpRequestMessage(HttpMethod.Post, BaseUrl + "/") { Content = content };
            req.Headers.TryAddWithoutValidation("X-Api-Key", ApiKey);
            using var res = await Http.SendAsync(req, cts.Token).ConfigureAwait(false);
            if (res.IsSuccessStatusCode)
                AdoptInstallId(await res.Content.ReadAsStringAsync(cts.Token).ConfigureAwait(false));
            // 2xx = stored. 4xx = the server rejected it for good (do not queue it forever). 5xx / network = try again later.
            var ok = res.IsSuccessStatusCode || ((int)res.StatusCode is >= 400 and < 500);
            if (ok && isClose) sentClose = true;
            return ok;
        }
        catch { return false; }
    }

    // ───────────────────────── offline queue ─────────────────────────

    private static void Enqueue(Dictionary<string, object?> payload)
    {
        try
        {
            lock (Gate)
            {
                Directory.CreateDirectory(Path.GetDirectoryName(QueuePath)!);
                var lines = File.Exists(QueuePath) ? File.ReadAllLines(QueuePath).ToList() : new List<string>();
                lines.Add(JsonSerializer.Serialize(payload));
                if (lines.Count > MaxQueued) lines = lines.Skip(lines.Count - MaxQueued).ToList();
                File.WriteAllLines(QueuePath, lines);
            }
        }
        catch { }
    }

    private static async Task FlushQueueAsync()
    {
        if (Interlocked.Exchange(ref flushingQueue, 1) != 0) return;
        try
        {
            string[] lines;
            lock (Gate)
            {
                try { lines = File.Exists(QueuePath) ? File.ReadAllLines(QueuePath) : Array.Empty<string>(); }
                catch { return; }
            }
            if (lines.Length == 0) return;
            var keep = new List<string>();
            foreach (var line in lines)
            {
                if (string.IsNullOrWhiteSpace(line)) continue;
                var delivered = await SendJsonAsync(line, 6000).ConfigureAwait(false);
                if (!delivered)
                {
                    keep.Add(line);
                    continue;
                }
                try
                {
                    using var doc = JsonDocument.Parse(line);
                    if (doc.RootElement.TryGetProperty("event", out var ev) && ev.GetString() == "review")
                    {
                        AppSettings.SetBool("review_pending", false);
                        AppSettings.SetBool("review_completed", true);
                    }
                }
                catch { }
            }
            lock (Gate)
            {
                try
                {
                    // anything queued while we were sending stays; only the original delivered entries are removed
                    var now = File.Exists(QueuePath) ? File.ReadAllLines(QueuePath) : Array.Empty<string>();
                    var extra = now.Skip(lines.Length);
                    var left = keep.Concat(extra).ToList();
                    if (left.Count == 0) File.Delete(QueuePath); else File.WriteAllLines(QueuePath, left);
                }
                catch { }
            }
        }
        finally { Volatile.Write(ref flushingQueue, 0); }
    }
}