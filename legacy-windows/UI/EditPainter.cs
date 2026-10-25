using PdfStudio.Models;
using PdfStudio.Services;
using System.Drawing.Drawing2D;
using System.Drawing.Text;

namespace PdfStudio.UI;

/// <summary>Draws Edit PDF objects with GDI+ (editor canvas and main preview share this) and measures text.</summary>
public static class EditPainter
{
    private static readonly Dictionary<string, Font> FontCache = new();
    private static readonly Bitmap MeasureBmp = new(1, 1);
    private static readonly Dictionary<string, Image?> ImageCache = new();

    public static Font GetFont(string name, double sizePt, bool bold, bool italic, bool underline)
    {
        var size = (float)Math.Max(4, sizePt);
        var key = $"{name}|{size:0.##}|{bold}|{italic}|{underline}";
        if (FontCache.TryGetValue(key, out var f)) return f;
        try
        {
            var fam = TextMetrics.Family(name);
            var style = TextMetrics.StyleFor(fam, bold, italic) | (underline ? FontStyle.Underline : 0);
            f = new Font(fam, size, style, GraphicsUnit.Pixel);
        }
        catch { f = new Font("Arial", size, FontStyle.Regular, GraphicsUnit.Pixel); }
        if (FontCache.Count > 600) FontCache.Clear();   // not disposed: a font may still be assigned to a control
        FontCache[key] = f;
        return f;
    }

    public static SizeF MeasureText(PageEditObject o)
    {
        var text = (o.Text ?? "").Replace("\r", "");
        var lines = text.Split('\n');
        if (lines.Length == 0) lines = new[] { "" };
        var runs = NormalizedRuns(o);
        double maxW = 0, totalH = 0;
        var offset = 0;
        foreach (var line in lines)
        {
            var lineLen = line.Length;
            var lineRuns = RunsForRange(o, runs, offset, lineLen);
            var x = 0.0;
            var maxSize = Math.Max(4, o.FontSize);
            foreach (var r in lineRuns)
            {
                var part = line.Substring(r.Start - offset, r.Length);
                x += TextMetrics.Advance(part, r.FontName, Math.Max(4, r.FontSize), r.Bold, r.Italic);
                maxSize = Math.Max(maxSize, r.FontSize);
            }
            maxW = Math.Max(maxW, x);
            totalH += maxSize * 1.25;
            offset += lineLen + 1;
        }
        maxW *= HScaleOf(o);
        return new SizeF((float)Math.Max(maxW, Math.Max(4, o.FontSize) * 0.5), (float)Math.Max(totalH, Math.Max(4, o.FontSize) * 1.25));
    }

    /// <summary>Top-to-baseline distance of the first line, including mixed per-character formatting.</summary>
    public static double FirstLineAscent(PageEditObject o) => FirstLineMetric(o, ascent: true);

    public static double FirstLineDescent(PageEditObject o) => FirstLineMetric(o, ascent: false);

    private static double FirstLineMetric(PageEditObject o, bool ascent)
    {
        var text = (o.Text ?? "").Replace("\r", "");
        var newline = text.IndexOf('\n');
        var length = newline < 0 ? text.Length : newline;
        double Metric(string? font, double size, bool bold, bool italic) => ascent
            ? TextMetrics.Ascent(font, Math.Max(4, size), bold, italic)
            : TextMetrics.Descent(font, Math.Max(4, size), bold, italic);
        if (length <= 0) return Metric(o.FontName, o.FontSize, o.Bold, o.Italic);
        var runs = RunsForRange(o, NormalizedRuns(o), 0, length);
        if (runs.Count == 0) return Metric(o.FontName, o.FontSize, o.Bold, o.Italic);
        return runs.Max(r => Metric(r.FontName, r.FontSize, r.Bold, r.Italic));
    }

