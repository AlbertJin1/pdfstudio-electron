using System.Drawing.Drawing2D;
using System.Diagnostics.CodeAnalysis;
using System.Globalization;

namespace PdfStudio.UI;

/// <summary>Marker: the control paints and themes itself (and its children), so Theme.Apply must leave it alone.</summary>
internal interface ISelfThemed { }

internal static class ExportUi
{
    /// <summary>First opaque background up the parent chain (what a rounded control is drawn on top of).</summary>
    public static Color ParentBack(Control c)
    {
        for (var p = c.Parent; p is not null; p = p.Parent) if (p.BackColor.A == 255) return p.BackColor;
        return Theme.Surface;
    }

    public const TextFormatFlags OneLine = TextFormatFlags.NoPadding | TextFormatFlags.NoPrefix | TextFormatFlags.SingleLine;
    public const TextFormatFlags Wrap = TextFormatFlags.NoPadding | TextFormatFlags.NoPrefix | TextFormatFlags.WordBreak;
}

// ───────────────────────────────────────── segmented tabs ─────────────────────────────────────────

/// <summary>
/// Segmented tab strip: equal-width segments in a rounded track, one selected, optional "has settings" dot per segment.
/// Keyboard: Left / Right / Home / End. The dialog adds Ctrl+Tab and Ctrl+PageUp/PageDown on top of <see cref="Step"/>.
/// </summary>
internal sealed class SegmentedTabs : Control, ISelfThemed
{
    private readonly List<string> items = new();
    private readonly HashSet<int> badges = new();
    private int selected, hot = -1;

    public event EventHandler? SelectedIndexChanged;

