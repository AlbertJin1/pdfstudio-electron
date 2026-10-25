using System.Net;
using System.Text.Json;

namespace PdfStudio.Services;

/// <summary>
/// Device-level access policy controlled by the PDF Studio Monitor.
///
/// Important design rule: PDF Studio never requires a server login to start.
/// A new/offline device is allowed to open normally. Once the monitor has
/// explicitly disabled a known installation, the deny decision is cached
/// locally and remains enforced until the monitor says the device is enabled.
/// </summary>
public static class AccessControlService
{
    public enum AccessState { Checking, Allowed, Denied }

    public readonly record struct AccessResult(
        AccessState State,
        string Reason,
        DateTimeOffset CheckedAt,
        bool FromServer);

    private const int PollSeconds = 30;
    private static readonly HttpClient Http = CreateClient();
    private static readonly object Gate = new();
    private static System.Threading.Timer? pollTimer;
    private static bool started;
    private static bool stopped;

    public static event Action<AccessResult>? StateChanged;

    public static AccessState State
    {
        get
        {
            var cached = AppSettings.Get("access_state", "unknown");
            return cached.Equals("denied", StringComparison.OrdinalIgnoreCase)
                ? AccessState.Denied
                : AccessState.Allowed;
        }
    }

    public static string Reason => AppSettings.Get("access_reason", "");
    public static DateTimeOffset? LastChecked
    {
        get
        {
            var raw = AppSettings.Get("access_checked_at", "");
            return long.TryParse(raw, out var unix) && unix > 0
                ? DateTimeOffset.FromUnixTimeSeconds(unix)
                : null;
        }
    }

    public static void Start()
    {
        lock (Gate)
        {
            if (started) return;
            started = true;
            stopped = false;
            pollTimer = new System.Threading.Timer(_ => _ = CheckAsync(), null, Timeout.Infinite, Timeout.Infinite);
        }

        // Do not block application startup. The app is intentionally usable while
        // the first check is in flight; an offline/failed check does not revoke access.
        _ = CheckAsync();
    }

    public static void Stop()
    {
        lock (Gate)
        {
            stopped = true;
            try { pollTimer?.Dispose(); } catch { }
            pollTimer = null;
        }
    }

    public static async Task<AccessResult> CheckAsync(CancellationToken ct = default)
    {
        if (stopped) return CurrentResult(false);

        var result = await QueryServerAsync(ct).ConfigureAwait(false);
        if (result.FromServer)
        {
            SaveServerState(result.State, result.Reason);
        }

        Raise(result);

        lock (Gate)
        {
            if (!stopped)
            {
                try { pollTimer?.Change(TimeSpan.FromSeconds(PollSeconds), Timeout.InfiniteTimeSpan); } catch { }
            }
        }
        return result;
    }

    private static AccessResult CurrentResult(bool fromServer)
    {
        var state = State;
        return new AccessResult(state, Reason, LastChecked ?? DateTimeOffset.UtcNow, fromServer);
    }

