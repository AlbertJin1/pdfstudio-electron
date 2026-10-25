using PdfStudio.Services;
using System.Drawing.Drawing2D;

namespace PdfStudio.UI;

// ─────────────────────────────────────────────────────────────────────────────────────────────
//  Review window ("Rate PDF Studio")
//
//  A mood-reactive header (a little face + gradient that follow the stars), quick "what stood out"
//  chips, rounded input fields, inline errors (no message boxes) and an animated thank-you screen.
//  Usage statistics are always on, so there is no checkbox here (see Services/UsageTracker.cs).
// ─────────────────────────────────────────────────────────────────────────────────────────────

/// <summary>
/// Header of the review window: a gradient that changes colour with the rating, a face that smiles (or not) as you
/// hover or pick stars, and the 1–5 star picker itself (mouse, Left/Right/Up/Down and the number keys 1–5).
/// </summary>
internal sealed class ReviewHero : Control
{
    private static readonly string[] Titles = { "How are we doing?", "Oh no, we're sorry", "We can do better", "Thanks, that's fair", "Glad you like it!", "You made our day!" };
    private static readonly string[] Hints = { "Tap a star to rate PDF Studio.", "Tell us what went wrong below.", "Tell us what to improve below.", "What would make it great?", "What did you like most?", "What did you love about it?" };
    private static readonly float[] Smiles = { 0.2f, -1f, -0.5f, 0.05f, 0.65f, 1f };
    private static readonly Color[] MoodA =
    {
        Color.FromArgb(67, 56, 202), Color.FromArgb(159, 18, 57), Color.FromArgb(194, 65, 12),
        Color.FromArgb(29, 78, 216), Color.FromArgb(5, 150, 105), Color.FromArgb(79, 70, 229)
    };
    private static readonly Color[] MoodB =
    {
        Color.FromArgb(109, 40, 217), Color.FromArgb(88, 28, 135), Color.FromArgb(131, 24, 67),
        Color.FromArgb(15, 118, 110), Color.FromArgb(13, 148, 136), Color.FromArgb(219, 39, 119)
    };
    private static readonly Color StarGold = Color.FromArgb(253, 224, 71);
    private static readonly Color Ink = Color.FromArgb(30, 27, 75);

    private int rating, hover;
    private bool thanks;
    private Color curA = MoodA[0], curB = MoodB[0];
    private float smile = Smiles[0], pop, shake;
    private readonly float[] fill = new float[6];
    private readonly float[] scale = { 1f, 1f, 1f, 1f, 1f, 1f };
    private long nextBlink = Environment.TickCount64 + 2500, blinkStart = -1;
    private readonly System.Windows.Forms.Timer timer = new() { Interval = 16 };

    public event EventHandler? ValueChanged;

    private static int S(int v) => Theme.S(v);

