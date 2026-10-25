using System.Drawing.Drawing2D;
using System.Drawing.Text;

namespace PdfStudio.UI;

/// <summary>
/// The reading pane of the Help window. It replaces the old RichTextBox that was rebuilt character by character
/// (slow, flickering, and it could be caught half-painted).
///
///   parse once   (HelpParser)          topic text -> blocks
///   measure once (per topic + width)   blocks get their position and height; the result is cached
///   paint        (OnPaint)             double-buffered, only what is visible
///
/// While a topic is opening a content-shaped skeleton shimmers, the topic icon is circled by an orbiting arc and a light
/// runs along the top edge. When the content is ready the skeleton gives way to the real text, whose blocks glide up and
/// fade in one after the other. Topics already opened skip the skeleton and only play the short reveal.
/// </summary>
public sealed class GuideView : ScrollableControl
{
    private enum State { Empty, Loading, Ready }
    private sealed class TopicLayout { public int Width; public int Height; public List<GuideBlock> Blocks = new(); }

    private const int RevealMs = 640, MinLoaderMs = 320;
    private static int S(int v) => Theme.S(v);
    private static readonly TextFormatFlags Wrap = TextFormatFlags.WordBreak | TextFormatFlags.NoPadding | TextFormatFlags.NoPrefix | TextFormatFlags.Left | TextFormatFlags.Top;
    private static readonly TextFormatFlags One = TextFormatFlags.NoPadding | TextFormatFlags.NoPrefix | TextFormatFlags.SingleLine | TextFormatFlags.EndEllipsis | TextFormatFlags.Left | TextFormatFlags.VerticalCenter;
    private static readonly TextFormatFlags Center = TextFormatFlags.NoPadding | TextFormatFlags.NoPrefix | TextFormatFlags.SingleLine | TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter;

    private readonly Dictionary<(HelpTopic, int), TopicLayout> cache = new();
    private readonly System.Windows.Forms.Timer timer = new() { Interval = 16 };
    private State state = State.Empty;
    private HelpTopic? topic;
    private int index, total, token;
    private string query = "", emptyMessage = "";
    private TopicLayout? layout;
    private long loadStart, revealStart;
    private bool revealing, needsLayout;

    private static int PadL => S(40);
    private static int PadR => S(28);
    private static int HeaderH => S(116);
    private static Font TitleFont => Theme.Ui(21f, FontStyle.Bold);
    private static Font HeadFont => Theme.Ui(13f, FontStyle.Bold);
    private static Font LabelFont => Theme.Ui(8.75f, FontStyle.Bold);
    private static Font BodyFont => Theme.Ui(10.5f);
    private static Font TipFont => Theme.Ui(10f);
    private static Font KeyFont => Theme.Ui(9.5f, FontStyle.Bold);

    public GuideView()
    {
        SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
        AutoScroll = true; TabStop = true; BackColor = Theme.Surface; Cursor = Cursors.Arrow;
        timer.Tick += (_, _) => Tick();
    }

    protected override void Dispose(bool disposing) { if (disposing) timer.Dispose(); base.Dispose(disposing); }
    public void RefreshTheme() { BackColor = Theme.Surface; Invalidate(); }

    // ───────────────────────── public API ─────────────────────────

    /// <summary>Opens a topic. Shows the loader first, then reveals the content.</summary>
    public void ShowTopic(HelpTopic t, int topicIndex, int topicCount, string searchText)
    {
        searchText = searchText.Trim();
        // same topic, only the search text changed: no reload, just re-tint the matching blocks
        if (state == State.Ready && ReferenceEquals(t, topic) && layout != null)
        {
            index = topicIndex; total = topicCount; query = searchText;
            MarkMatches(layout);
            Invalidate();
            ScrollToFirstMatch();
            return;
        }

        topic = t; index = topicIndex; total = topicCount; query = searchText;
        var tok = ++token; needsLayout = false;
        var cached = cache.ContainsKey((t, ClientSize.Width)) || cache.Keys.Any(k => ReferenceEquals(k.Item1, t) && k.Item2 == ClientSize.Width);
        state = State.Loading; revealing = false; layout = null;
        loadStart = Environment.TickCount64;
        AutoScrollMinSize = Size.Empty; AutoScrollPosition = Point.Empty;
        timer.Start();
        Invalidate(); Update();                                   // paint the loader NOW, before any work is done
        _ = FinishAsync(tok, cached);
    }

