using PdfStudio.Models;
using PdfStudio.Services;
using System.Drawing.Drawing2D;
using System.Drawing.Text;

namespace PdfStudio.UI;

/// <summary>Right-hand page viewer: fit/zoom, pan by dragging, Ctrl+wheel zoom, shows text overlays and user rotation.</summary>
public sealed class PreviewPane : Surface
{
    private readonly ImagePdfService renderer = new();
    private readonly ViewPanel scroller = new() { Dock = DockStyle.Fill, AutoScroll = false };
    private readonly PictureBox pic = new() { SizeMode = PictureBoxSizeMode.AutoSize, Cursor = Cursors.Hand };
    private readonly Txt title = new("Preview", 11f, FontStyle.Bold) { AutoEllipsis = true };
    private readonly Txt info = new("", 8.5f, FontStyle.Regular, true) { AutoEllipsis = true };
    private readonly Txt hint = new("Select a page to preview it here.", 10f, FontStyle.Regular, true) { TextAlign = ContentAlignment.MiddleCenter, Dock = DockStyle.Fill };
    private readonly FlatButton fitBtn = new() { Text = "Fit", Glyph = "\uE740", Kind = BtnKind.Ghost, Height = 34, AutoWidth = true, MinWidth = 40 };
    private readonly Txt zoomLabel = new("Fit", 9f, FontStyle.Bold) { TextAlign = ContentAlignment.MiddleCenter, Width = 58, Height = 34 };
    private readonly System.Windows.Forms.Timer debounce = new() { Interval = 90 };

    private Surface? headerBar;
    private Surface? barWrap;
    private PageItem? current;
    private bool fitMode = true;
    private int zoom = 100;
    private int version;
    private int shownDpiPercent = 100;
    private Point panStart;
    private bool panning;
    private bool pageChanged = true;
    private bool featureAccessEnabled = true;

    private FlatButton prevBtn = null!, nextBtn = null!, zoomOutBtn = null!, zoomInBtn = null!,
        rotLeftBtn = null!, rotRightBtn = null!, addTextBtn = null!, addImageBtn = null!, clearBtn = null!;

    public event Action? RotateLeftClicked, RotateRightClicked, AddTextClicked, AddImageClicked, ClearTextClicked, PrevClicked, NextClicked;
    private readonly ToolTip tips = new() { InitialDelay = 450, ReshowDelay = 150, AutoPopDelay = 7000 };