    public ReviewHero()
    {
        SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw | ControlStyles.Selectable | ControlStyles.StandardClick, true);
        TabStop = true; Height = S(196);
        AccessibleName = "Star rating"; AccessibleRole = AccessibleRole.Slider;
        timer.Tick += (_, _) => { if (Step()) Invalidate(); };
        Theme.Changed += OnTheme;
    }

    public int Value
    {
        get => rating;
        set
        {
            var v = Math.Clamp(value, 0, 5);
            if (v == rating) return;
            rating = v; pop = 1f;
            AccessibleDescription = $"{v} of 5";
            Invalidate();
            ValueChanged?.Invoke(this, EventArgs.Empty);
        }
    }

    /// <summary>Switches the header to its "thank you" state and locks the stars.</summary>
    public bool Thanks
    {
        get => thanks;
        set { thanks = value; hover = 0; pop = 1f; Cursor = Cursors.Default; Invalidate(); }
    }

    /// <summary>Wiggles the stars (used when Send is pressed without a rating).</summary>
    public void Nudge() => shake = 1f;

    private int Shown => thanks ? 5 : hover > 0 ? hover : rating;

    private void OnTheme() { if (!IsDisposed) Invalidate(); }

    protected override void OnHandleCreated(EventArgs e) { base.OnHandleCreated(e); timer.Start(); }
    protected override void OnHandleDestroyed(EventArgs e) { timer.Stop(); base.OnHandleDestroyed(e); }
    protected override void Dispose(bool disposing)
    {
        if (disposing) { Theme.Changed -= OnTheme; timer.Dispose(); }
        base.Dispose(disposing);
    }

    // ───────── animation ─────────

    private static Color Settle(Color cur, Color target)
    {
        if (cur == target) return cur;
        if (Math.Abs(cur.R - target.R) + Math.Abs(cur.G - target.G) + Math.Abs(cur.B - target.B) < 8) return target;
        return Gfx.Mix(cur, target, 0.14f);
    }

    /// <summary>One animation frame; returns true when something moved and the control must repaint.</summary>
    private bool Step()
    {
        var changed = false;
        var shown = Shown;

        var a = Settle(curA, MoodA[shown]); var b = Settle(curB, MoodB[shown]);
        if (a != curA || b != curB) { curA = a; curB = b; changed = true; }

        var ts = Smiles[shown]; var ds = ts - smile;
        if (Math.Abs(ds) > 0.003f) { smile += ds * 0.22f; changed = true; }
        else if (smile != ts) { smile = ts; changed = true; }

        if (pop > 0.003f) { pop *= 0.88f; changed = true; } else if (pop != 0f) { pop = 0f; changed = true; }
        if (shake > 0.01f) { shake *= 0.9f; changed = true; } else if (shake != 0f) { shake = 0f; changed = true; }

        for (var i = 1; i <= 5; i++)
        {
            // stars fill one after another (and empty from the right), which gives the little "wave"
            var target = i <= shown ? 1f : 0f;
            var ready = target > fill[i] ? (i == 1 || fill[i - 1] >= 0.55f)
                      : target < fill[i] && (i == 5 || fill[i + 1] <= 0.45f);
            if (ready)
            {
                var d = target - fill[i];
                fill[i] = Math.Abs(d) < 0.02f ? target : fill[i] + d * 0.34f;
                changed = true;
            }
            var ss = i == hover && !thanks ? 1.22f : 1f; var dd = ss - scale[i];
            if (Math.Abs(dd) > 0.003f) { scale[i] += dd * 0.3f; changed = true; }
            else if (scale[i] != ss) { scale[i] = ss; changed = true; }
        }

        var now = Environment.TickCount64;
        if (blinkStart < 0 && now >= nextBlink) blinkStart = now;
        if (blinkStart >= 0)
        {
            changed = true;
            if (now - blinkStart > 160) { blinkStart = -1; nextBlink = now + Random.Shared.Next(2600, 5200); }
        }
        if (shown == 5) changed = true;      // sparkles twinkle
        return changed;
    }

    // ───────── input ─────────

    private int HitStar(Point p)
    {
        var tx = S(168); var pitch = S(42); var size = S(34); var top = S(110);
        if (p.Y < top - S(10) || p.Y > top + size + S(10) || p.X < tx - S(4)) return 0;
        var i = (p.X - tx + S(4)) / pitch + 1;
        return i is >= 1 and <= 5 ? i : 0;
    }

    protected override void OnMouseMove(MouseEventArgs e)
    {
        base.OnMouseMove(e);
        if (thanks) return;
        var h = HitStar(e.Location);
        if (h != hover) { hover = h; Cursor = h > 0 ? Cursors.Hand : Cursors.Default; Invalidate(); }
    }

    protected override void OnMouseLeave(EventArgs e) { base.OnMouseLeave(e); hover = 0; Cursor = Cursors.Default; Invalidate(); }

    protected override void OnMouseDown(MouseEventArgs e)
    {
        base.OnMouseDown(e);
        Focus();
        if (thanks) return;
        var h = HitStar(e.Location);
        if (h <= 0) return;
        scale[h] = 1.55f;
        if (h == rating) pop = Math.Max(pop, 0.6f);
        Value = h;
    }

    protected override bool IsInputKey(Keys keyData) => keyData is Keys.Left or Keys.Right or Keys.Up or Keys.Down || base.IsInputKey(keyData);

    protected override void OnKeyDown(KeyEventArgs e)
    {
        base.OnKeyDown(e);
        if (thanks) return;
        if (e.KeyCode is Keys.Right or Keys.Up) { Value = Math.Min(5, rating + 1); e.Handled = true; }
        else if (e.KeyCode is Keys.Left or Keys.Down) { Value = Math.Max(1, rating - 1); e.Handled = true; }
        else if (e.KeyCode >= Keys.D1 && e.KeyCode <= Keys.D5) { Value = e.KeyCode - Keys.D0; e.Handled = true; }
        else if (e.KeyCode >= Keys.NumPad1 && e.KeyCode <= Keys.NumPad5) { Value = e.KeyCode - Keys.NumPad0; e.Handled = true; }
    }

    protected override void OnGotFocus(EventArgs e) { base.OnGotFocus(e); Invalidate(); }
    protected override void OnLostFocus(EventArgs e) { base.OnLostFocus(e); Invalidate(); }

    // ───────── painting ─────────

    private static GraphicsPath StarPath(float cx, float cy, float ro)
    {
        var path = new GraphicsPath();
        var ri = ro * 0.5f;
        var pts = new PointF[10];
        for (var i = 0; i < 10; i++)
        {
            var r = i % 2 == 0 ? ro : ri;
            var a = -Math.PI / 2 + i * Math.PI / 5;
            pts[i] = new PointF(cx + (float)(Math.Cos(a) * r), cy + (float)(Math.Sin(a) * r) + ro * 0.04f);
        }
        path.AddPolygon(pts);
        return path;
    }

    private static GraphicsPath Sparkle(float cx, float cy, float r)
    {
        var path = new GraphicsPath();
        var pts = new PointF[8];
        for (var i = 0; i < 8; i++)
        {
            var rr = i % 2 == 0 ? r : r * 0.28f;
            var a = -Math.PI / 2 + i * Math.PI / 4;
            pts[i] = new PointF(cx + (float)(Math.Cos(a) * rr), cy + (float)(Math.Sin(a) * rr));
        }
        path.AddPolygon(pts);
        return path;
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.PixelOffsetMode = PixelOffsetMode.HighQuality;
        g.Clear(Theme.Surface);
        var w = Width; var h = Height;
        var shown = Shown;

        // gradient card with a soft wave along the bottom edge
        using var shape = new GraphicsPath();
        shape.AddLine(0, 0, w, 0);
        shape.AddLine(w, 0, w, h - S(38));
        shape.AddBezier(w, h - S(38), w * 0.72f, h - S(6), w * 0.32f, h - S(64), 0, h - S(30));
        shape.CloseFigure();
        using (var br = new LinearGradientBrush(new Rectangle(0, 0, Math.Max(1, w), Math.Max(1, h)), curA, curB, 35f))
            g.FillPath(br, shape);

        var saved = g.Save();
        g.SetClip(shape, CombineMode.Intersect);
        using (var b1 = new SolidBrush(Color.FromArgb(26, 255, 255, 255))) g.FillEllipse(b1, w - S(150), -S(70), S(250), S(250));
        using (var b2 = new SolidBrush(Color.FromArgb(18, 255, 255, 255))) g.FillEllipse(b2, -S(60), h - S(170), S(170), S(170));
        using (var ring = new Pen(Color.FromArgb(34, 255, 255, 255), S(2))) g.DrawEllipse(ring, w - S(210), S(100), S(60), S(60));
        g.Restore(saved);

        DrawFace(g, new RectangleF(S(30), S(38), S(104), S(104)), shown);

        // text column
        var tx = S(168); var tw = Math.Max(S(40), w - tx - S(24));
        var soft = Gfx.Mix(curA, Color.White, 0.78f);
        const TextFormatFlags flags = TextFormatFlags.Left | TextFormatFlags.Top | TextFormatFlags.NoPadding | TextFormatFlags.NoPrefix | TextFormatFlags.SingleLine | TextFormatFlags.EndEllipsis;
        TextRenderer.DrawText(g, "RATE PDF STUDIO", Theme.Ui(8f, FontStyle.Bold), new Rectangle(tx, S(26), tw, S(16)), soft, flags);
        TextRenderer.DrawText(g, thanks ? "Thank you!" : Titles[shown], Theme.Ui(17f, FontStyle.Bold), new Rectangle(tx, S(44), tw, S(34)), Color.White, flags);
        TextRenderer.DrawText(g, thanks ? "Your review was sent to the developer." : Hints[shown], Theme.Ui(9.5f), new Rectangle(tx, S(80), tw, S(20)), soft, flags);

        // stars
        var size = S(34); var pitch = S(42); var top = S(110);
        var shakeX = (float)Math.Sin(Environment.TickCount64 / 35.0) * shake * S(8);
        for (var i = 1; i <= 5; i++)
        {
            var cx = tx + (i - 1) * pitch + size / 2f + shakeX;
            var cy = top + size / 2f;
            using var path = StarPath(cx, cy, size / 2f * scale[i] - S(1));
            var f = Math.Min(1f, fill[i]);
            if (f > 0.01f)
            {
                var col = Color.FromArgb((int)(255 * f), StarGold);
                using var sb = new SolidBrush(col);
                using var sp = new Pen(col, S(3)) { LineJoin = LineJoin.Round };
                g.FillPath(sb, path); g.DrawPath(sp, path);
            }
            if (f < 0.99f)
            {
                using var op = new Pen(Color.FromArgb((int)(200 * (1f - f)), 255, 255, 255), S(2)) { LineJoin = LineJoin.Round };
                g.DrawPath(op, path);
            }
        }

        if (Focused && ShowFocusCues && !thanks)
            Gfx.DrawRound(g, Color.FromArgb(150, 255, 255, 255), new RectangleF(tx - S(8), top - S(8), 5 * pitch, size + S(16)), S(10), 1.2f);
    }

    private void DrawFace(Graphics g, RectangleF box, int shown)
    {
        var now = Environment.TickCount64;
        var r = box.Width / 2f * (1f + pop * 0.12f);
        var cx = box.X + box.Width / 2f; var cy = box.Y + box.Height / 2f;

        using (var sh = new SolidBrush(Color.FromArgb(38, 0, 0, 0))) g.FillEllipse(sh, cx - r, cy - r + S(6), r * 2, r * 2);
        using (var face = new SolidBrush(Color.FromArgb(250, 255, 255, 255))) g.FillEllipse(face, cx - r, cy - r, r * 2, r * 2);

        // blinking: 1 = open, 0 = closed
        var open = 1f;
        if (blinkStart >= 0) open = Math.Max(0.08f, Math.Abs((now - blinkStart) / 160f * 2f - 1f));

        var ex = r * 0.36f; var ey = cy - r * 0.12f;
        var line = Math.Max(2f, r * 0.075f);
        if (shown == 5)
        {
            using var pen = new Pen(Ink, line) { StartCap = LineCap.Round, EndCap = LineCap.Round };
            var er = r * 0.15f;
            g.DrawArc(pen, cx - ex - er, ey - er, er * 2, er * 2, 200, 140);
            g.DrawArc(pen, cx + ex - er, ey - er, er * 2, er * 2, 200, 140);
        }
        else
        {
            var ew = r * 0.13f; var eh = r * 0.19f * open;
            using var eb = new SolidBrush(Ink);
            g.FillEllipse(eb, cx - ex - ew, ey - eh, ew * 2, eh * 2);
            g.FillEllipse(eb, cx + ex - ew, ey - eh, ew * 2, eh * 2);
        }

        if (smile < -0.05f)      // worried eyebrows
        {
            var b = Math.Min(1f, -smile);
            using var pen = new Pen(Color.FromArgb((int)(255 * b), Ink), Math.Max(2f, r * 0.065f)) { StartCap = LineCap.Round, EndCap = LineCap.Round };
            var by = ey - r * 0.30f; var bw = r * 0.2f; var tilt = r * 0.12f * b;
            g.DrawLine(pen, cx - ex - bw, by + tilt, cx - ex + bw, by - tilt);
            g.DrawLine(pen, cx + ex + bw, by + tilt, cx + ex - bw, by - tilt);
        }

        var blush = Math.Clamp((smile - 0.45f) / 0.55f, 0f, 1f);
        if (blush > 0.02f)
        {
            using var cb = new SolidBrush(Color.FromArgb((int)(120 * blush), 251, 113, 133));
            g.FillEllipse(cb, cx - r * 0.80f, cy + r * 0.08f, r * 0.30f, r * 0.18f);
            g.FillEllipse(cb, cx + r * 0.50f, cy + r * 0.08f, r * 0.30f, r * 0.18f);
        }

        // mouth: one bezier whose bend follows the mood; opens up for 5 stars
        var my = cy + r * 0.30f + Math.Max(0f, -smile) * r * 0.08f;
        var mw = r * 0.34f; var c = smile * r * 0.26f;
        var p0 = new PointF(cx - mw, my); var p3 = new PointF(cx + mw, my);
        var p1 = new PointF(cx - mw * 0.45f, my + c * 1.33f); var p2 = new PointF(cx + mw * 0.45f, my + c * 1.33f);
        var openAmt = Math.Clamp((smile - 0.7f) / 0.3f, 0f, 1f);
        if (openAmt > 0.02f)
        {
            using var mp = new GraphicsPath();
            mp.AddBezier(p0, p1, p2, p3); mp.CloseFigure();
            using var mb = new SolidBrush(Color.FromArgb((int)(255 * openAmt), Ink));
            g.FillPath(mb, mp);
        }
        using (var mpen = new Pen(Ink, line) { StartCap = LineCap.Round, EndCap = LineCap.Round, LineJoin = LineJoin.Round })
            g.DrawBezier(mpen, p0, p1, p2, p3);

        if (openAmt > 0.02f)     // sparkles around a happy face
        {
            for (var i = 0; i < 3; i++)
            {
                var (ox, oy, sz) = i switch { 0 => (1.18f, -0.78f, 8f), 1 => (-1.22f, -0.15f, 6f), _ => (1.0f, 0.82f, 5f) };
                var twinkle = 0.55f + 0.45f * (float)Math.Sin(now / 240.0 + i * 2.1);
                using var sp = Sparkle(cx + ox * r, cy + oy * r, Theme.S(sz) * twinkle);
                using var sb = new SolidBrush(Color.FromArgb((int)(235 * openAmt * Math.Max(0.15f, twinkle)), 255, 255, 255));
                g.FillPath(sb, sp);
            }
        }
    }
}

