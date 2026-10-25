using PdfSharp.Drawing;
using PdfSharp.Pdf;
using PdfSharp.Pdf.IO;
using PdfStudio.Models;

namespace PdfStudio.Services;

public sealed class PdfService
{
    /// <summary>Reads page sizes/rotation of every page so the editor can lay pages out without rendering them.</summary>
    public List<PageItem> LoadPages(string path, string? displayName = null)
    {
        using var doc = PdfPasswords.Open(path, PdfDocumentOpenMode.Import);
        var name = displayName ?? Path.GetFileName(path);
        var list = new List<PageItem>(doc.PageCount);
        for (var i = 0; i < doc.PageCount; i++)
        {
            var p = doc.Pages[i];
            list.Add(new PageItem
            {
                SourcePath = path, SourcePageIndex = i, SourceName = name,
                WidthPt = p.Width.Point, HeightPt = p.Height.Point, SourceRotate = Norm(p.Rotate)
            });
        }
        return list;
    }

    public int GetPageCount(string path)
    {
        using var doc = PdfPasswords.Open(path, PdfDocumentOpenMode.Import);
        return doc.PageCount;
    }

    public static PageItem CreateBlank(double widthPt, double heightPt) =>
        new() { IsBlank = true, WidthPt = widthPt, HeightPt = heightPt, SourceName = "Blank" };

    /// <summary>
    /// Assembles the final PDF from the page list. Pages stay vector (no rasterising). Pipeline:
    /// build → optional built-in compression → optional password protection → move into place.
    /// </summary>
    /// <summary>What the last <see cref="Export"/> call's compression achieved (null when compression was off).</summary>
    public CompressionReport? LastCompression { get; private set; }

    public void Export(string outputPath, IReadOnlyList<PageItem> pages, ExportOptions? options = null, Action<int, int>? progress = null)
    {
        if (pages.Count == 0) throw new InvalidOperationException("There are no pages to export.");
        options ??= new ExportOptions();
        LastCompression = null;

        var dir = Path.GetDirectoryName(Path.GetFullPath(outputPath))!;
        Directory.CreateDirectory(dir);
        var temp = Path.Combine(dir, $"~pdfstudio_{Guid.NewGuid():N}.pdf");
        try
        {
            Build(temp, pages, options, progress);
            if (options.WantsCompression) LastCompression = PdfCompressor.Compress(temp, options);
            if (options.HasSecurity) ApplySecurity(temp, options);
            File.Move(temp, outputPath, true);
        }
        finally { try { if (File.Exists(temp)) File.Delete(temp); } catch { } }
    }

