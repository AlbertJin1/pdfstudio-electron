using PdfStudio.Services;
using System.Drawing.Drawing2D;

namespace PdfStudio.UI;

/// <summary>Searchable, detailed user guide with a topic list on the left and formatted content on the right.</summary>
public sealed class HelpDialog : Form
{
    // ───────────────────────── window ─────────────────────────

    private static int S(int v) => Theme.S(v);
    private static Padding P(int l, int t, int r, int b) => new(S(l), S(t), S(r), S(b));

    private readonly SearchBox search = new();
    private readonly ViewPanel navList = new() { Dock = DockStyle.Fill, AutoScroll = true };
    private readonly Txt navCaption = new("TOPICS", 8f, FontStyle.Bold, true) { Dock = DockStyle.Top, TextAlign = ContentAlignment.MiddleLeft };
    private readonly GuideView guide = new() { Dock = DockStyle.Fill };
    private readonly Surface contentHost = new();
    private readonly Surface nav = new();
    private readonly List<HelpTopic> shown = new();
    private readonly List<NavItem> items = new();
    private readonly FlatButton prevBtn = new(), nextBtn = new();
    private HelpTopic? current;

    public HelpDialog(string? startTopic = null)
    {
        // Sizes are written in design pixels and scaled once with Theme.S, so no second automatic scaling happens.
        AutoScaleMode = AutoScaleMode.None;
        Text = "PDF Studio — Help & user guide";
        Font = Theme.Ui();
        StartPosition = FormStartPosition.CenterParent; ShowInTaskbar = false; KeyPreview = true;
        var wa = Screen.FromPoint(Cursor.Position).WorkingArea;
        ClientSize = new Size(Math.Min(S(1080), wa.Width - S(40)), Math.Min(S(740), wa.Height - S(60)));
        MinimumSize = new Size(Math.Min(S(800), wa.Width), Math.Min(S(560), wa.Height));
        BackColor = Theme.Surface; Opacity = 0;

        // ── header: title block on the left, search on the right ──
        var header = new Surface { Dock = DockStyle.Top, Height = S(80), Padding = P(28, 0, 28, 0), BorderBottom = true };
        header.UseRole(() => Theme.Surface);
        var badge = new Txt("\uE897", 14f) { Font = new Font("Segoe MDL2 Assets", 15f, FontStyle.Regular, GraphicsUnit.Point), ForeColor = Theme.Accent, AutoSize = true, Margin = P(0, 0, 14, 0), Anchor = AnchorStyles.None };
        Theme.Changed += () => { if (!IsDisposed) badge.ForeColor = Theme.Accent; };
        var title = new Txt("Help & user guide", 15f, FontStyle.Bold) { AutoSize = true, Margin = new Padding(0), Anchor = AnchorStyles.Left };
        var sub = new Txt("Answers, shortcuts and tips for every feature", 9f, FontStyle.Regular, true) { AutoSize = true, Margin = P(0, 2, 0, 0), Anchor = AnchorStyles.Left };
        var titleBlock = new TableLayoutPanel { AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink, ColumnCount = 1, RowCount = 2, BackColor = Color.Transparent, Margin = new Padding(0), Anchor = AnchorStyles.Left };
        titleBlock.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        titleBlock.RowStyles.Add(new RowStyle(SizeType.AutoSize)); titleBlock.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        titleBlock.Controls.Add(title, 0, 0); titleBlock.Controls.Add(sub, 0, 1);
        search.Width = S(340); search.Height = S(42); search.Anchor = AnchorStyles.None; search.Margin = new Padding(0);
        var headRow = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 4, RowCount = 1, BackColor = Color.Transparent, Margin = new Padding(0) };
        headRow.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        headRow.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        headRow.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        headRow.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, S(340)));
        headRow.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        headRow.Controls.Add(badge, 0, 0); headRow.Controls.Add(titleBlock, 1, 0); headRow.Controls.Add(search, 3, 0);
        header.Controls.Add(headRow);

        // ── topic list (left) ──
        nav.Dock = DockStyle.Left; nav.Width = S(290); nav.Padding = P(12, 12, 8, 12); nav.BorderRight = true;
        nav.UseRole(() => Theme.SurfaceAlt);
        navCaption.Height = S(28); navCaption.Padding = P(10, 0, 0, 0);
        navList.BackColor = Theme.SurfaceAlt;
        Theme.Changed += () => { if (!IsDisposed) navList.BackColor = Theme.SurfaceAlt; };
        nav.Controls.Add(navList); nav.Controls.Add(navCaption);

        // ── content (right) ──
        contentHost.Dock = DockStyle.Fill; contentHost.Padding = new Padding(0);
        contentHost.UseRole(() => Theme.Surface);
        contentHost.Controls.Add(guide);

        // ── footer: credit on the left, Previous / Next on the right (laid out by hand so nothing can collapse) ──
        var footer = new Surface { Dock = DockStyle.Bottom, Height = S(72), Padding = P(28, 0, 28, 0), BorderTop = true };
        footer.UseRole(() => Theme.Surface);
        var credit = new Txt($"Developed by {AppInfo.Developer}  ·  {AppInfo.DeveloperRole}", 9f, FontStyle.Regular, true) { TextAlign = ContentAlignment.MiddleLeft, AutoEllipsis = true, Margin = new Padding(0) };
        void Setup(FlatButton b, string text, string glyph, int minW)
        {
            b.Text = text; b.Glyph = glyph; b.Kind = BtnKind.Secondary; b.Height = S(40); b.AutoWidth = true; b.MinWidth = minW;
            b.Anchor = AnchorStyles.None; b.TabStop = true;
        }
        Setup(prevBtn, "Previous", "\uE76B", 108);
        Setup(nextBtn, "Next", "\uE76C", 96);
        prevBtn.Click += (_, _) => Step(-1);
        nextBtn.Click += (_, _) => Step(+1);
        footer.Controls.Add(credit); footer.Controls.Add(prevBtn); footer.Controls.Add(nextBtn);
        void LayoutFooter()
        {
            prevBtn.FitNow(); nextBtn.FitNow();
            var y = (footer.ClientSize.Height - prevBtn.Height) / 2;
            var right = footer.ClientSize.Width - footer.Padding.Right;
            nextBtn.Location = new Point(right - nextBtn.Width, y);
            prevBtn.Location = new Point(nextBtn.Left - S(10) - prevBtn.Width, y);
            credit.SetBounds(footer.Padding.Left, 0, Math.Max(40, prevBtn.Left - S(16) - footer.Padding.Left), footer.ClientSize.Height);
        }
        footer.Resize += (_, _) => LayoutFooter();
        footer.Layout += (_, _) => LayoutFooter();
        prevBtn.SizeChanged += (_, _) => LayoutFooter();
        nextBtn.SizeChanged += (_, _) => LayoutFooter();

        Controls.Add(contentHost); Controls.Add(nav); Controls.Add(footer); Controls.Add(header);

        search.TextChangedX += () => Filter();
        Theme.Changed += OnTheme;
        Load += (_, _) => { ApplyTheme(); Filter(startTopic); };
        Shown += (_, _) => { FlatButton.FitTree(this); ModernDialog.FadeIn(this); };
        Resize += (_, _) => { nav.Width = ClientSize.Width < S(920) ? S(236) : S(290); };
        KeyDown += (_, e) =>
        {
            if (e.Control && e.KeyCode == Keys.F) { search.Focus(); search.SelectAll(); e.SuppressKeyPress = true; }
            else if (e.Control && e.KeyCode == Keys.PageDown) { Step(+1); e.SuppressKeyPress = true; }
            else if (e.Control && e.KeyCode == Keys.PageUp) { Step(-1); e.SuppressKeyPress = true; }
            else if (e.Alt && e.KeyCode == Keys.Right) { Step(+1); e.SuppressKeyPress = true; }
            else if (e.Alt && e.KeyCode == Keys.Left) { Step(-1); e.SuppressKeyPress = true; }
            else if (e.KeyCode == Keys.Escape) { Close(); e.SuppressKeyPress = true; }
        };
    }

    private void OnTheme() { if (IsDisposed) return; BackColor = Theme.Surface; ApplyTheme(); foreach (var it in items) it.Invalidate(); guide.RefreshTheme(); }
    protected override void Dispose(bool disposing) { if (disposing) Theme.Changed -= OnTheme; base.Dispose(disposing); }

    private void ApplyTheme()
    {
        guide.RefreshTheme();
        search.ApplyTheme();
    }

    /// <summary>Jumps to a topic by (part of) its title, clearing any active search so the topic is always listed.</summary>
    public void OpenTopic(string title)
    {
        search.Clear();   // re-filters by itself when a search was active
        var t = shown.FirstOrDefault(x => x.Title.Contains(title, StringComparison.OrdinalIgnoreCase));
        if (t is not null) Select(t);
    }

    private void Step(int dir)
    {
        if (shown.Count == 0 || current is null) return;
        var i = shown.IndexOf(current) + dir;
        if (i >= 0 && i < shown.Count) Select(shown[i]);
    }

    private void Filter(string? preferTitle = null)
    {
        var q = search.Value.Trim();
        shown.Clear();
        foreach (var t in HelpContent.All)
            if (q.Length == 0 || t.Title.Contains(q, StringComparison.OrdinalIgnoreCase) || t.Body.Contains(q, StringComparison.OrdinalIgnoreCase))
                shown.Add(t);

        navList.SuspendLayout();
        foreach (var it in items) { navList.Controls.Remove(it); it.Dispose(); }
        items.Clear();
        foreach (var t in shown)
        {
            var it = new NavItem(t.Glyph, t.Title) { Dock = DockStyle.Top, Height = S(44), Tag = t };
            it.Clicked += () => Select(t);
            items.Add(it);
        }
        for (var i = items.Count - 1; i >= 0; i--) navList.Controls.Add(items[i]);   // Dock.Top stacks last-added first
        navList.ResumeLayout(true);
        navCaption.Text = q.Length == 0 ? $"TOPICS  ·  {shown.Count}" : $"{shown.Count} MATCHING TOPIC{(shown.Count == 1 ? "" : "S")}";

        if (shown.Count == 0)
        {
            current = null;
            guide.ShowEmpty($"No topics match “{q}”.\nTry a shorter word such as rotate, export or password.");
            UpdateStepButtons();
            return;
        }
        var idx = preferTitle is null ? 0 : Math.Max(0, shown.FindIndex(t => t.Title.Contains(preferTitle, StringComparison.OrdinalIgnoreCase)));
        Select(shown[idx]);
    }

    private void Select(HelpTopic t)
    {
        foreach (var it in items) it.Selected = ReferenceEquals(it.Tag, t);
        var sel = items.FirstOrDefault(i => i.Selected);
        if (sel is not null) navList.ScrollControlIntoView(sel);
        current = t;
        guide.ShowTopic(t, shown.IndexOf(t), shown.Count, search.Value);
        UpdateStepButtons();
    }

    private void UpdateStepButtons()
    {
        var i = current is null ? -1 : shown.IndexOf(current);
        prevBtn.Enabled = i > 0;
        nextBtn.Enabled = i >= 0 && i < shown.Count - 1;
        prevBtn.Invalidate(); nextBtn.Invalidate();
    }

    // ───────────────────────── custom controls ─────────────────────────

    /// <summary>One row of the topic list: icon + title, hover and selected states, no native ListBox.</summary>
    private sealed class NavItem : Control
    {
        private readonly string glyph, title;
        private bool hover;
        private bool selected;
        public event Action? Clicked;
        public bool Selected { get => selected; set { if (selected != value) { selected = value; Invalidate(); } } }

        public NavItem(string glyph, string title)
        {
            this.glyph = glyph; this.title = title;
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
            Cursor = Cursors.Hand; TabStop = false;
        }

        protected override void OnMouseEnter(EventArgs e) { hover = true; base.OnMouseEnter(e); Invalidate(); }
        protected override void OnMouseLeave(EventArgs e) { hover = false; base.OnMouseLeave(e); Invalidate(); }
        protected override void OnClick(EventArgs e) { base.OnClick(e); Clicked?.Invoke(); }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics; g.SmoothingMode = SmoothingMode.AntiAlias;
            g.Clear(Theme.SurfaceAlt);
            var r = new RectangleF(S(2), S(2), Width - S(6), Height - S(4));
            if (selected) Gfx.FillRound(g, Theme.AccentSoft, r, S(9));
            else if (hover) Gfx.FillRound(g, Gfx.Mix(Theme.SurfaceAlt, Theme.Border, 0.55f), r, S(9));
            if (selected)
                Gfx.FillRound(g, Theme.Accent, new RectangleF(r.X + S(1), r.Y + S(9), S(3), r.Height - S(18)), 1.5f);

            var flags = TextFormatFlags.NoPadding | TextFormatFlags.NoPrefix | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine | TextFormatFlags.EndEllipsis;
            var fg = selected ? Theme.Accent : Theme.Text;
            TextRenderer.DrawText(g, glyph, Theme.Icons(11f), new Rectangle(S(16), 0, S(26), Height), selected ? Theme.Accent : Theme.Muted, flags);
            TextRenderer.DrawText(g, title, Theme.Ui(9.75f, selected ? FontStyle.Bold : FontStyle.Regular), new Rectangle(S(50), 0, Math.Max(10, Width - S(60)), Height), fg, flags);
        }
    }

    /// <summary>Rounded search field with a magnifier and a clear (×) button.</summary>
    private sealed class SearchBox : Control
    {
        protected override void OnPaintBackground(PaintEventArgs e) { e.Graphics.Clear(Theme.Surface); }
        private readonly TextBox box = new() { BorderStyle = BorderStyle.None };
        private bool focused, hoverClear;
        public event Action? TextChangedX;
        public string Value => box.Text;

        public SearchBox()
        {
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
            box.Font = Theme.Ui(10f); box.PlaceholderText = "Search the guide…  (Ctrl+F)";
            box.GotFocus += (_, _) => { focused = true; Invalidate(); };
            box.LostFocus += (_, _) => { focused = false; Invalidate(); };
            box.TextChanged += (_, _) => { Invalidate(); TextChangedX?.Invoke(); };
            box.KeyDown += (_, e) => { if (e.KeyCode == Keys.Escape && box.Text.Length > 0) { box.Clear(); e.SuppressKeyPress = true; e.Handled = true; } };
            Controls.Add(box);
            ApplyTheme();
        }

        public void ApplyTheme() { box.BackColor = Theme.Input; box.ForeColor = Theme.Text; Invalidate(); }
        public new void Focus() => box.Focus();
        public void SelectAll() => box.SelectAll();
        public void Clear() => box.Clear();

        private Rectangle ClearRect => new(Width - S(38), (Height - S(28)) / 2, S(28), S(28));

        protected override void OnLayout(LayoutEventArgs e)
        {
            base.OnLayout(e);
            var h = box.PreferredHeight;
            box.SetBounds(S(42), Math.Max(0, (Height - h) / 2), Math.Max(20, Width - S(42) - S(44)), h);
        }

        protected override void OnMouseMove(MouseEventArgs e) { var h = box.Text.Length > 0 && ClearRect.Contains(e.Location); if (h != hoverClear) { hoverClear = h; Cursor = h ? Cursors.Hand : Cursors.IBeam; Invalidate(); } base.OnMouseMove(e); }
        protected override void OnMouseLeave(EventArgs e) { hoverClear = false; Invalidate(); base.OnMouseLeave(e); }
        protected override void OnMouseDown(MouseEventArgs e)
        {
            base.OnMouseDown(e);
            if (box.Text.Length > 0 && ClearRect.Contains(e.Location)) box.Clear();
            box.Focus();
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics; g.SmoothingMode = SmoothingMode.AntiAlias;
            g.Clear(Theme.Surface);
            var r = new RectangleF(0.5f, 0.5f, Width - 1.5f, Height - 1.5f);
            Gfx.FillRound(g, Theme.Input, r, S(10));
            Gfx.DrawRound(g, focused ? Theme.Accent : Theme.Border, r, S(10), focused ? 1.6f : 1f);
            var flags = TextFormatFlags.NoPadding | TextFormatFlags.NoPrefix | TextFormatFlags.VerticalCenter | TextFormatFlags.HorizontalCenter | TextFormatFlags.SingleLine;
            TextRenderer.DrawText(g, "\uE721", Theme.Icons(11f), new Rectangle(S(8), 0, S(30), Height), focused ? Theme.Accent : Theme.Muted, flags);
            if (box.Text.Length > 0)
            {
                var cr = ClearRect;
                if (hoverClear) Gfx.FillRound(g, Theme.SurfaceAlt, cr, S(8));
                TextRenderer.DrawText(g, "\uE711", Theme.Icons(9f), cr, hoverClear ? Theme.Text : Theme.Muted, flags);
            }
        }
    }
}