    public PreviewPane()
    {
        UseRole(() => Theme.Surface);
        BorderLeft = true;

        scroller.BackColor = Theme.Canvas;
        Theme.Changed += () => { if (!IsDisposed) scroller.BackColor = Theme.Canvas; };
        scroller.Controls.Add(pic);
        scroller.Resize += (_, _) => { if (fitMode) Schedule(); else CenterPicture(false); };
        scroller.MouseWheel += OnWheel; pic.MouseWheel += OnWheel;
        pic.MouseDown += (_, e) => { if (!featureAccessEnabled) return; if (e.Button == MouseButtons.Left && scroller.AutoScroll) { panning = true; panStart = Cursor.Position; pic.Cursor = Cursors.SizeAll; } };
        pic.MouseUp += (_, _) => { panning = false; pic.Cursor = fitMode ? Cursors.Default : Cursors.Hand; };
        pic.MouseMove += (_, _) =>
        {
            if (!featureAccessEnabled || !panning) return;
            var p = Cursor.Position; var dx = p.X - panStart.X; var dy = p.Y - panStart.Y; panStart = p;
            scroller.AutoScrollPosition = new Point(-scroller.AutoScrollPosition.X - dx, -scroller.AutoScrollPosition.Y - dy);
        };

        // ── header: bold page title, one muted details line; both end with "…" instead of being cut off ──
        var header = headerBar = new Surface { Dock = DockStyle.Top, Height = 62, Padding = new Padding(20, 10, 16, 6) };
        header.UseRole(() => Theme.Surface);
        title.Dock = DockStyle.Top; title.Height = 24; title.TextAlign = ContentAlignment.MiddleLeft;
        info.Dock = DockStyle.Top; info.Height = 20; info.TextAlign = ContentAlignment.MiddleLeft;
        header.Controls.Add(info); header.Controls.Add(title);

        // ── toolbar: groups never split across rows; every button is as wide as its caption ──
        FlatButton B(string text, string glyph, bool textGlyph, Action a, string tip, bool danger = false)
        {
            var b = new FlatButton { Text = text, Glyph = glyph, GlyphIsText = textGlyph, Kind = BtnKind.Ghost, Height = 34, AutoWidth = true, MinWidth = 38, DangerStyle = danger, Margin = new Padding(1, 0, 1, 0) };
            b.Click += (_, _) => a(); tips.SetToolTip(b, tip); return b;
        }
        FlowLayoutPanel Group(params Control[] items)
        {
            var g = new FlowLayoutPanel { AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink, WrapContents = false, FlowDirection = FlowDirection.LeftToRight, BackColor = Color.Transparent, Margin = new Padding(0, 0, 10, 4), Padding = new Padding(0) };
            g.Controls.AddRange(items); return g;
        }
        var prev = prevBtn = B("", "\uE76B", false, () => PrevClicked?.Invoke(), "Previous page");
        var next = nextBtn = B("", "\uE76C", false, () => NextClicked?.Invoke(), "Next page");
        var zOut = zoomOutBtn = B("", "−", true, () => SetZoom(-10), "Zoom out (Ctrl + mouse wheel)");
        var zIn = zoomInBtn = B("", "+", true, () => SetZoom(+10), "Zoom in (Ctrl + mouse wheel)");
        fitBtn.Margin = new Padding(1, 0, 1, 0); fitBtn.Active = true;
        fitBtn.Click += (_, _) => { if (!featureAccessEnabled) return; fitMode = true; Schedule(); UpdateZoomLabel(); };
        tips.SetToolTip(fitBtn, "Fit the whole page in the preview");
        zoomLabel.Margin = new Padding(0);
        var rotL = rotLeftBtn = B("", "↺", true, () => RotateLeftClicked?.Invoke(), "Rotate left (Ctrl+←)");
        rotL.GlyphTextSize = 16f;
        var rotR = rotRightBtn = B("", "↻", true, () => RotateRightClicked?.Invoke(), "Rotate right (Ctrl+→)");
        rotR.GlyphTextSize = 16f;
        var addT = addTextBtn = B("Text", "\uE8D2", false, () => AddTextClicked?.Invoke(), "Add text to this page");
        var addI = addImageBtn = B("Image", "\uE91B", false, () => AddImageClicked?.Invoke(), "Add a logo, stamp or signature image");
        var del = clearBtn = B("", "\uE74D", false, () => ClearTextClicked?.Invoke(), "Remove text and images from this page", true);

        var bar = new FlowLayoutPanel { Dock = DockStyle.Top, AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink, WrapContents = true, FlowDirection = FlowDirection.LeftToRight, Padding = new Padding(0), BackColor = Color.Transparent };
        bar.Controls.AddRange(new Control[] { Group(prev, next), Group(zOut, zoomLabel, zIn, fitBtn), Group(rotL, rotR), Group(addT, addI, del) });

        var wrap = barWrap = new Surface { Dock = DockStyle.Top, Height = 54, BorderBottom = true, Padding = new Padding(16, 8, 12, 4) };
        wrap.UseRole(() => Theme.Surface);
        wrap.Controls.Add(bar);
        bar.SizeChanged += (_, _) => wrap.Height = bar.Height + wrap.Padding.Vertical;

        Controls.Add(scroller);
        Controls.Add(hint);
        Controls.Add(wrap);
        Controls.Add(header);
        scroller.Visible = false;
        debounce.Tick += (_, _) => { debounce.Stop(); _ = RenderAsync(); };
    }

    protected override void OnResize(EventArgs e)
    {
        base.OnResize(e);
        if (headerBar is not null) headerBar.Visible = Height >= Theme.S(380);
    }

    /// <summary>Re-measures the toolbar buttons (called once the window is shown and after DPI changes).</summary>
    public void RefreshLayout() { FlatButton.FitTree(this); }

    public void SetFeatureAccess(bool enabled)
    {
        featureAccessEnabled = enabled;
        prevBtn.Enabled = nextBtn.Enabled = zoomOutBtn.Enabled = zoomInBtn.Enabled = fitBtn.Enabled = enabled;
        rotLeftBtn.Enabled = rotRightBtn.Enabled = addTextBtn.Enabled = addImageBtn.Enabled = clearBtn.Enabled = enabled;
        scroller.Enabled = enabled;
        pic.Enabled = enabled;
        if (!enabled) { panning = false; pic.Cursor = Cursors.Default; }
        else pic.Cursor = fitMode ? Cursors.Default : Cursors.Hand;
        Invalidate(true);
    }

    public void ShowPage(PageItem? page)
    {
        pageChanged = pageChanged || !ReferenceEquals(page, current);
        current = page;
        hint.Visible = page is null;
        scroller.Visible = page is not null;
        UpdateInfo();
        if (page is null) { var old = pic.Image; pic.Image = null; old?.Dispose(); return; }
        Schedule();
    }