    private static void Build(string path, IReadOnlyList<PageItem> pages, ExportOptions opt, Action<int, int>? progress)
    {
        using var output = new PdfDocument();
        output.Info.Title = string.IsNullOrWhiteSpace(opt.Title) ? "PDF Studio Export" : opt.Title;
        if (!string.IsNullOrWhiteSpace(opt.Author)) output.Info.Author = opt.Author;
        if (!string.IsNullOrWhiteSpace(opt.Subject)) output.Info.Subject = opt.Subject;
        if (!string.IsNullOrWhiteSpace(opt.Keywords)) output.Info.Keywords = opt.Keywords;
        output.Info.Creator = "PDF Studio";

        var cache = new Dictionary<string, PdfDocument>(StringComparer.OrdinalIgnoreCase);
        var keepAlive = new List<IDisposable>(); // overlay pictures must outlive Save()
        var forms = new Dictionary<string, XPdfForm>(StringComparer.OrdinalIgnoreCase); // sources drawn onto resized pages
        var tempFiles = new List<string>();
        var resize = !opt.Layout.IsOriginal;
        (double W, double H) baseSize = resize ? PageSizing.ResolveBase(opt.Layout, pages) : (0.0, 0.0);
        try
        {
            for (var idx = 0; idx < pages.Count; idx++)
            {
                var item = pages[idx];
                PdfPage target;
                double w, h;
                int srcRot;
                var userRot = item.Rotation;

                // "One page size for all pages": pages that already match are copied untouched, the rest are redrawn.
                var redraw = false; PagePlacement place = default;
                if (resize)
                {
                    var (cw, ch) = item.DisplaySizePt(true);
                    place = PageSizing.Place(cw, ch, opt.Layout, baseSize);
                    redraw = !(Math.Abs(place.PageW - cw) < 0.75 && Math.Abs(place.PageH - ch) < 0.75 &&
                               Math.Abs(place.SX - 1) < 0.002 && Math.Abs(place.SY - 1) < 0.002);
                }

                if (redraw)
                {
                    target = output.AddPage();
                    target.Width = XUnit.FromPoint(place.PageW);
                    target.Height = XUnit.FromPoint(place.PageH);
                    using (var gfx = XGraphics.FromPdfPage(target))
                        DrawResized(gfx, item, place, forms, tempFiles, keepAlive);
                    w = place.PageW; h = place.PageH; srcRot = 0; userRot = 0;
                }
                else if (item.IsBlank)
                {
                    target = output.AddPage();
                    target.Width = XUnit.FromPoint(item.WidthPt);
                    target.Height = XUnit.FromPoint(item.HeightPt);
                    w = item.WidthPt; h = item.HeightPt; srcRot = 0;
                }
                else
                {
                    if (!cache.TryGetValue(item.SourcePath, out var source))
                    {
                        source = PdfPasswords.Open(item.SourcePath, PdfDocumentOpenMode.Import);
                        cache[item.SourcePath] = source;
                    }
                    if (item.SourcePageIndex < 0 || item.SourcePageIndex >= source.PageCount)
                        throw new InvalidOperationException($"Page {item.SourcePageIndex + 1} no longer exists in {item.SourceName}.");
                    target = output.AddPage(source.Pages[item.SourcePageIndex]);
                    w = target.Width.Point; h = target.Height.Point; srcRot = Norm(target.Rotate);
                }

                // 1) user text overlays: authored in the page as first displayed (before user rotation).
                if (!redraw && item.HasOverlays)
                    DrawFramed(target, w, h, srcRot, (g, dw, dh) =>
                    {
                        foreach (var e in item.Edits) DrawEdit(g, e, keepAlive);
                        foreach (var im in item.ImageAnnotations) DrawImageAnnotation(g, im, dw, dh, keepAlive);
                        foreach (var a in item.TextAnnotations) DrawAnnotation(g, a, dw, dh);
                    });

                // 2) stamps (watermark / page numbers): drawn upright in the FINAL orientation.
                var finalRot = Norm(srcRot + userRot);
                var number = opt.StartNumber + idx;
                var wantNumber = opt.PageNumbers && !(opt.SkipFirstPage && idx == 0);
                if (opt.Watermark || wantNumber)
                    DrawFramed(target, w, h, finalRot, (g, dw, dh) =>
                    {
                        if (opt.Watermark && !string.IsNullOrWhiteSpace(opt.WatermarkText)) DrawWatermark(g, opt, dw, dh);
                        if (wantNumber) DrawPageNumber(g, opt, number, pages.Count, dw, dh);
                    });

                target.Rotate = finalRot;
                progress?.Invoke(idx + 1, pages.Count);
            }
            output.Save(path);
        }
        finally
        {
            foreach (var d in cache.Values) d.Dispose();
            foreach (var k in keepAlive) try { k.Dispose(); } catch { }
            foreach (var f in forms.Values) try { f.Dispose(); } catch { }
            foreach (var t in tempFiles) try { File.Delete(t); } catch { }
        }
    }

    // ───────────────────────── resized pages ─────────────────────────