/// <summary>Toggleable "what stood out" pills; their wording follows the rating. Click, or Left/Right + Space.</summary>
internal sealed class ChipPicker : Control
{
    private const TextFormatFlags TextFlags = TextFormatFlags.NoPadding | TextFormatFlags.NoPrefix | TextFormatFlags.SingleLine;
    private string[] items = Array.Empty<string>();
    private readonly HashSet<string> chosen = new();
    private readonly List<Rectangle> rects = new();
    private string heading = "";
    private int hover = -1, cursor = -1;

    public string EmptyText { get; set; } = "";

    private static int S(int v) => Theme.S(v);

    public ChipPicker()
    {
        SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw | ControlStyles.Selectable, true);
        TabStop = false;
    }

    public string[] Selected => items.Where(chosen.Contains).ToArray();

    /// <summary>Replaces the chips (and clears the selection).</summary>
    public void SetItems(string newHeading, string[] list)
    {
        heading = newHeading; items = list;
        chosen.Clear(); hover = -1; cursor = -1;
        TabStop = list.Length > 0;
        Relayout(); Invalidate();
    }

    private int Flow(string[] list, int width, List<Rectangle>? output)
    {
        var x = 0; var y = S(24); var h = S(32); var gap = S(8);
        foreach (var s in list)
        {
            var tw = TextRenderer.MeasureText(s, Theme.Ui(9.5f), new Size(1000, 100), TextFlags).Width;
            var cw = S(12) + S(14) + S(7) + tw + S(14);
            if (x > 0 && x + cw > width) { x = 0; y += h + gap; }
            output?.Add(new Rectangle(x, y, cw, h));
            x += cw + gap;
        }
        return y + h;
    }

    /// <summary>Height needed to show <paramref name="list"/> (heading + wrapped pills) at <paramref name="width"/>.</summary>
    public int Measure(string[] list, int width) => Flow(list, width, null) + S(2);

    private void Relayout() { rects.Clear(); Flow(items, Math.Max(10, Width), rects); }

    protected override void OnResize(EventArgs e) { base.OnResize(e); Relayout(); }

    private int HitChip(Point p)
    {
        for (var i = 0; i < rects.Count; i++) if (rects[i].Contains(p)) return i;
        return -1;
    }

    private void Toggle(int i)
    {
        if (i < 0 || i >= items.Length) return;
        if (!chosen.Remove(items[i])) chosen.Add(items[i]);
        Invalidate();
    }

    protected override void OnMouseMove(MouseEventArgs e)
    {
        base.OnMouseMove(e);
        var h = HitChip(e.Location);
        if (h != hover) { hover = h; Cursor = h >= 0 ? Cursors.Hand : Cursors.Default; Invalidate(); }
    }

    protected override void OnMouseLeave(EventArgs e) { base.OnMouseLeave(e); if (hover != -1) { hover = -1; Invalidate(); } }

    protected override void OnMouseDown(MouseEventArgs e)
    {
        base.OnMouseDown(e);
        var h = HitChip(e.Location);
        if (h < 0) return;
        Focus(); cursor = h; Toggle(h);
    }

    protected override bool IsInputKey(Keys keyData) => keyData is Keys.Left or Keys.Right or Keys.Up or Keys.Down || base.IsInputKey(keyData);

    protected override void OnKeyDown(KeyEventArgs e)
    {
        base.OnKeyDown(e);
        if (items.Length == 0) return;
        if (e.KeyCode is Keys.Right or Keys.Down) { cursor = Math.Min(items.Length - 1, Math.Max(0, cursor + 1)); e.Handled = true; Invalidate(); }
        else if (e.KeyCode is Keys.Left or Keys.Up) { cursor = Math.Max(0, cursor - 1); e.Handled = true; Invalidate(); }
        else if (e.KeyCode == Keys.Space) { Toggle(Math.Max(0, cursor)); e.Handled = true; }
    }

    protected override void OnGotFocus(EventArgs e) { base.OnGotFocus(e); if (cursor < 0 && items.Length > 0) cursor = 0; Invalidate(); }
    protected override void OnLostFocus(EventArgs e) { base.OnLostFocus(e); Invalidate(); }

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.Clear(Theme.Surface);

        if (items.Length == 0)
        {
            using var pen = new Pen(Theme.Border, 1.2f) { DashStyle = DashStyle.Dash };
            using var path = Gfx.Round(new RectangleF(0.5f, 0.5f, Width - 1.5f, Height - 1.5f), S(12));
            g.DrawPath(pen, path);
            TextRenderer.DrawText(g, EmptyText, Theme.Ui(9.5f), new Rectangle(0, 0, Width, Height), Theme.Muted,
                TextFlags | TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis);
            return;
        }

        TextRenderer.DrawText(g, heading, Theme.Ui(9f, FontStyle.Bold), new Rectangle(0, 0, Width, S(20)), Theme.Muted,
            TextFlags | TextFormatFlags.Left | TextFormatFlags.VerticalCenter);

        for (var i = 0; i < rects.Count && i < items.Length; i++)
        {
            var rc = rects[i];
            var on = chosen.Contains(items[i]); var hot = i == hover;
            var rf = new RectangleF(rc.X + 0.5f, rc.Y + 0.5f, rc.Width - 1.5f, rc.Height - 1.5f);
            var radius = rc.Height / 2f;
            var fill = on ? Theme.AccentSoft : hot ? Theme.SurfaceAlt : Theme.Surface;
            var border = on ? Theme.Accent : hot ? Gfx.Mix(Theme.Border, Theme.Accent, 0.55f) : Theme.Border;
            Gfx.FillRound(g, fill, rf, radius);
            Gfx.DrawRound(g, border, rf, radius, on ? 1.4f : 1f);

            TextRenderer.DrawText(g, on ? "\uE73E" : "\uE710", Theme.Icons(8.5f), new Rectangle(rc.X + S(12), rc.Y, S(14), rc.Height),
                on ? Theme.Accent : Theme.Muted, TextFlags | TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter);
            var tl = rc.X + S(12) + S(14) + S(7);
            TextRenderer.DrawText(g, items[i], Theme.Ui(9.5f), new Rectangle(tl, rc.Y, rc.Right - tl, rc.Height),
                on ? Theme.Accent : Theme.Text, TextFlags | TextFormatFlags.Left | TextFormatFlags.VerticalCenter);

            if (Focused && ShowFocusCues && i == cursor)
                Gfx.DrawRound(g, Theme.Accent, RectangleF.Inflate(rf, 2, 2), radius + 2, 1.2f);
        }
    }
}