    private void UpdateInfo()
    {
        if (current is null) { title.Text = "Preview"; info.Text = ""; tips.SetToolTip(title, ""); return; }
        var (w, h) = current.DisplaySizePt(true);
        title.Text = current.IsBlank ? "Blank page" : $"Page {current.SourcePageIndex + 1} · {current.SourceName}";
        tips.SetToolTip(title, title.Text);
        info.Text = $"{w * 25.4 / 72:0} × {h * 25.4 / 72:0} mm   •   rotation {current.Rotation}°" +
                    (current.TextAnnotations.Count > 0 ? $"   •   {current.TextAnnotations.Count} text" : "") +
                    (current.ImageAnnotations.Count > 0 ? $"   •   {current.ImageAnnotations.Count} image(s)" : "") +
                    (current.Edits.Count > 0 ? $"   •   {current.Edits.Count} edit(s)" : "");
        tips.SetToolTip(info, info.Text);
    }

    private void SetZoom(int delta)
    {
        if (!featureAccessEnabled) return;
        if (fitMode) { fitMode = false; zoom = Math.Clamp(shownDpiPercent, 20, 400); }
        zoom = Math.Clamp(zoom + delta, 20, 400);
        UpdateZoomLabel(); Schedule();
    }

    private void UpdateZoomLabel()
    {
        zoomLabel.Text = fitMode ? $"{shownDpiPercent}%" : $"{zoom}%";
        fitBtn.Active = fitMode; fitBtn.Invalidate();
    }

    private void OnWheel(object? s, MouseEventArgs e)
    {
        if (!featureAccessEnabled || (ModifierKeys & Keys.Control) == 0) return;
        SetZoom(Math.Sign(e.Delta) * 10);
        if (e is HandledMouseEventArgs h) h.Handled = true;
    }

    private void Schedule() { debounce.Stop(); debounce.Start(); }

    private async Task RenderAsync()
    {
        var page = current;
        if (page is null) return;
        var ver = ++version;
        var margin = Theme.S(16);
        var (dw, dh) = page.DisplaySizePt(true);

        // Fit mode never shows scrollbars (they are what made the viewport size flip back and forth),
        // so the available area is simply the panel's own size.
        if (fitMode && scroller.AutoScroll) { scroller.AutoScroll = false; }
        var availW = Math.Max(40, scroller.ClientSize.Width - margin * 2);
        var availH = Math.Max(40, scroller.ClientSize.Height - margin * 2);

        double dpi;
        if (fitMode)
        {
            var s = Math.Min(availW / dw, availH / dh);
            dpi = Math.Clamp(72 * s, 24, 300);
        }
        else dpi = Math.Clamp(96 * Theme.Scale * zoom / 100.0, 24, 400);
        shownDpiPercent = (int)Math.Round(dpi / (96 * Theme.Scale) * 100);

        var rot = ((page.Rotation % 360) + 360) % 360;
        var anns = page.TextAnnotations.Select(a => a.Clone()).ToList();
        var imgs = page.ImageAnnotations.Select(a => a.Clone()).ToList();
        var eds = page.Edits.Select(a => a.Clone()).ToList();
        var (fw, fh) = page.DisplaySizePt(false);
        Bitmap? bmp = null;
        try { bmp = await Task.Run(() => Compose(page, dpi, rot, anns, imgs, eds, fw, fh)); }
        catch { }
        if (ver != version || IsDisposed) { bmp?.Dispose(); return; }

        // Never let the fitted bitmap exceed the viewport by even a pixel.
        if (fitMode && bmp is not null && (bmp.Width > availW + margin * 2 || bmp.Height > availH + margin * 2))
        {
            var k = Math.Min((availW + margin * 2 - 2.0) / bmp.Width, (availH + margin * 2 - 2.0) / bmp.Height);
            var fixedBmp = new Bitmap(bmp, Math.Max(1, (int)(bmp.Width * k)), Math.Max(1, (int)(bmp.Height * k)));
            bmp.Dispose(); bmp = fixedBmp;
        }

        scroller.SuspendLayout();
        scroller.AutoScroll = !fitMode;
        var old = pic.Image; pic.Image = bmp; old?.Dispose();
        CenterPicture(pageChanged);
        scroller.ResumeLayout(true);
        pageChanged = false;
        pic.Cursor = fitMode ? Cursors.Default : Cursors.Hand;
        UpdateZoomLabel();
        UpdateInfo();
    }

