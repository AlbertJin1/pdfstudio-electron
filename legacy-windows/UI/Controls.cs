using System.Drawing.Drawing2D;
using System.Drawing.Text;

namespace PdfStudio.UI;

public enum BtnKind { Primary, Secondary, Ghost }

/// <summary>
/// Modern flat button: owner-drawn, theme aware, optional icon glyph (Segoe MDL2), stacked layout and drop-down menu.
/// Hover and press are animated (colour cross-fade, accent tint on icons, slight press-in).
/// </summary>
public class FlatButton : Button
{
    public BtnKind Kind { get; set; } = BtnKind.Secondary;
    /// <summary>Segoe MDL2 Assets glyph, e.g. "\uE710".</summary>
    public string Glyph { get; set; } = "";
    /// <summary>Use a normal text symbol (e.g. ⟲) instead of the icon font.</summary>
    public bool GlyphIsText { get; set; }
    public bool Vertical { get; set; }
    public bool DangerStyle { get; set; }
    public float GlyphTextSize { get; set; } = 0f;
    public bool Active { get; set; }
    private ContextMenuStrip? dropMenu;
    private bool menuOpen;
    private long swallowClickAt;

    /// <summary>
    /// Drop-down shown under the button. Clicking the button again while it is open closes it (a second click used to
    /// close the menu on mouse-down and then re-open it on mouse-up, so it could never be toggled off).
    /// </summary>
    public ContextMenuStrip? DropMenu
    {
        get => dropMenu;
        set
        {
            if (dropMenu is not null) { dropMenu.Closing -= OnDropMenuClosing; dropMenu.Opened -= OnDropMenuOpened; dropMenu.Closed -= OnDropMenuClosed; }
            dropMenu = value;
            if (dropMenu is not null) { dropMenu.Closing += OnDropMenuClosing; dropMenu.Opened += OnDropMenuOpened; dropMenu.Closed += OnDropMenuClosed; }
        }
    }

    private void OnDropMenuOpened(object? sender, EventArgs e) { menuOpen = true; Repaint(); }
    private void OnDropMenuClosed(object? sender, ToolStripDropDownClosedEventArgs e) { menuOpen = false; Repaint(); }

    private void OnDropMenuClosing(object? sender, ToolStripDropDownClosingEventArgs e)
    {
        // the menu is closing because the user pressed the mouse on THIS button: that click must only close the menu
        if (e.CloseReason == ToolStripDropDownCloseReason.AppClicked && IsHandleCreated
            && RectangleToScreen(ClientRectangle).Contains(Cursor.Position))
            swallowClickAt = Environment.TickCount64;
    }

    /// <summary>When true the width follows the caption (icon + text + chevron + padding) so nothing is ever clipped.</summary>
    public bool AutoWidth { get; set; }
    /// <summary>Smallest width (design pixels) an AutoWidth button may shrink to.</summary>
    public int MinWidth { get; set; }
    /// <summary>Set by the main window once it is shown; before that sizes are still being DPI-scaled by WinForms.</summary>
    public static bool LayoutReady { get; set; }
    private bool hover, down;
    private float amount;                       // 0 = resting, 1 = fully hovered
    private System.Windows.Forms.Timer? anim;

