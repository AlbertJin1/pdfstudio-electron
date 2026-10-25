namespace PdfStudio.Services;

/// <summary>Tiny persisted preferences (key=value lines in %LOCALAPPDATA%\PdfStudio\settings.txt).</summary>
public static class AppSettings
{
    private static readonly Dictionary<string, string> values = new(StringComparer.OrdinalIgnoreCase);
    private static bool loaded;

    private static string FilePath => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "PdfStudio", "settings.txt");

    private static void Load()
    {
        if (loaded) return;
        loaded = true;
        try
        {
            if (!File.Exists(FilePath)) return;
            foreach (var line in File.ReadAllLines(FilePath))
            {
                var i = line.IndexOf('=');
                if (i > 0) values[line[..i].Trim()] = line[(i + 1)..].Trim();
            }
        }
        catch { }
    }

    private static void Save()
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(FilePath)!);
            File.WriteAllLines(FilePath, values.Select(kv => $"{kv.Key}={kv.Value}"));
        }
        catch { }
    }

    public static string Get(string key, string fallback = "") { Load(); return values.TryGetValue(key, out var v) ? v : fallback; }
    public static bool GetBool(string key, bool fallback) { Load(); return values.TryGetValue(key, out var v) ? v == "1" : fallback; }
    public static int GetInt(string key, int fallback) { Load(); return values.TryGetValue(key, out var v) && int.TryParse(v, out var n) ? n : fallback; }

    public static void Set(string key, string value) { Load(); values[key] = value; Save(); }
    public static void SetBool(string key, bool value) => Set(key, value ? "1" : "0");
    public static void SetInt(string key, int value) => Set(key, value.ToString());

    public static bool LoadDark() => GetBool("dark", false);
    public static void SaveDark(bool dark) => SetBool("dark", dark);
}