    /// <summary>Draws one page (vector) onto an empty target page, scaled/positioned by <paramref name="p"/>, then its text and image overlays.</summary>
    private static void DrawResized(XGraphics g, PageItem item, PagePlacement p, Dictionary<string, XPdfForm> forms, List<string> temps, List<IDisposable> keep)
    {
        var clip = new XRect(p.ClipX, p.ClipY, p.ClipW, p.ClipH);
        var (cw, ch) = item.DisplaySizePt(true);

        if (!item.IsBlank)
        {
            var form = GetForm(item, forms, temps);
            var st = g.Save();
            g.IntersectClip(clip);
            g.TranslateTransform(p.X, p.Y);
            g.ScaleTransform(p.SX, p.SY);
            ApplyRotation(g, item.EffectiveRotation, item.WidthPt, item.HeightPt);
            g.DrawImage(form, 0, 0, item.WidthPt, item.HeightPt);
            g.Restore(st);
        }

        if (item.HasOverlays)
        {
            var (fw, fh) = item.DisplaySizePt(false);   // the frame overlays were authored in
            var su = Math.Min(p.SX, p.SY);
            var st = g.Save();
            g.IntersectClip(clip);
            g.TranslateTransform(p.X + (p.W - cw * su) / 2, p.Y + (p.H - ch * su) / 2);
            g.ScaleTransform(su, su);
            ApplyRotation(g, Norm(item.Rotation), fw, fh);
            foreach (var e in item.Edits) DrawEdit(g, e, keep);
            foreach (var im in item.ImageAnnotations) DrawImageAnnotation(g, im, fw, fh, keep);
            foreach (var a in item.TextAnnotations) DrawAnnotation(g, a, fw, fh);
            g.Restore(st);
        }
    }

    /// <summary>Rotates content of size w × h clockwise by rot degrees so it lands in the top-left of the rotated frame.</summary>
    private static void ApplyRotation(XGraphics g, int rot, double w, double h)
    {
        switch (Norm(rot))
        {
            case 90: g.TranslateTransform(h, 0); g.RotateTransform(90); break;
            case 180: g.TranslateTransform(w, h); g.RotateTransform(180); break;
            case 270: g.TranslateTransform(0, w); g.RotateTransform(270); break;
        }
    }

    private static XPdfForm GetForm(PageItem item, Dictionary<string, XPdfForm> forms, List<string> temps)
    {
        if (!forms.TryGetValue(item.SourcePath, out var form))
        {
            form = XPdfForm.FromFile(PrepareSource(item.SourcePath, temps));
            forms[item.SourcePath] = form;
        }
        form.PageIndex = item.SourcePageIndex;
        return form;
    }

    /// <summary>
    /// Pages are drawn from their raw content, so a copy with /Rotate cleared (and any password removed) is used when needed;
    /// the rotation is then applied explicitly. Unprotected, unrotated files are used as they are.
    /// </summary>
    private static string PrepareSource(string path, List<string> temps)
    {
        var hasPassword = !string.IsNullOrEmpty(PdfPasswords.Get(path));
        string? tmp = null;
        try
        {
            using var doc = PdfPasswords.Open(path, PdfDocumentOpenMode.Modify);
            var rotated = false;
            for (var i = 0; i < doc.PageCount; i++) if (Norm(doc.Pages[i].Rotate) != 0) { rotated = true; break; }
            if (!hasPassword && !rotated) return path;
            for (var i = 0; i < doc.PageCount; i++) doc.Pages[i].Rotate = 0;
            var dir = Path.Combine(Path.GetTempPath(), "PdfStudio");
            Directory.CreateDirectory(dir);
            tmp = Path.Combine(dir, $"src_{Guid.NewGuid():N}.pdf");
            doc.Save(tmp);
            temps.Add(tmp);
        }
        catch (Exception ex)
        {
            if (hasPassword) throw new InvalidOperationException($"\"{Path.GetFileName(path)}\" is password-protected and its pages can't be resized. Export with 'Keep each page's own size' instead.", ex);
            return path;
        }

        if (hasPassword)
        {
            // The copy must open without a password, otherwise it can't be drawn onto a resized page.
            try { using var check = PdfReader.Open(tmp!, PdfDocumentOpenMode.Import); }
            catch (Exception ex)
            {
                throw new InvalidOperationException($"\"{Path.GetFileName(path)}\" is password-protected and its pages can't be resized. Export with 'Keep each page's own size' instead.", ex);
            }
        }
        return tmp!;
    }