    public FlatButton()
    {
        SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
        FlatStyle = FlatStyle.Flat; FlatAppearance.BorderSize = 0; UseVisualStyleBackColor = false;
        Cursor = Cursors.Hand; Font = Theme.Ui(); Height = 34; TabStop = true;
        Theme.Changed += Repaint;
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing) { Theme.Changed -= Repaint; anim?.Dispose(); anim = null; }
        base.Dispose(disposing);
    }

    private void Repaint() { if (!IsDisposed) Invalidate(); }

    private void Animate()
    {
        anim ??= CreateTimer();
        if (!anim.Enabled) anim.Start();
    }

    private System.Windows.Forms.Timer CreateTimer()
    {
        var t = new System.Windows.Forms.Timer { Interval = 15 };
        t.Tick += (_, _) =>
        {
            var target = hover && Enabled ? 1f : 0f;
            var d = target - amount;
            if (Math.Abs(d) < 0.04f) { amount = target; t.Stop(); }
            else amount += d * 0.32f;
            Invalidate();
        };
        return t;
    }

    private Color ParentBack()
    {
        for (var c = Parent; c is not null; c = c.Parent) if (c.BackColor.A == 255) return c.BackColor;
        return Theme.Window;
    }

    protected override void OnMouseEnter(EventArgs e) { hover = true; base.OnMouseEnter(e); Animate(); }
    protected override void OnMouseLeave(EventArgs e) { swallowClickAt = 0; hover = false; down = false; base.OnMouseLeave(e); Animate(); }
    protected override void OnMouseDown(MouseEventArgs e) { down = true; base.OnMouseDown(e); Repaint(); }
    protected override void OnMouseUp(MouseEventArgs e) { down = false; base.OnMouseUp(e); Repaint(); }
    protected override void OnEnabledChanged(EventArgs e) { base.OnEnabledChanged(e); amount = 0; Repaint(); }
    protected override void OnGotFocus(EventArgs e) { base.OnGotFocus(e); Repaint(); }
    protected override void OnLostFocus(EventArgs e) { base.OnLostFocus(e); Repaint(); }

    protected override void OnTextChanged(EventArgs e) { base.OnTextChanged(e); FitNow(); Repaint(); }
    protected override void OnFontChanged(EventArgs e) { base.OnFontChanged(e); FitNow(); }

    private Font IconFont => GlyphIsText
        ? Theme.Ui(GlyphTextSize > 0 ? GlyphTextSize : (Vertical ? 14f : 11f))
        : Theme.Icons(Vertical ? 15f : 11.5f);
    private const TextFormatFlags MeasureFlags = TextFormatFlags.NoPadding | TextFormatFlags.NoPrefix | TextFormatFlags.SingleLine;

    /// <summary>Width needed to show glyph, caption and chevron with comfortable side padding.</summary>
    public int MeasureWidth()
    {
        var gs = Glyph.Length > 0 ? TextRenderer.MeasureText(Glyph, IconFont, new Size(1000, 1000), MeasureFlags) : Size.Empty;
        var ts = Text.Length > 0 ? TextRenderer.MeasureText(Text, Font, new Size(1000, 1000), MeasureFlags) : Size.Empty;
        var chev = DropMenu is not null ? TextRenderer.MeasureText("\uE70D", Theme.Icons(8f), new Size(100, 100), MeasureFlags) : Size.Empty;
        int content;
        if (Vertical) content = Math.Max(gs.Width, ts.Width + (chev.Width > 0 ? chev.Width + 3 : 0));
        else content = gs.Width + (gs.Width > 0 && ts.Width > 0 ? 8 : 0) + ts.Width + (chev.Width > 0 ? 8 + chev.Width : 0);
        var pad = Theme.S(Vertical ? 10 : (ts.Width > 0 ? 14 : 10));
        return Math.Max(Theme.S(MinWidth), content + pad * 2);
    }

    /// <summary>Re-measures an AutoWidth button. Does nothing until the window has finished its DPI scaling.</summary>
    public void FitNow()
    {
        if (!AutoWidth || !LayoutReady || IsDisposed) return;
        var w = MeasureWidth();
        if (Width != w) Width = w;
    }

    /// <summary>Re-measures every AutoWidth button below <paramref name="root"/>.</summary>
    public static void FitTree(Control root)
    {
        if (root is FlatButton fb) fb.FitNow();
        foreach (Control c in root.Controls) FitTree(c);
    }

    protected override void OnClick(EventArgs e)
    {
        if (DropMenu is not null && Enabled)
        {
            var wasClosedByThisClick = swallowClickAt != 0 && Environment.TickCount64 - swallowClickAt < 1500;
            swallowClickAt = 0;
            if (wasClosedByThisClick || DropMenu.Visible) return;
            DropMenu.MinimumSize = new Size(Math.Max(Width, Theme.S(220)), 0);
            DropMenu.Show(this, new Point(0, Height + 4));
            return;
        }
        base.OnClick(e);
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.Clear(ParentBack());

        Color bg, fg, border = Color.Transparent;
        var on = Enabled;
        var t = on ? Math.Max(amount, menuOpen ? 1f : 0f) : 0f;
        switch (Kind)
        {
            case BtnKind.Primary:
                bg = !on ? Theme.SurfaceAlt : down ? Theme.AccentPressed : Gfx.Mix(Theme.Accent, Theme.AccentHover, t);
                fg = on ? Color.White : Theme.Muted; break;
            case BtnKind.Secondary:
                bg = !on ? Theme.Surface : down ? Theme.Border : Gfx.Mix(Theme.Surface, Theme.SurfaceAlt, t);
                border = on ? Gfx.Mix(Theme.Border, Theme.Accent, t * 0.7f) : Theme.Border;
                fg = on ? Theme.Text : Theme.Muted; break;
            default:
            {
                var rest = Active ? Theme.AccentSoft : Color.FromArgb(0, Theme.SurfaceAlt);
                var hot = Active ? Theme.AccentSoft : Theme.SurfaceAlt;
                bg = !on ? rest : down ? Theme.Border : Gfx.Mix(rest, hot, t);
                var baseFg = DangerStyle ? Theme.Danger : Theme.Text;
                fg = !on ? Theme.Muted : Active ? Theme.Accent : Gfx.Mix(baseFg, DangerStyle ? Theme.Danger : Theme.Accent, t);
                break;
            }
        }

        var r = new RectangleF(0.5f, 0.5f, Width - 1.5f, Height - 1.5f);
        if (down && on) r.Inflate(-1.2f, -1.2f);
        var radius = Vertical ? 10 : 8;
        if (bg.A > 0) Gfx.FillRound(g, bg, r, radius);
        if (border.A > 0) Gfx.DrawRound(g, border, r, radius);
        if (Focused && ShowFocusCues) Gfx.DrawRound(g, Theme.Accent, RectangleF.Inflate(r, -2, -2), radius - 2);

        var flags = MeasureFlags;
        var iconFont = IconFont;
        var gs = Glyph.Length > 0 ? TextRenderer.MeasureText(Glyph, iconFont, new Size(1000, 1000), flags) : Size.Empty;
        var ts = Text.Length > 0 ? TextRenderer.MeasureText(Text, Font, new Size(1000, 1000), flags) : Size.Empty;
        var chev = DropMenu is not null ? TextRenderer.MeasureText("\uE70D", Theme.Icons(8f), new Size(100, 100), flags) : Size.Empty;
        var lift = (int)Math.Round(-t * Theme.S(1.5f)); // icon floats up slightly on hover

        if (Vertical)
        {
            // the icon always gets the same slot height, whatever font it is drawn in, so every caption lines up
            var gh = Glyph.Length > 0 ? Theme.S(24) : 0;
            var total = gh + (ts.Height > 0 ? 3 + ts.Height : 0);
            var y = (Height - total) / 2 + (gh > 0 ? lift : 0);
            if (gh > 0) { TextRenderer.DrawText(g, Glyph, iconFont, new Rectangle(0, y, Width, gh), fg, flags | TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter); y += gh + 3 - lift; }
            if (ts.Height > 0)
            {
                var tw = Math.Min(Width - 2, ts.Width + (chev.Width > 0 ? chev.Width + 3 : 0));
                TextRenderer.DrawText(g, Text, Font, new Rectangle((Width - tw) / 2, y, Math.Min(ts.Width, Width - 2), ts.Height), fg, flags | TextFormatFlags.EndEllipsis);
                if (chev.Width > 0) TextRenderer.DrawText(g, "\uE70D", Theme.Icons(8f), new Point((Width - tw) / 2 + ts.Width + 3, y + 3), fg, flags);
            }
        }
        else
        {
            var gap = 8;
            var total = gs.Width + (gs.Width > 0 && ts.Width > 0 ? gap : 0) + ts.Width + (chev.Width > 0 ? gap + chev.Width : 0);
            var x = Math.Max(6, (Width - total) / 2);
            if (gs.Width > 0) { TextRenderer.DrawText(g, Glyph, iconFont, new Point(x, (Height - gs.Height) / 2), fg, flags); x += gs.Width + gap; }
            if (ts.Width > 0) { TextRenderer.DrawText(g, Text, Font, new Rectangle(x, (Height - ts.Height) / 2, Math.Min(ts.Width, Math.Max(1, Width - x - 6)), ts.Height), fg, flags | TextFormatFlags.EndEllipsis); x += ts.Width + gap; }
            if (chev.Width > 0) TextRenderer.DrawText(g, "\uE70D", Theme.Icons(8f), new Point(x - 2, (Height - chev.Height) / 2), fg, flags);
        }
    }
}