    public SegmentedTabs()
    {
        SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer
                 | ControlStyles.ResizeRedraw | ControlStyles.Selectable, true);
        TabStop = true; Cursor = Cursors.Hand; Font = Theme.Ui(9.5f); Height = 44;
        Theme.Changed += Repaint;
    }

    protected override void Dispose(bool disposing) { if (disposing) Theme.Changed -= Repaint; base.Dispose(disposing); }
    private void Repaint() { if (!IsDisposed) Invalidate(); }
    private int S(int v) => (int)Math.Round(v * DeviceDpi / 96f);

    public void SetItems(params string[] names)
    {
        items.Clear(); items.AddRange(names);
        selected = Math.Clamp(selected, 0, Math.Max(0, items.Count - 1));
        Invalidate();
    }

    public int SelectedIndex
    {
        get => selected;
        set
        {
            if (items.Count == 0) return;
            value = Math.Clamp(value, 0, items.Count - 1);
            if (value == selected) return;
            selected = value; Invalidate();
            SelectedIndexChanged?.Invoke(this, EventArgs.Empty);
        }
    }

    public void SetBadge(int index, bool on) { if (on ? badges.Add(index) : badges.Remove(index)) Invalidate(); }

    public void Step(int delta, bool wrap)
    {
        if (items.Count == 0) return;
        var i = selected + delta;
        i = wrap ? ((i % items.Count) + items.Count) % items.Count : Math.Clamp(i, 0, items.Count - 1);
        SelectedIndex = i;
    }

    private RectangleF Seg(int i)
    {
        var pad = S(4);
        var n = Math.Max(1, items.Count);
        var w = (Width - pad * 2f) / n;
        return new RectangleF(pad + i * w, pad, w, Height - pad * 2f);
    }

    private int HitTest(Point p)
    {
        for (var i = 0; i < items.Count; i++) if (Seg(i).Contains(p)) return i;
        return -1;
    }

    protected override bool IsInputKey(Keys keyData) =>
        (keyData & Keys.KeyCode) is Keys.Left or Keys.Right or Keys.Home or Keys.End || base.IsInputKey(keyData);

    protected override void OnKeyDown(KeyEventArgs e)
    {
        switch (e.KeyCode)
        {
            case Keys.Left: Step(-1, false); e.Handled = true; break;
            case Keys.Right: Step(1, false); e.Handled = true; break;
            case Keys.Home: SelectedIndex = 0; e.Handled = true; break;
            case Keys.End: SelectedIndex = items.Count - 1; e.Handled = true; break;
        }
        base.OnKeyDown(e);
    }

    protected override void OnMouseMove(MouseEventArgs e)
    {
        base.OnMouseMove(e);
        var h = HitTest(e.Location);
        if (h != hot) { hot = h; Invalidate(); }
    }

    protected override void OnMouseLeave(EventArgs e) { base.OnMouseLeave(e); if (hot != -1) { hot = -1; Invalidate(); } }

    protected override void OnMouseDown(MouseEventArgs e)
    {
        base.OnMouseDown(e);
        if (e.Button != MouseButtons.Left) return;
        var i = HitTest(e.Location);
        if (i < 0) return;
        Focus();
        SelectedIndex = i;
    }

    protected override void OnGotFocus(EventArgs e) { base.OnGotFocus(e); Invalidate(); }
    protected override void OnLostFocus(EventArgs e) { base.OnLostFocus(e); Invalidate(); }
    protected override void OnEnabledChanged(EventArgs e) { base.OnEnabledChanged(e); Invalidate(); }

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.Clear(ExportUi.ParentBack(this));
        var track = new RectangleF(0.5f, 0.5f, Width - 1.5f, Height - 1.5f);
        Gfx.FillRound(g, Theme.SurfaceAlt, track, S(11));

        var radius = S(8);
        for (var i = 0; i < items.Count; i++)
        {
            var r = Seg(i);
            var sel = i == selected;
            var isHot = i == hot && Enabled;

            if (sel)
            {
                var shadow = r; shadow.Offset(0, 1);
                Gfx.FillRound(g, Color.FromArgb(Theme.Dark ? 80 : 26, 0, 0, 0), shadow, radius);
                Gfx.FillRound(g, Theme.Dark ? Gfx.Mix(Theme.SurfaceAlt, Color.White, 0.10f) : Theme.Surface, r, radius);
                if (Focused && ShowFocusCues) Gfx.DrawRound(g, Theme.Accent, r, radius, 1.6f);
                else Gfx.DrawRound(g, Theme.Border, r, radius);
            }
            else if (isHot) Gfx.FillRound(g, Gfx.Mix(Theme.SurfaceAlt, Theme.Border, 0.45f), r, radius);

            var font = Theme.Ui(9.5f, sel ? FontStyle.Bold : FontStyle.Regular);
            var fg = !Enabled ? Theme.Muted : sel ? (Theme.Dark ? Theme.Text : Theme.Accent) : isHot ? Theme.Text : Theme.Muted;
            var dot = badges.Contains(i) ? S(6) : 0;
            var gap = dot > 0 ? S(6) : 0;
            var ts = TextRenderer.MeasureText(g, items[i], font, new Size(int.MaxValue, int.MaxValue), ExportUi.OneLine);
            var tw = Math.Min(ts.Width, Math.Max(10, (int)r.Width - dot - gap - S(10)));
            var startX = r.X + (r.Width - (tw + gap + dot)) / 2f;
            TextRenderer.DrawText(g, items[i], font, new Rectangle((int)Math.Round(startX), (int)r.Y, tw, (int)r.Height), fg,
                ExportUi.OneLine | TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis);
            if (dot > 0)
            {
                using var br = new SolidBrush(Theme.Accent);
                g.FillEllipse(br, startX + tw + gap, r.Y + (r.Height - dot) / 2f, dot, dot);
            }
        }
    }
}

// ───────────────────────────────────────── toggle switch ─────────────────────────────────────────

/// <summary>On/off switch with a caption on its right. Space or a click toggles it; the thumb slides.</summary>
internal sealed class ToggleSwitch : Control, ISelfThemed
{
    private bool isChecked, hover;
    private float t;                                   // 0 = off … 1 = on
    private System.Windows.Forms.Timer? anim;

    public event EventHandler? CheckedChanged;

