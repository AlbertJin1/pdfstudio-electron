using System.Drawing;
using System.Runtime.InteropServices;
using System.Text;
using PdfStudio.Models;

namespace PdfStudio.Services;

/// <summary>One line (or column fragment) of text that already exists in a PDF page. Points, top-left origin.</summary>
public sealed class PdfTextBlock
{
    public string Text { get; init; } = "";
    public RectangleF Box { get; init; }
    public double FontSize { get; init; }
    public string FontName { get; init; } = "Arial";
    public bool Bold { get; init; }
    public bool Italic { get; init; }
    /// <summary>Underline-only ranges imported from PDF line paths beneath the glyphs.</summary>
    public List<TextStyleRun> TextStyles { get; init; } = new();
    public Color Color { get; init; } = Color.Black;
    /// <summary>Pen origin of the first character (x) and the text baseline (y), points, top-left origin.</summary>
    public float OriginX { get; init; }
    public float Baseline { get; init; }
    /// <summary>Distance from the first character's pen origin to the last character's pen origin.</summary>
    public float Advance { get; init; }
}

/// <summary>
/// Reads the existing text of a page (with positions, font and colour) through the PDFium library that
/// PDFtoImage already ships, so the Edit PDF window can let the user click and change it.
/// </summary>
public static class PdfiumText
{
    private const string Lib = "pdfium";

    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] private static extern void FPDF_InitLibrary();
    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] private static extern IntPtr FPDF_LoadMemDocument(IntPtr data, int size, [MarshalAs(UnmanagedType.LPStr)] string? password);
    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] private static extern void FPDF_CloseDocument(IntPtr doc);
    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] private static extern IntPtr FPDF_LoadPage(IntPtr doc, int index);
    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] private static extern void FPDF_ClosePage(IntPtr page);
    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] private static extern float FPDF_GetPageWidthF(IntPtr page);
    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] private static extern float FPDF_GetPageHeightF(IntPtr page);
    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] private static extern int FPDF_PageToDevice(IntPtr page, int startX, int startY, int sizeX, int sizeY, int rotate, double pageX, double pageY, out int deviceX, out int deviceY);
    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] private static extern IntPtr FPDFText_LoadPage(IntPtr page);
    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] private static extern void FPDFText_ClosePage(IntPtr textPage);
    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] private static extern int FPDFText_CountChars(IntPtr textPage);
    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] private static extern uint FPDFText_GetUnicode(IntPtr textPage, int index);
    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] private static extern double FPDFText_GetFontSize(IntPtr textPage, int index);
    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] private static extern uint FPDFText_GetFontInfo(IntPtr textPage, int index, byte[]? buffer, uint length, out int flags);
    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] private static extern int FPDFText_GetFontWeight(IntPtr textPage, int index);
    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] private static extern int FPDFText_GetFillColor(IntPtr textPage, int index, out uint r, out uint g, out uint b, out uint a);
    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] private static extern int FPDFText_GetCharOrigin(IntPtr textPage, int index, out double x, out double y);
    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] private static extern int FPDFText_GetCharBox(IntPtr textPage, int index, out double left, out double right, out double bottom, out double top);

    [StructLayout(LayoutKind.Sequential)]
    private struct FsMatrix { public float A, B, C, D, E, F; }
    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] private static extern int FPDFText_GetMatrix(IntPtr textPage, int index, out FsMatrix matrix);

    private static bool matrixApiMissing;

    /// <summary>
    /// FPDFText_GetFontSize returns the raw Tf size and ignores the text/CTM scale (browser-printed PDFs use a 0.75 CTM,
    /// so a 12 pt line reports 16). The real size on the page is that value times the vertical scale of the char matrix.
    /// Returns 1 when the matrix isn't available.
    /// </summary>
    private static double MatrixScale(IntPtr tp, int index)
    {
        if (matrixApiMissing) return 1;
        try
        {
            if (FPDFText_GetMatrix(tp, index, out var m) == 0) return 1;
            var v = Math.Sqrt((double)m.C * m.C + (double)m.D * m.D);
            return double.IsNaN(v) || v < 0.05 || v > 50 ? 1 : v;
        }
        catch (EntryPointNotFoundException) { matrixApiMissing = true; return 1; }
        catch (DllNotFoundException) { matrixApiMissing = true; return 1; }
    }

    private struct Ch
    {
        public char C; public float X0, Y0, X1, Y1, OX, OY; public double Size; public string Font; public int Flags, Weight; public Color Fill; public bool Underline;
    }

    /// <summary>Returns the text lines of one page, or throws if PDFium's text API can't be reached.</summary>
    public static List<PdfTextBlock> GetBlocks(string pdfPath, int pageIndex)
    {
        var bytes = File.ReadAllBytes(pdfPath);
        var password = PdfPasswords.Get(pdfPath);
        var chars = new List<Ch>();

        lock (ImagePdfService.PdfiumGate)
        {
            FPDF_InitLibrary();
            var mem = Marshal.AllocHGlobal(bytes.Length);
            IntPtr doc = IntPtr.Zero, page = IntPtr.Zero, tp = IntPtr.Zero;
            try
            {
                Marshal.Copy(bytes, 0, mem, bytes.Length);
                doc = FPDF_LoadMemDocument(mem, bytes.Length, string.IsNullOrEmpty(password) ? null : password);
                if (doc == IntPtr.Zero) throw new InvalidOperationException("PDFium could not open this file.");
                page = FPDF_LoadPage(doc, pageIndex);
                if (page == IntPtr.Zero) throw new InvalidOperationException("PDFium could not load the page.");
                tp = FPDFText_LoadPage(page);
                if (tp == IntPtr.Zero) return new List<PdfTextBlock>();

                var pw = FPDF_GetPageWidthF(page); var ph = FPDF_GetPageHeightF(page);
                int sx = (int)Math.Round(pw * 10), sy = (int)Math.Round(ph * 10);
                var n = FPDFText_CountChars(tp);
                var nameBuf = new byte[256];
                for (var i = 0; i < n; i++)
                {
                    var u = FPDFText_GetUnicode(tp, i);
                    if (u == 0 || u > 0xFFFF) continue;
                    var c = (char)u;
                    if (c < ' ') continue;
                    if (c == '\u00AD') continue;
                    // spaces (justified text, word-spacing, or ones PDFium makes up between words) have an empty box but separate the words: keep them
                    var isSpace = c == ' ' || c == '\u00A0' || char.IsWhiteSpace(c);
                    if (isSpace) c = ' ';
                    if (FPDFText_GetCharBox(tp, i, out var l, out var r, out var b, out var t) == 0) {
                        if (isSpace && chars.Count > 0)
                        {
                            var pv0 = chars[^1];
                            chars.Add(new Ch { C = ' ', X0 = pv0.X1, X1 = pv0.X1, Y0 = pv0.Y0, Y1 = pv0.Y1, OX = pv0.X1, OY = pv0.OY, Size = pv0.Size, Font = pv0.Font, Flags = pv0.Flags, Weight = pv0.Weight, Fill = pv0.Fill });
                        }
                        continue;
                    }
                    if (!isSpace && r - l <= 0.01 && t - b <= 0.01) continue;
                    if (isSpace && chars.Count == 0) continue;
                    FPDF_PageToDevice(page, 0, 0, sx, sy, 0, l, t, out var ax, out var ay);
                    FPDF_PageToDevice(page, 0, 0, sx, sy, 0, r, b, out var bx, out var by);
                    float x0 = Math.Min(ax, bx) / 10f, x1 = Math.Max(ax, bx) / 10f, y0 = Math.Min(ay, by) / 10f, y1 = Math.Max(ay, by) / 10f;
                    if (isSpace && chars.Count > 0)
                    {
                        // an empty space box has no usable height: borrow the letter before it so the space stays on the same line
                        var pv = chars[^1];
                        y0 = pv.Y0; y1 = pv.Y1;
                        if (x1 - x0 < 0.01f) { x0 = Math.Max(x0, pv.X1); x1 = x0; }
                    }

                    // pen origin = where the glyph really sits on its baseline (the char box is only an em-ish rectangle)
                    float ox = x0, oy = y1 - (y1 - y0) * 0.2f;
                    try
                    {
                        if (FPDFText_GetCharOrigin(tp, i, out var cx0, out var cy0) != 0)
                        {
                            FPDF_PageToDevice(page, 0, 0, sx, sy, 0, cx0, cy0, out var dx, out var dy);
                            ox = dx / 10f; oy = dy / 10f;
                        }
                    }
                    catch (EntryPointNotFoundException) { }

                    if (isSpace && chars.Count > 0)
                    {
                        var pv = chars[^1];
                        chars.Add(new Ch { C = ' ', X0 = x0, X1 = Math.Max(x1, x0), Y0 = y0, Y1 = y1, OX = x0, OY = pv.OY, Size = pv.Size, Font = pv.Font, Flags = pv.Flags, Weight = pv.Weight, Fill = pv.Fill });
                        continue;
                    }
                    var len = FPDFText_GetFontInfo(tp, i, nameBuf, (uint)nameBuf.Length, out var flags);
                    var font = len > 1 ? Encoding.UTF8.GetString(nameBuf, 0, (int)Math.Min(len, (uint)nameBuf.Length) - 1) : "";
                    var fill = Color.Black;
                    if (FPDFText_GetFillColor(tp, i, out var cr, out var cg, out var cb, out var ca) != 0)
                        fill = Color.FromArgb((int)Math.Min(cr, 255u), (int)Math.Min(cg, 255u), (int)Math.Min(cb, 255u));
                    chars.Add(new Ch
                    {
                        C = c, X0 = x0, X1 = x1, Y0 = y0, Y1 = y1, OX = ox, OY = oy, Size = FPDFText_GetFontSize(tp, i) * MatrixScale(tp, i),
                        Font = font, Flags = flags, Weight = FPDFText_GetFontWeight(tp, i), Fill = fill
                    });
                }
                // PDF files usually store underlines as separate vector strokes instead of a text font flag.
                // Recover the underline style while the original page objects are still available.
                MarkUnderlineCharacters(chars, PdfRules.Read(page, pw, ph));
            }
            finally
            {
                if (tp != IntPtr.Zero) FPDFText_ClosePage(tp);
                if (page != IntPtr.Zero) FPDF_ClosePage(page);
                if (doc != IntPtr.Zero) FPDF_CloseDocument(doc);
                Marshal.FreeHGlobal(mem);
            }
        }
        return Group(chars);
    }

    /// <summary>Maps short horizontal underline strokes to glyphs, ignoring connected table/frame borders.</summary>
    private static void MarkUnderlineCharacters(List<Ch> chars, List<RuleLine> rules)
    {
        if (chars.Count == 0 || rules.Count == 0) return;
        var verticals = rules.Where(r => !r.Horizontal).ToArray();
        bool IsConnectedBorder(RuleLine line)
        {
            // On very complex vector pages, skip this optional classification rather than doing quadratic work.
            if (rules.Count > 5000) return false;
            return verticals.Any(v =>
                (Math.Abs(v.Pos - line.From) <= 1.5 || Math.Abs(v.Pos - line.To) <= 1.5) &&
                line.Pos >= v.From - 1.5 && line.Pos <= v.To + 1.5);
        }

        foreach (var line in rules)
        {
            if (!line.Horizontal || line.Length < 2.5 || line.Width > 2.5 || IsConnectedBorder(line)) continue;
            bool NearBaseline(Ch c)
            {
                var delta = line.Pos - c.OY;
                return delta >= -1.5 && delta <= Math.Max(4.0, c.Size * 0.40);
            }
            bool Crosses(Ch c) => c.X1 > line.From - 0.5 && c.X0 < line.To + 0.5;
            var matches = chars.Where(c => c.C != ' ' && Crosses(c) && NearBaseline(c)).ToList();
            if (matches.Count == 0) continue;
            var left = matches.Min(c => c.X0);
            var right = matches.Max(c => c.X1);
            var overhang = Math.Max(4.0, matches.Average(c => c.Size) * 0.45);
            if (line.From < left - overhang || line.To > right + overhang || line.Length > right - left + overhang * 2) continue;
            var covered = matches.Sum(c => Math.Max(0, Math.Min(c.X1, line.To) - Math.Max(c.X0, line.From)));
            if (covered < Math.Min(2.0, line.Length * 0.35)) continue;

            for (var i = 0; i < chars.Count; i++)
            {
                var c = chars[i];
                if (!NearBaseline(c)) continue;
                var intersects = c.C == ' '
                    ? c.OX >= line.From - 0.25 && c.OX <= line.To + 0.25
                    : Crosses(c);
                if (!intersects) continue;
                c.Underline = true;
                chars[i] = c;
            }
        }
    }

    /// <summary>Joins characters into lines; a new block starts on a new line or after a wide horizontal gap (columns, tab stops).</summary>
    private static List<PdfTextBlock> Group(List<Ch> chars)
    {
        var result = new List<PdfTextBlock>();
        var cur = new List<Ch>();

        void Flush()
        {
            // trim leading/trailing spaces
            while (cur.Count > 0 && cur[0].C == ' ') cur.RemoveAt(0);
            while (cur.Count > 0 && cur[^1].C == ' ') cur.RemoveAt(cur.Count - 1);
            if (cur.Count > 0) result.Add(Build(cur));
            cur = new List<Ch>();
        }

        foreach (var ch in chars)
        {
            if (cur.Count > 0)
            {
                var last = cur[^1];
                // same baseline = same line (comparing boxes would split lines at commas, dots and other short glyphs)
                var sameLine = Math.Abs(last.OY - ch.OY) < Math.Max(Math.Max(ch.Size, last.Size), 4) * 0.3;
                var size = Math.Max(ch.Size, 4);
                var gap = ch.X0 - last.X1;
                var jump = gap > size * 1.6f || gap < -size * 0.5f;
                var styleChange = Math.Abs(ch.Size - last.Size) > 0.6;
                if (!sameLine || jump || (styleChange && ch.C != ' ' && last.C != ' ' && gap > size * 0.4f)) Flush();
            }
            cur.Add(ch);
        }
        Flush();
        return result;
    }

    private static PdfTextBlock Build(List<Ch> run)
    {
        var sb = new StringBuilder(run.Count);
        float x0 = float.MaxValue, y0 = float.MaxValue, x1 = float.MinValue, y1 = float.MinValue;
        foreach (var c in run)
        {
            sb.Append(c.C);
            x0 = Math.Min(x0, c.X0); y0 = Math.Min(y0, c.Y0); x1 = Math.Max(x1, c.X1); y1 = Math.Max(y1, c.Y1);
        }
        // the dominant character decides font, size and colour
        var dom = run.Where(c => c.C != ' ').GroupBy(c => (c.Font, Math.Round(c.Size, 1), c.Fill.ToArgb()))
                     .OrderByDescending(g => g.Count()).FirstOrDefault()?.First() ?? run[0];
        var size = dom.Size;
        if (size < 2 || size > 300 || double.IsNaN(size)) size = Math.Max(4, (y1 - y0) / 1.15);
        var name = dom.Font ?? "";
        var plus = name.IndexOf('+');
        if (plus == 6) name = name[7..];            // subset prefix ABCDEF+
        var lower = name.ToLowerInvariant();
        var bold = (dom.Weight >= 600 && dom.Weight <= 900) || lower.Contains("bold") || lower.Contains("black") || lower.Contains("heavy") || (dom.Flags & 0x40000) != 0;
        var italic = (dom.Flags & 0x40) != 0 || lower.Contains("italic") || lower.Contains("oblique");
        // baseline: median of the glyph origins (ignores the odd super/subscript or accent)
        var ys = run.Where(c => c.C != ' ').Select(c => c.OY).OrderBy(v => v).ToList();
        var baseline = ys.Count > 0 ? ys[ys.Count / 2] : y1 - (y1 - y0) * 0.2f;
        var first = run[0]; var last = run[^1];
        var mapped = MapFont(name, dom.Flags);
        size = FitSizeToAdvance(size, run.Count, sb.ToString(), Math.Max(0f, last.OX - first.OX), mapped, bold, italic);
        var text = sb.ToString();
        var styles = new List<TextStyleRun>();
        for (var i = 0; i < run.Count;)
        {
            if (!run[i].Underline) { i++; continue; }
            var start = i;
            while (i < run.Count && run[i].Underline) i++;
            styles.Add(new TextStyleRun
            {
                Start = start, Length = i - start, FontName = mapped, FontSize = size,
                Bold = bold, Italic = italic, Underline = true, ColorHex = PageEditObject.Hex(dom.Fill)
            });
        }
        return new PdfTextBlock
        {
            OriginX = first.OX, Baseline = baseline, Advance = Math.Max(0f, last.OX - first.OX),
            Text = text, Box = new RectangleF(x0, y0, Math.Max(1, x1 - x0), Math.Max(1, y1 - y0)),
            FontSize = size, FontName = mapped, Bold = bold, Italic = italic, TextStyles = styles, Color = dom.Fill
        };
    }

    /// <summary>
    /// Safety net for when PDFium reports a size that is too large (matrix unavailable or identity): the glyph origins
    /// give the true width of the line, so a replacement font that is far too wide at the reported size means the size
    /// itself is off. Only a clear mismatch (line &gt; 15 % narrower than the font would be) changes the size.
    /// </summary>
    private static double FitSizeToAdvance(double size, int count, string text, float advance, string font, bool bold, bool italic)
    {
        try
        {
            if (count < 4 || advance < 8 || text.Length < 4) return Math.Round(size, 2);
            var natural = TextMetrics.Advance(text[..^1], font, size, bold, italic);
            if (natural < 8) return Math.Round(size, 2);
            var r = advance / natural;
            if (r < 0.85 && r > 0.45) size *= r;
        }
        catch { }
        return Math.Round(size, 2);
    }

    /// <summary>Maps a PDF font name to an installed Windows font family so the replacement text looks alike.</summary>
    public static string MapFont(string pdfName, int flags = 0) => PdfFontResolver.MapToInstalled(pdfName, flags);
}