/// <summary>Panel whose colour follows the theme, with optional hairline borders.</summary>
public class Surface : Panel
{
    public Func<Color> Role { get; set; } = () => Theme.Window;
    public bool BorderTop { get; set; }
    public bool BorderBottom { get; set; }
    public bool BorderLeft { get; set; }
    public bool BorderRight { get; set; }

    public Surface()
    {
        SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
        BackColor = Role();
        Theme.Changed += OnTheme;
    }

    protected override void Dispose(bool disposing) { if (disposing) Theme.Changed -= OnTheme; base.Dispose(disposing); }
    private void OnTheme() { if (IsDisposed) return; BackColor = Role(); Invalidate(); }
    public void UseRole(Func<Color> role) { Role = role; BackColor = role(); }

    protected override void OnPaint(PaintEventArgs e)
    {
        e.Graphics.Clear(BackColor);
        using var pen = new Pen(Theme.Border);
        if (BorderTop) e.Graphics.DrawLine(pen, 0, 0, Width, 0);
        if (BorderBottom) e.Graphics.DrawLine(pen, 0, Height - 1, Width, Height - 1);
        if (BorderLeft) e.Graphics.DrawLine(pen, 0, 0, 0, Height);
        if (BorderRight) e.Graphics.DrawLine(pen, Width - 1, 0, Width - 1, Height);
        base.OnPaint(e);
    }
}

/// <summary>Double-buffered panel (no flicker while its content is resized or re-centred).</summary>
public class ViewPanel : Panel
{
    public ViewPanel() { DoubleBuffered = true; SetStyle(ControlStyles.ResizeRedraw, true); }
}

/// <summary>Theme-aware label.</summary>
public class Txt : Label
{
    public bool Muted { get; set; }
    public Txt(string text = "", float size = 9.5f, FontStyle style = FontStyle.Regular, bool muted = false)
    {
        Text = text; Font = Theme.Ui(size, style); Muted = muted; AutoSize = false; BackColor = Color.Transparent;
        AutoEllipsis = false; UseMnemonic = false;
        ForeColor = muted ? Theme.Muted : Theme.Text;
        Theme.Changed += OnTheme;
    }
    protected override void Dispose(bool disposing) { if (disposing) Theme.Changed -= OnTheme; base.Dispose(disposing); }
    private void OnTheme() { if (!IsDisposed) { ForeColor = Muted ? Theme.Muted : Theme.Text; Invalidate(); } }
}