/// <summary>Rounded input field (single line or multi-line) with a focus ring, a placeholder, an optional icon and a counter.</summary>
internal sealed class FieldBox : Control
{
    private const TextFormatFlags TextFlags = TextFormatFlags.NoPadding | TextFormatFlags.NoPrefix | TextFormatFlags.SingleLine;
    private readonly bool multi;
    private readonly Label hint;
    private bool focused;

    public TextBox Input { get; }
    /// <summary>Segoe MDL2 glyph drawn at the left of a single-line field.</summary>
    public string Glyph { get; set; } = "";
    public string Counter { get; set; } = "";
    public bool CounterWarn { get; set; }

    private static int S(int v) => Theme.S(v);

    public FieldBox(bool multiline, int maxLength, string placeholder)
    {
        multi = multiline;
        SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
        TabStop = false;
        Input = new TextBox { BorderStyle = BorderStyle.None, Multiline = multiline, MaxLength = maxLength, Font = Theme.Ui(10f), BackColor = Theme.Input, ForeColor = Theme.Text };
        if (multiline) { Input.AcceptsReturn = true; Input.WordWrap = true; Input.ScrollBars = ScrollBars.None; }
        hint = new Label { Text = placeholder, AutoSize = false, BackColor = Color.Transparent, ForeColor = Theme.Muted, Font = Input.Font, Cursor = Cursors.IBeam, UseMnemonic = false };
        hint.Click += (_, _) => Input.Focus();
        Input.Controls.Add(hint);
        Controls.Add(Input);
        Input.TextChanged += (_, _) => hint.Visible = Input.TextLength == 0;
        Input.Enter += (_, _) => { focused = true; Invalidate(); };
        Input.Leave += (_, _) => { focused = false; Invalidate(); };
        Theme.Changed += OnTheme;
    }

