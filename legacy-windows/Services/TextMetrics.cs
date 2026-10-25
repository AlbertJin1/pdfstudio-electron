using System.Drawing;
using System.Drawing.Text;

namespace PdfStudio.Services;

/// <summary>
/// Font metrics shared by the editor canvas, the preview and the PDF export so that text lands on exactly the same
/// baseline everywhere. Widths are measured at a large reference size (no hinting / pixel rounding), then scaled.
/// </summary>
public static class TextMetrics
{
    private const float RefSize = 100f;
    private static readonly Bitmap MeasureBmp = new(1, 1);
    private static readonly object Gate = new();
    private static readonly Dictionary<string, FontFamily> Families = new(StringComparer.OrdinalIgnoreCase);
    private static readonly Dictionary<string, float> WidthCache = new();

    public static FontFamily Family(string? name)
    {
        var key = name ?? "";
        lock (Families)
        {
            if (Families.TryGetValue(key, out var f)) return f;
            try { f = new FontFamily(key); }
            catch
            {
                try { f = new FontFamily("Arial"); }
                catch { f = FontFamily.GenericSansSerif; }
            }
            Families[key] = f;
            return f;
        }
    }

    /// <summary>The closest style the family really has (so we never ask GDI+ for a style it would synthesise badly).</summary>
    public static FontStyle StyleFor(FontFamily fam, bool bold, bool italic)
    {
        var want = (bold ? FontStyle.Bold : FontStyle.Regular) | (italic ? FontStyle.Italic : FontStyle.Regular);
        foreach (var s in new[] { want, bold ? FontStyle.Bold : FontStyle.Regular, italic ? FontStyle.Italic : FontStyle.Regular, FontStyle.Regular })
        {
            try { if (fam.IsStyleAvailable(s)) return s; } catch { }
        }
        return FontStyle.Regular;
    }

    /// <summary>Distance from the top of the line box to the baseline, in the same unit as <paramref name="size"/>.</summary>
    public static double Ascent(string? fontName, double size, bool bold, bool italic)
    {
        var fam = Family(fontName); var st = StyleFor(fam, bold, italic);
        var em = fam.GetEmHeight(st);
        return em <= 0 ? size * 0.905 : fam.GetCellAscent(st) * size / em;
    }

    public static double Descent(string? fontName, double size, bool bold, bool italic)
    {
        var fam = Family(fontName); var st = StyleFor(fam, bold, italic);
        var em = fam.GetEmHeight(st);
        return em <= 0 ? size * 0.212 : fam.GetCellDescent(st) * size / em;
    }

    /// <summary>Advance width of one line of text (trailing spaces included), unhinted.</summary>
    public static double Advance(string? text, string? fontName, double size, bool bold, bool italic)
    {
        if (string.IsNullOrEmpty(text)) return 0;
        var fam = Family(fontName); var st = StyleFor(fam, bold, italic);
        var key = $"{fam.Name}|{(int)st}|{text}";
        float w;
        lock (Gate)
        {
            if (!WidthCache.TryGetValue(key, out w))
            {
                using var font = new Font(fam, RefSize, st, GraphicsUnit.Pixel);
                using var g = Graphics.FromImage(MeasureBmp);
                g.PageUnit = GraphicsUnit.Pixel;
                g.TextRenderingHint = TextRenderingHint.AntiAlias;
                using var sf = (StringFormat)StringFormat.GenericTypographic.Clone();
                sf.FormatFlags |= StringFormatFlags.MeasureTrailingSpaces | StringFormatFlags.NoWrap;
                w = g.MeasureString(text, font, 1_000_000, sf).Width;
                if (WidthCache.Count > 4000) WidthCache.Clear();
                WidthCache[key] = w;
            }
        }
        return w * size / RefSize;
    }
}