    /// <summary>Shows a friendly message instead of a topic (for example "no topics match").</summary>
    public void ShowEmpty(string message)
    {
        token++; topic = null; layout = null; revealing = false;
        state = State.Empty; emptyMessage = message;
        AutoScrollMinSize = Size.Empty; timer.Stop(); Invalidate();
    }

    // ───────────────────────── loading pipeline ─────────────────────────

    private async Task FinishAsync(int tok, bool cached)
    {
        try
        {
            var l = EnsureLayout();
            if (!cached)
            {
                var wait = MinLoaderMs - (int)(Environment.TickCount64 - loadStart);     // let the shimmer play one full sweep
                if (wait > 0) await Task.Delay(wait);
            }
            if (tok != token || IsDisposed) return;
            l = EnsureLayout();                                    // the window may have been resized while the loader played
            if (l == null) { needsLayout = true; return; }          // not sized yet: OnResize finishes the job
            layout = l;
            state = State.Ready; revealing = true; revealStart = Environment.TickCount64;
            timer.Start(); Invalidate();
            ScrollToFirstMatch();
        }
        catch (Exception) when (IsDisposed) { /* closed while loading */ }
    }

    /// <summary>Parses (once), measures (once per width), applies the search tint and sets the scroll range.</summary>
    private TopicLayout? EnsureLayout()
    {
        if (topic == null || IsDisposed) return null;
        for (var pass = 0; pass < 2; pass++)
        {
            var w = ClientSize.Width;
            if (w <= 0) return null;
            if (!cache.TryGetValue((topic, w), out var l))
            {
                l = Build(topic, w);
                if (cache.Count > 48) cache.Clear();
                cache[(topic, w)] = l;
            }
            MarkMatches(l);
            AutoScrollMinSize = new Size(0, l.Height);
            if (ClientSize.Width == w) return l;                  // else a scroll bar appeared and the text must wrap again
        }
        return cache.TryGetValue((topic, ClientSize.Width), out var last) ? last : null;
    }

    private void MarkMatches(TopicLayout l) { foreach (var b in l.Blocks) b.Match = HelpParser.Matches(b, query); }

    private void ScrollToFirstMatch()
    {
        if (layout == null || query.Length < 2) return;
        var m = layout.Blocks.FirstOrDefault(b => b.Match);
        if (m != null) AutoScrollPosition = new Point(0, Math.Max(0, m.Y - S(90)));
    }

    // ───────────────────────── measuring ─────────────────────────

    private static int MeasureH(string text, Font f, int width) =>
        TextRenderer.MeasureText(text, f, new Size(Math.Max(S(60), width), int.MaxValue), Wrap).Height;

    private static int ContentW(int width) => Math.Max(S(220), width - PadL - PadR);