    private void OnTheme()
    {
        if (IsDisposed) return;
        Input.BackColor = Theme.Input; Input.ForeColor = Theme.Text; hint.ForeColor = Theme.Muted;
        Invalidate();
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing) Theme.Changed -= OnTheme;
        base.Dispose(disposing);
    }

    protected override void OnLayout(LayoutEventArgs e)
    {
        base.OnLayout(e);
        var left = S(Glyph.Length > 0 ? 42 : 14); var right = S(14);
        var w = Math.Max(20, Width - left - right);
        if (multi)
        {
            var top = S(11); var bottom = S(28);
            Input.SetBounds(left, top, w, Math.Max(20, Height - top - bottom));
        }
        else
        {
            Input.Width = w;
            Input.Location = new Point(left, Math.Max(0, (Height - Input.Height) / 2));
        }
        hint.SetBounds(1, 0, Math.Max(10, w - 2), Math.Max(S(18), Input.ClientSize.Height));
    }

    protected override void OnMouseDown(MouseEventArgs e) { base.OnMouseDown(e); Input.Focus(); }

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.Clear(Theme.Surface);
        var rf = new RectangleF(2.5f, 2.5f, Width - 5f, Height - 5f);
        Gfx.FillRound(g, Theme.Input, rf, S(10));
        if (focused)
        {
            Gfx.DrawRound(g, Color.FromArgb(55, Theme.Accent), new RectangleF(1.5f, 1.5f, Width - 3f, Height - 3f), S(11), 3f);
            Gfx.DrawRound(g, Theme.Accent, rf, S(10), 1.4f);
        }
        else Gfx.DrawRound(g, Theme.Border, rf, S(10), 1f);

        if (Glyph.Length > 0)
            TextRenderer.DrawText(g, Glyph, Theme.Icons(11f), new Rectangle(S(12), 0, S(24), Height), focused ? Theme.Accent : Theme.Muted,
                TextFlags | TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter);
        if (multi && Counter.Length > 0)
            TextRenderer.DrawText(g, Counter, Theme.Ui(8.5f), new Rectangle(0, Height - S(26), Width - S(16), S(20)), CounterWarn ? Theme.Danger : Theme.Muted,
                TextFlags | TextFormatFlags.Right | TextFormatFlags.VerticalCenter);
    }
}