    public ToggleSwitch(string text = "")
    {
        SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer
                 | ControlStyles.ResizeRedraw | ControlStyles.Selectable, true);
        Text = text; Font = Theme.Ui(9.5f); Cursor = Cursors.Hand; TabStop = true; Height = 28;
        Theme.Changed += Repaint;
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing) { Theme.Changed -= Repaint; anim?.Dispose(); anim = null; }
        base.Dispose(disposing);
    }

    private void Repaint() { if (!IsDisposed) Invalidate(); }
    private int S(int v) => (int)Math.Round(v * DeviceDpi / 96f);

    public bool Checked
    {
        get => isChecked;
        set
        {
            if (isChecked == value) return;
            isChecked = value;
            if (IsHandleCreated && Visible) Animate(); else t = value ? 1f : 0f;
            Invalidate();
            CheckedChanged?.Invoke(this, EventArgs.Empty);
        }
    }

    private void Animate()
    {
        anim ??= CreateTimer();
        if (!anim.Enabled) anim.Start();
    }

    private System.Windows.Forms.Timer CreateTimer()
    {
        var timer = new System.Windows.Forms.Timer { Interval = 15 };
        timer.Tick += (_, _) =>
        {
            var target = isChecked ? 1f : 0f;
            var d = target - t;
            if (Math.Abs(d) < 0.05f) { t = target; timer.Stop(); }
            else t += d * 0.35f;
            Invalidate();
        };
        return timer;
    }

    public override Size GetPreferredSize(Size proposedSize)
    {
        var ts = Text.Length > 0 ? TextRenderer.MeasureText(Text, Font, new Size(4000, 400), ExportUi.OneLine) : Size.Empty;
        return new Size(S(38) + (ts.Width > 0 ? S(10) + ts.Width : 0) + S(8), Math.Max(S(24), ts.Height));
    }

    protected override void OnTextChanged(EventArgs e) { base.OnTextChanged(e); Invalidate(); }
    protected override void OnClick(EventArgs e) { base.OnClick(e); if (Enabled) { Focus(); Checked = !Checked; } }
    protected override void OnKeyDown(KeyEventArgs e)
    {
        if (e.KeyCode == Keys.Space && Enabled) { Checked = !Checked; e.Handled = true; }
        base.OnKeyDown(e);
    }
    protected override void OnMouseEnter(EventArgs e) { hover = true; base.OnMouseEnter(e); Invalidate(); }
    protected override void OnMouseLeave(EventArgs e) { hover = false; base.OnMouseLeave(e); Invalidate(); }
    protected override void OnGotFocus(EventArgs e) { base.OnGotFocus(e); Invalidate(); }
    protected override void OnLostFocus(EventArgs e) { base.OnLostFocus(e); Invalidate(); }
    protected override void OnEnabledChanged(EventArgs e) { base.OnEnabledChanged(e); Invalidate(); }

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.Clear(ExportUi.ParentBack(this));
        var on = Enabled;
        var sw = S(38); var sh = S(20);
        var y = (Height - sh) / 2f;
        var track = new RectangleF(1, y, sw - 2, sh);

        var off = Theme.Dark ? Color.FromArgb(78, 84, 96) : Color.FromArgb(188, 194, 206);
        var fill = Gfx.Mix(off, Theme.Accent, t);
        if (!on) fill = Gfx.Mix(fill, ExportUi.ParentBack(this), 0.55f);
        else if (hover) fill = Gfx.Mix(fill, Color.White, 0.08f);
        Gfx.FillRound(g, fill, track, sh / 2f);
        if (Focused && ShowFocusCues) Gfx.DrawRound(g, Theme.Accent, RectangleF.Inflate(track, S(2), S(2)), sh / 2f + S(2), 1.6f);

        var d = sh - S(6);
        var x0 = track.X + S(3); var x1 = track.Right - S(3) - d;
        var tx = x0 + (x1 - x0) * t;
        var thumb = new RectangleF(tx, y + S(3), d, d);
        using (var sb = new SolidBrush(Color.FromArgb(on ? 50 : 20, 0, 0, 0))) g.FillEllipse(sb, thumb.X, thumb.Y + 1, d, d);
        using (var tb = new SolidBrush(on ? Color.White : Color.FromArgb(235, 237, 241))) g.FillEllipse(tb, thumb);

        if (Text.Length > 0)
        {
            var left = sw + S(10);
            TextRenderer.DrawText(g, Text, Font, new Rectangle(left, 0, Math.Max(10, Width - left), Height), on ? Theme.Text : Theme.Muted,
                ExportUi.OneLine | TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis);
        }
    }
}

// ───────────────────────────────────────── text + number fields ─────────────────────────────────────────

/// <summary>
/// Rounded input chrome around a borderless TextBox, so text boxes, password boxes and number boxes share one look,
/// one height and one focus ring. The inner TextBox is the real tab stop.
/// </summary>
internal abstract class FieldBase : Control, ISelfThemed
{
    protected readonly TextBox Box = new() { BorderStyle = BorderStyle.None };
    private bool hover;

    protected FieldBase()
    {
        SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
        SetStyle(ControlStyles.Selectable, false);
        TabStop = false; Font = Theme.Ui(9.5f); Height = 30;
        Box.Font = Font; Box.TabStop = true;
        Box.Enter += (_, _) => Invalidate();
        Box.Leave += (_, _) => Invalidate();
        Box.MouseEnter += (_, _) => UpdateHover();
        Box.MouseLeave += (_, _) => UpdateHover();
        Controls.Add(Box);
        ApplyColors();
        Theme.Changed += OnTheme;
    }