    private static void ApplySecurity(string path, ExportOptions opt)
    {
        var temp = path + ".sec";
        using (var doc = PdfReader.Open(path, PdfDocumentOpenMode.Modify))
        {
            var s = doc.SecuritySettings;
            if (!string.IsNullOrEmpty(opt.UserPassword)) s.UserPassword = opt.UserPassword;
            // An owner password is required for permissions to be enforced; default it to something unguessable.
            s.OwnerPassword = string.IsNullOrEmpty(opt.OwnerPassword) ? Guid.NewGuid().ToString("N") : opt.OwnerPassword;
            s.PermitPrint = opt.AllowPrint;
            s.PermitExtractContent = opt.AllowCopy;
            s.PermitModifyDocument = opt.AllowEdit;
            doc.Save(temp);
        }
        File.Move(temp, path, true);
    }

    // ───────────────────────── drawing helpers ─────────────────────────

    /// <summary>Runs <paramref name="draw"/> in a coordinate frame that appears upright when the page is shown with rotation <paramref name="rot"/>.</summary>
    private static void DrawFramed(PdfPage page, double w, double h, int rot, Action<XGraphics, double, double> draw)
    {
        using var gfx = XGraphics.FromPdfPage(page, XGraphicsPdfPageOptions.Append);
        switch (rot)
        {
            case 90: gfx.TranslateTransform(0, h); gfx.RotateTransform(-90); draw(gfx, h, w); break;
            case 180: gfx.TranslateTransform(w, h); gfx.RotateTransform(180); draw(gfx, w, h); break;
            case 270: gfx.TranslateTransform(w, 0); gfx.RotateTransform(90); draw(gfx, h, w); break;
            default: draw(gfx, w, h); break;
        }
    }

    private static void DrawAnnotation(XGraphics g, PageTextAnnotation a, double dw, double dh)
    {
        if (string.IsNullOrEmpty(a.Text)) return;
        var font = MakeFont(a.FontName, Math.Max(4, a.FontSize), a.Bold, a.Italic);
        var brush = new XSolidBrush(ParseColor(a.ColorHex));
        var (ax, ay) = a.AnchorPoint(dw, dh);
        var lines = a.Text.Replace("\r", "").Split('\n');
        var lh = a.FontSize * 1.25;
        var total = lines.Length * lh;
        var top = a.V switch { VAnchor.Top => ay, VAnchor.Middle => ay - total / 2, _ => ay - total };
        var fmt = new XStringFormat
        {
            Alignment = a.H switch { HAnchor.Left => XStringAlignment.Near, HAnchor.Right => XStringAlignment.Far, _ => XStringAlignment.Center },
            LineAlignment = XLineAlignment.Near
        };
        for (var i = 0; i < lines.Length; i++) g.DrawString(lines[i], font, brush, new XPoint(ax, top + i * lh), fmt);
    }

    private static List<TextStyleRun> NormalizeTextRuns(PageEditObject o)
    {
        var text = (o.Text ?? "").Replace("\r", "");
        var n = text.Length;
        if (n == 0) return new List<TextStyleRun>();
        var baseRun = new TextStyleRun { Start = 0, Length = n, FontName = o.FontName, FontSize = o.FontSize, Bold = o.Bold, Italic = o.Italic, Underline = o.Underline, ColorHex = o.ColorHex };
        if (o.TextStyles.Count == 0) return new List<TextStyleRun> { baseRun };
        var result = new List<TextStyleRun>();
        var cursor = 0;
        foreach (var source in o.TextStyles.OrderBy(r => r.Start))
        {
            var a = Math.Clamp(source.Start, 0, n);
            var b = Math.Clamp(source.Start + source.Length, a, n);
            if (b <= a) continue;
            if (a > cursor) { var gap = baseRun.Clone(); gap.Start = cursor; gap.Length = a - cursor; result.Add(gap); }
            if (a < cursor) a = cursor;
            if (b <= a) continue;
            var r = source.Clone(); r.Start = a; r.Length = b - a; result.Add(r); cursor = b;
        }
        if (cursor < n) { var tail = baseRun.Clone(); tail.Start = cursor; tail.Length = n - cursor; result.Add(tail); }
        return result;
    }