/// <summary>Small wrapped note with a lock icon (what is sent, what never is).</summary>
internal sealed class PrivacyNote : Control
{
    private const TextFormatFlags WrapFlags = TextFormatFlags.WordBreak | TextFormatFlags.NoPadding | TextFormatFlags.NoPrefix | TextFormatFlags.Left | TextFormatFlags.Top;

    private static int S(int v) => Theme.S(v);

    public PrivacyNote()
    {
        SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
        TabStop = false; Font = Theme.Ui(8.5f);
    }

    public int MeasureHeight(int width) =>
        Math.Max(S(18), TextRenderer.MeasureText(Text, Font, new Size(Math.Max(10, width - S(24)), int.MaxValue), WrapFlags).Height + S(2));

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        g.Clear(Theme.Surface);
        TextRenderer.DrawText(g, "\uE72E", Theme.Icons(9f), new Rectangle(0, S(1), S(18), S(18)), Theme.Muted, TextFormatFlags.NoPadding | TextFormatFlags.NoPrefix | TextFormatFlags.SingleLine);
        TextRenderer.DrawText(g, Text, Font, new Rectangle(S(24), 0, Math.Max(10, Width - S(24)), Height), Theme.Muted, WrapFlags);
    }
}

/// <summary>"Your review is in" screen: a check mark that draws itself, shown after a successful send.</summary>
internal sealed class ThanksPanel : Control
{
    private readonly System.Windows.Forms.Timer timer = new() { Interval = 15 };
    private float t;
    public bool Pending { get; set; }

    private static int S(int v) => Theme.S(v);

    public ThanksPanel()
    {
        SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
        TabStop = false;
        timer.Tick += (_, _) => { t = Math.Min(1f, t + 0.04f); Invalidate(); if (t >= 1f) timer.Stop(); };
    }

    public void Play() { t = 0f; timer.Start(); }

    protected override void Dispose(bool disposing)
    {
        if (disposing) timer.Dispose();
        base.Dispose(disposing);
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.Clear(Theme.Surface);

        var ease = 1f - (float)Math.Pow(1f - t, 3);
        var cx = Width / 2f; var cy = S(62);
        var r = S(34) * (0.6f + 0.4f * ease);
        using (var halo = new SolidBrush(Color.FromArgb((int)(70 * ease), Theme.Accent))) g.FillEllipse(halo, cx - r - S(8), cy - r - S(8), (r + S(8)) * 2, (r + S(8)) * 2);
        using (var disc = new SolidBrush(Theme.Accent)) g.FillEllipse(disc, cx - r, cy - r, r * 2, r * 2);

        // the check mark is drawn along its two strokes as t grows
        var p = Math.Clamp((t - 0.3f) / 0.7f, 0f, 1f);
        if (p > 0f)
        {
            var a = new PointF(cx - S(14), cy + S(1)); var b = new PointF(cx - S(4), cy + S(11)); var c = new PointF(cx + S(15), cy - S(10));
            var l1 = Dist(a, b); var l2 = Dist(b, c); var cut = p * (l1 + l2);
            using var pen = new Pen(Color.White, S(5)) { StartCap = LineCap.Round, EndCap = LineCap.Round, LineJoin = LineJoin.Round };
            if (cut <= l1) g.DrawLine(pen, a, Lerp(a, b, cut / l1));
            else g.DrawLines(pen, new[] { a, b, Lerp(b, c, (cut - l1) / l2) });
        }

        var pad = S(48);
        var title = Pending ? "Your review is saved" : "Your review is in";
        var body = Pending
            ? "Your review is safely queued and will be sent to the developer automatically when the internet connection returns."
            : "It goes straight to the developer and helps shape the next version of PDF Studio.";
        TextRenderer.DrawText(g, title, Theme.Ui(13f, FontStyle.Bold), new Rectangle(pad, S(112), Width - pad * 2, S(30)), Theme.Text,
            TextFormatFlags.HorizontalCenter | TextFormatFlags.Top | TextFormatFlags.NoPadding | TextFormatFlags.SingleLine);
        TextRenderer.DrawText(g, body, Theme.Ui(9.5f),
            new Rectangle(pad, S(146), Width - pad * 2, S(60)), Theme.Muted,
            TextFormatFlags.HorizontalCenter | TextFormatFlags.Top | TextFormatFlags.WordBreak | TextFormatFlags.NoPadding);
    }