    private static async Task<AccessResult> QueryServerAsync(CancellationToken ct)
    {
        var installId = InstallId;
        if (installId.Length < 16)
            return new AccessResult(AccessState.Allowed, "", DateTimeOffset.UtcNow, false);

        try
        {
            using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            cts.CancelAfter(TimeSpan.FromSeconds(8));

            var url = $"{UsageTracker.BaseUrl}/access.php?app=pdfstudio" +
                      $"&install_id={Uri.EscapeDataString(installId)}" +
                      $"&version={Uri.EscapeDataString(UpdateService.CurrentVersion)}" +
                      $"&hostname={Uri.EscapeDataString(Environment.MachineName)}" +
                      $"&local_ip={Uri.EscapeDataString(GetLocalIp())}";

            using var req = new HttpRequestMessage(HttpMethod.Get, url);
            req.Headers.TryAddWithoutValidation("X-Api-Key", UsageTracker.ApiKey);
            req.Headers.TryAddWithoutValidation("ngrok-skip-browser-warning", "1");
            using var res = await Http.SendAsync(req, cts.Token).ConfigureAwait(false);

            var body = await res.Content.ReadAsStringAsync(cts.Token).ConfigureAwait(false);
            if (res.StatusCode == HttpStatusCode.Unauthorized)
            {
                // A broken/mismatched monitor key is a connectivity/configuration problem,
                // not an access denial. Never lock a user out because of it.
                return CurrentResult(false);
            }
            if (!res.IsSuccessStatusCode)
                return CurrentResult(false);

            using var doc = JsonDocument.Parse(body);
            var root = doc.RootElement;
            if (!root.TryGetProperty("ok", out var ok) || !ok.GetBoolean())
                return CurrentResult(false);

            if (root.TryGetProperty("install_id", out var canonical))
            {
                var id = canonical.GetString()?.Trim().ToLowerInvariant() ?? "";
                if (IsValidInstallId(id) && !id.Equals(AppSettings.Get("install_id"), StringComparison.Ordinal))
                    AppSettings.Set("install_id", id);
            }

            var enabled = !root.TryGetProperty("enabled", out var en) || en.GetBoolean();
            var reason = root.TryGetProperty("reason", out var rs) && rs.ValueKind == JsonValueKind.String
                ? rs.GetString() ?? ""
                : "";

            return new AccessResult(
                enabled ? AccessState.Allowed : AccessState.Denied,
                reason,
                DateTimeOffset.UtcNow,
                true);
        }
        catch (OperationCanceledException)
        {
            return CurrentResult(false);
        }
        catch (HttpRequestException)
        {
            return CurrentResult(false);
        }
        catch (JsonException)
        {
            return CurrentResult(false);
        }
        catch
        {
            return CurrentResult(false);
        }
    }

    private static void SaveServerState(AccessState state, string reason)
    {
        AppSettings.Set("access_state", state == AccessState.Denied ? "denied" : "allowed");
        AppSettings.Set("access_reason", reason ?? "");
        AppSettings.Set("access_checked_at", DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString());
    }

    private static void Raise(AccessResult result)
    {
        try { StateChanged?.Invoke(result); } catch { }
    }

    private static string InstallId
    {
        get
        {
            var id = AppSettings.Get("install_id");
            if (!IsValidInstallId(id))
            {
                id = Guid.NewGuid().ToString("N");
                AppSettings.Set("install_id", id);
            }
            return id;
        }
    }

    private static bool IsValidInstallId(string? id) =>
        id is not null && id.Length is >= 16 and <= 128 &&
        id.All(c => (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F'));

    private static string GetLocalIp()
    {
        try
        {
            foreach (var nic in System.Net.NetworkInformation.NetworkInterface.GetAllNetworkInterfaces())
            {
                if (nic.OperationalStatus != System.Net.NetworkInformation.OperationalStatus.Up) continue;
                if (nic.NetworkInterfaceType is System.Net.NetworkInformation.NetworkInterfaceType.Loopback
                    or System.Net.NetworkInformation.NetworkInterfaceType.Tunnel) continue;
                var props = nic.GetIPProperties();
                if (!props.GatewayAddresses.Any(g => g.Address.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork
                                                     && !g.Address.Equals(System.Net.IPAddress.Any))) continue;
                var ua = props.UnicastAddresses.FirstOrDefault(a =>
                    a.Address.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork);
                if (ua != null) return ua.Address.ToString();
            }
        }
        catch { }
        return "";
    }

    private static HttpClient CreateClient()
    {
        var c = new HttpClient { Timeout = TimeSpan.FromSeconds(10) };
        c.DefaultRequestHeaders.TryAddWithoutValidation("User-Agent", $"PdfStudio/{UI.AppInfo.Version}");
        c.DefaultRequestHeaders.TryAddWithoutValidation("Accept", "application/json");
        return c;
    }
}
