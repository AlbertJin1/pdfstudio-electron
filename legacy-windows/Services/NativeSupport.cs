using System.Runtime.InteropServices;

namespace PdfStudio.Services;

/// <summary>
/// Checks once whether the PDFium native library (pdfium.dll) can be loaded. PDFtoImage keeps a static PDFium
/// handle whose finalizer throws DllNotFoundException on a background thread when pdfium.dll is missing, which
/// used to surface as a crash dialog. Every PDFium call in the app is gated on <see cref="PdfiumAvailable"/>
/// so that case becomes an ordinary, explained "preview unavailable" instead.
/// </summary>
public static class NativeSupport
{
    public const string PdfiumMissingMessage =
        "The PDF preview engine (pdfium.dll) was not found next to PdfStudio.exe, so PDF pages cannot be drawn. " +
        "Use a PdfStudio.exe built with build_publish.bat (it bundles pdfium.dll inside the exe), or put pdfium.dll next to the exe. " +
        "Images you add still work.";

    private static readonly object Gate = new();
    private static bool? pdfium;

    public static bool PdfiumAvailable
    {
        get { lock (Gate) { pdfium ??= Probe(); return pdfium.Value; } }
    }

    private static bool Probe()
    {
        try
        {
            // Normal probing (app folder / PATH), exactly what PDFtoImage's own import does.
            if (NativeLibrary.TryLoad("pdfium", typeof(NativeSupport).Assembly, null, out _)) return true;

            // Explicit folders; once loaded by full path, later imports of "pdfium" resolve to the same module.
            var dirs = new List<string>();
            void Add(string? d) { if (!string.IsNullOrWhiteSpace(d) && !dirs.Contains(d)) dirs.Add(d); }
            Add(AppContext.BaseDirectory);
            try { Add(Path.GetDirectoryName(Environment.ProcessPath)); } catch { }
            foreach (var d in dirs.ToList()) Add(Path.Combine(d, "runtimes", "win-x64", "native"));
            foreach (var d in dirs)
            {
                var file = Path.Combine(d, "pdfium.dll");
                if (File.Exists(file) && NativeLibrary.TryLoad(file, out _)) return true;
            }
        }
        catch { }
        return false;
    }
}