    protected override void Dispose(bool disposing) { if (disposing) Theme.Changed -= OnTheme; base.Dispose(disposing); }
    protected int S(int v) => (int)Math.Round(v * DeviceDpi / 96f);

    private void OnTheme() { if (IsDisposed) return; ApplyColors(); Invalidate(); }
    private Color Fill => Enabled ? Theme.Input : Theme.SurfaceAlt;

    private void ApplyColors()
    {
        Box.BackColor = Fill;
        Box.ForeColor = Enabled ? Theme.Text : Theme.Muted;
    }

    /// <summary>Where the TextBox sits inside the field (pixels).</summary>
    protected virtual Rectangle TextArea => new(S(10), 0, Math.Max(10, Width - S(20)), Height);

    protected void PositionBox()
    {
        var a = TextArea;
        Box.SetBounds(a.X, (Height - Box.Height) / 2, Math.Max(10, a.Width), Box.Height);
    }

    protected virtual void PaintExtras(Graphics g) { }

    protected override void OnResize(EventArgs e) { base.OnResize(e); PositionBox(); }
    protected override void OnHandleCreated(EventArgs e) { base.OnHandleCreated(e); PositionBox(); }
    protected override void OnDpiChangedAfterParent(EventArgs e) { base.OnDpiChangedAfterParent(e); PositionBox(); }
    protected override void OnEnabledChanged(EventArgs e) { base.OnEnabledChanged(e); ApplyColors(); Invalidate(); }
    protected override void OnMouseEnter(EventArgs e) { base.OnMouseEnter(e); UpdateHover(); }
    protected override void OnMouseLeave(EventArgs e) { base.OnMouseLeave(e); UpdateHover(); }
    protected override void OnMouseDown(MouseEventArgs e) { base.OnMouseDown(e); if (Enabled) Box.Focus(); }

    private void UpdateHover()
    {
        var h = IsHandleCreated && ClientRectangle.Contains(PointToClient(Cursor.Position));
        if (h != hover) { hover = h; Invalidate(); }
    }

    protected bool IsHover => hover;

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.Clear(ExportUi.ParentBack(this));
        var r = new RectangleF(0.5f, 0.5f, Width - 1.5f, Height - 1.5f);
        var focus = Box.Focused && Enabled;
        Gfx.FillRound(g, Fill, r, 8);
        var border = !Enabled ? Theme.Border : focus ? Theme.Accent : hover ? Gfx.Mix(Theme.Border, Theme.Accent, 0.6f) : Theme.Border;
        Gfx.DrawRound(g, border, r, 8, focus ? 1.6f : 1f);
        PaintExtras(g);
    }
}

/// <summary>Single-line text field; optionally a password field with a show/hide eye.</summary>
internal sealed class InputField : FieldBase
{
    private readonly bool password;
    private bool revealed, overEye;

    public InputField(bool password = false, string placeholder = "")
    {
        this.password = password;
        Box.PlaceholderText = placeholder;
        Box.UseSystemPasswordChar = password;
        Box.TextChanged += (_, _) => OnTextChanged(EventArgs.Empty);
    }

    [AllowNull]
    public override string Text { get => Box.Text; set => Box.Text = value ?? ""; }
    public void FocusInput() => Box.Focus();

    private Rectangle EyeRect => new(Width - S(34), S(2), S(30), Height - S(4));
    protected override Rectangle TextArea => new(S(10), 0, Math.Max(10, Width - S(password ? 44 : 20)), Height);

    protected override void OnMouseMove(MouseEventArgs e)
    {
        base.OnMouseMove(e);
        var o = password && EyeRect.Contains(e.Location);
        if (o != overEye) { overEye = o; Cursor = o ? Cursors.Hand : Cursors.Default; Invalidate(); }
    }

    protected override void OnMouseDown(MouseEventArgs e)
    {
        if (password && Enabled && EyeRect.Contains(e.Location))
        {
            revealed = !revealed; Box.UseSystemPasswordChar = !revealed; Box.Focus(); Invalidate();
            return;
        }
        base.OnMouseDown(e);
    }