    private TopicLayout Build(HelpTopic t, int width)
    {
        var l = new TopicLayout { Width = width, Blocks = HelpParser.Parse(t.Body) };
        var cw = ContentW(width);
        var y = HeaderH + S(10);
        var first = true;
        foreach (var b in l.Blocks)
        {
            switch (b.Kind)
            {
                case GuideKind.Heading:
                    y += first ? 0 : S(18);
                    b.Y = y; b.TextH = MeasureH(b.Text, HeadFont, cw); b.H = b.TextH; y += b.H + S(7); break;
                case GuideKind.Label:
                    y += S(12);
                    b.Y = y; b.TextH = MeasureH(b.Text, LabelFont, cw); b.H = b.TextH; y += b.H + S(6); break;
                case GuideKind.Para:
                    b.Y = y; b.TextH = MeasureH(b.Text, BodyFont, cw); b.H = b.TextH; y += b.H + S(9); break;
                case GuideKind.Bullet:
                    b.Y = y; b.TextH = MeasureH(b.Text, BodyFont, cw - S(26)); b.H = b.TextH; y += b.H + S(6); break;
                case GuideKind.Tips:
                    y += S(6);
                    b.Y = y; b.TipH.Clear();
                    var inner = S(18);                                      // top + bottom padding of the card
                    foreach (var tip in b.Tips) { var h = MeasureH(tip, TipFont, cw - S(58)); b.TipH.Add(h); inner += h + S(6); }
                    b.H = inner - S(6) + S(0); y += b.H + S(12); break;
                case GuideKind.Key:
                    b.KeyW = TextRenderer.MeasureText(b.Text, KeyFont, new Size(int.MaxValue, int.MaxValue), TextFormatFlags.NoPadding).Width + S(22);
                    b.TextH = MeasureH(b.Text2, TipFont, cw - S(250));
                    b.Y = y; b.H = Math.Max(S(28), b.TextH + S(4)); y += b.H + S(6); break;
            }
            first = false;
        }
        l.Height = y + S(34);
        return l;
    }

    // ───────────────────────── animation ─────────────────────────

    private void Tick()
    {
        if (IsDisposed) return;
        if (state == State.Loading) { Invalidate(); return; }
        if (state == State.Ready && revealing)
        {
            if (Environment.TickCount64 - revealStart >= RevealMs) { revealing = false; timer.Stop(); }
            Invalidate();
            return;
        }
        timer.Stop();
    }

    private static float Ease(float t) { t = Math.Clamp(t, 0f, 1f); return 1f - (1f - t) * (1f - t) * (1f - t); }

    /// <summary>Opacity of the n-th block while the reveal plays (0..1); blocks start one after the other.</summary>
    private float Appear(float t, int n)
    {
        if (!revealing || t >= 1f) return 1f;
        var start = Math.Min(n * 0.04f, 0.5f);
        return Ease((t - start) / 0.4f);
    }

    private Color Fd(Color c, float a) => a >= 0.999f ? c : Gfx.Mix(BackColor, c, a);

    protected override bool IsInputKey(Keys keyData) =>
        keyData is Keys.Up or Keys.Down or Keys.PageUp or Keys.PageDown or Keys.Home or Keys.End || base.IsInputKey(keyData);

    protected override void OnResize(EventArgs e)
    {
        base.OnResize(e);
        if (needsLayout && ClientSize.Width > 0) { needsLayout = false; _ = FinishAsync(token, true); }
        if (state == State.Ready && topic != null && layout != null && layout.Width != ClientSize.Width)
        {
            var keep = layout;
            var l = EnsureLayout();
            if (l != null) layout = l; else layout = keep;
        }
        Invalidate();
    }

    protected override void OnScroll(ScrollEventArgs se) { base.OnScroll(se); Invalidate(); }
    protected override void OnMouseEnter(EventArgs e) { base.OnMouseEnter(e); Focus(); }              // the mouse wheel works without a click
    private void ScrollBy(int pixels) => AutoScrollPosition = new Point(0, Math.Max(0, -AutoScrollPosition.Y + pixels));