    private static List<TextStyleRun> NormalizedRuns(PageEditObject o)
    {
        var text = (o.Text ?? "").Replace("\r", "");
        var n = text.Length;
        var baseRun = new TextStyleRun
        { Start = 0, Length = n, FontName = o.FontName, FontSize = o.FontSize,
          Bold = o.Bold, Italic = o.Italic, Underline = o.Underline, ColorHex = o.ColorHex };
        if (n == 0) return new List<TextStyleRun>();
        var result = new List<TextStyleRun>();
        foreach (var r0 in o.TextStyles.OrderBy(r => r.Start))
        {
            var a = Math.Clamp(r0.Start, 0, n);
            var b = Math.Clamp(r0.Start + r0.Length, a, n);
            if (b <= a) continue;
            // Fill gaps from the object-level style.
            if (result.Count == 0 && a > 0) result.Add(new TextStyleRun { Start = 0, Length = a, FontName = baseRun.FontName, FontSize = baseRun.FontSize, Bold = baseRun.Bold, Italic = baseRun.Italic, Underline = baseRun.Underline, ColorHex = baseRun.ColorHex });
            else if (result.Count > 0 && result[^1].Start + result[^1].Length < a)
            {
                var st = result[^1].Start + result[^1].Length;
                result.Add(new TextStyleRun { Start = st, Length = a - st, FontName = baseRun.FontName, FontSize = baseRun.FontSize, Bold = baseRun.Bold, Italic = baseRun.Italic, Underline = baseRun.Underline, ColorHex = baseRun.ColorHex });
            }
            var rr = r0.Clone(); rr.Start = a; rr.Length = b - a;
            // Runs are expected to be ordered/non-overlapping; later data wins when legacy data overlaps.
            if (result.Count > 0 && result[^1].Start + result[^1].Length > rr.Start)
            {
                var prev = result[^1];
                if (prev.Start < rr.Start) prev.Length = rr.Start - prev.Start; else result.RemoveAt(result.Count - 1);
            }
            result.Add(rr);
        }
        if (result.Count == 0) result.Add(baseRun);
        else if (result[^1].Start + result[^1].Length < n)
        {
            var st = result[^1].Start + result[^1].Length;
            result.Add(new TextStyleRun { Start = st, Length = n - st, FontName = baseRun.FontName, FontSize = baseRun.FontSize, Bold = baseRun.Bold, Italic = baseRun.Italic, Underline = baseRun.Underline, ColorHex = baseRun.ColorHex });
        }
        return result;
    }

    private static List<TextStyleRun> RunsForRange(PageEditObject o, List<TextStyleRun> runs, int start, int length)
    {
        if (length <= 0) return new List<TextStyleRun>();
        var end = start + length;
        return runs.Where(r => r.Start < end && r.Start + r.Length > start).Select(r =>
        {
            var a = Math.Max(start, r.Start); var b = Math.Min(end, r.Start + r.Length);
            var c = r.Clone(); c.Start = a; c.Length = b - a; return c;
        }).ToList();
    }

    public static double HScaleOf(PageEditObject o) => o.HScale is > 0.2 and < 5 ? o.HScale : 1.0;

    /// <summary>Normalised bounding box (points) of any object.</summary>
    public static RectangleF Bounds(PageEditObject o)
    {
        if (o.Kind == EditKind.Text) { var s = MeasureText(o); return new RectangleF((float)o.X, (float)o.Y, s.Width, s.Height); }
        var x = (float)Math.Min(o.X, o.X + o.W); var y = (float)Math.Min(o.Y, o.Y + o.H);
        return new RectangleF(x, y, (float)Math.Abs(o.W), (float)Math.Abs(o.H));
    }

    public static Color Parse(string hex, Color fallback)
    {
        try { return string.IsNullOrEmpty(hex) ? fallback : ColorTranslator.FromHtml(hex); } catch { return fallback; }
    }

    private static Image? LoadImage(string path)
    {
        if (ImageCache.TryGetValue(path, out var img)) return img;
        try
        {
            using var fs = new MemoryStream(File.ReadAllBytes(path));
            using var src = Image.FromStream(fs);
            img = new Bitmap(src);
        }
        catch { img = null; }
        ImageCache[path] = img;
        return img;
    }