    protected override void PaintExtras(Graphics g)
    {
        if (!password) return;
        var fg = !Enabled ? Theme.Muted : overEye || revealed ? Theme.Accent : Theme.Muted;
        TextRenderer.DrawText(g, revealed ? "\uED1A" : "\uE7B3", Theme.Icons(11f), EyeRect, fg,
            TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
    }
}

/// <summary>Number field with a unit suffix and stepper arrows (click, hold to repeat, mouse wheel, Up/Down keys).</summary>
internal sealed class ModernNumber : FieldBase
{
    private readonly decimal min, max, step;
    private readonly int decimals;
    private readonly string suffix;
    private readonly System.Windows.Forms.Timer repeat = new() { Interval = 380 };
    private decimal current;
    private bool suppress;
    private int hotZone, pressedZone;                  // 0 none, 1 up, 2 down

    public event EventHandler? ValueChanged;

    public ModernNumber(decimal min, decimal max, decimal value, int decimals = 0, decimal step = 1m, string suffix = "")
    {
        this.min = min; this.max = max; this.step = step; this.decimals = decimals; this.suffix = suffix;
        current = Clamp(value);
        suppress = true; Box.Text = Format(current); suppress = false;
        Box.TextChanged += (_, _) => OnBoxChanged();
        Box.KeyPress += OnBoxKeyPress;
        Box.KeyDown += OnBoxKeyDown;
        Box.Leave += (_, _) => Commit();
        Box.MouseWheel += OnBoxWheel;
        repeat.Tick += (_, _) => { repeat.Interval = 55; Nudge(pressedZone == 1 ? 1 : -1); };
    }

    protected override void Dispose(bool disposing) { if (disposing) repeat.Dispose(); base.Dispose(disposing); }

    private decimal Clamp(decimal v) => Math.Round(Math.Clamp(v, min, max), decimals, MidpointRounding.AwayFromZero);
    private string Format(decimal v) => v.ToString("F" + decimals, CultureInfo.InvariantCulture);
    private bool TryRead(out decimal v) =>
        decimal.TryParse(Box.Text.Trim(), NumberStyles.AllowLeadingSign | NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out v);

    /// <summary>The value, including what is typed right now (so Export never uses a stale number).</summary>
    public decimal Value
    {
        get { if (TryRead(out var v)) current = Clamp(v); return current; }
        set => SetValue(value, true);
    }

    private void SetValue(decimal v, bool rewrite)
    {
        v = Clamp(v);
        var changed = v != current;
        current = v;
        if (rewrite) { suppress = true; Box.Text = Format(v); suppress = false; }
        if (changed) ValueChanged?.Invoke(this, EventArgs.Empty);
    }

    private void OnBoxChanged()
    {
        if (suppress) return;
        if (TryRead(out var v))
        {
            var c = Clamp(v);
            if (c != current) { current = c; ValueChanged?.Invoke(this, EventArgs.Empty); }
        }
    }

    private void Commit() { suppress = true; Box.Text = Format(Value); suppress = false; }
    private void Nudge(int dir) => SetValue(Value + dir * step, true);

    private void OnBoxKeyPress(object? sender, KeyPressEventArgs e)
    {
        var c = e.KeyChar;
        if (char.IsControl(c) || char.IsDigit(c)) return;
        if (c == '.' && decimals > 0 && !Box.Text.Contains('.')) return;
        if (c == '-' && min < 0 && Box.SelectionStart == 0 && !Box.Text.Contains('-')) return;
        e.Handled = true;
    }

    private void OnBoxKeyDown(object? sender, KeyEventArgs e)
    {
        if (e.KeyCode == Keys.Up) { Nudge(1); e.Handled = e.SuppressKeyPress = true; }
        else if (e.KeyCode == Keys.Down) { Nudge(-1); e.Handled = e.SuppressKeyPress = true; }
        else if (e.KeyCode == Keys.Enter) Commit();
    }

    private void OnBoxWheel(object? sender, MouseEventArgs e)
    {
        if (!Box.Focused) return;
        Nudge(e.Delta > 0 ? 1 : -1);
        if (e is HandledMouseEventArgs h) h.Handled = true;
    }

    // geometry ----------------------------------------------------------------------------------------------
    private int StepW => S(22);
    private int SuffixW => string.IsNullOrEmpty(suffix) ? 0 : TextRenderer.MeasureText(suffix, Font, new Size(500, 100), ExportUi.OneLine).Width + S(4);
    private Rectangle Stepper => new(Width - StepW - S(4), S(3), StepW, Math.Max(10, Height - S(6)));
    private Rectangle UpRect { get { var s = Stepper; return new Rectangle(s.X, s.Y, s.Width, s.Height / 2); } }
    private Rectangle DownRect { get { var s = Stepper; return new Rectangle(s.X, s.Y + s.Height / 2, s.Width, s.Height - s.Height / 2); } }
    protected override Rectangle TextArea => new(S(10), 0, Math.Max(10, Width - S(10) - StepW - S(10) - SuffixW), Height);