public sealed class ModernRenderer : ToolStripProfessionalRenderer
{
    public ModernRenderer() : base(new ProfessionalColorTable { UseSystemColors = false }) { RoundedEdges = false; }

    protected override void OnRenderToolStripBackground(ToolStripRenderEventArgs e)
    {
        using var b = new SolidBrush(Theme.Surface); e.Graphics.FillRectangle(b, e.AffectedBounds);
    }
    protected override void OnRenderToolStripBorder(ToolStripRenderEventArgs e)
    {
        var g = e.Graphics; g.SmoothingMode = SmoothingMode.AntiAlias;
        Gfx.DrawRound(g, Theme.Border, new RectangleF(0.5f, 0.5f, e.ToolStrip.Width - 1.5f, e.ToolStrip.Height - 1.5f), Menus.Radius);
    }
    protected override void OnRenderImageMargin(ToolStripRenderEventArgs e) { }

    protected override void OnRenderMenuItemBackground(ToolStripItemRenderEventArgs e)
    {
        var it = e.Item; var g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        var hot = it.Selected && it.Enabled;
        if (hot) Gfx.FillRound(g, Theme.AccentSoft, new RectangleF(1, 1, it.Width - 2, it.Height - 2), 8);
        if (it.Tag is string glyph && glyph.Length > 0)
        {
            var col = !it.Enabled ? Theme.Muted : hot ? Theme.Accent : Gfx.Mix(Theme.Muted, Theme.Text, 0.35f);
            TextRenderer.DrawText(g, glyph, Theme.Icons(11f), new Rectangle(Theme.S(10), 0, Theme.S(26), it.Height), col, hot ? Theme.AccentSoft : Theme.Surface,
                TextFormatFlags.VerticalCenter | TextFormatFlags.HorizontalCenter | TextFormatFlags.NoPadding | TextFormatFlags.NoPrefix | TextFormatFlags.SingleLine);
        }
    }
    protected override void OnRenderSeparator(ToolStripSeparatorRenderEventArgs e)
    {
        using var p = new Pen(Gfx.Mix(Theme.Surface, Theme.Border, 0.8f));
        var y = e.Item.Height / 2;
        e.Graphics.DrawLine(p, 12, y, e.Item.Width - 12, y);
    }
    protected override void OnRenderItemText(ToolStripItemTextRenderEventArgs e)
    {
        var it = e.Item;
        var isShortcut = it is ToolStripMenuItem mi && !string.IsNullOrEmpty(mi.ShortcutKeyDisplayString) && e.Text == mi.ShortcutKeyDisplayString;
        // items built by Menus.Make: the text is placed here (item padding is not reliable), clear of the icon column
        // Every row is centred on its full height (like flex items-center), not on the layout's padded text box.
        if (it is ToolStripMenuItem && it.Tag is string tag)
        {
            if (isShortcut)
                e.TextRectangle = new Rectangle(e.TextRectangle.X, 0, e.TextRectangle.Width, it.Height);
            else
            {
                var left = Menus.TextLeft(tag);
                var shortcutReserve = it is ToolStripMenuItem menuItem && !string.IsNullOrEmpty(menuItem.ShortcutKeyDisplayString)
                    ? TextRenderer.MeasureText(menuItem.ShortcutKeyDisplayString, menuItem.Font, new Size(1000, 100), TextFormatFlags.NoPadding).Width + Theme.S(42)
                    : Theme.S(12);
                // Reserve the shortcut column explicitly; otherwise a long caption such as "Add PDF or image…"
                // can paint underneath Ctrl+O and appears jammed together in the menu.
                e.TextRectangle = new Rectangle(left, 0, Math.Max(10, it.Width - left - shortcutReserve), it.Height);
            }
            e.TextFormat = (isShortcut ? e.TextFormat : TextFormatFlags.Left | TextFormatFlags.EndEllipsis)
                | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPrefix | TextFormatFlags.SingleLine;
        }
        e.TextColor = !it.Enabled || isShortcut ? Theme.Muted : it.Selected ? Theme.Accent : Theme.Text;
        base.OnRenderItemText(e);
    }
}

public static class Menus
{
    public const float Radius = 10f;