    /// <summary>Draws one Edit PDF object (absolute coordinates, points, top-left origin).</summary>
    private static void DrawEdit(XGraphics g, PageEditObject o, List<IDisposable> keep)
    {
        switch (o.Kind)
        {
            case EditKind.Text:
            {
                if (string.IsNullOrEmpty(o.Text)) return;
                var text = o.Text.Replace("\r", "");
                var lines = text.Split('\n');
                var runs = NormalizeTextRuns(o);
                var hs = o.HScale is > 0.2 and < 5 ? o.HScale : 1.0;
                var state = g.Save();
                g.TranslateTransform(o.X, o.Y);
                if (Math.Abs(hs - 1.0) > 0.0005) g.ScaleTransform(hs, 1.0);
                var offset = 0;
                var fmt = new XStringFormat { Alignment = XStringAlignment.Near, LineAlignment = XLineAlignment.BaseLine };
                foreach (var line in lines)
                {
                    var lineRuns = runs.Where(r => r.Start < offset + line.Length && r.Start + r.Length > offset).ToList();
                    var lineHeight = Math.Max(4, lineRuns.Count == 0 ? o.FontSize : lineRuns.Max(r => r.FontSize)) * 1.25;
                    var baseline = lineRuns.Count == 0 ? TextMetrics.Ascent(o.FontName, o.FontSize, o.Bold, o.Italic) :
                        lineRuns.Max(r => TextMetrics.Ascent(r.FontName, r.FontSize, r.Bold, r.Italic));
                    var x = 0.0;
                    foreach (var r in lineRuns)
                    {
                        var local = Math.Max(0, r.Start - offset);
                        var len = Math.Min(r.Length, line.Length - local);
                        if (len <= 0) continue;
                        var part = line.Substring(local, len);
                        var flags = (r.Bold ? 1 : 0) | (r.Italic ? 2 : 0);
                        XFont font;
                        try { font = new XFont(r.FontName, Math.Max(4, r.FontSize), (XFontStyleEx)flags); }
                        catch
                        {
                            try { font = new XFont("Arial", Math.Max(4, r.FontSize), (XFontStyleEx)flags); }
                            catch { font = new XFont("Arial", Math.Max(4, r.FontSize), XFontStyleEx.Regular); }
                        }
                        var brush = new XSolidBrush(ParseColor(r.ColorHex));
                        g.DrawString(part, font, brush, new XPoint(x, baseline), fmt);
                        if (r.Underline)
                        {
                            var width = TextMetrics.Advance(part, r.FontName, r.FontSize, r.Bold, r.Italic);
                            var y = baseline + Math.Max(0.5, r.FontSize * 0.10);
                            g.DrawLine(new XPen(ParseColor(r.ColorHex), Math.Max(0.5, r.FontSize / 16.0)), x, y, x + width, y);
                        }
                        x += TextMetrics.Advance(part, r.FontName, r.FontSize, r.Bold, r.Italic);
                    }
                    offset += line.Length + 1;
                    if (offset <= text.Length) g.TranslateTransform(0, lineHeight);
                }
                g.Restore(state);
                break;
            }
            case EditKind.Image:
            {
                if (string.IsNullOrEmpty(o.ImagePath) || !File.Exists(o.ImagePath) || o.W <= 0 || o.H <= 0) return;
                var img = XImage.FromFile(o.ImagePath);
                keep.Add(img);
                g.DrawImage(img, o.X, o.Y, o.W, o.H);
                break;
            }
            case EditKind.Rect:
            case EditKind.Ellipse:
            {
                var x = Math.Min(o.X, o.X + o.W); var y = Math.Min(o.Y, o.Y + o.H);
                var w = Math.Abs(o.W); var h = Math.Abs(o.H);
                if (w <= 0 || h <= 0) return;
                if (!string.IsNullOrEmpty(o.FillHex))
                {
                    var c = ParseColor(o.FillHex);
                    var b = new XSolidBrush(XColor.FromArgb(Math.Clamp(o.FillAlpha, 0, 255), (int)c.R, (int)c.G, (int)c.B));
                    if (o.Kind == EditKind.Rect) g.DrawRectangle(b, x, y, w, h); else g.DrawEllipse(b, x, y, w, h);
                }
                if (!string.IsNullOrEmpty(o.StrokeHex) && o.StrokeWidth > 0)
                {
                    var pen = new XPen(ParseColor(o.StrokeHex), o.StrokeWidth);
                    if (o.Kind == EditKind.Rect) g.DrawRectangle(pen, x, y, w, h); else g.DrawEllipse(pen, x, y, w, h);
                }
                break;
            }
            case EditKind.Line:
            {
                var col = string.IsNullOrEmpty(o.StrokeHex) ? "#000000" : o.StrokeHex;
                g.DrawLine(new XPen(ParseColor(col), Math.Max(0.25, o.StrokeWidth)), o.X, o.Y, o.X + o.W, o.Y + o.H);
                break;
            }
        }
    }