    private int ZoneAt(Point p) => !Enabled ? 0 : UpRect.Contains(p) ? 1 : DownRect.Contains(p) ? 2 : 0;

    protected override void OnMouseMove(MouseEventArgs e)
    {
        base.OnMouseMove(e);
        var z = ZoneAt(e.Location);
        if (z != hotZone) { hotZone = z; Cursor = z != 0 ? Cursors.Hand : Cursors.Default; Invalidate(); }
    }

    protected override void OnMouseLeave(EventArgs e) { base.OnMouseLeave(e); if (hotZone != 0) { hotZone = 0; Invalidate(); } }

    protected override void OnMouseDown(MouseEventArgs e)
    {
        var z = e.Button == MouseButtons.Left ? ZoneAt(e.Location) : 0;
        if (z == 0) { base.OnMouseDown(e); return; }
        Box.Focus();
        pressedZone = z;
        Nudge(z == 1 ? 1 : -1);
        repeat.Interval = 380; repeat.Start();
    }

    protected override void OnMouseUp(MouseEventArgs e) { base.OnMouseUp(e); repeat.Stop(); pressedZone = 0; }

    protected override void PaintExtras(Graphics g)
    {
        var on = Enabled;
        if (!string.IsNullOrEmpty(suffix))
        {
            var sw = SuffixW;
            TextRenderer.DrawText(g, suffix, Font, new Rectangle(Stepper.X - S(6) - sw, 0, sw, Height), Theme.Muted,
                ExportUi.OneLine | TextFormatFlags.Right | TextFormatFlags.VerticalCenter);
        }
        foreach (var (rect, zone, glyph) in new[] { (UpRect, 1, "\uE70E"), (DownRect, 2, "\uE70D") })
        {
            if (on && hotZone == zone) Gfx.FillRound(g, Theme.SurfaceAlt, Rectangle.Inflate(rect, -1, -1), 5);
            TextRenderer.DrawText(g, glyph, Theme.Icons(6.5f), rect, !on ? Theme.Muted : hotZone == zone ? Theme.Accent : Theme.Muted,
                TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
        }
    }
}

// ───────────────────────────────────────── info card ─────────────────────────────────────────

/// <summary>Soft card with an icon, an optional bold title and wrapped body text. Its height follows its width.</summary>
internal sealed class NoteCard : Control, ISelfThemed
{
    private string title = "", body = "", glyph;

    public NoteCard(string body, string glyph = "\uE946", string title = "")
    {
        SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
        SetStyle(ControlStyles.Selectable, false);
        TabStop = false; Font = Theme.Ui(9f); Height = 60;
        this.body = body; this.glyph = glyph; this.title = title;
        Theme.Changed += Repaint;
    }

    protected override void Dispose(bool disposing) { if (disposing) Theme.Changed -= Repaint; base.Dispose(disposing); }
    private void Repaint() { if (!IsDisposed) Invalidate(); }
    private int S(int v) => (int)Math.Round(v * DeviceDpi / 96f);

    public string Title { get => title; set { title = value; Changed(); } }
    public string Body { get => body; set { body = value; Changed(); } }
    public string Glyph { get => glyph; set { glyph = value; Invalidate(); } }

    private void Changed() { Invalidate(); (Parent as SettingsPage)?.Relayout(); }

    private int TextLeft => S(12) + S(30) + S(12);
    private static Font TitleFont => Theme.Ui(10f, FontStyle.Bold);