    // first match wins: text prefix -> Segoe MDL2 glyph shown in the menu's icon column
    private static readonly (string Prefix, string Glyph)[] AutoGlyphs =
    {
        ("Reset", "\uE777"), ("Rotate", "\uE7AD"), ("Duplicate", "\uE8C8"), ("Delete", "\uE74D"), ("Remove", "\uE74D"),
        ("Add images", "\uE91B"), ("Add image", "\uE91B"), ("Add PDFs", "\uE8A5"), ("Add text", "\uE8D2"), ("Add", "\uE710"), ("Insert", "\uE710"),
        ("PDF \u2192", "\uE8AB"), ("Images \u2192", "\uE8AB"),
        ("Move earlier", "\uE76B"), ("Move later", "\uE76C"), ("Move to the start", "\uE892"), ("Move to the end", "\uE893"),
        ("Reverse", "\uE8CB"), ("Select all", "\uE8B3"), ("Clear selection", "\uE711"),
        ("Edit PDF", "\uE70F"), ("Extract", "\uE74E"), ("Split", "\uE74E"), ("Export", "\uE896"), ("Open result", "\uE8A7"),
        ("Show / hide", "\uE7B3"), ("Use this page", "\uE8C8"), ("Highlight", "\uE7E6"),
        ("Bring to front", "\uE74A"), ("Send to back", "\uE74B"),
    };

    /// <summary>Left edge of the text of a menu row: after the icon column when the row has an icon.</summary>
    public static int TextLeft(string glyph) => Theme.S(glyph.Length > 0 ? 44 : 16);

    private static string GlyphFor(string text)
    {
        foreach (var (prefix, glyph) in AutoGlyphs) if (text.StartsWith(prefix, StringComparison.Ordinal)) return glyph;
        return "";
    }

    /// <summary>Gives a drop-down rounded corners (kept in sync with its size).</summary>
    public static void Round(ToolStripDropDown m)
    {
        void Apply()
        {
            if (m.Width <= 0 || m.Height <= 0) return;
            using var path = Gfx.Round(new RectangleF(0, 0, m.Width, m.Height), Radius);
            var old = m.Region; m.Region = new Region(path); old?.Dispose();
        }
        m.SizeChanged += (_, _) => Apply();
        m.Opening += (_, _) => Apply();
    }

    /// <summary>
    /// Builds a themed drop-down. Use "-" as text for a separator; "Text\tCtrl+X" shows a shortcut hint.
    /// An icon is added automatically from the wording; start the text with "\uE8C8|" to pick a glyph yourself.
    /// </summary>
    public static ContextMenuStrip Make(params (string Text, Action? Click)[] items)
    {
        var m = new ContextMenuStrip
        {
            Renderer = new ModernRenderer(), ShowImageMargin = false, ShowCheckMargin = false, Font = Theme.Ui(10f),
            Padding = new Padding(5), BackColor = Theme.Surface
        };
        var glyphs = items.Select(i => i.Text == "-" ? "" : (i.Text.Length > 2 && i.Text[1] == '|' ? i.Text[..1] : GlyphFor(i.Text))).ToArray();
        var anyGlyph = glyphs.Any(g => g.Length > 0);
        for (var n = 0; n < items.Length; n++)
        {
            var (text, click) = items[n];
            if (text == "-") { m.Items.Add(new ToolStripSeparator { Margin = new Padding(0, 3, 0, 3) }); continue; }
            if (text.Length > 2 && text[1] == '|') text = text[2..];
            var parts = text.Split('\t');
            var it = new ToolStripMenuItem(parts[0])
            {
                Padding = new Padding(10, 7, 14, 7), Tag = glyphs[n], Margin = new Padding(0, 1, 0, 1), ShowShortcutKeys = true
            };
            if (parts.Length > 1) it.ShortcutKeyDisplayString = parts[1];
            if (click is not null) it.Click += (_, _) => click();
            m.Items.Add(it);
        }
        // width: icon column + longest caption + shortcut column + breathing room (rows are stretched to the menu width)
        var w = 0;
        foreach (var mi in m.Items.OfType<ToolStripMenuItem>())
        {
            var tw = TextRenderer.MeasureText(mi.Text, m.Font, new Size(2000, 100), TextFormatFlags.NoPadding | TextFormatFlags.NoPrefix).Width;
            var sw = string.IsNullOrEmpty(mi.ShortcutKeyDisplayString) ? 0
                : TextRenderer.MeasureText(mi.ShortcutKeyDisplayString, m.Font, new Size(2000, 100), TextFormatFlags.NoPadding).Width + Theme.S(36);
            w = Math.Max(w, TextLeft((mi.Tag as string) ?? "") + tw + sw + Theme.S(22));
        }
        m.MinimumSize = new Size(Math.Max(w + m.Padding.Horizontal, Theme.S(210)), 0);
        Round(m);
        return m;
    }
}