    protected override void OnKeyDown(KeyEventArgs e)
    {
        if (state == State.Ready && !e.Control && !e.Alt)
        {
            var handled = true;
            switch (e.KeyCode)
            {
                case Keys.Down: ScrollBy(S(48)); break;
                case Keys.Up: ScrollBy(-S(48)); break;
                case Keys.PageDown: case Keys.Space: ScrollBy(ClientSize.Height - S(60)); break;
                case Keys.PageUp: ScrollBy(-(ClientSize.Height - S(60))); break;
                case Keys.Home: ScrollBy(-1_000_000); break;
                case Keys.End: ScrollBy(1_000_000); break;
                default: handled = false; break;
            }
            if (handled) { e.Handled = true; Invalidate(); return; }
        }
        if (e.Control && e.KeyCode == Keys.C && topic != null)
        {
            try { Clipboard.SetText(HelpParser.ToPlainText(topic)); } catch (System.Runtime.InteropServices.ExternalException) { }
            e.Handled = true;
        }
        base.OnKeyDown(e);
    }

    // ───────────────────────── painting ─────────────────────────

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        g.Clear(BackColor);
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.TextRenderingHint = TextRenderingHint.ClearTypeGridFit;
        switch (state)
        {
            case State.Loading: PaintLoader(g); break;
            case State.Ready: PaintDocument(g); break;
            default: PaintEmpty(g); break;
        }
    }

    private void PaintEmpty(Graphics g)
    {
        var r = ClientRectangle;
        TextRenderer.DrawText(g, "\uE721", Theme.Icons(30f), new Rectangle(0, r.Height / 2 - S(70), r.Width, S(50)), Theme.Border, Center);
        TextRenderer.DrawText(g, emptyMessage, Theme.Ui(11f), new Rectangle(S(40), r.Height / 2 - S(10), r.Width - S(80), S(80)), Theme.Muted,
            TextFormatFlags.HorizontalCenter | TextFormatFlags.Top | TextFormatFlags.WordBreak | TextFormatFlags.NoPadding);
    }

    // ── the document ──

    private void PaintDocument(Graphics g)
    {
        if (layout == null || topic == null) return;
        var dy = AutoScrollPosition.Y;
        var now = Environment.TickCount64;
        var t = revealing ? Math.Min(1f, (now - revealStart) / (float)RevealMs) : 1f;
        var cw = ContentW(layout.Width);

        PaintHeader(g, dy, Appear(t, 0));
        for (var i = 0; i < layout.Blocks.Count; i++)
        {
            var b = layout.Blocks[i];
            if (b.Y + dy > Height || b.Y + b.H + dy < -S(20)) continue;
            var a = Appear(t, i + 1);
            if (a <= 0.001f) continue;
            var y = b.Y + dy + (int)((1f - a) * S(10));
            if (b.Match && b.Kind != GuideKind.Tips)
                Gfx.FillRound(g, Fd(Theme.AccentSoft, a), new RectangleF(PadL - S(10), y - S(4), cw + S(20), b.H + S(8)), S(8));
            switch (b.Kind)
            {
                case GuideKind.Heading:
                    using (var br = new SolidBrush(Fd(Theme.Accent, a))) g.FillRectangle(br, PadL - S(14), y + S(3), S(3), Math.Max(S(10), b.TextH - S(7)));
                    TextRenderer.DrawText(g, b.Text, HeadFont, new Rectangle(PadL, y, cw, b.H + S(2)), Fd(Theme.Text, a), Wrap); break;
                case GuideKind.Label:
                    TextRenderer.DrawText(g, b.Text, LabelFont, new Rectangle(PadL, y, cw, b.H + S(2)), Fd(Theme.Accent, a), Wrap); break;
                case GuideKind.Para:
                    TextRenderer.DrawText(g, b.Text, BodyFont, new Rectangle(PadL, y, cw, b.H + S(2)), Fd(Theme.Text, a), Wrap); break;
                case GuideKind.Bullet:
                    var dot = S(6);
                    using (var br = new SolidBrush(Fd(Theme.Accent, a))) g.FillEllipse(br, PadL + S(6), y + (BodyFont.Height - dot) / 2f + S(1), dot, dot);
                    TextRenderer.DrawText(g, b.Text, BodyFont, new Rectangle(PadL + S(26), y, cw - S(26), b.H + S(2)), Fd(Theme.Text, a), Wrap); break;
                case GuideKind.Tips: PaintTips(g, b, y, cw, a); break;
                case GuideKind.Key: PaintKey(g, b, y, cw, a); break;
            }
        }
    }

    private void PaintHeader(Graphics g, int dy, float a)
    {
        var capY = S(26) + dy; var badgeY = S(46) + dy; var d = S(48);
        TextRenderer.DrawText(g, $"TOPIC {index + 1} OF {total}", Theme.Ui(8f, FontStyle.Bold), new Rectangle(PadL, capY, S(300), S(16)), Fd(Theme.Muted, a), One);
        var badge = new RectangleF(PadL, badgeY, d, d);
        using (var br = new SolidBrush(Fd(Theme.AccentSoft, a))) g.FillEllipse(br, badge);
        TextRenderer.DrawText(g, topic!.Glyph, Theme.Icons(17f), Rectangle.Round(badge), Fd(Theme.Accent, a), Center);
        TextRenderer.DrawText(g, topic.Title, TitleFont, new Rectangle(PadL + d + S(16), badgeY, Math.Max(S(100), Width - PadL - PadR - d - S(16)), d), Fd(Theme.Text, a), One);
        using var pen = new Pen(Fd(Theme.Border, a));
        g.DrawLine(pen, PadL, HeaderH - S(10) + dy, Width - PadR, HeaderH - S(10) + dy);
    }

    private void PaintTips(Graphics g, GuideBlock b, int y, int cw, float a)
    {
        var card = new RectangleF(PadL, y, cw, b.H);
        Gfx.FillRound(g, Fd(Theme.AccentSoft, a), card, S(10));
        using (var br = new SolidBrush(Fd(Theme.Accent, a))) g.FillRectangle(br, PadL + S(1), y + S(10), S(3), b.H - S(20));
        var ty = y + S(9);
        for (var i = 0; i < b.Tips.Count; i++)
        {
            TextRenderer.DrawText(g, "\uE946", Theme.Icons(10f), new Rectangle(PadL + S(16), ty, S(20), TipFont.Height + S(2)), Fd(Theme.Accent, a),
                TextFormatFlags.NoPadding | TextFormatFlags.Left | TextFormatFlags.Top);
            TextRenderer.DrawText(g, b.Tips[i], TipFont, new Rectangle(PadL + S(42), ty, cw - S(58), b.TipH[i] + S(2)), Fd(Theme.Text, a), Wrap);
            ty += b.TipH[i] + S(6);
        }
    }

    private void PaintKey(Graphics g, GuideBlock b, int y, int cw, float a)
    {
        var h = S(26);
        var cap = new RectangleF(PadL, y + (S(28) - h) / 2f, b.KeyW, h);
        Gfx.FillRound(g, Fd(Theme.SurfaceAlt, a), cap, S(7));
        Gfx.DrawRound(g, Fd(Theme.Border, a), cap, S(7));
        TextRenderer.DrawText(g, b.Text, KeyFont, Rectangle.Round(cap), Fd(Theme.Accent, a), Center);
        TextRenderer.DrawText(g, b.Text2, TipFont, new Rectangle(PadL + S(250), y + S(4), cw - S(250), b.TextH + S(2)), Fd(Theme.Text, a), Wrap);
    }

    // ── the loader ──

    private void PaintLoader(Graphics g)
    {
        var now = Environment.TickCount64;
        var w = ClientSize.Width; var h = ClientSize.Height;
        var cw = ContentW(w);
        var baseCol = Gfx.Mix(BackColor, Theme.Border, 0.55f);

        // 1. skeleton shapes in the outline of a typical topic
        using var path = new GraphicsPath { FillMode = FillMode.Winding };
        void Bar(float rx, float ry, float rw, float rh, float rad = 0) { using var rp = Gfx.Round(new RectangleF(rx, ry, rw, rh), rad > 0 ? rad : Math.Min(rh / 2f, S(6))); path.AddPath(rp, false); }
        Bar(PadL + S(64), S(46) + S(11), cw * 0.34f, S(26));                          // title
        var y = HeaderH + S(14);
        for (var block = 0; block < 3 && y < h; block++)
        {
            Bar(PadL, y, cw * (block == 1 ? 0.22f : 0.3f), S(16)); y += S(38);
            foreach (var bw in block == 1 ? new[] { 0.98f, 0.94f, 0.97f, 0.52f } : new[] { 0.9f, 0.78f, 0.86f, 0.6f })
            {
                if (block != 1) { using var dot = new GraphicsPath(); dot.AddEllipse(PadL + S(4), y + S(2), S(6), S(6)); path.AddPath(dot, false); Bar(PadL + S(26), y, cw * bw - S(26), S(11)); }
                else Bar(PadL, y, cw * bw, S(11));
                y += S(25);
            }
            y += S(14);
            if (block == 1) { Bar(PadL, y, cw, S(62), S(10)); y += S(80); }
        }
        using (var br = new SolidBrush(baseCol)) g.FillPath(br, path);

        // 2. the shimmer: a soft band sweeping across the shapes only
        var ph = (now % 1500) / 1500f;
        var band = S(280);
        var bx = -band + ph * (w + band * 2);
        var hi = Theme.Dark ? Gfx.Mix(baseCol, Theme.Text, 0.14f) : Color.White;
        var state0 = g.Save();
        g.SetClip(path);
        using (var lg = new LinearGradientBrush(new RectangleF(bx, 0, band, 1), baseCol, baseCol, LinearGradientMode.Horizontal))
        {
            lg.InterpolationColors = new ColorBlend { Colors = new[] { baseCol, hi, baseCol }, Positions = new[] { 0f, 0.5f, 1f } };
            g.FillRectangle(lg, bx, 0, band, h);
        }
        g.Restore(state0);

        // 3. the topic icon with an orbiting arc
        var d = S(48); var badge = new RectangleF(PadL, S(46), d, d);
        var pulse = 0.55f + 0.45f * (float)Math.Sin(now / 260.0);
        using (var br = new SolidBrush(Gfx.Mix(BackColor, Theme.AccentSoft, 0.5f + 0.5f * pulse))) g.FillEllipse(br, badge);
        if (topic != null) TextRenderer.DrawText(g, topic.Glyph, Theme.Icons(17f), Rectangle.Round(badge), Gfx.Mix(BackColor, Theme.Accent, 0.55f + 0.45f * pulse), Center);
        var ring = RectangleF.Inflate(badge, S(5), S(5));
        using (var pen = new Pen(Gfx.Mix(BackColor, Theme.Border, 0.7f), S(2))) g.DrawEllipse(pen, ring);
        using (var pen = new Pen(Theme.Accent, S(3)) { StartCap = LineCap.Round, EndCap = LineCap.Round })
            g.DrawArc(pen, ring, (now % 1000) / 1000f * 360f, 100f);

        // 4. caption with animated dots
        var dots = new string('.', (int)((now / 350) % 4));
        TextRenderer.DrawText(g, $"Opening “{topic?.Title}”{dots}", Theme.Ui(8.5f, FontStyle.Bold), new Rectangle(PadL, S(24), Math.Max(S(120), cw), S(18)), Theme.Muted, One);

        // 5. a light running along the top edge
        var lw = S(220); var lx = -lw + ((now % 1300) / 1300f) * (w + lw * 2);
        using var top = new LinearGradientBrush(new RectangleF(lx, 0, lw, 1), Theme.Accent, Theme.Accent, LinearGradientMode.Horizontal);
        top.InterpolationColors = new ColorBlend { Colors = new[] { BackColor, Theme.Accent, BackColor }, Positions = new[] { 0f, 0.5f, 1f } };
        g.FillRectangle(top, lx, 0, lw, S(3));
    }
}