    /// <summary>
    /// Text is filled from its glyph outlines (no hinting, no grid-fitting, sub-pixel positioned) – that is how PDFium draws
    /// the page, so edited text has the same weight and sharpness as the text around it, at any zoom.
    /// The line box top is o.Y; the baseline sits one font-ascent below it (identical rule in the PDF export).
    /// </summary>
    private static void DrawText(Graphics g, PageEditObject o)
    {
        if (string.IsNullOrEmpty(o.Text)) return;
        var text = o.Text.Replace("\r", "");
        var lines = text.Split('\n');
        var runs = NormalizedRuns(o);
        var sx = (float)HScaleOf(o);
        var offset = 0;
        var state = g.Save();
        g.TranslateTransform((float)o.X, (float)o.Y);
        if (Math.Abs(sx - 1f) > 0.0005f) g.ScaleTransform(sx, 1f);
        g.SmoothingMode = SmoothingMode.AntiAlias;
        using var fmt = (StringFormat)StringFormat.GenericTypographic.Clone();
        fmt.FormatFlags |= StringFormatFlags.NoWrap | StringFormatFlags.MeasureTrailingSpaces;

        foreach (var line in lines)
        {
            var lineRuns = RunsForRange(o, runs, offset, line.Length);
            float lineH = Math.Max(4f, (float)(lineRuns.Count == 0 ? o.FontSize : lineRuns.Max(r => r.FontSize))) * 1.25f;
            var baseline = lineRuns.Count == 0 ? (float)TextMetrics.Ascent(o.FontName, o.FontSize, o.Bold, o.Italic) :
                (float)lineRuns.Max(r => TextMetrics.Ascent(r.FontName, r.FontSize, r.Bold, r.Italic));
            var x = 0f;
            foreach (var r in lineRuns)
            {
                var local = Math.Max(0, r.Start - offset);
                var len = Math.Min(r.Length, line.Length - local);
                if (len <= 0) continue;
                var part = line.Substring(local, len);
                var fam = TextMetrics.Family(r.FontName);
                var style = TextMetrics.StyleFor(fam, r.Bold, r.Italic);
                var size = (float)Math.Max(4, r.FontSize);
                using var brush = new SolidBrush(Parse(r.ColorHex, Color.Black));
                // AddString's point is the line-box top; align all runs to the largest ascent so mixed font sizes behave like Word.
                var st = g.Save();
                g.TranslateTransform(x, baseline - (float)TextMetrics.Ascent(r.FontName, r.FontSize, r.Bold, r.Italic));
                using var runPath = new GraphicsPath(FillMode.Winding);
                runPath.AddString(part, fam, (int)style, size, PointF.Empty, fmt);
                g.FillPath(brush, runPath);
                if (r.Underline)
                {
                    var w = (float)TextMetrics.Advance(part, r.FontName, r.FontSize, r.Bold, r.Italic);
                    var th = Math.Max(0.5f, size / 16f);
                    g.FillRectangle(brush, 0, (float)TextMetrics.Ascent(r.FontName, r.FontSize, r.Bold, r.Italic) + size * 0.11f, w, th);
                }
                g.Restore(st);
                x += (float)TextMetrics.Advance(part, r.FontName, r.FontSize, r.Bold, r.Italic);
            }
            offset += line.Length + 1;
            // line height is based on the largest run on that line.
            if (offset <= text.Length) g.TranslateTransform(0f, lineH);
        }
        g.Restore(state);
    }

    /// <summary>Draws objects in point coordinates; the caller sets the Graphics transform (points → pixels).</summary>
    public static void Draw(Graphics g, IEnumerable<PageEditObject> objs, Guid? skip = null)
    {
        var oldSmooth = g.SmoothingMode; var oldText = g.TextRenderingHint;
        g.SmoothingMode = SmoothingMode.AntiAlias; g.TextRenderingHint = TextRenderingHint.AntiAlias;
        g.InterpolationMode = InterpolationMode.HighQualityBicubic;
        foreach (var o in objs)
        {
            if (skip == o.Id) continue;
            switch (o.Kind)
            {
                case EditKind.Text:
                    DrawText(g, o);
                    break;
                case EditKind.Image:
                {
                    var img = LoadImage(o.ImagePath);
                    if (img != null && o.W > 0 && o.H > 0) g.DrawImage(img, (float)o.X, (float)o.Y, (float)o.W, (float)o.H);
                    break;
                }
                case EditKind.Rect:
                case EditKind.Ellipse:
                {
                    var b = Bounds(o);
                    if (b.Width <= 0 || b.Height <= 0) break;
                    if (!string.IsNullOrEmpty(o.FillHex))
                    {
                        using var br = new SolidBrush(Color.FromArgb(Math.Clamp(o.FillAlpha, 0, 255), Parse(o.FillHex, Color.White)));
                        // the cover behind edited text is pixel-snapped so it leaves no soft, visible edge
                        var crisp = o.Kind == EditKind.Rect && o.Tag.Length > 0 && o.FillAlpha >= 255;
                        var prevSm = g.SmoothingMode; var prevPo = g.PixelOffsetMode;
                        if (crisp) { g.SmoothingMode = SmoothingMode.None; g.PixelOffsetMode = PixelOffsetMode.Half; }
                        if (o.Kind == EditKind.Rect) g.FillRectangle(br, b); else g.FillEllipse(br, b);
                        g.SmoothingMode = prevSm; g.PixelOffsetMode = prevPo;
                    }
                    if (!string.IsNullOrEmpty(o.StrokeHex) && o.StrokeWidth > 0)
                    {
                        using var pen = new Pen(Parse(o.StrokeHex, Color.Black), (float)o.StrokeWidth);
                        if (o.Kind == EditKind.Rect) g.DrawRectangle(pen, b.X, b.Y, b.Width, b.Height); else g.DrawEllipse(pen, b);
                    }
                    break;
                }
                case EditKind.Line:
                {
                    using var pen = new Pen(Parse(string.IsNullOrEmpty(o.StrokeHex) ? "#000000" : o.StrokeHex, Color.Black), (float)Math.Max(0.25, o.StrokeWidth)) { StartCap = LineCap.Round, EndCap = LineCap.Round };
                    g.DrawLine(pen, (float)o.X, (float)o.Y, (float)(o.X + o.W), (float)(o.Y + o.H));
                    break;
                }
            }
        }
        g.SmoothingMode = oldSmooth; g.TextRenderingHint = oldText;
    }
}