/// <summary>
/// Drop-down list (ComboBox) in the app's style: rounded field, accent border while open, and a rounded themed popup
/// instead of the white system list. Behaves like a normal ComboBox (Items, SelectedIndex, SelectedIndexChanged).
/// </summary>
public class ModernCombo : ComboBox
{
    [System.Runtime.InteropServices.DllImport("uxtheme.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode)]
    private static extern int SetWindowTheme(IntPtr hWnd, string? subApp, string? subIdList);

    private bool hover;
    private ToolStripDropDown? popup;
    private long closedAt;

    public ModernCombo()
    {
        SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
        DropDownStyle = ComboBoxStyle.DropDownList; FlatStyle = FlatStyle.Flat; Font = Theme.Ui(9.5f); Cursor = Cursors.Hand;
        Theme.Changed += Repaint;
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing) { Theme.Changed -= Repaint; popup?.Dispose(); popup = null; }
        base.Dispose(disposing);
    }

    private void Repaint() { if (!IsDisposed) Invalidate(); }
    private bool IsOpen => popup is { Visible: true };

    protected override void OnMouseEnter(EventArgs e) { hover = true; base.OnMouseEnter(e); Invalidate(); }
    protected override void OnMouseLeave(EventArgs e) { hover = false; base.OnMouseLeave(e); Invalidate(); }
    protected override void OnGotFocus(EventArgs e) { base.OnGotFocus(e); Invalidate(); }
    protected override void OnLostFocus(EventArgs e) { base.OnLostFocus(e); Invalidate(); }
    protected override void OnSelectedIndexChanged(EventArgs e) { base.OnSelectedIndexChanged(e); Invalidate(); }
    protected override void OnEnabledChanged(EventArgs e) { base.OnEnabledChanged(e); Invalidate(); }

    protected override void OnKeyDown(KeyEventArgs e)
    {
        if (e.KeyCode == Keys.F4 || (e.Alt && (e.KeyCode == Keys.Down || e.KeyCode == Keys.Up)))
        {
            e.Handled = true; e.SuppressKeyPress = true; ToggleDrop(); return;
        }
        base.OnKeyDown(e);
    }

    protected override void WndProc(ref Message m)
    {
        const int WM_LBUTTONDOWN = 0x201, WM_LBUTTONDBLCLK = 0x203;
        if ((m.Msg == WM_LBUTTONDOWN || m.Msg == WM_LBUTTONDBLCLK) && Enabled)
        {
            Focus(); ToggleDrop(); return;          // never show the white system list
        }
        base.WndProc(ref m);
    }

    private Color ParentBack()
    {
        for (var c = Parent; c is not null; c = c.Parent) if (c.BackColor.A == 255) return c.BackColor;
        return Theme.Window;
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.Clear(ParentBack());
        var on = Enabled;
        var r = new RectangleF(0.5f, 0.5f, Width - 1.5f, Height - 1.5f);
        var border = !on ? Theme.Border : IsOpen || Focused ? Theme.Accent : hover ? Gfx.Mix(Theme.Border, Theme.Accent, 0.6f) : Theme.Border;
        Gfx.FillRound(g, on ? (hover || IsOpen ? Gfx.Mix(Theme.Input, Theme.SurfaceAlt, 0.5f) : Theme.Input) : Theme.SurfaceAlt, r, 8);
        Gfx.DrawRound(g, border, r, 8);
        var fg = on ? Theme.Text : Theme.Muted;
        var text = SelectedItem is null ? "" : GetItemText(SelectedItem);
        const TextFormatFlags f = TextFormatFlags.VerticalCenter | TextFormatFlags.Left | TextFormatFlags.EndEllipsis | TextFormatFlags.NoPrefix | TextFormatFlags.NoPadding;
        TextRenderer.DrawText(g, text, Font, new Rectangle(Theme.S(10), 0, Math.Max(10, Width - Theme.S(36)), Height), fg, f);
        TextRenderer.DrawText(g, IsOpen ? "\uE70E" : "\uE70D", Theme.Icons(8f), new Rectangle(Width - Theme.S(26), 0, Theme.S(18), Height),
            on ? (IsOpen || hover ? Theme.Accent : Theme.Muted) : Theme.Muted,
            TextFormatFlags.VerticalCenter | TextFormatFlags.HorizontalCenter | TextFormatFlags.NoPadding);
    }

    private void ToggleDrop()
    {
        if (IsOpen) { popup!.Close(); return; }
        if (Environment.TickCount64 - closedAt < 350) { closedAt = 0; return; }   // this very click just closed the list
        if (Items.Count == 0) return;
        ShowDrop();
    }

    private void ShowDrop()
    {
        popup?.Dispose();
        var rowH = Theme.S(32);
        var lb = new ListBox
        {
            BorderStyle = BorderStyle.None, DrawMode = DrawMode.OwnerDrawFixed, ItemHeight = rowH, IntegralHeight = false,
            BackColor = Theme.Surface, ForeColor = Theme.Text, Font = Font, SelectionMode = SelectionMode.One
        };
        var textW = 0;
        foreach (var it in Items)
        {
            var t = GetItemText(it) ?? string.Empty; lb.Items.Add(t);
            textW = Math.Max(textW, TextRenderer.MeasureText(t, Font, new Size(2000, 100), TextFormatFlags.NoPadding | TextFormatFlags.NoPrefix).Width);
        }
        var visible = Math.Min(lb.Items.Count, Math.Max(8, MaxDropDownItems));
        var needScroll = lb.Items.Count > visible;
        var w = Math.Max(Width - Theme.S(8), textW + Theme.S(56) + (needScroll ? SystemInformation.VerticalScrollBarWidth : 0));
        w = Math.Min(w, Theme.S(560));
        lb.Size = new Size(w, visible * rowH);
        if (SelectedIndex >= 0) { lb.SelectedIndex = SelectedIndex; lb.TopIndex = Math.Max(0, SelectedIndex - visible / 2); }
        lb.HandleCreated += (_, _) => { try { SetWindowTheme(lb.Handle, Theme.Dark ? "DarkMode_Explorer" : "Explorer", null); } catch { } };

        var hot = -1;
        lb.DrawItem += (_, de) =>
        {
            if (de.Index < 0) return;
            var gg = de.Graphics; gg.SmoothingMode = SmoothingMode.AntiAlias;
            using (var bg = new SolidBrush(Theme.Surface)) gg.FillRectangle(bg, de.Bounds);
            var chosen = de.Index == SelectedIndex;
            var row = new RectangleF(de.Bounds.X + 1, de.Bounds.Y + 1, de.Bounds.Width - 2, de.Bounds.Height - 2);
            if (de.Index == hot) Gfx.FillRound(gg, Theme.AccentSoft, row, 8);
            else if (chosen) Gfx.FillRound(gg, Gfx.Mix(Theme.Surface, Theme.AccentSoft, 0.55f), row, 8);
            var col = de.Index == hot || chosen ? Theme.Accent : Theme.Text;
            var tr = new Rectangle(de.Bounds.X + Theme.S(12), de.Bounds.Y, de.Bounds.Width - Theme.S(44), de.Bounds.Height);
            TextRenderer.DrawText(gg, lb.Items[de.Index]?.ToString() ?? "", chosen ? Theme.Ui(Font.Size, FontStyle.Bold) : Font, tr, col,
                TextFormatFlags.VerticalCenter | TextFormatFlags.Left | TextFormatFlags.EndEllipsis | TextFormatFlags.NoPrefix | TextFormatFlags.NoPadding);
            if (chosen)
                TextRenderer.DrawText(gg, "\uE73E", Theme.Icons(10f), new Rectangle(de.Bounds.Right - Theme.S(30), de.Bounds.Y, Theme.S(22), de.Bounds.Height), Theme.Accent,
                    TextFormatFlags.VerticalCenter | TextFormatFlags.HorizontalCenter | TextFormatFlags.NoPadding);
        };
        lb.MouseMove += (_, me) =>
        {
            var i = lb.IndexFromPoint(me.Location);
            if (i != hot) { hot = i; lb.Invalidate(); }
        };
        lb.MouseLeave += (_, _) => { hot = -1; lb.Invalidate(); };
        lb.MouseUp += (_, me) =>
        {
            if (me.Button != MouseButtons.Left) return;
            var i = lb.IndexFromPoint(me.Location);
            if (i < 0) return;
            popup?.Close();
            SelectedIndex = i;
        };

        var host = new ToolStripControlHost(lb) { Margin = Padding.Empty, Padding = Padding.Empty, AutoSize = false, Size = lb.Size };
        var dd = new ToolStripDropDown
        {
            Renderer = new ModernRenderer(), Padding = new Padding(4), BackColor = Theme.Surface, AutoClose = true, DropShadowEnabled = true
        };
        dd.Items.Add(host);
        Round(dd);
        dd.Closing += (_, ce) =>
        {
            if (ce.CloseReason == ToolStripDropDownCloseReason.AppClicked && IsHandleCreated && RectangleToScreen(ClientRectangle).Contains(Cursor.Position))
                closedAt = Environment.TickCount64;
        };
        dd.Closed += (_, _) => { Invalidate(); BeginInvoke(new Action(() => { if (ReferenceEquals(popup, dd)) popup = null; dd.Dispose(); })); };
        popup = dd;
        dd.Show(this, new Point(0, Height + 4));
        Invalidate();
    }

    private static void Round(ToolStripDropDown m) => Menus.Round(m);
}

/// <summary>
/// Theme-aware slider that replaces the native TrackBar (which stays light grey / white in dark mode).
/// Same members the app used on the TrackBar: Minimum, Maximum, Value, SmallChange, LargeChange, ValueChanged.
/// Rounded track with an accent-filled part, round thumb that grows on hover / drag, keyboard and mouse-wheel support.
/// </summary>
public sealed class ModernSlider : Control
{
    private int min, max = 100, val;
    private bool hover, drag;

