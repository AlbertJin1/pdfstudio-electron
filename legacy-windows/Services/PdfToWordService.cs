using System.Drawing;
using System.Drawing.Imaging;
using DrawingImageFormat = System.Drawing.Imaging.ImageFormat;
using System.Runtime.InteropServices;
using System.Text;
using System.Reflection;
using TesseractOCR;
using TesseractOCR.Enums;

namespace PdfStudio.Services;

public sealed class PdfToWordOptions
{
    /// <summary>Resolution used when preserving individual image regions or optional page artwork.</summary>
    public int GraphicsDpi { get; set; } = 150;
    /// <summary>When true, adds one flattened, page-sized picture. False by default so the Word page does not become one draggable image.</summary>
    public bool IncludeFullPageArtwork { get; set; }
    /// <summary>Recognize English text embedded in raster image panels and scanned pages into editable Word text.</summary>
    public bool EnableRasterOcr { get; set; } = true;
}

public sealed class PdfToWordResult
{
    public int Pages { get; init; }
    public int TextLines { get; init; }
    /// <summary>Number of real Word tables created.</summary>
    public int Tables { get; init; }
    public List<string> Warnings { get; } = new();
}

/// <summary>
/// Built-in PDF → Word (.docx) converter — no Office, no LibreOffice.
/// For every page it
///   1. reads the text with PDFium (position, baseline, font, size, colour),
///   2. maps thin underline paths beneath glyphs to native Word underline runs and removes those paths along with
///      rebuilt table borders from PDFium's in-memory page; raster text panels are OCRed into ordinary Word runs,
///   3. preserves only bounded genuine photos/logos as separate pictures; no page-sized or text-panel picture is emitted by default.
/// Tables are the exception: their ruling lines are read from the page, rebuilt as real Word tables (grid, merged cells,
/// borders) and the text inside them is written into the cells as ordinary paragraphs — never as text boxes.
/// The Word page has the PDF's size and zero margins. Editable text is allowed to reflow naturally, so font substitutions
/// can change line breaks and exact positions relative to the original PDF.
/// </summary>
public sealed class PdfToWordService
{
    private const string Lib = "pdfium";
    private static readonly object OcrGate = new();
    private static Engine? sharedOcrEngine;
    private static bool ocrInitAttempted;

    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] private static extern void FPDF_InitLibrary();
    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] private static extern IntPtr FPDF_LoadMemDocument(IntPtr data, int size, [MarshalAs(UnmanagedType.LPStr)] string? password);
    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] private static extern void FPDF_CloseDocument(IntPtr doc);
    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] private static extern int FPDF_GetPageCount(IntPtr doc);
    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] private static extern IntPtr FPDF_LoadPage(IntPtr doc, int index);
    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] private static extern void FPDF_ClosePage(IntPtr page);
    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] private static extern float FPDF_GetPageWidthF(IntPtr page);
    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] private static extern float FPDF_GetPageHeightF(IntPtr page);
    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] private static extern int FPDFPage_GetRotation(IntPtr page);
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
    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] private static extern float FPDFText_GetCharAngle(IntPtr textPage, int index);
    [StructLayout(LayoutKind.Sequential)] private struct FsMatrix { public float A, B, C, D, E, F; }
    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] private static extern int FPDFText_GetMatrix(IntPtr textPage, int index, out FsMatrix matrix);
    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] private static extern IntPtr FPDFText_GetTextObject(IntPtr textPage, int index);
    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] private static extern int FPDFTextObj_GetTextRenderMode(IntPtr textObject);

    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] private static extern int FPDFPage_CountObjects(IntPtr page);
    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] private static extern IntPtr FPDFPage_GetObject(IntPtr page, int index);
    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] private static extern int FPDFPage_RemoveObject(IntPtr page, IntPtr pageObj);
    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] private static extern int FPDFPageObj_GetType(IntPtr pageObj);
    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] private static extern int FPDFPageObj_GetBounds(IntPtr pageObj, out float left, out float bottom, out float right, out float top);
    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] private static extern void FPDFPageObj_Destroy(IntPtr pageObj);
    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] private static extern int FPDFFormObj_CountObjects(IntPtr formObj);
    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] private static extern IntPtr FPDFFormObj_GetObject(IntPtr formObj, uint index);
    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] private static extern int FPDFFormObj_RemoveObject(IntPtr formObj, IntPtr subObj);

    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] private static extern IntPtr FPDFBitmap_Create(int width, int height, int alpha);
    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] private static extern int FPDFBitmap_FillRect(IntPtr bitmap, int left, int top, int width, int height, uint color);
    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] private static extern IntPtr FPDFBitmap_GetBuffer(IntPtr bitmap);
    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] private static extern int FPDFBitmap_GetStride(IntPtr bitmap);
    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] private static extern void FPDFBitmap_Destroy(IntPtr bitmap);
    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] private static extern void FPDF_RenderPageBitmap(IntPtr bitmap, IntPtr page, int startX, int startY, int sizeX, int sizeY, int rotate, int flags);

    private const int ObjText = 1, ObjImage = 3, ObjShading = 4, ObjForm = 5;
    private const int RenderAnnot = 0x01;
    private const int MaxBitmapSide = 5000;

    // ───────────────────────── characters ─────────────────────────

    private sealed class Ch
    {
        public string S = "";
        public float X0, Y0, X1, Y1, OX, OY;
        public double Size;
        public PdfFontInfo Font = null!;
        public bool Bold, Italic, Underline, Invisible;
        public int Rgb;
    }

    private sealed class PageText
    {
        public List<Ch> Chars = new();
        public HashSet<IntPtr> Objects = new();
        public bool ObjectMappingAvailable = true;
    }

    /// <summary>Word bullets come out of PDFs as private-use Symbol/Wingdings code points that other fonts draw as an empty box.</summary>
    private static string MapSymbol(uint u) => u switch
    {
        0xF0B7 or 0xF06C or 0xF095 => "\u2022",
        0xF0A7 or 0xF06E or 0xF0A8 => "\u25AA",
        0xF0D8 => "\u27A2",
        0xF0FC => "\u2713",
        0xF0E0 => "\u2192",
        _ => char.ConvertFromUtf32((int)u)
    };

    private static bool IsUpright(float angle, int pageRotation)
    {
        if (float.IsNaN(angle)) return true;
        var expected = pageRotation * Math.PI / 2;
        var d = (angle - expected) % (2 * Math.PI);
        if (d > Math.PI) d -= 2 * Math.PI;
        if (d < -Math.PI) d += 2 * Math.PI;
        return Math.Abs(d) < 0.09;
    }

    private static PageText ReadChars(IntPtr page, IntPtr tp, float pw, float ph, PdfFontResolver fonts)
    {
        var res = new PageText();
        int sx = (int)Math.Round(pw * 10), sy = (int)Math.Round(ph * 10);
        var rotation = FPDFPage_GetRotation(page);
        var n = FPDFText_CountChars(tp);
        var nameBuf = new byte[256];
        var modeCache = new Dictionary<IntPtr, bool>();   // text object -> is it invisible (OCR layer)?
        var angleOk = true;

        for (var i = 0; i < n; i++)
        {
            var u = FPDFText_GetUnicode(tp, i);
            if (u == 0 || u == 0xAD || u == 0xFFFE || u == 0xFFFF) continue;
            if (u < ' ') continue;
            if (u > 0x10FFFF || (u >= 0xD800 && u <= 0xDFFF)) continue;
            if (FPDFText_GetCharBox(tp, i, out var l, out var r, out var b, out var t) == 0) continue;
            // spaces often have an empty box (justified text, word-spacing) but still separate the words, so they are kept
            var isSpace = u == 0xA0 || (u < 0x10000 && char.IsWhiteSpace((char)u));
            if (!isSpace && r - l <= 0.01 && t - b <= 0.01) continue;

            // Text object this character belongs to. Invisible rendering mode is retained as metadata: OCR layers can
            // contain the only extractable text for rasterized content, so they must not be discarded automatically.
            IntPtr obj = IntPtr.Zero;
            var invisibleText = false;
            if (res.ObjectMappingAvailable)
            {
                try { obj = FPDFText_GetTextObject(tp, i); }
                catch (EntryPointNotFoundException) { res.ObjectMappingAvailable = false; }
            }
            if (obj != IntPtr.Zero)
            {
                if (!modeCache.TryGetValue(obj, out var invisible))
                {
                    try { var mode = FPDFTextObj_GetTextRenderMode(obj); invisible = mode == 3 || mode == 7; }
                    catch (EntryPointNotFoundException) { invisible = false; }
                    modeCache[obj] = invisible;
                }
                invisibleText = invisible;
            }

            // rotated / vertical text can't be a plain Word line: leave it in the picture instead
            if (res.ObjectMappingAvailable && angleOk)
            {
                try
                {
                    if (!IsUpright(FPDFText_GetCharAngle(tp, i), rotation)) continue;
                }
                catch (EntryPointNotFoundException) { angleOk = false; }
            }

            FPDF_PageToDevice(page, 0, 0, sx, sy, 0, l, t, out var ax, out var ay);
            FPDF_PageToDevice(page, 0, 0, sx, sy, 0, r, b, out var bx, out var by);
            float x0 = Math.Min(ax, bx) / 10f, x1 = Math.Max(ax, bx) / 10f, y0 = Math.Min(ay, by) / 10f, y1 = Math.Max(ay, by) / 10f;

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

            var len = FPDFText_GetFontInfo(tp, i, nameBuf, (uint)nameBuf.Length, out var flags);
            var rawFont = len > 1 ? Encoding.UTF8.GetString(nameBuf, 0, (int)Math.Min(len, (uint)nameBuf.Length) - 1) : "";
            var weight = FPDFText_GetFontWeight(tp, i);
            // real family from the embedded font program (PDF font names like "CIDFont+F1" say nothing)
            var face = fonts.For(obj, rawFont, flags, weight);
            var bold = face.Bold;
            var italic = face.Italic;

            var rgb = 0;
            if (FPDFText_GetFillColor(tp, i, out var cr, out var cg, out var cb, out var ca) != 0)
                rgb = ((int)Math.Min(cr, 255u) << 16) | ((int)Math.Min(cg, 255u) << 8) | (int)Math.Min(cb, 255u);

            // PDFium's font size is the size before the text matrix / page transform. Many producers draw text with a
            // scaled matrix (e.g. 13.3 pt x 0.75 = 10 pt), so the real size is font size x matrix scale.
            var size = FPDFText_GetFontSize(tp, i);
            if (!isSpace)
            {
                try
                {
                    if (FPDFText_GetMatrix(tp, i, out var tm) != 0)
                    {
                        var k = Math.Sqrt(Math.Abs((double)tm.A * tm.D - (double)tm.B * tm.C));
                        if (k > 0.01 && k < 100) size *= k;
                    }
                }
                catch (EntryPointNotFoundException) { }
            }
            else if (res.Chars.Count > 0 && Math.Abs(res.Chars[^1].OY - oy) < res.Chars[^1].Size * 0.3)
            {
                size = res.Chars[^1].Size;   // spaces PDFium makes up carry no matrix: use the neighbouring letter's size
            }
            if (double.IsNaN(size) || size < 2 || size > 400) size = Math.Max(4, (y1 - y0) / 1.15);

            res.Chars.Add(new Ch
            {
                S = isSpace ? " " : MapSymbol(u), X0 = x0, X1 = x1, Y0 = y0, Y1 = y1, OX = ox, OY = oy,
                Size = size, Font = face.Font, Bold = bold, Italic = italic, Rgb = rgb, Invisible = invisibleText
            });
            if (obj != IntPtr.Zero) res.Objects.Add(obj);
        }
        // Hidden OCR text often exactly overlays a visible text layer. Keep hidden characters only when no visible
        // glyph already occupies the same position; otherwise the Word text would be duplicated.
        RemoveHiddenTextDuplicates(res);
        return res;
    }

    private static void RemoveHiddenTextDuplicates(PageText pageText)
    {
        var visible = pageText.Chars.Where(c => !c.Invisible).ToList();
        if (visible.Count == 0) return;
        // Spatial buckets keep this linear for large OCR PDFs; a 2 pt cell is fine-grained enough for glyph origins.
        var cells = new Dictionary<(int X, int Y), List<Ch>>();
        foreach (var c in visible)
        {
            var key = ((int)Math.Round(c.OX / 2.0f), (int)Math.Round(c.OY / 2.0f));
            if (!cells.TryGetValue(key, out var list)) cells[key] = list = new List<Ch>();
            list.Add(c);
        }
        var filtered = new List<Ch>(pageText.Chars.Count);
        foreach (var c in pageText.Chars)
        {
            if (!c.Invisible) { filtered.Add(c); continue; }
            var kx = (int)Math.Round(c.OX / 2.0f); var ky = (int)Math.Round(c.OY / 2.0f);
            var duplicate = false;
            for (var dx = -1; dx <= 1 && !duplicate; dx++)
                for (var dy = -1; dy <= 1 && !duplicate; dy++)
                    if (cells.TryGetValue((kx + dx, ky + dy), out var candidates))
                        duplicate = candidates.Any(v => Math.Abs(v.OX - c.OX) <= Math.Max(1.25, Math.Min(v.Size, c.Size) * 0.28)
                            && Math.Abs(v.OY - c.OY) <= Math.Max(1.25, Math.Min(v.Size, c.Size) * 0.22));
            if (!duplicate) filtered.Add(c);
        }
        pageText.Chars = filtered;
    }

    // ───────────────────────── lines ─────────────────────────

    private static List<List<Ch>> SplitLines(List<Ch> chars)
    {
        var lines = new List<List<Ch>>();
        var cur = new List<Ch>();
        foreach (var ch in chars)
        {
            if (cur.Count > 0)
            {
                var last = cur[^1];
                var size = (float)Math.Max(ch.Size, 4);
                // same baseline = same line (spaces have zero-height boxes in PDFium, so boxes can't be compared)
                var sameLine = Math.Abs(last.OY - ch.OY) < Math.Max(size, (float)last.Size) * 0.3f;
                var gap = ch.X0 - last.X1;
                var jump = gap > size * 1.6f || gap < -size * 0.5f;
                if (!sameLine || jump) { lines.Add(cur); cur = new List<Ch>(); }
            }
            cur.Add(ch);
        }
        if (cur.Count > 0) lines.Add(cur);
        return lines;
    }

    private static DocxTextLine? BuildLine(List<Ch> chars)
    {
        while (chars.Count > 0 && chars[0].S == " ") chars.RemoveAt(0);
        while (chars.Count > 0 && chars[^1].S == " ") chars.RemoveAt(chars.Count - 1);
        if (chars.Count == 0) return null;

        // Runs preserve every semantic style. In particular, underline is assigned to the text run itself,
        // not left behind as a vector line in the page-background picture. A space may start a new run when
        // its formatting changes at the boundary of an underlined phrase.
        var runs = new List<(StringBuilder Text, PdfFontInfo Font, double Size, bool Bold, bool Italic, int Rgb, bool Underline)>();
        var starts = new List<int>();   // index (in chars) of the first character of each run
        for (var ci = 0; ci < chars.Count; ci++)
        {
            var c = chars[ci];
            var size = Math.Round(c.Size * 2) / 2;
            if (size < 1) size = 1;
            if (runs.Count > 0)
            {
                var r = runs[^1];
                var same = ReferenceEquals(r.Font, c.Font) && Math.Abs(r.Size - size) < 0.01 &&
                           r.Bold == c.Bold && r.Italic == c.Italic && r.Rgb == c.Rgb && r.Underline == c.Underline;
                if (same) { r.Text.Append(c.S); continue; }
            }
            runs.Add((new StringBuilder(c.S), c.Font, size, c.Bold, c.Italic, c.Rgb, c.Underline));
            starts.Add(ci);
        }

        var line = new DocxTextLine();
        double ascent = 0, descent = 0, measured = 0, maxSize = 0;
        foreach (var r in runs)
        {
            ascent = Math.Max(ascent, TextMetrics.Ascent(r.Font.MeasureFamily, r.Size, r.Bold, r.Italic));
            descent = Math.Max(descent, TextMetrics.Descent(r.Font.MeasureFamily, r.Size, r.Bold, r.Italic));
            measured += TextMetrics.Advance(r.Text.ToString(), r.Font.MeasureFamily, r.Size, r.Bold, r.Italic);
            maxSize = Math.Max(maxSize, r.Size);
        }

        // baseline = median pen-origin y of the real glyphs (ignores a stray superscript)
        var ys = chars.Where(c => c.S != " ").Select(c => c.OY).OrderBy(v => v).ToList();
        var baseline = ys.Count > 0 ? ys[ys.Count / 2] : chars[^1].Y1;

        var first = chars[0]; var lastCh = chars[^1];
        var target = (lastCh.OX - first.OX) + TextMetrics.Advance(lastCh.S, lastCh.Font.MeasureFamily, Math.Round(lastCh.Size * 2) / 2, lastCh.Bold, lastCh.Italic);
        if (target < 1) target = Math.Max(1, lastCh.X1 - first.OX);

        // Letter-spacing is worked out so that everything starts exactly where the PDF puts it, even when the fallback
        // font is a little wider/narrower than the original or the line mixes fonts. A run that matches the PDF closely
        // stays one run; a run that drifts is cut into words and spaces, each with its own spacing, so that the
        // correction lands on the gaps between words instead of stretching every letter.
        // Positions of real glyphs are reliable; the spaces PDFium makes up between words are not, so only glyph origins
        // are used as anchors and a space simply fills the gap up to the next glyph.
        var segs = new List<(string Text, int Run, int First, int Last)>();   // First/Last = indexes in chars (inclusive)
        for (var j = 0; j < runs.Count; j++)
        {
            var r = runs[j];
            var end = j + 1 < runs.Count ? starts[j + 1] : chars.Count;   // exclusive
            var text = r.Text.ToString();
            var m = TextMetrics.Advance(text, r.Font.MeasureFamily, r.Size, r.Bold, r.Italic);
            var runTarget = j + 1 < runs.Count ? chars[starts[j + 1]].OX - chars[starts[j]].OX : target - (chars[starts[j]].OX - first.OX);
            var n = text.Length;
            var uniform = n > 1 && m > 0 && runTarget > 0 ? (runTarget - m) / (j + 1 < runs.Count ? n : n - 1) : 0;
            var split = text.Contains(' ') && Math.Abs(uniform) > 0.04 * r.Size && text.Length == end - starts[j];
            if (!split) { segs.Add((text, j, starts[j], end - 1)); continue; }

            var sb = new StringBuilder(); var segFirst = starts[j]; var wasSpace = chars[starts[j]].S == " ";
            for (var ci = starts[j]; ci < end; ci++)
            {
                var sp = chars[ci].S == " ";
                if (sp != wasSpace) { segs.Add((sb.ToString(), j, segFirst, ci - 1)); sb.Clear(); segFirst = ci; wasSpace = sp; }
                sb.Append(chars[ci].S);
            }
            if (sb.Length > 0) segs.Add((sb.ToString(), j, segFirst, end - 1));
        }

        // where the last real glyph of a segment ends in the PDF (its pen origin + its own width)
        double InkEnd(int k)
        {
            var li = segs[k].Last;
            while (li > segs[k].First && chars[li].S == " ") li--;
            var c = chars[li];
            return c.OX + TextMetrics.Advance(c.S, c.Font.MeasureFamily, Math.Round(c.Size * 2) / 2, c.Bold, c.Italic);
        }
        double NextGlyphX(int k)   // x of the first real glyph at or after segment k+1
        {
            for (var q = k + 1; q < segs.Count; q++)
            {
                var ci = segs[q].First;
                while (ci <= segs[q].Last && chars[ci].S == " ") ci++;
                if (ci <= segs[q].Last) return chars[ci].OX;
            }
            return double.NaN;
        }

        var spacings = new double[segs.Count];
        double total = 0;
        double pen = first.OX;   // where the previous segments really end up in Word
        for (var k = 0; k < segs.Count; k++)
        {
            var r = runs[segs[k].Run];
            var m = TextMetrics.Advance(segs[k].Text, r.Font.MeasureFamily, r.Size, r.Bold, r.Italic);
            var n = segs[k].Text.Length;
            var isGap = segs[k].Text.Trim().Length == 0;
            var isLast = k == segs.Count - 1;
            var nextX = isLast ? double.NaN : NextGlyphX(k);
            var nextIsSpace = !isLast && segs[k + 1].Text.Trim().Length == 0;

            double desiredEnd; int denom;
            if (isLast) { desiredEnd = first.OX + target; denom = n - 1; }
            else if (double.IsNaN(nextX)) { desiredEnd = InkEnd(k); denom = n - 1; }
            else if (isGap || !nextIsSpace) { desiredEnd = nextX; denom = n; }   // a gap or a word that runs straight into the next one: end exactly at the next glyph
            else { desiredEnd = InkEnd(k); denom = n - 1; }                       // a word followed by a space: the space takes up the slack

            double sp = 0;
            if (denom > 0 && m > 0) sp = (desiredEnd - pen - m) / denom;
            sp = isGap ? Math.Clamp(sp, -0.5 * r.Size, 40) : Math.Clamp(sp, -0.15 * r.Size, 0.5 * r.Size);
            if (Math.Abs(sp) < 0.01) sp = 0;
            spacings[k] = sp;
            pen += m + sp * n;
            total += m + sp * n;
        }

        var boxW = Math.Max(target, total) * 1.12 + 6;
        var result = new DocxTextLine
        {
            X = first.OX,
            Top = baseline - ascent,
            Width = boxW,
            Height = ascent + descent + 2,
            SpacingPt = 0,
            Baseline = baseline,
            Ascent = ascent,
            Descent = descent,
            TextWidth = Math.Max(target, total),
            MaxSize = maxSize
        };
        for (var k = 0; k < segs.Count; k++)
        {
            var r = runs[segs[k].Run];
            result.Runs.Add(new DocxRun { Text = segs[k].Text, Font = r.Font.Family, Info = r.Font, SizePt = r.Size, Bold = r.Bold, Italic = r.Italic, Underline = r.Underline, Rgb = r.Rgb, SpacingPt = spacings[k] });
        }
        return result;
    }

    /// <summary>
    /// PDF files often represent underlining as an independent thin path, not as a font attribute. When the
    /// text reflows in Word, leaving that path in the page artwork makes the underline look like a detached
    /// picture. Associate short horizontal paths with the glyphs immediately above them and turn the path into
    /// a real Word underline run. Table borders are excluded because those are rebuilt as table borders.
    /// </summary>
    private static List<RuleLine> DetectTextUnderlineRules(List<RuleLine> rules, List<Ch> chars, HashSet<IntPtr> tableRuleObjects)
    {
        var selected = new List<RuleLine>();
        var glyphs = chars.Where(c => c.S != " ").ToList();
        foreach (var rule in rules)
        {
            if (!rule.Horizontal || rule.Length < 2.5 || rule.Width > 2.5 || tableRuleObjects.Contains(rule.Obj)) continue;

            bool IsBelowBaseline(Ch c)
            {
                var delta = rule.Pos - c.OY;
                // PDF coordinates have already been mapped to a top-left page origin. A text underline is
                // at or just below the baseline; horizontal separators between paragraphs are much farther away.
                return delta >= -1.5 && delta <= Math.Max(4.0, c.Size * 0.40);
            }

            bool Crosses(Ch c) => c.X1 > rule.From - 0.5 && c.X0 < rule.To + 0.5;
            var matched = glyphs.Where(c => Crosses(c) && IsBelowBaseline(c)).ToList();
            if (matched.Count == 0) continue;

            var minX = matched.Min(c => c.X0);
            var maxX = matched.Max(c => c.X1);
            var averageSize = matched.Average(c => c.Size);
            var overhang = Math.Max(4.0, averageSize * 0.45);
            // Do not steal long paragraph rules, separators or page borders and label them as text decoration.
            // A genuine underline closely follows the horizontal span of the glyphs it intersects.
            if (rule.From < minX - overhang || rule.To > maxX + overhang) continue;
            if (rule.Length > (maxX - minX) + overhang * 2) continue;
            var covered = matched.Sum(c => Math.Max(0, Math.Min(c.X1, rule.To) - Math.Max(c.X0, rule.From)));
            if (covered < Math.Min(2.0, rule.Length * 0.35)) continue;

            foreach (var c in chars)
            {
                if (!IsBelowBaseline(c)) continue;
                if (c.S == " ")
                {
                    // Preserve the underline across inter-word spaces when the PDF path spans those spaces.
                    if (c.OX >= rule.From - 0.25 && c.OX <= rule.To + 0.25) c.Underline = true;
                }
                else if (Crosses(c)) c.Underline = true;
            }
            selected.Add(rule);
        }
        return selected;
    }

    // ───────────────────────── table cells ─────────────────────────

    /// <summary>
    /// Lays the text lines of one table cell out as Word paragraphs. Lines on the same baseline become one paragraph with tab
    /// stops (columns inside a cell); the paragraph's space-before and exact line height put every baseline where the PDF has it,
    /// and left / centre / right alignment is recognised from the gaps to the cell edges so edited text behaves naturally.
    /// </summary>
    private static void FillCell(DocxCell cell, List<DocxTextLine> lines)
    {
        if (lines.Count == 0) return;
        var rows = new List<List<DocxTextLine>>();
        foreach (var l in lines.OrderBy(l => l.Baseline).ThenBy(l => l.X))
        {
            if (rows.Count > 0)
            {
                var cur = rows[^1];
                var bl = cur.Average(c => c.Baseline);
                var size = Math.Max(cur.Max(c => c.MaxSize), l.MaxSize);
                if (Math.Abs(l.Baseline - bl) < 0.3 * size) { cur.Add(l); continue; }
            }
            rows.Add(new List<DocxTextLine> { l });
        }

        var y = cell.Y0;   // bottom of the previous paragraph
        foreach (var row in rows)
        {
            row.Sort((a, b) => a.X.CompareTo(b.X));
            var baseline = row.Average(s => s.Baseline);
            var asc = row.Max(s => s.Ascent); var desc = row.Max(s => s.Descent);
            var height = Math.Max(2, asc + desc);
            var top = baseline - asc;
            var start = Math.Max(y, top);
            var p = new DocxCellPara { Before = start - y, LineHeight = height };
            y = start + height;

            var first = row[0]; var last = row[^1];
            var left = first.X - cell.X0;
            var right = cell.X1 - (last.X + last.TextWidth);
            var slack = Math.Max(6, 0.1 * last.TextWidth);   // room so a slightly wider substitute font never wraps the line
            if (row.Count == 1 && left >= 6 && Math.Abs(left - right) <= 2.5)
            {
                p.Align = 1; p.IndentLeft = -slack; p.IndentRight = -slack;
            }
            else if (row.Count == 1 && left >= 15 && right >= -1 && right <= 8 && right < left * 0.5)
            {
                p.Align = 2; p.IndentLeft = -slack; p.IndentRight = Math.Max(0, right);
            }
            else
            {
                p.IndentLeft = Math.Max(0, left); p.IndentRight = -slack;
            }
            p.Segs.AddRange(row);
            cell.Paras.Add(p);
        }
    }

    // ───────────────────────── graphics layer ─────────────────────────

    private sealed record ImageRegion(double X, double Y, double Width, double Height);

    /// <summary>
    /// Reads bounded image regions from page objects and image-bearing Form XObjects. Many PDFs place text panels
    /// inside a Form XObject; looking only at top-level ObjImage objects misses those panels and lets them escape OCR.
    /// For a form we use the form's page-level bounds as a single crop, rather than child bounds in local coordinates.
    /// </summary>
    private static List<ImageRegion> ReadImageRegions(IntPtr page, float pw, float ph)
    {
        var regions = new List<ImageRegion>();
        try
        {
            var count = FPDFPage_CountObjects(page);
            for (var i = 0; i < count && regions.Count < 128; i++)
            {
                var obj = FPDFPage_GetObject(page, i);
                if (obj == IntPtr.Zero) continue;
                var type = FPDFPageObj_GetType(obj);
                if (type != ObjImage && (type != ObjForm || !FormContainsImage(obj, 0))) continue;
                AddObjectBounds(regions, obj, pw, ph);
            }
        }
        catch (EntryPointNotFoundException) { regions.Clear(); }
        catch (DllNotFoundException) { regions.Clear(); }

        // Discard fully-contained nested bounds if a PDFium build exposes a form and a child as separate entries.
        var sorted = regions.OrderByDescending(r => r.Width * r.Height).ToList();
        var filtered = new List<ImageRegion>();
        foreach (var region in sorted)
        {
            if (filtered.Any(parent => ContainsRegion(parent, region, 0.985))) continue;
            filtered.Add(region);
            if (filtered.Count >= 128) break;
        }
        return filtered;
    }

    private static void AddObjectBounds(List<ImageRegion> regions, IntPtr obj, float pw, float ph)
    {
        if (FPDFPageObj_GetBounds(obj, out var left, out var bottom, out var right, out var top) == 0) return;
        left = Math.Clamp(left, 0, pw); right = Math.Clamp(right, 0, pw);
        bottom = Math.Clamp(bottom, 0, ph); top = Math.Clamp(top, 0, ph);
        var width = right - left; var height = top - bottom;
        if (width < 3 || height < 3) return;
        regions.Add(new ImageRegion(left, ph - top, width, height));
    }

    private static bool FormContainsImage(IntPtr form, int depth)
    {
        if (depth > 8) return false;
        try
        {
            var count = FPDFFormObj_CountObjects(form);
            for (var i = 0; i < count && i < 2048; i++)
            {
                var child = FPDFFormObj_GetObject(form, (uint)i);
                if (child == IntPtr.Zero) continue;
                var type = FPDFPageObj_GetType(child);
                if (type == ObjImage) return true;
                if (type == ObjForm && FormContainsImage(child, depth + 1)) return true;
            }
        }
        catch (EntryPointNotFoundException) { return false; }
        catch (DllNotFoundException) { return false; }
        return false;
    }

    private static bool ContainsRegion(ImageRegion outer, ImageRegion inner, double tolerance)
    {
        var epsilon = Math.Max(1.0, Math.Min(inner.Width, inner.Height) * (1.0 - tolerance));
        return inner.X >= outer.X - epsilon && inner.Y >= outer.Y - epsilon
            && inner.X + inner.Width <= outer.X + outer.Width + epsilon
            && inner.Y + inner.Height <= outer.Y + outer.Height + epsilon;
    }

    /// <summary>
    /// Detects image objects whose bounds and pixels look like a text-panel screenshot rather than a photograph/logo.
    /// Such panels are OCRed into ordinary Word paragraphs or omitted in editable-first mode, never emitted as draggable pictures.
    /// </summary>
    private static bool LooksLikeTextPanel(Bitmap pageImage, Rectangle crop, ImageRegion region, IReadOnlyList<Ch> chars,
        float pageWidth, float pageHeight)
    {
        var textChars = chars.Where(c => c.S != " " && c.OX >= region.X && c.OX <= region.X + region.Width
            && c.OY >= region.Y && c.OY <= region.Y + region.Height).ToList();
        if (textChars.Count >= 8)
        {
            var baselines = textChars.GroupBy(c => (int)Math.Round(c.OY / Math.Max(2.0, c.Size * 0.45)))
                .Select(g => new { Count = g.Count(), Width = g.Max(c => c.X1) - g.Min(c => c.X0) }).ToList();
            var broadLines = baselines.Count(line => line.Count >= 3 && line.Width >= region.Width * 0.18);
            if (broadLines >= 2 || (textChars.Count >= 12 && baselines.Any(line => line.Count >= 7 && line.Width >= region.Width * 0.42)))
                return true;
        }

        // Some PDFs rasterize text without providing an OCR layer. Classify high-contrast, mostly white text panels
        // by repeated horizontal ink bands. Sampling bounds CPU cost for high-DPI pages.
        var sx = Math.Max(1, crop.Width / 240);
        var sy = Math.Max(1, crop.Height / 160);
        var sampleWidth = Math.Max(1, (crop.Width + sx - 1) / sx);
        var sampleHeight = Math.Max(1, (crop.Height + sy - 1) / sy);
        long total = 0, bright = 0, dark = 0, chromatic = 0;
        var activeRows = new List<int>();
        var rowSpans = new List<double>();
        for (int y = crop.Top, sampleY = 0; y < crop.Bottom; y += sy, sampleY++)
        {
            var rowDark = 0; var minX = int.MaxValue; var maxX = int.MinValue;
            for (var x = crop.Left; x < crop.Right; x += sx)
            {
                var color = pageImage.GetPixel(x, y);
                var lum = (299 * color.R + 587 * color.G + 114 * color.B) / 1000;
                total++;
                if (Math.Max(color.R, Math.Max(color.G, color.B)) - Math.Min(color.R, Math.Min(color.G, color.B)) >= 25) chromatic++;
                if (lum >= 225) bright++;
                if (lum <= 105) { dark++; rowDark++; minX = Math.Min(minX, x); maxX = Math.Max(maxX, x); }
            }
            if (rowDark >= Math.Max(2, sampleWidth * 0.012))
            {
                activeRows.Add(sampleY);
                rowSpans.Add((double)(maxX - minX + 1) / Math.Max(1, crop.Width));
            }
        }
        if (total == 0) return false;
        var brightRatio = bright / (double)total;
        var darkRatio = dark / (double)total;
        var chromaticRatio = chromatic / (double)total;
        var mostlyNeutral = chromaticRatio <= 0.16;
        var groups = 0; var previous = int.MinValue / 2;
        foreach (var row in activeRows)
        {
            if (row > previous + 1) groups++;
            previous = row;
        }
        var minimumSpan = mostlyNeutral ? 0.07 : 0.10;
        var requiredRows = mostlyNeutral ? Math.Max(2, sampleHeight * 0.010) : Math.Max(3, sampleHeight * 0.018);
        var enoughLongRows = rowSpans.Count(span => span >= minimumSpan) >= requiredRows;
        // Grayscale text boxes often have antialiasing that makes the simple photo detector see many colour bins.
        // For mostly neutral crops, repeated horizontal ink bands are stronger evidence of text than colour variance.
        // More colourful candidates keep the stricter thresholds to avoid discarding real photographs.
        return brightRatio >= (mostlyNeutral ? 0.46 : 0.58)
            && darkRatio >= 0.001 && darkRatio <= (mostlyNeutral ? 0.42 : 0.34)
            && groups >= (mostlyNeutral ? 2 : 3) && enoughLongRows;
    }

    private static bool LooksLikePhotograph(Bitmap bitmap, Rectangle crop)
    {
        // A true photo normally has chroma and broad tonal variation. Screenshot-like text panels are mostly neutral,
        // high-contrast pixels on a light background. Keep this cheap: sample at most about 24 x 24 points.
        var sx = Math.Max(1, crop.Width / 24); var sy = Math.Max(1, crop.Height / 24);
        var total = 0; var chromatic = 0; var veryDark = 0; var veryBright = 0;
        var bins = new HashSet<int>();
        long sum = 0; long sumSquares = 0;
        for (var y = crop.Top; y < crop.Bottom; y += sy)
        for (var x = crop.Left; x < crop.Right; x += sx)
        {
            var c = bitmap.GetPixel(x, y);
            var max = Math.Max(c.R, Math.Max(c.G, c.B));
            var min = Math.Min(c.R, Math.Min(c.G, c.B));
            if (max - min >= 24) chromatic++;
            var lum = (299 * c.R + 587 * c.G + 114 * c.B) / 1000;
            if (lum < 100) veryDark++;
            if (lum > 225) veryBright++;
            bins.Add(((c.R >> 5) << 6) | ((c.G >> 5) << 3) | (c.B >> 5));
            sum += lum; sumSquares += (long)lum * lum; total++;
        }
        if (total == 0) return false;
        var mean = sum / (double)total;
        var variance = Math.Max(0, sumSquares / (double)total - mean * mean);
        var chromaRatio = chromatic / (double)total;
        var darkRatio = veryDark / (double)total;
        var brightRatio = veryBright / (double)total;
        return (chromaRatio >= 0.08 && bins.Count >= 12) ||
               (bins.Count >= 30 && variance >= 1900 && darkRatio > 0.025 && brightRatio < 0.88);
    }

    private static Engine? GetOcrEngine(ref bool ocrUnavailable)
    {
        lock (OcrGate)
        {
            if (!ocrInitAttempted)
            {
                ocrInitAttempted = true;
                try
                {
                    var dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "PDF Studio", "OCR", "tessdata");
                    Directory.CreateDirectory(dir);
                    var modelPath = Path.Combine(dir, "eng.traineddata");
                    if (!File.Exists(modelPath) || new FileInfo(modelPath).Length < 1_000_000)
                    {
                        using var model = Assembly.GetExecutingAssembly().GetManifestResourceStream("PdfStudio.Ocr.tessdata.eng.traineddata")
                            ?? throw new FileNotFoundException("The embedded English OCR data file is missing.");
                        using var output = new FileStream(modelPath, FileMode.Create, FileAccess.Write, FileShare.None);
                        model.CopyTo(output);
                    }
                    sharedOcrEngine = new Engine(dir, Language.English, EngineMode.Default);
                }
                catch
                {
                    // OCR is an optional conversion aid. A native OCR runtime failure must not crash or block PDF-to-Word.
                    sharedOcrEngine = null;
                }
            }
            if (sharedOcrEngine == null) ocrUnavailable = true;
            return sharedOcrEngine;
        }
    }

    private static bool HasRasterUnderline(Bitmap source, Rectangle cropRect, int wordX1, int wordY1, int wordX2, int wordY2)
    {
        var left = Math.Clamp(cropRect.Left + wordX1, cropRect.Left, cropRect.Right - 1);
        var right = Math.Clamp(cropRect.Left + wordX2, left + 1, cropRect.Right);
        var top = Math.Clamp(cropRect.Top + wordY2 - 1, cropRect.Top, cropRect.Bottom - 1);
        var wordHeight = Math.Max(1, wordY2 - wordY1);
        var scanBottom = Math.Min(cropRect.Bottom, top + Math.Clamp(wordHeight / 4, 3, 7));
        var wordWidth = right - left;
        if (wordWidth < 7) return false;
        for (var y = top; y < scanBottom; y++)
        {
            var longest = 0; var run = 0; var darkPixels = 0;
            for (var x = left; x < right; x++)
            {
                var c = source.GetPixel(x, y);
                var luminance = (299 * c.R + 587 * c.G + 114 * c.B) / 1000;
                if (luminance < 125) { run++; darkPixels++; longest = Math.Max(longest, run); }
                else run = 0;
            }
            if (longest >= Math.Max(6, wordWidth * 0.58) && darkPixels >= wordWidth * 0.58) return true;
        }
        return false;
    }

    /// <summary>
    /// OCRs one cropped image panel. Recognized lines are inserted as ordinary Word runs at the panel's original page
    /// coordinates; individual word runs preserve basic underline styling when a real horizontal underline is detected.
    /// Returns true only if enough legible text was recognized to justify replacing the picture with editable text.
    /// </summary>
    private static bool TryAddRasterOcr(Bitmap pageImage, Rectangle cropRect, ImageRegion region,
        List<DocxTextLine> outputLines, bool panelLike, bool photoLike, out bool ocrUnavailable, out bool ocrLooksTextLike)
    {
        ocrUnavailable = false;
        ocrLooksTextLike = false;
        var engine = GetOcrEngine(ref ocrUnavailable);
        if (engine == null) return false;
        var tempPath = Path.Combine(Path.GetTempPath(), "pdfstudio-ocr-" + Guid.NewGuid().ToString("N") + ".png");
        var ocrWidth = cropRect.Width;
        var ocrHeight = cropRect.Height;
        var sourceScaleX = 1.0;
        var sourceScaleY = 1.0;
        try
        {
            // Small text panels are commonly embedded at a low resolution. Upscale them before OCR, with a hard
            // 4,800 px side limit so a page-size fallback remains safe on memory. Keep the point mapping tied to
            // the processed image dimensions so OCR word boxes still land at their original PDF coordinates.
            using (var crop = new Bitmap(cropRect.Width, cropRect.Height, PixelFormat.Format32bppArgb))
            {
                using (var g = Graphics.FromImage(crop))
                {
                    g.Clear(Color.White);
                    g.DrawImage(pageImage, new Rectangle(0, 0, cropRect.Width, cropRect.Height), cropRect, GraphicsUnit.Pixel);
                }
                var upscale = Math.Min(2.5, Math.Min(4800.0 / Math.Max(1, crop.Width), 4800.0 / Math.Max(1, crop.Height)));
                upscale = Math.Max(1.0, upscale);
                ocrWidth = Math.Max(1, (int)Math.Round(crop.Width * upscale));
                ocrHeight = Math.Max(1, (int)Math.Round(crop.Height * upscale));
                sourceScaleX = ocrWidth / (double)Math.Max(1, cropRect.Width);
                sourceScaleY = ocrHeight / (double)Math.Max(1, cropRect.Height);
                using var ocrCrop = new Bitmap(ocrWidth, ocrHeight, PixelFormat.Format32bppArgb);
                using (var g = Graphics.FromImage(ocrCrop))
                {
                    g.Clear(Color.White);
                    g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
                    g.PixelOffsetMode = System.Drawing.Drawing2D.PixelOffsetMode.HighQuality;
                    g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.HighQuality;
                    g.DrawImage(crop, new Rectangle(0, 0, ocrWidth, ocrHeight), new Rectangle(0, 0, crop.Width, crop.Height), GraphicsUnit.Pixel);
                }
                ocrCrop.Save(tempPath, DrawingImageFormat.Png);
            }

            using var pix = TesseractOCR.Pix.Image.LoadFromFile(tempPath);
            using var result = engine.Process(pix);
            var sx = region.Width / Math.Max(1, ocrWidth);
            var sy = region.Height / Math.Max(1, ocrHeight);
            var candidate = new List<DocxTextLine>();
            var recognizedCharacters = 0;
            var recognizedLines = 0;
            var confidenceTotal = 0.0;
            var recognizedLineArea = 0.0;

            foreach (var block in result.Layout)
            foreach (var paragraph in block.Paragraphs)
            foreach (var textLine in paragraph.TextLines)
            {
                var lineText = (textLine.Text ?? string.Empty).Trim();
                var minimumLineConfidence = panelLike ? 8 : 18;
                if (lineText.Length < 2 || textLine.Confidence < minimumLineConfidence || textLine.BoundingBox == null) continue;
                var lineBox = textLine.BoundingBox.Value;
                var pxHeight = Math.Max(1, lineBox.Y2 - lineBox.Y1);
                var top = region.Y + lineBox.Y1 * sy;
                var sizePt = Math.Clamp(pxHeight * sy * 0.78, 5.5, 30.0);
                var baseline = top + pxHeight * sy * 0.82;
                var line = new DocxTextLine
                {
                    X = region.X + lineBox.X1 * sx,
                    Top = top,
                    Width = Math.Max(1, (lineBox.X2 - lineBox.X1) * sx),
                    Height = Math.Max(sizePt, pxHeight * sy),
                    Baseline = baseline,
                    Ascent = sizePt * 0.80,
                    Descent = sizePt * 0.20,
                    TextWidth = Math.Max(1, (lineBox.X2 - lineBox.X1) * sx),
                    MaxSize = sizePt
                };

                var appendedWord = false;
                string previousToken = string.Empty;
                foreach (var word in textLine.Words)
                {
                    var token = (word.Text ?? string.Empty).Trim();
                    var minimumWordConfidence = panelLike ? 8 : 16;
                    if (token.Length == 0 || word.Confidence < minimumWordConfidence) continue;
                    var wordBox = word.BoundingBox;
                    var underlined = wordBox != null && HasRasterUnderline(pageImage, cropRect,
                        (int)Math.Round(wordBox.Value.X1 / sourceScaleX), (int)Math.Round(wordBox.Value.Y1 / sourceScaleY),
                        (int)Math.Round(wordBox.Value.X2 / sourceScaleX), (int)Math.Round(wordBox.Value.Y2 / sourceScaleY));
                    // Store separators in separate non-underlined runs so Word underlines only the word, not its trailing space.
                    if (appendedWord && !StartsWithClosingPunctuation(token) && !EndsWithOpeningPunctuation(previousToken))
                        line.Runs.Add(new DocxRun { Text = " ", Font = "Arial", SizePt = sizePt, Rgb = 0x000000 });
                    line.Runs.Add(new DocxRun { Text = token, Font = "Arial", SizePt = sizePt, Rgb = 0x000000, Underline = underlined });
                    appendedWord = true;
                    previousToken = token;
                }
                if (!appendedWord)
                    line.Runs.Add(new DocxRun { Text = lineText, Font = "Arial", SizePt = sizePt, Rgb = 0x000000 });
                var emittedText = string.Concat(line.Runs.Select(r => r.Text)).Trim();
                if (emittedText.Length < 2) continue;
                recognizedCharacters += emittedText.Count(char.IsLetterOrDigit);
                recognizedLines++;
                confidenceTotal += Math.Clamp(textLine.Confidence, 0, 100);
                recognizedLineArea += Math.Max(0, lineBox.X2 - lineBox.X1) * (double)Math.Max(0, lineBox.Y2 - lineBox.Y1);
                candidate.Add(line);
            }

            // Do not replace a real photo merely because OCR finds a sign or label in it. A text panel needs several
            // legible lines and enough text to behave like a paragraph; photo-like regions require stronger evidence.
            var avgConfidence = recognizedLines == 0 ? 0 : confidenceTotal / recognizedLines;
            var textCoverage = recognizedLineArea / Math.Max(1.0, ocrWidth * (double)ocrHeight);
            var normalTextPanel = recognizedCharacters >= 18 && recognizedLines >= 2 && avgConfidence >= 26;
            var strongTextPanel = recognizedCharacters >= 34 && recognizedLines >= 3 && avgConfidence >= 30 && textCoverage >= 0.012;
            // This flag is deliberately more permissive than the conversion threshold. If OCR sees a substantial
            // multi-line text block, do not fall back to exporting it as a draggable picture solely because confidence
            // is weakened by compression, unusual fonts or a decorative textbox border.
            ocrLooksTextLike = (recognizedCharacters >= 8 && recognizedLines >= 2
                && avgConfidence >= (panelLike ? 10 : 22))
                || (recognizedCharacters >= 28 && recognizedLines >= 1 && avgConfidence >= 18);
            // When the raster geometry already strongly looks like a text panel, accept a cautious best-effort OCR
            // pass at lower confidence. The export is still ordinary editable text; the conversion dialog warns the
            // user that OCR may need proofreading. Photos retain the stricter multi-line/coverage thresholds.
            var detectedTextPanel = panelLike
                ? recognizedCharacters >= 8 && recognizedLines >= 2 && avgConfidence >= 10
                : photoLike ? strongTextPanel || (recognizedCharacters >= 24 && recognizedLines >= 2 && avgConfidence >= 34)
                : normalTextPanel || strongTextPanel;
            if (!detectedTextPanel) return false;
            outputLines.AddRange(candidate);
            return true;
        }
        catch (Exception ex) when (ex is DllNotFoundException or EntryPointNotFoundException or BadImageFormatException or TypeInitializationException)
        {
            lock (OcrGate) sharedOcrEngine = null;
            ocrUnavailable = true;
            return false;
        }
        catch
        {
            // One unrecognizable or corrupted image should not abort the whole PDF conversion.
            return false;
        }
        finally
        {
            try { if (File.Exists(tempPath)) File.Delete(tempPath); } catch { }
        }
    }

    private static bool StartsWithClosingPunctuation(string text) => text.Length > 0 && ",.;:!?%)]}»”’".Contains(text[0]);
    private static bool EndsWithOpeningPunctuation(string text) => text.Length > 0 && "([{«“‘\"".Contains(text[^1]);

    private static bool LineOverlapsRegion(DocxTextLine line, ImageRegion region)
    {
        var left = Math.Max(line.X, region.X);
        var right = Math.Min(line.X + Math.Max(1, line.Width), region.X + region.Width);
        var top = Math.Max(line.Top, region.Y);
        var bottom = Math.Min(line.Top + Math.Max(1, line.Height), region.Y + region.Height);
        var overlap = Math.Max(0, right - left) * Math.Max(0, bottom - top);
        var lineArea = Math.Max(1, line.Width * Math.Max(1, line.Height));
        return overlap / lineArea >= 0.35;
    }

    private static string RasterLineText(DocxTextLine line) => string.Concat(line.Runs.Select(run => run.Text));

    private static bool IsParagraphLikeRasterGroup(IReadOnlyCollection<DocxTextLine> lines)
    {
        var characters = lines.Sum(line => RasterLineText(line).Count(char.IsLetterOrDigit));
        return (lines.Count >= 2 && characters >= 12) || (lines.Count == 1 && characters >= 32);
    }

    private static List<DocxTextLine> KeepParagraphLikeRasterLines(IEnumerable<DocxTextLine> candidates, IReadOnlyList<ImageRegion> regions)
    {
        var all = candidates.OrderBy(line => line.Top).ThenBy(line => line.X).ToList();
        if (regions.Count == 0) return all;

        var kept = new List<DocxTextLine>();
        foreach (var region in regions)
        {
            var inside = all.Where(line => LineOverlapsRegion(line, region)).ToList();
            // A real image panel should contribute a whole paragraph, not a short label accidentally found in a photo.
            if (IsParagraphLikeRasterGroup(inside))
                foreach (var line in inside) if (!kept.Contains(line)) kept.Add(line);
        }

        // PDFium sometimes exposes the containing Form XObject but not the image's true bounds. In that case the OCR
        // lines are valid page-coordinate text but overlap no region strongly enough. Keep spatially coherent orphan
        // paragraphs too, rather than throwing them away and later leaving the original text as a movable picture.
        // The rendered page has already had native text objects removed, so these lines come from raster/vector artwork.
        var orphanLines = all.Where(line => !kept.Contains(line)).OrderBy(line => line.Top).ThenBy(line => line.X).ToList();
        var groups = new List<List<DocxTextLine>>();
        foreach (var line in orphanLines)
        {
            List<DocxTextLine>? match = null;
            for (var i = groups.Count - 1; i >= 0; i--)
            {
                var group = groups[i];
                var previous = group[^1];
                var previousBottom = previous.Top + Math.Max(1, previous.Height);
                var verticalGap = line.Top - previousBottom;
                var maxGap = Math.Max(3.0, Math.Max(previous.Height, line.Height) * 1.15);
                var maxIndentChange = Math.Max(42.0, Math.Max(previous.Height, line.Height) * 3.5);
                if (verticalGap >= -Math.Max(1.0, line.Height * 0.45)
                    && verticalGap <= maxGap
                    && Math.Abs(line.X - previous.X) <= maxIndentChange)
                {
                    match = group;
                    break;
                }
                // Because input is sorted by vertical position, earlier groups are too far above once the gap grows.
                if (line.Top - previous.Top > Math.Max(18.0, Math.Max(previous.Height, line.Height) * 2.6)) break;
            }
            if (match is null) groups.Add(new List<DocxTextLine> { line });
            else match.Add(line);
        }

        foreach (var group in groups)
            if (IsParagraphLikeRasterGroup(group))
                foreach (var line in group) if (!kept.Contains(line)) kept.Add(line);

        return kept.OrderBy(line => line.Top).ThenBy(line => line.X).ToList();
    }

    private static bool HasRasterTextForRegion(ImageRegion region, IReadOnlyList<DocxTextLine> rasterLines)
    {
        if (rasterLines.Count == 0) return false;
        var inside = rasterLines.Where(line => LineOverlapsRegion(line, region)).ToList();
        var characters = inside.Sum(line => string.Concat(line.Runs.Select(r => r.Text)).Count(char.IsLetterOrDigit));
        return (inside.Count >= 2 && characters >= 12) || (inside.Count == 1 && characters >= 30);
    }

    /// <summary>
    /// Converts rasterized text to editable Word text when OCR succeeds. Only genuinely bounded photo/logo objects stay
    /// as Word pictures. Large scans and text-like panels are never emitted as a draggable picture in editable-first mode.
    /// </summary>
    private static void AddIndividualImageCrops(DocxPage output, byte[]? renderedData, List<ImageRegion> regions,
        float pageWidth, float pageHeight, IReadOnlyList<Ch> chars, IReadOnlyList<DocxTextLine> pageOcrLines, bool enableOcr,
        ref bool omittedArtwork, ref bool ocrUnavailable)
    {
        if (renderedData is not { Length: > 0 } || regions.Count == 0) { if (regions.Count > 0) omittedArtwork = true; return; }
        using var ms = new MemoryStream(renderedData);
        using var source = new Bitmap(ms);
        var added = 0;
        foreach (var region in regions)
        {
            // The full-page OCR pass catches text inside Form XObjects and poorly-bounded image panels. Once it has
            // recovered a paragraph from this region, never add the same pixels back as a movable Word picture.
            if (HasRasterTextForRegion(region, pageOcrLines)) { omittedArtwork = true; continue; }
            var fraction = (region.Width * region.Height) / Math.Max(1.0, pageWidth * pageHeight);
            var large = fraction >= 0.22 || region.Width >= pageWidth * 0.84 || region.Height >= pageHeight * 0.52 || added >= 64;
            var geometryCandidate = fraction >= 0.015 && region.Width >= pageWidth * 0.18 && region.Height >= pageHeight * 0.035;
            var x = Math.Clamp((int)Math.Floor(region.X / pageWidth * source.Width), 0, source.Width - 1);
            var y = Math.Clamp((int)Math.Floor(region.Y / pageHeight * source.Height), 0, source.Height - 1);
            var w = Math.Clamp((int)Math.Ceiling(region.Width / pageWidth * source.Width), 1, source.Width - x);
            var h = Math.Clamp((int)Math.Ceiling(region.Height / pageHeight * source.Height), 1, source.Height - y);
            if (w < 3 || h < 3) continue;
            var cropRect = new Rectangle(x, y, w, h);
            var panelLike = LooksLikeTextPanel(source, cropRect, region, chars, pageWidth, pageHeight);
            var photoLike = LooksLikePhotograph(source, cropRect);
            var sourceTextCount = chars.Count(c => !string.IsNullOrWhiteSpace(c.S)
                && c.OX >= region.X - 1 && c.OX <= region.X + region.Width + 1
                && c.OY >= region.Y - 1 && c.OY <= region.Y + region.Height + 1);

            // Text already reconstructed from PDF glyphs/OCR must not have its raster duplicate added underneath.
            if (sourceTextCount >= 5 && (panelLike || large)) { omittedArtwork = true; continue; }

            // OCR every meaningful image region before classifying it as a picture. Previously photoLike won first,
            // so rasterized paragraphs with anti-aliased colour fringes bypassed OCR and became floating pictures.
            // Include any region with enough area to contain a paragraph, not only regions which already pass the
            // pixel-based panel heuristic. OCR acceptance below requires paragraph-like, confident multi-line text.
            var shouldOcr = enableOcr && sourceTextCount < 5 && (panelLike || geometryCandidate || large || fraction >= 0.008);
            var unavailable = false;
            var ocrLooksTextLike = false;
            var ocrSucceeded = shouldOcr && TryAddRasterOcr(source, cropRect, region, output.Lines, panelLike, photoLike, out unavailable, out ocrLooksTextLike);
            if (unavailable) ocrUnavailable = true;
            if (ocrSucceeded)
            {
                // Recognized text is now normal Word text, not a picture. Underline is attached to word runs if detected.
                omittedArtwork = true;
                continue;
            }
            if (ocrLooksTextLike)
            {
                // OCR saw paragraph-like text but failed the confidence/layout threshold. Omit the doubtful region
                // for review rather than violating the user's expectation by turning the text box into a movable image.
                omittedArtwork = true;
                continue;
            }

            // Default output is editable-first. An image is kept as a separate movable picture only when it is a
            // small, high-variation photo/logo candidate. Paragraph-shaped crops and broad/landscape text panels are
            // deliberately omitted if OCR cannot confidently recover them; they must not silently become picture text.
            var aspect = region.Width / Math.Max(1.0, region.Height);
            // A paragraph-shaped crop can look "photographic" solely because antialiased glyph edges add many gray
            // tones. Require a stronger small-photo signature and reject wide/tall panels outright; text extraction
            // takes priority over visual fidelity in the default editable-first mode.
            var panelSized = region.Width >= pageWidth * 0.16 && region.Height >= pageHeight * 0.055
                && (fraction >= 0.012 || region.Height >= pageHeight * 0.12);
            var safeStandalonePicture = photoLike && !panelLike && !panelSized && !ocrLooksTextLike && sourceTextCount < 5 && !large
                && fraction <= 0.18 && region.Width <= pageWidth * 0.68 && region.Height <= pageHeight * 0.45
                && aspect >= 0.50 && aspect <= 2.05;
            if (!safeStandalonePicture || unavailable)
            { omittedArtwork = true; continue; }

            using var crop = new Bitmap(w, h, PixelFormat.Format32bppArgb);
            using (var g = Graphics.FromImage(crop))
            {
                g.Clear(Color.White);
                g.DrawImage(source, new Rectangle(0, 0, w, h), cropRect, GraphicsUnit.Pixel);
            }
            using var outStream = new MemoryStream();
            crop.Save(outStream, DrawingImageFormat.Png);
            output.Pictures.Add(new DocxPicture { X = region.X, Y = region.Y, Width = region.Width, Height = region.Height, Data = outStream.ToArray(), Ext = "png" });
            added++;
        }
        if (regions.Count > added) omittedArtwork = true;
    }

    /// <summary>Deletes the emitted text from the page (or all text when PDFium can't tell us which is which); reports whether photos/gradients remain.</summary>
    private static void StripText(IntPtr container, bool isPage, HashSet<IntPtr> emitted, bool removeAll, ref bool hasPhoto, ref int remaining)
    {
        var n = isPage ? FPDFPage_CountObjects(container) : FPDFFormObj_CountObjects(container);
        for (var i = n - 1; i >= 0; i--)
        {
            var obj = isPage ? FPDFPage_GetObject(container, i) : FPDFFormObj_GetObject(container, (uint)i);
            if (obj == IntPtr.Zero) continue;
            var type = FPDFPageObj_GetType(obj);
            if (type == ObjText && (removeAll || emitted.Contains(obj)))
            {
                var ok = isPage ? FPDFPage_RemoveObject(container, obj) != 0 : FPDFFormObj_RemoveObject(container, obj) != 0;
                if (ok) { FPDFPageObj_Destroy(obj); continue; }
            }
            remaining++;
            if (type == ObjImage || type == ObjShading) hasPhoto = true;
            else if (type == ObjForm) StripText(obj, false, emitted, removeAll, ref hasPhoto, ref remaining);
        }
    }

    private static (byte[]? Data, string Ext) RenderGraphics(IntPtr page, float pw, float ph, int dpi, bool photo)
    {
        var scale = dpi / 72.0;
        var wpx = (int)Math.Round(pw * scale); var hpx = (int)Math.Round(ph * scale);
        var big = Math.Max(wpx, hpx);
        if (big > MaxBitmapSide) { var f = (double)MaxBitmapSide / big; wpx = (int)Math.Round(wpx * f); hpx = (int)Math.Round(hpx * f); }
        wpx = Math.Max(1, wpx); hpx = Math.Max(1, hpx);

        var bmp = FPDFBitmap_Create(wpx, hpx, 0);
        if (bmp == IntPtr.Zero) throw new InvalidOperationException("Not enough memory to render the page graphics.");
        try
        {
            FPDFBitmap_FillRect(bmp, 0, 0, wpx, hpx, 0xFFFFFFFF);
            FPDF_RenderPageBitmap(bmp, page, 0, 0, wpx, hpx, 0, RenderAnnot);
            var scan0 = FPDFBitmap_GetBuffer(bmp);
            var stride = FPDFBitmap_GetStride(bmp);

            // nothing left to draw? then the page is pure text and needs no picture
            var row = new byte[wpx * 4];
            var blank = true;
            for (var y = 0; y < hpx && blank; y++)
            {
                Marshal.Copy(scan0 + y * stride, row, 0, row.Length);
                for (var x = 0; x < row.Length; x += 4)
                    if (row[x] != 255 || row[x + 1] != 255 || row[x + 2] != 255) { blank = false; break; }
            }
            if (blank) return (null, "png");

            using var image = new Bitmap(wpx, hpx, stride, PixelFormat.Format32bppRgb, scan0);
            using var ms = new MemoryStream();
            if (photo)
            {
                var codec = ImageCodecInfo.GetImageEncoders().First(c => c.FormatID == DrawingImageFormat.Jpeg.Guid);
                using var ep = new EncoderParameters(1);
                ep.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, 88L);
                image.Save(ms, codec, ep);
                return (ms.ToArray(), "jpg");
            }
            image.Save(ms, DrawingImageFormat.Png);
            return (ms.ToArray(), "png");
        }
        finally { FPDFBitmap_Destroy(bmp); }
    }

    // ───────────────────────── conversion ─────────────────────────

    public static string DefaultTitle(string pdfPath) => Path.GetFileNameWithoutExtension(pdfPath);

    /// <summary>Converts every page of <paramref name="pdfPath"/> to <paramref name="docxPath"/>.</summary>
    public PdfToWordResult Convert(string pdfPath, string docxPath, PdfToWordOptions? options = null, Action<int, int>? progress = null)
    {
        options ??= new PdfToWordOptions();
        var dpi = Math.Clamp(options.GraphicsDpi, 72, 400);
        var bytes = File.ReadAllBytes(pdfPath);
        var password = PdfPasswords.Get(pdfPath);
        var tmp = docxPath + ".tmp";
        var mem = Marshal.AllocHGlobal(bytes.Length);
        IntPtr doc = IntPtr.Zero;
        var warnings = new List<string>();
        var pageCount = 0; var lineCount = 0; var tableCount = 0;
        var fonts = new PdfFontResolver();   // font handles are only valid while this document is open

        try
        {
            Marshal.Copy(bytes, 0, mem, bytes.Length);
            lock (ImagePdfService.PdfiumGate)
            {
                FPDF_InitLibrary();
                doc = FPDF_LoadMemDocument(mem, bytes.Length, string.IsNullOrEmpty(password) ? null : password);
                if (doc == IntPtr.Zero) throw new InvalidOperationException("This PDF could not be opened (it may be damaged or password-protected).");
                pageCount = FPDF_GetPageCount(doc);
            }
            if (pageCount <= 0) throw new InvalidOperationException("This PDF has no pages.");

            using (var writer = new DocxWriter(tmp))
            {
                var artworkNoticeAdded = false;
                var ocrWarningAdded = false;
                for (var i = 0; i < pageCount; i++)
                {
                    progress?.Invoke(i, pageCount);
                    DocxPage dp;
                    var omittedArtwork = false;
                    var ocrUnavailable = false;
                    try { lock (ImagePdfService.PdfiumGate) dp = ConvertPage(doc, i, dpi, fonts, options, out omittedArtwork, out ocrUnavailable); }
                    catch (Exception ex)
                    {
                        warnings.Add($"Page {i + 1} could not be converted ({ex.Message}); it was left blank.");
                        dp = new DocxPage { WidthPt = 612, HeightPt = 792 };
                    }
                    if (ocrUnavailable && !ocrWarningAdded)
                    {
                        warnings.Add("Raster-text OCR could not start. Editable text layers still convert normally, but raster-only text panels may be omitted rather than inserted as draggable pictures. Verify the Microsoft Visual C++ 2015–2022 x64 runtime is installed, then retry.");
                        ocrWarningAdded = true;
                    }
                    if (omittedArtwork && !options.IncludeFullPageArtwork && !artworkNoticeAdded)
                    {
                        warnings.Add("Editable-first mode converts recognized raster text into normal Word text and does not insert text-like panels as draggable pictures. Some decorative artwork or scans that OCR cannot read may be omitted; review the converted document and correct OCR mistakes.");
                        artworkNoticeAdded = true;
                    }
                    lineCount += dp.Lines.Count + dp.Tables.Sum(t => t.LineCount); tableCount += dp.Tables.Count;
                    writer.AddPage(dp);
                }
                writer.Finish(DefaultTitle(pdfPath));
            }
            progress?.Invoke(pageCount, pageCount);
            File.Move(tmp, docxPath, true);
        }
        catch
        {
            try { if (File.Exists(tmp)) File.Delete(tmp); } catch { }
            throw;
        }
        finally
        {
            lock (ImagePdfService.PdfiumGate) { if (doc != IntPtr.Zero) FPDF_CloseDocument(doc); }
            Marshal.FreeHGlobal(mem);
        }

        var result = new PdfToWordResult { Pages = pageCount, TextLines = lineCount, Tables = tableCount };
        result.Warnings.AddRange(warnings);
        return result;
    }

    private static DocxPage ConvertPage(IntPtr doc, int index, int dpi, PdfFontResolver fonts, PdfToWordOptions options, out bool omittedArtwork, out bool ocrUnavailable)
    {
        omittedArtwork = false;
        ocrUnavailable = false;
        var page = FPDF_LoadPage(doc, index);
        if (page == IntPtr.Zero) throw new InvalidOperationException("PDFium could not load the page.");
        try
        {
            float pw = FPDF_GetPageWidthF(page), ph = FPDF_GetPageHeightF(page);
            var dp = new DocxPage { WidthPt = pw, HeightPt = ph };
            var imageRegions = ReadImageRegions(page, pw, ph);

            // 1. text
            PageText text;
            var tp = FPDFText_LoadPage(page);
            if (tp == IntPtr.Zero) text = new PageText();
            else
            {
                try { text = ReadChars(page, tp, pw, ph, fonts); }
                finally { FPDFText_ClosePage(tp); }
            }

            // 1b. tables: ruling lines → grid; every character inside a cell goes to that cell instead of a text box
            var rules = PdfRules.Read(page, pw, ph);
            var centres = text.Chars.Select(c => (X: (c.X0 + c.X1) / 2.0, Y: c.OY - c.Size * 0.3)).ToList();
            var tables = rules.Count >= 4
                ? TableBuilder.Build(rules, pw, ph, (x0, y0, x1, y1) => centres.Any(c => c.X >= x0 && c.X <= x1 && c.Y >= y0 && c.Y <= y1))
                : new List<DocxTable>();
            var tableRuleObjects = tables.SelectMany(t => t.Rules).Select(r => r.Obj).ToHashSet();
            // Mark semantic underlines before BuildLine splits characters into styled Word runs.
            var underlineRules = DetectTextUnderlineRules(rules, text.Chars, tableRuleObjects);

            var cellChars = new Dictionary<DocxCell, List<Ch>>();
            var freeChars = text.Chars;
            if (tables.Count > 0)
            {
                freeChars = new List<Ch>();
                foreach (var ch in text.Chars)
                {
                    var cx = (ch.X0 + ch.X1) / 2.0; var cy = ch.OY - ch.Size * 0.3;
                    DocxCell? best = null; var bestArea = double.MaxValue;
                    foreach (var t in tables)
                        foreach (var c in t.Cells)
                        {
                            if (cx < c.X0 || cx >= c.X1 || cy < c.Y0 || cy >= c.Y1) continue;
                            var area = (c.X1 - c.X0) * (c.Y1 - c.Y0);
                            if (area < bestArea) { best = c; bestArea = area; }
                        }
                    if (best is null) { freeChars.Add(ch); continue; }
                    if (!cellChars.TryGetValue(best, out var list)) cellChars[best] = list = new List<Ch>();
                    list.Add(ch);
                }
            }

            var seen = new HashSet<(string, int, int)>();
            foreach (var kv in cellChars)
            {
                var lines = new List<DocxTextLine>();
                foreach (var chars in SplitLines(kv.Value))
                {
                    var line = BuildLine(chars);
                    if (line is null) continue;
                    var txt = string.Concat(line.Runs.Select(r => r.Text));
                    if (!seen.Add((txt, (int)Math.Round(line.X / 2), (int)Math.Round(line.Top / 2)))) continue;
                    lines.Add(line);
                }
                FillCell(kv.Key, lines);
            }
            dp.Tables.AddRange(tables);

            foreach (var chars in SplitLines(freeChars))
            {
                var line = BuildLine(chars);
                if (line is null) continue;
                var txt = string.Concat(line.Runs.Select(r => r.Text));
                if (!seen.Add((txt, (int)Math.Round(line.X / 2), (int)Math.Round(line.Top / 2)))) continue;   // fake-bold double strikes
                dp.Lines.Add(line);
            }

            // 2. render the remaining graphics for optional artwork or separate bounded photo/logo crops
            var hasPhoto = false; var remaining = 0;
            PdfRules.Strip(tables.SelectMany(t => t.Rules).Concat(underlineRules));   // use real Word table borders and underline runs instead of baking either into the background picture
            StripText(page, true, text.Objects, removeAll: !text.ObjectMappingAvailable, ref hasPhoto, ref remaining);
            var (data, ext) = RenderGraphics(page, pw, ph, dpi, hasPhoto);
            if (options.IncludeFullPageArtwork)
            {
                dp.Background = data;
                dp.BackgroundExt = ext;
            }
            else
            {
                // First try OCR over the remaining graphics as a whole. Embedded paragraphs often live in Form XObjects
                // or awkwardly clipped image objects that per-object OCR misses. Since StripText already removed the
                // PDF's actual text objects, this pass sees raster lettering without duplicating normal PDF text.
                var pageRasterLines = new List<DocxTextLine>();
                if (options.EnableRasterOcr && hasPhoto && data is { Length: > 0 })
                {
                    try
                    {
                        using var stream = new MemoryStream(data);
                        using var source = new Bitmap(stream);
                        var wholePage = new Rectangle(0, 0, source.Width, source.Height);
                        var fullRegion = new ImageRegion(0, 0, pw, ph);
                        var pageOcrUnavailable = false;
                        var pageOcrTextLike = false;
                        if (TryAddRasterOcr(source, wholePage, fullRegion, pageRasterLines, panelLike: true, photoLike: false,
                            out pageOcrUnavailable, out pageOcrTextLike))
                        {
                            var recovered = KeepParagraphLikeRasterLines(pageRasterLines, imageRegions);
                            pageRasterLines = recovered;
                            dp.Lines.AddRange(recovered);
                        }
                        if (pageOcrUnavailable) ocrUnavailable = true;
                    }
                    catch { /* A page-level OCR fallback must never stop normal PDF conversion. */ }
                }

                AddIndividualImageCrops(dp, data, imageRegions, pw, ph, text.Chars, pageRasterLines,
                    options.EnableRasterOcr, ref omittedArtwork, ref ocrUnavailable);
                // Vector artwork that was not reconstructed as a Word table/underline is intentionally not flattened
                // into a page-sized picture. The dialog explains this trade-off before conversion.
                if (data is { Length: > 0 } && (imageRegions.Count == 0 || imageRegions.Any(r => r.Width * r.Height / Math.Max(1.0, pw * ph) >= 0.60)))
                    omittedArtwork = true;
            }
            return dp;
        }
        finally { FPDF_ClosePage(page); }
    }
}