    public int HeightFor(int width)
    {
        var tw = Math.Max(60, width - TextLeft - S(14));
        var h = S(12);
        if (title.Length > 0) h += TextRenderer.MeasureText(title, TitleFont, new Size(tw, 0), ExportUi.Wrap).Height + S(3);
        if (body.Length > 0) h += TextRenderer.MeasureText(body, Font, new Size(tw, 0), ExportUi.Wrap).Height;
        return Math.Max(S(54), h + S(12));
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.Clear(ExportUi.ParentBack(this));
        var r = new RectangleF(0.5f, 0.5f, Width - 1.5f, Height - 1.5f);
        Gfx.FillRound(g, Theme.Input, r, 10);
        Gfx.DrawRound(g, Theme.Border, r, 10);

        var d = S(30);
        var ib = new Rectangle(S(12), S(12), d, d);
        using (var br = new SolidBrush(Theme.AccentSoft)) g.FillEllipse(br, ib);
        TextRenderer.DrawText(g, glyph, Theme.Icons(11f), ib, Theme.Accent,
            TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);

        var tx = TextLeft; var tw = Math.Max(60, Width - tx - S(14)); var y = S(12);
        if (title.Length > 0)
        {
            var th = TextRenderer.MeasureText(title, TitleFont, new Size(tw, 0), ExportUi.Wrap).Height;
            TextRenderer.DrawText(g, title, TitleFont, new Rectangle(tx, y, tw, th), Theme.Text, ExportUi.Wrap);
            y += th + S(3);
        }
        if (body.Length > 0)
            TextRenderer.DrawText(g, body, Font, new Rectangle(tx, y, tw, Math.Max(10, Height - y - S(8))), Theme.Muted, ExportUi.Wrap);
    }
}

// ───────────────────────────────────────── settings page ─────────────────────────────────────────

/// <summary>
/// One tab page. Rows are laid out by hand on a single grid: a fixed label column, every field starting at the same left
/// edge and sharing the same width and height, rows vertically centred, hidden rows collapsing. Nothing depends on
/// TableLayoutPanel auto-sizing, so alignment is identical at every DPI.
/// </summary>
internal sealed class SettingsPage : Surface
{
    private enum Kind { Heading, Blurb, Gap, Divider, Section, Row, Full, Note }

    private sealed class Item
    {
        public Kind Kind;
        public Control? Label, Ctl, Hint;
        public int W, H, Space;
        public bool Shown = true, Applied = true;
        public readonly List<(Control C, int W)> After = new();
    }

    private readonly List<Item> items = new();
    private readonly List<int> dividers = new();
    private bool laying;

    /// <summary>A control whose height every single-line field should match (the themed drop-down).</summary>
    public Control? HeightSource { get; set; }

    public SettingsPage(string heading, string blurb)
    {
        UseRole(() => Theme.Surface);
        AutoScroll = true; Visible = false;
        Add(new Item { Kind = Kind.Heading, Ctl = new Txt(heading, 12f, FontStyle.Bold) });
        Add(new Item { Kind = Kind.Blurb, Ctl = new Txt(blurb, 9.5f, FontStyle.Regular, true) });
    }

    private int S(int v) => (int)Math.Round(v * DeviceDpi / 96f);

    private void Add(Item it)
    {
        foreach (var c in Controls_Of(it)) Controls.Add(c);
        items.Add(it);
    }

    private static IEnumerable<Control> Controls_Of(Item it)
    {
        if (it.Label is not null) yield return it.Label;
        if (it.Ctl is not null) yield return it.Ctl;
        foreach (var (c, _) in it.After) yield return c;
        if (it.Hint is not null) yield return it.Hint;
    }

    /// <summary>Label on the left, field on the right. <paramref name="width"/> 0 = fill (up to a common maximum).</summary>
    public void Row(string label, Control ctl, int width = 0, int height = 0, string hint = "", params (Control C, int W)[] after)
    {
        var it = new Item
        {
            Kind = Kind.Row, Ctl = ctl, W = width, H = height,
            Label = new Txt(label, 9.5f) { TextAlign = ContentAlignment.MiddleLeft, AutoEllipsis = true }
        };
        it.After.AddRange(after);
        if (hint.Length > 0) it.Hint = new Txt(hint, 8.5f, FontStyle.Regular, true);
        Add(it);
    }

    /// <summary>A control that starts at the left edge (toggles, buttons).</summary>
    public void Full(Control ctl, int width = 0, int height = 0) => Add(new Item { Kind = Kind.Full, Ctl = ctl, W = width, H = height });
    public void Note(NoteCard card) => Add(new Item { Kind = Kind.Note, Ctl = card });
    public void Section(string text) => Add(new Item { Kind = Kind.Section, Ctl = new Txt(text, 9f, FontStyle.Bold, true) });
    public void Gap(int design) => Add(new Item { Kind = Kind.Gap, Space = design });
    public void Divider() => Add(new Item { Kind = Kind.Divider });

    public void SetShown(Control ctl, bool shown)
    {
        var it = items.Find(i => i.Ctl == ctl);
        if (it is null || it.Shown == shown) return;
        it.Shown = shown;
        PerformLayout();
    }

    public void SetEnabled(Control ctl, bool enabled)
    {
        var it = items.Find(i => i.Ctl == ctl);
        if (it is null) return;
        ctl.Enabled = enabled;
        foreach (var (c, _) in it.After) c.Enabled = enabled;
        if (it.Label is Txt t) { t.Muted = !enabled; t.ForeColor = enabled ? Theme.Text : Theme.Muted; }
    }