    public event EventHandler? ValueChanged;
    public int SmallChange { get; set; } = 1;
    public int LargeChange { get; set; } = 10;

    public int Minimum { get => min; set { min = value; if (max < min) max = min; Value = val; Invalidate(); } }
    public int Maximum { get => max; set { max = Math.Max(value, min); Value = val; Invalidate(); } }
    public int Value
    {
        get => val;
        set
        {
            var v = Math.Clamp(value, min, max);
            if (v == val) return;
            val = v; Invalidate(); ValueChanged?.Invoke(this, EventArgs.Empty);
        }
    }

    public ModernSlider()
    {
        SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw | ControlStyles.Selectable, true);
        TabStop = true; Cursor = Cursors.Hand; Height = Theme.S(26); Width = Theme.S(130);
        BackColor = Theme.Surface;                                                // sits on the status bar
        AccessibleRole = AccessibleRole.Slider;
        Theme.Changed += OnTheme;
    }

    protected override void Dispose(bool disposing) { if (disposing) Theme.Changed -= OnTheme; base.Dispose(disposing); }
    private void OnTheme() { if (!IsDisposed) { BackColor = Theme.Surface; Invalidate(); } }

    private float Pad => Theme.S(10);
    private float Fraction => max > min ? (val - min) / (float)(max - min) : 0f;
    private float ThumbX => Pad + Fraction * Math.Max(1, Width - Pad * 2);