    private static float Dist(PointF a, PointF b) => (float)Math.Sqrt((b.X - a.X) * (b.X - a.X) + (b.Y - a.Y) * (b.Y - a.Y));
    private static PointF Lerp(PointF a, PointF b, float k) => new(a.X + (b.X - a.X) * k, a.Y + (b.Y - a.Y) * k);
}

/// <summary>
/// "Rate PDF Studio": pick stars (the face and colours react), tap what stood out, optionally add a name and a few words,
/// and send. Anonymous usage statistics are always on, so there is no checkbox. Problems are shown inline, never in a message box.
/// Ctrl+Enter sends; Enter inside the review box adds a new line.
/// </summary>
public sealed class ReviewDialog : Form
{
    private const int MaxMessage = 1000;
    private const string DefaultStatus = "Ctrl + Enter to send";
    private static readonly string[] Headings = { "What went wrong?", "What could be better?", "What did you like?" };
    private static readonly string[][] ChipSets =
    {
        new[] { "Bug or crash", "Too slow", "Confusing", "Missing a feature", "Layout issue" },
        new[] { "Speed", "Ease of use", "Design", "More tools", "Stability" },
        new[] { "Easy to use", "Fast", "Great design", "Powerful tools", "Saves me time" }
    };

    private readonly ReviewHero hero = new() { Dock = DockStyle.Top };
    private readonly Surface body = new() { Dock = DockStyle.Fill };
    private readonly ThanksPanel thanks = new() { Dock = DockStyle.Fill, Visible = false };
    private readonly ChipPicker chips = new() { EmptyText = "Pick a star rating, then tell us what stood out." };
    private readonly FieldBox nameBox = new(false, 60, "Your name (optional)") { Glyph = "\uE77B" };
    private readonly FieldBox messageBox = new(true, MaxMessage, "Write a few words about your experience (optional)");
    private readonly PrivacyNote note = new()
    {
        Text = "Sent with the app version, a random install id and this PC's name and network address. Usage statistics (times opened, time open) are included. Your files and file names are never sent."
    };
    private readonly Txt status = new(DefaultStatus, 8.5f, FontStyle.Regular, true) { Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleLeft, AutoEllipsis = true };
    private readonly FlatButton cancel;
    private readonly FlatButton send;
    private int group = -1;
    private bool busy, errorShown;

    /// <summary>True once the review was accepted for delivery (immediately or through the offline queue).</summary>
    public bool Sent { get; private set; }
    public bool Pending { get; private set; }

    private static int S(int v) => Theme.S(v);

    public ReviewDialog()
    {
        AutoScaleMode = AutoScaleMode.None;          // sizes are scaled once with Theme.S
        Text = "Rate PDF Studio";
        Font = Theme.Ui();
        FormBorderStyle = FormBorderStyle.FixedDialog; StartPosition = FormStartPosition.CenterParent;
        MaximizeBox = false; MinimizeBox = false; ShowInTaskbar = false; KeyPreview = true;
        BackColor = Theme.Surface; Opacity = 0;

        // footer: hint / error on the left, buttons on the right
        var footer = new Surface { Dock = DockStyle.Bottom, Height = S(72), Padding = new Padding(S(28), 0, S(28), 0), BorderTop = true };
        footer.UseRole(() => Theme.Surface);
        status.Margin = new Padding(0, 0, S(12), 0);
        cancel = new FlatButton { Text = "Cancel", Kind = BtnKind.Secondary, Height = S(40), AutoWidth = true, MinWidth = 96, Margin = new Padding(S(4), 0, 0, 0), Anchor = AnchorStyles.None, DialogResult = DialogResult.Cancel };
        send = new FlatButton { Text = "Send review", Glyph = "\uE724", Kind = BtnKind.Primary, Height = S(40), AutoWidth = true, MinWidth = 150, Margin = new Padding(S(8), 0, 0, 0), Anchor = AnchorStyles.None };
        cancel.FitNow(); send.FitNow();
        var row = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 3, RowCount = 1, BackColor = Color.Transparent, Margin = new Padding(0) };
        row.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        row.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        row.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        row.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        row.Controls.Add(status, 0, 0); row.Controls.Add(cancel, 1, 0); row.Controls.Add(send, 2, 0);
        footer.Controls.Add(row);
        CancelButton = cancel;                       // AcceptButton stays unset: Enter in the review box must add a new line