    private Bitmap Compose(PageItem page, double dpi, int rot, List<PageTextAnnotation> anns, List<PageImageAnnotation> imgs, List<PageEditObject> eds, double frameW, double frameH)
    {
        Bitmap bmp;
        if (page.IsBlank)
        {
            bmp = new Bitmap(Math.Max(1, (int)(page.WidthPt * dpi / 72)), Math.Max(1, (int)(page.HeightPt * dpi / 72)));
            using var g = Graphics.FromImage(bmp); g.Clear(Color.White);
        }
        else bmp = renderer.RenderBitmapLossless(page.SourcePath, page.SourcePageIndex, (int)Math.Round(dpi));

        if (eds.Count > 0)
        {
            using var g = Graphics.FromImage(bmp);
            var k = (float)(bmp.Width / frameW);
            g.ScaleTransform(k, k);
            EditPainter.Draw(g, eds);
        }

        if (imgs.Count > 0)
        {
            using var g = Graphics.FromImage(bmp);
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
            var scale = bmp.Width / frameW;
            foreach (var im in imgs)
            {
                try
                {
                    using var src = Image.FromFile(im.Path);
                    var wPt = Math.Max(4, im.WidthPt);
                    var hPt = wPt * src.Height / Math.Max(1.0, src.Width);
                    var (x, y) = im.TopLeft(frameW, frameH, wPt, hPt);
                    g.DrawImage(src, (float)(x * scale), (float)(y * scale), (float)(wPt * scale), (float)(hPt * scale));
                }
                catch { /* missing or unreadable picture: skip it in the preview */ }
            }
        }

        if (anns.Count > 0)
        {
            using var g = Graphics.FromImage(bmp);
            g.SmoothingMode = SmoothingMode.AntiAlias; g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
            var scale = bmp.Width / frameW;
            foreach (var a in anns)
            {
                if (string.IsNullOrEmpty(a.Text)) continue;
                var style = (a.Bold ? FontStyle.Bold : 0) | (a.Italic ? FontStyle.Italic : 0);
                Font font;
                try { font = new Font(a.FontName, (float)Math.Max(4, a.FontSize * scale), style, GraphicsUnit.Pixel); }
                catch { font = new Font("Arial", (float)Math.Max(4, a.FontSize * scale), style, GraphicsUnit.Pixel); }
                using (font)
                using (var brush = new SolidBrush(ParseColor(a.ColorHex)))
                using (var sf = new StringFormat
                {
                    Alignment = a.H switch { HAnchor.Left => StringAlignment.Near, HAnchor.Right => StringAlignment.Far, _ => StringAlignment.Center },
                    LineAlignment = StringAlignment.Near
                })
                {
                    var (ax, ay) = a.AnchorPoint(frameW, frameH);
                    var lines = a.Text.Replace("\r", "").Split('\n');
                    var lh = a.FontSize * 1.25;
                    var total = lines.Length * lh;
                    var top = a.V switch { VAnchor.Top => ay, VAnchor.Middle => ay - total / 2, _ => ay - total };
                    for (var i = 0; i < lines.Length; i++)
                        g.DrawString(lines[i], font, brush, (float)(ax * scale), (float)((top + i * lh) * scale), sf);
                }
            }
        }

        var flip = rot switch { 90 => RotateFlipType.Rotate90FlipNone, 180 => RotateFlipType.Rotate180FlipNone, 270 => RotateFlipType.Rotate270FlipNone, _ => RotateFlipType.RotateNoneFlipNone };
        if (flip != RotateFlipType.RotateNoneFlipNone) bmp.RotateFlip(flip);
        return bmp;
    }

    private static Color ParseColor(string hex)
    {
        try { return ColorTranslator.FromHtml(hex); } catch { return Color.Black; }
    }

    private void CenterPicture(bool resetScroll)
    {
        if (pic.Image is null) return;
        var m = Theme.S(16);
        var keep = resetScroll ? Point.Empty : new Point(-scroller.AutoScrollPosition.X, -scroller.AutoScrollPosition.Y);
        if (scroller.AutoScroll) scroller.AutoScrollPosition = Point.Empty;
        var x = Math.Max(m, (scroller.ClientSize.Width - pic.Width) / 2);
        var y = Math.Max(m, (scroller.ClientSize.Height - pic.Height) / 2);
        pic.Location = new Point(x, y);
        if (scroller.AutoScroll)
        {
            scroller.AutoScrollMinSize = new Size(pic.Width + m * 2, pic.Height + m * 2);
            if (keep != Point.Empty) scroller.AutoScrollPosition = keep;
        }
        else scroller.AutoScrollMinSize = Size.Empty;
    }
}