    public void Relayout() => PerformLayout();

    protected override void OnLayout(LayoutEventArgs e)
    {
        base.OnLayout(e);
        if (laying) return;
        laying = true;
        try { DoLayout(); } finally { laying = false; }
    }

    protected override void OnScroll(ScrollEventArgs se) { base.OnScroll(se); Invalidate(); }

    private int TextH(Control t, int w) =>
        TextRenderer.MeasureText(t.Text, t.Font, new Size(Math.Max(20, w), 0), ExportUi.Wrap).Height + S(3);

    private static void PlaceCentered(Control c, int x, int rowTop, int w, int h, int rowH)
    {
        c.SetBounds(x, rowTop + (rowH - h) / 2, w, h);
        if (c.Height != h) c.Top = rowTop + (rowH - c.Height) / 2;     // fixed-height controls (drop-downs) keep their own height
    }

    private void DoLayout()
    {
        var oy = AutoScrollPosition.Y;
        var W = Math.Max(S(240), ClientSize.Width);
        var fh = HeightSource is { Height: > 0 } hs ? hs.Height : S(30);
        var labelW = S(176);
        var maxField = S(420);
        var y = S(2);
        dividers.Clear();

        foreach (var it in items)
        {
            if (it.Applied != it.Shown)
            {
                it.Applied = it.Shown;
                foreach (var c in Controls_Of(it)) c.Visible = it.Shown;
            }
            if (!it.Shown) continue;

            switch (it.Kind)
            {
                case Kind.Heading:
                {
                    var t = it.Ctl!; var h = TextH(t, W);
                    t.SetBounds(0, y + oy, W, h); y += h + S(2);
                    break;
                }
                case Kind.Blurb:
                {
                    var t = it.Ctl!; var h = TextH(t, W);
                    t.SetBounds(0, y + oy, W, h); y += h + S(14);
                    break;
                }
                case Kind.Section:
                {
                    var t = it.Ctl!; y += S(6); var h = TextH(t, W);
                    t.SetBounds(0, y + oy, W, h); y += h + S(4);
                    break;
                }
                case Kind.Gap: y += S(it.Space); break;
                case Kind.Divider:
                    y += S(6); dividers.Add(y); y += S(1) + S(6);
                    break;
                case Kind.Note:
                {
                    var card = (NoteCard)it.Ctl!;
                    var w = Math.Min(W, S(690));
                    var h = card.HeightFor(w);
                    card.SetBounds(0, y + oy, w, h); y += h + S(8);
                    break;
                }
                case Kind.Full:
                {
                    var ch = it.H > 0 ? S(it.H) : fh;
                    var rowH = Math.Max(S(38), ch + S(10));
                    var cw = it.W > 0 ? S(it.W) : it.Ctl is ToggleSwitch ts ? ts.GetPreferredSize(Size.Empty).Width : W;
                    PlaceCentered(it.Ctl!, 0, y + oy, Math.Min(cw, W), ch, rowH);
                    y += rowH;
                    break;
                }
                case Kind.Row:
                {
                    var ch = it.H > 0 ? S(it.H) : fh;
                    var rowH = Math.Max(S(40), ch + S(12));
                    var cw = it.W > 0 ? S(it.W) : Math.Min(Math.Max(S(120), W - labelW), maxField);
                    it.Label!.SetBounds(0, y + oy, labelW - S(12), rowH);
                    PlaceCentered(it.Ctl!, labelW, y + oy, cw, ch, rowH);
                    var ax = labelW + cw + S(10);
                    foreach (var (c, w) in it.After)
                    {
                        var aw = S(w);
                        PlaceCentered(c, ax, y + oy, aw, ch, rowH);
                        ax += aw + S(6);
                    }
                    y += rowH;
                    if (it.Hint is { } hint)
                    {
                        var top = y - S(4);
                        var h = TextH(hint, cw);
                        hint.SetBounds(labelW, top + oy, cw, h);
                        y = top + h + S(6);
                    }
                    break;
                }
            }
        }

        var min = new Size(0, y + S(8));
        if (AutoScrollMinSize != min) AutoScrollMinSize = min;
        Invalidate();
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        if (dividers.Count == 0) return;
        using var pen = new Pen(Theme.Border);
        var oy = AutoScrollPosition.Y;
        foreach (var y in dividers) e.Graphics.DrawLine(pen, 0, y + oy, ClientSize.Width, y + oy);
    }
}