        // body: laid out by measuring, so the window is exactly tall enough
        body.UseRole(() => Theme.Surface);
        var wa = Screen.FromPoint(Cursor.Position).WorkingArea;
        var cw = Math.Min(S(520), wa.Width - S(40));
        var px = S(28); var innerW = cw - px * 2;
        var chipsH = Math.Max(chips.Measure(ChipSets[0], innerW), Math.Max(chips.Measure(ChipSets[1], innerW), chips.Measure(ChipSets[2], innerW)));
        var noteH = note.MeasureHeight(innerW);
        var y = S(14);
        chips.SetBounds(px, y, innerW, chipsH); y += chipsH + S(10);
        nameBox.SetBounds(px, y, innerW, S(42)); y += S(42) + S(10);
        messageBox.SetBounds(px, y, innerW, S(104)); y += S(104) + S(8);
        note.SetBounds(px, y, innerW, noteH); y += noteH + S(12);
        var contentH = y;
        body.Controls.Add(chips); body.Controls.Add(nameBox); body.Controls.Add(messageBox); body.Controls.Add(note);

        var totalH = hero.Height + contentH + footer.Height;
        var maxH = wa.Height - S(60);
        if (totalH > maxH) { body.AutoScroll = true; body.AutoScrollMinSize = new Size(0, contentH); totalH = maxH; }   // tiny screens: scroll instead of clipping
        ClientSize = new Size(cw, totalH);

        Controls.Add(thanks); Controls.Add(body); Controls.Add(footer); Controls.Add(hero);

        hero.TabIndex = 0; body.TabIndex = 1; footer.TabIndex = 2;
        chips.TabIndex = 0; nameBox.TabIndex = 1; messageBox.TabIndex = 2;
        cancel.TabIndex = 0; send.TabIndex = 1;
        nameBox.Input.AccessibleName = "Your name (optional)";
        messageBox.Input.AccessibleName = "Your review";
        chips.AccessibleName = "What stood out";

        hero.ValueChanged += (_, _) => RatingChanged();
        messageBox.Input.TextChanged += (_, _) => { UpdateCounter(); ClearError(); };
        send.Click += async (_, _) => await SubmitAsync();
        UpdateCounter();
    }

    private void RatingChanged()
    {
        var g = hero.Value >= 4 ? 2 : hero.Value == 3 ? 1 : 0;
        if (g != group) { group = g; chips.SetItems(Headings[g], ChipSets[g]); }
        ClearError();
    }

    private void UpdateCounter()
    {
        var n = messageBox.Input.TextLength;
        messageBox.Counter = $"{n} / {MaxMessage}";
        messageBox.CounterWarn = n >= MaxMessage * 9 / 10;
        messageBox.Invalidate();
    }

    private void SetStatus(string text, bool error)
    {
        errorShown = error;
        status.Text = text;
        status.Muted = !error;
        status.ForeColor = error ? Theme.Danger : Theme.Muted;
    }

    private void ClearError() { if (errorShown) SetStatus(DefaultStatus, false); }

    private void SetBusy(bool on)
    {
        busy = on;
        hero.Enabled = !on; body.Enabled = !on; cancel.Enabled = !on; send.Enabled = !on;
        send.Text = on ? "Sending…" : "Send review";
        UseWaitCursor = on;
        if (on) SetStatus("Sending your review…", false);
    }

    private async Task SubmitAsync()
    {
        if (busy || Sent) return;
        if (hero.Value < 1)
        {
            hero.Nudge(); hero.Focus();
            SetStatus("Pick a star rating first.", true);
            return;
        }
        var text = messageBox.Input.Text.Trim();
        if (text.Length is > 0 and < 3)
        {
            SetStatus("Write a little more, or leave the review empty.", true);
            messageBox.Input.Focus();
            return;
        }
        var tags = chips.Selected;       // the chosen chips travel inside the message text, so the server needs no change
        if (tags.Length > 0) text = (text.Length > 0 ? text + "\n\nTags: " : "Tags: ") + string.Join(", ", tags);

        SetBusy(true);
        UsageTracker.ReviewSubmitResult result;
        try { result = await UsageTracker.SubmitReviewAsync(hero.Value, nameBox.Input.Text.Trim(), text); }
        catch (Exception ex) { result = new UsageTracker.ReviewSubmitResult(false, false, ex.Message); }
        if (IsDisposed) return;
        SetBusy(false);
        if (!result.Ok) { SetStatus(result.Error, true); send.Focus(); return; }
        Pending = result.Pending;
        await ShowThanksAsync();
    }

    private async Task ShowThanksAsync()
    {
        Sent = true;
        hero.Thanks = true;
        thanks.Pending = Pending;
        body.Visible = false; thanks.Visible = true; thanks.Play();
        cancel.Visible = false;
        send.Glyph = "\uE73E"; send.Text = "Done"; send.DialogResult = DialogResult.OK;
        AcceptButton = send; CancelButton = send;
        SetStatus("", false);
        send.Focus();
        try { await Task.Delay(2400); } catch { }
        if (!IsDisposed && Visible) { DialogResult = DialogResult.OK; Close(); }
    }

    protected override bool ProcessCmdKey(ref Message msg, Keys keyData)
    {
        if (keyData == (Keys.Control | Keys.Enter)) { _ = SubmitAsync(); return true; }
        return base.ProcessCmdKey(ref msg, keyData);
    }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        if (busy && e.CloseReason == CloseReason.UserClosing) e.Cancel = true;      // a send is in flight (max ~12 s)
        base.OnFormClosing(e);
    }

    protected override void OnShown(EventArgs e)
    {
        base.OnShown(e);
        ModernDialog.FadeIn(this);
        ActiveControl = hero;
    }
}
