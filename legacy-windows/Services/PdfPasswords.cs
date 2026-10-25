using PdfSharp.Pdf;
using PdfSharp.Pdf.IO;

namespace PdfStudio.Services;

/// <summary>Remembers passwords of unlocked PDFs for this session only (never written to disk).</summary>
public static class PdfPasswords
{
    private static readonly Dictionary<string, string> map = new(StringComparer.OrdinalIgnoreCase);
    private static readonly object gate = new();

    public static void Set(string path, string password) { lock (gate) map[path] = password; }

    public static string? Get(string path) { lock (gate) return map.TryGetValue(path, out var p) ? p : null; }

    /// <summary>Opens a PDF with PDFsharp, using the remembered password when there is one.</summary>
    public static PdfDocument Open(string path, PdfDocumentOpenMode mode)
    {
        var pw = Get(path);
        return string.IsNullOrEmpty(pw) ? PdfReader.Open(path, mode) : PdfReader.Open(path, pw, mode);
    }

    public static bool IsPasswordProblem(Exception ex)
    {
        for (var e = ex; e is not null; e = e.InnerException!)
        {
            var m = e.Message ?? "";
            if (m.Contains("password", StringComparison.OrdinalIgnoreCase) ||
                m.Contains("encrypt", StringComparison.OrdinalIgnoreCase) ||
                m.Contains("protected", StringComparison.OrdinalIgnoreCase)) return true;
            if (e.InnerException is null) break;
        }
        return false;
    }
}