    private static void DrawImageAnnotation(XGraphics g, PageImageAnnotation a, double dw, double dh, List<IDisposable> keep)
    {
        if (string.IsNullOrEmpty(a.Path) || !File.Exists(a.Path)) return;
        var img = XImage.FromFile(a.Path);
        keep.Add(img);
        if (img.PointWidth <= 0) return;
        var w = Math.Max(4, a.WidthPt);
        var h = w * img.PointHeight / img.PointWidth;
        var (x, y) = a.TopLeft(dw, dh, w, h);
        g.DrawImage(img, x, y, w, h);
    }

    private static void DrawWatermark(XGraphics g, ExportOptions o, double dw, double dh)
    {
        var font = MakeFont("Arial", o.WatermarkFontSize, true, false);
        var alpha = (int)Math.Round(255 * Math.Clamp(o.WatermarkOpacityPercent, 1, 100) / 100.0);
        var brush = new XSolidBrush(XColor.FromArgb(alpha, 110, 110, 110));
        var state = g.Save();
        g.TranslateTransform(dw / 2, dh / 2);
        g.RotateTransform(o.WatermarkAngle);
        g.DrawString(o.WatermarkText, font, brush, new XPoint(0, 0), XStringFormats.Center);
        g.Restore(state);
    }

    private static void DrawPageNumber(XGraphics g, ExportOptions o, int number, int total, double dw, double dh)
    {
        var text = o.NumberFormat switch
        {
            PageNumberFormat.PageN => $"Page {number}",
            PageNumberFormat.PageNOfTotal => $"Page {number} of {total + o.StartNumber - 1}",
            PageNumberFormat.NSlashTotal => $"{number} / {total + o.StartNumber - 1}",
            _ => number.ToString()
        };
        var font = MakeFont("Arial", o.NumberFontSize, false, false);
        const double m = 28;
        var pos = o.NumberPosition;
        var left = pos is PageNumberPosition.BottomLeft or PageNumberPosition.TopLeft;
        var right = pos is PageNumberPosition.BottomRight or PageNumberPosition.TopRight;
        var top = pos is PageNumberPosition.TopCenter or PageNumberPosition.TopLeft or PageNumberPosition.TopRight;
        var x = left ? m : right ? dw - m : dw / 2;
        var y = top ? m : dh - m;
        var fmt = new XStringFormat
        {
            Alignment = left ? XStringAlignment.Near : right ? XStringAlignment.Far : XStringAlignment.Center,
            LineAlignment = top ? XLineAlignment.Near : XLineAlignment.Far
        };
        g.DrawString(text, font, new XSolidBrush(XColor.FromArgb(70, 70, 70)), new XPoint(x, y), fmt);
    }

    private static XFont MakeFont(string name, double size, bool bold, bool italic)
    {
        var style = (bold, italic) switch
        {
            (true, true) => XFontStyleEx.BoldItalic, (true, false) => XFontStyleEx.Bold,
            (false, true) => XFontStyleEx.Italic, _ => XFontStyleEx.Regular
        };
        try { return new XFont(name, size, style); }
        catch { return new XFont("Arial", size, style); }
    }

    private static XColor ParseColor(string hex)
    {
        var h = (hex ?? "").TrimStart('#');
        if (h.Length != 6) h = "111111";
        return XColor.FromArgb(Convert.ToInt32(h[..2], 16), Convert.ToInt32(h.Substring(2, 2), 16), Convert.ToInt32(h.Substring(4, 2), 16));
    }

    public static int Norm(int degrees) => ((degrees % 360) + 360) % 360;
}