    private void SetFromX(int x)
    {
        var f = Math.Clamp((x - Pad) / Math.Max(1f, Width - Pad * 2), 0f, 1f);
        Value = min + (int)Math.Round(f * (max - min));
    }

    protected override void OnMouseEnter(EventArgs e) { hover = true; base.OnMouseEnter(e); Invalidate(); }
    protected override void OnMouseLeave(EventArgs e) { hover = false; base.OnMouseLeave(e); Invalidate(); }
    protected override void OnMouseDown(MouseEventArgs e)
    {
        base.OnMouseDown(e);
        if (e.Button != MouseButtons.Left) return;
        Focus(); drag = true; Capture = true; SetFromX(e.X); Invalidate();
    }
    protected override void OnMouseMove(MouseEventArgs e) { base.OnMouseMove(e); if (drag) SetFromX(e.X); }
    protected override void OnMouseUp(MouseEventArgs e) { base.OnMouseUp(e); if (drag) { drag = false; Capture = false; Invalidate(); } }
    protected override void OnMouseWheel(MouseEventArgs e)
    {
        base.OnMouseWheel(e);
        Value += Math.Sign(e.Delta) * SmallChange;
        if (e is HandledMouseEventArgs h) h.Handled = true;
    }
    protected override void OnGotFocus(EventArgs e) { base.OnGotFocus(e); Invalidate(); }
    protected override void OnLostFocus(EventArgs e) { base.OnLostFocus(e); Invalidate(); }
    protected override bool IsInputKey(Keys keyData) => keyData is Keys.Left or Keys.Right or Keys.Up or Keys.Down or Keys.Home or Keys.End or Keys.PageUp or Keys.PageDown || base.IsInputKey(keyData);
    protected override void OnKeyDown(KeyEventArgs e)
    {
        switch (e.KeyCode)
        {
            case Keys.Left or Keys.Down: Value -= SmallChange; break;
            case Keys.Right or Keys.Up: Value += SmallChange; break;
            case Keys.PageDown: Value -= LargeChange; break;
            case Keys.PageUp: Value += LargeChange; break;
            case Keys.Home: Value = min; break;
            case Keys.End: Value = max; break;
            default: base.OnKeyDown(e); return;
        }
        e.Handled = true;
    }

    protected override void OnEnabledChanged(EventArgs e) { base.OnEnabledChanged(e); Invalidate(); }

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics; g.Clear(Theme.Surface); g.SmoothingMode = SmoothingMode.AntiAlias;
        var cy = Height / 2f; var th = Theme.S(4);
        var x = ThumbX;
        var on = Enabled;
        var track = new RectangleF(Pad, cy - th / 2f, Width - Pad * 2, th);
        Gfx.FillRound(g, Theme.Dark ? Color.FromArgb(70, 76, 90) : Color.FromArgb(206, 211, 222), track, th / 2f);
        var accent = on ? Theme.Accent : Theme.Muted;
        if (x > Pad) Gfx.FillRound(g, accent, new RectangleF(Pad, track.Y, x - Pad, th), th / 2f);

        var r = Theme.S(drag ? 9 : hover ? 8 : 7);
        if (drag || (Focused && ShowFocusCues))                                   // soft halo while dragging / keyboard focus
            using (var halo = new SolidBrush(Color.FromArgb(Theme.Dark ? 70 : 55, accent))) g.FillEllipse(halo, x - r - Theme.S(4), cy - r - Theme.S(4), (r + Theme.S(4)) * 2, (r + Theme.S(4)) * 2);
        using (var shadow = new SolidBrush(Color.FromArgb(Theme.Dark ? 90 : 40, 0, 0, 0))) g.FillEllipse(shadow, x - r, cy - r + Theme.S(1.5f), r * 2, r * 2);
        using (var fill = new SolidBrush(Theme.Dark ? Color.FromArgb(240, 242, 248) : Color.White)) g.FillEllipse(fill, x - r, cy - r, r * 2, r * 2);
        using (var ring = new Pen(accent, Theme.S(2.5f))) g.DrawEllipse(ring, x - r + Theme.S(1.2f), cy - r + Theme.S(1.2f), (r - Theme.S(1.2f)) * 2, (r - Theme.S(1.2f)) * 2);
    }
}
