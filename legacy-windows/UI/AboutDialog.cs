using PdfStudio.Services;
using System.Drawing.Drawing2D;

namespace PdfStudio.UI;

/// <summary>Application identity shown in the About window, footer and file properties.</summary>
public static class AppInfo
{
    public const string Name = "PDF Studio";
    public const string Developer = "Jessie Albert Regualos";
    public const string DeveloperRole = "IT Specialist - Mindanao";
    public static string Version
    {
        get
        {
            var v = typeof(AppInfo).Assembly.GetName().Version;
            return v is null ? "2.1.0" : $"{v.Major}.{v.Minor}.{v.Build}";
        }
    }

    /// <summary>Release date of the running version, from the version history; null if that version has no entry.</summary>
    public static DateOnly? ReleaseDate => ChangeLog.Find(Version)?.Date;

    /// <summary>"Version 2.5.1  ·  October 5, 2026" (the date is left out when the version has no history entry).</summary>
    public static string VersionLine => ReleaseDate is { } d
        ? $"Version {Version}  \u00B7  {ChangeLog.FormatDate(d)}"
        : $"Version {Version}";
}

/// <summary>
/// About window: what the app is, what it can do, what it detected on this PC, and who built it.
/// The body is laid out by measuring, so the window is always exactly tall enough (and scrolls on very small screens).
/// </summary>
public sealed class AboutDialog : Form
{
    private readonly AboutCanvas canvas;
    private readonly ViewPanel host = new() { Dock = DockStyle.Fill, AutoScroll = true };
    public bool OpenHelpRequested { get; private set; }
    public bool OpenChangelogRequested { get; private set; }
    public bool CheckUpdatesRequested { get; private set; }

    private static int S(int v) => Theme.S(v);

    public AboutDialog()
    {
        AutoScaleMode = AutoScaleMode.None;          // sizes are scaled once with Theme.S
        Text = "About PDF Studio";
        Font = Theme.Ui();
        FormBorderStyle = FormBorderStyle.FixedDialog; StartPosition = FormStartPosition.CenterParent;
        MaximizeBox = false; MinimizeBox = false; ShowInTaskbar = false; KeyPreview = true;
        BackColor = Theme.Surface; Opacity = 0;

        canvas = new AboutCanvas { Dock = DockStyle.Top };
        host.BackColor = Theme.Surface;
        host.Controls.Add(canvas);

        // footer: version on the left, buttons always fully visible on the right
        var footer = new Surface { Dock = DockStyle.Bottom, Height = S(72), Padding = new Padding(S(28), 0, S(28), 0), BorderTop = true };
        footer.UseRole(() => Theme.Surface);
        var note = new Txt(AppInfo.VersionLine, 9f, FontStyle.Regular, true) { Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleLeft, AutoEllipsis = true, Margin = new Padding(0) };
        var whatsNew = new FlatButton { Text = "What's new", Glyph = "\uE81C", Kind = BtnKind.Secondary, Height = S(40), AutoWidth = true, MinWidth = 130, Margin = new Padding(S(4), 0, 0, 0), Anchor = AnchorStyles.None };
        var help = new FlatButton { Text = "Open help guide", Glyph = "\uE897", Kind = BtnKind.Secondary, Height = S(40), AutoWidth = true, MinWidth = 150, Margin = new Padding(S(4), 0, 0, 0), Anchor = AnchorStyles.None };
        var updates = new FlatButton { Text = "Check for updates", Glyph = "\uE895", Kind = BtnKind.Secondary, Height = S(40), AutoWidth = true, MinWidth = 170, Margin = new Padding(S(4), 0, 0, 0), Anchor = AnchorStyles.None };
        var close = new FlatButton { Text = "Close", Kind = BtnKind.Primary, Height = S(40), AutoWidth = true, MinWidth = 104, Margin = new Padding(S(8), 0, 0, 0), Anchor = AnchorStyles.None, DialogResult = DialogResult.OK };
        whatsNew.FitNow(); help.FitNow(); updates.FitNow(); close.FitNow();
        whatsNew.Click += (_, _) => { OpenChangelogRequested = true; Close(); };
        help.Click += (_, _) => { OpenHelpRequested = true; Close(); };
        updates.Click += (_, _) => { CheckUpdatesRequested = true; Close(); };
        var row = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 5, RowCount = 1, BackColor = Color.Transparent, Margin = new Padding(0) };
        row.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        row.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        row.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        row.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        row.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        row.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        row.Controls.Add(note, 0, 0); row.Controls.Add(whatsNew, 1, 0); row.Controls.Add(help, 2, 0); row.Controls.Add(updates, 3, 0); row.Controls.Add(close, 4, 0);
        footer.Controls.Add(row);
        AcceptButton = close; CancelButton = close;

        Controls.Add(host); Controls.Add(footer);

        var wa = Screen.FromPoint(Cursor.Position).WorkingArea;
        var w = Math.Min(S(800), wa.Width - S(40));
        canvas.Width = w;
        var bodyH = canvas.MeasureHeight(w);
        canvas.Height = bodyH;
        var total = bodyH + footer.Height;
        ClientSize = new Size(w, Math.Min(total, wa.Height - S(60)));
        host.AutoScrollMinSize = new Size(0, bodyH);

        Shown += (_, _) => { FlatButton.FitTree(this); ModernDialog.FadeIn(this); };
        Theme.Changed += OnTheme;
    }

    private void OnTheme() { if (!IsDisposed) { BackColor = Theme.Surface; host.BackColor = Theme.Surface; Invalidate(true); } }
    protected override void Dispose(bool disposing) { if (disposing) Theme.Changed -= OnTheme; base.Dispose(disposing); }

    private sealed class AboutCanvas : Control
    {
        private readonly System.Windows.Forms.Timer drift = new() { Interval = 33 };
        private float phase;

        private const string Blurb =
            "PDF Studio is a fast, offline desktop toolkit for working with PDF pages. Drop in PDFs and pictures, " +
            "rearrange pages visually with drag and drop, then export one clean document — or split, convert, stamp, protect and " +
            "compress it. Everything runs on your own PC; your files are never uploaded anywhere. The app only reports usage " +
            "statistics (how often and how long it is opened, with this PC's name and network address) and the reviews you choose to send.";

        private static readonly (string Glyph, string Text)[] Chips =
        {
            ("\uE8C8", "Merge & reorder pages"), ("\uE8C6", "Split & extract"), ("\uE8D2", "Text & image overlays"),
            ("\uE8AB", "PDF ⇄ Word & images"), ("\uE72E", "Password & compression"), ("\uE790", "Light & dark themes")
        };

        private const TextFormatFlags Base = TextFormatFlags.NoPadding | TextFormatFlags.NoPrefix;

        public AboutCanvas()
        {
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
            drift.Tick += (_, _) => { phase += 0.018f; Invalidate(new Rectangle(0, 0, Width, S(170))); };
            drift.Start();
        }

        protected override void Dispose(bool disposing) { if (disposing) drift.Dispose(); base.Dispose(disposing); }

        public int MeasureHeight(int width)
        {
            using var g = CreateGraphics();
            return DoLayout(g, width, false);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            e.Graphics.Clear(Theme.Surface);
            DoLayout(e.Graphics, Width, true);
        }

        /// <summary>One routine both measures and paints, so the two can never disagree. Returns the total height.</summary>
        private int DoLayout(Graphics g, int width, bool draw)
        {
            var margin = S(32);
            var x = margin; var w = width - margin * 2;
            var gap = S(12);

            // ── banner ──
            var bannerH = S(160);
            if (draw)
            {
                var banner = new Rectangle(0, 0, width, bannerH);
                using (var grad = new LinearGradientBrush(banner, Color.FromArgb(67, 56, 202), Color.FromArgb(139, 92, 246), 18f))
                    g.FillRectangle(grad, banner);
                var st = g.Save();
                g.SetClip(banner);
                using (var b1 = new SolidBrush(Color.FromArgb(34, 255, 255, 255)))
                using (var b2 = new SolidBrush(Color.FromArgb(22, 255, 255, 255)))
                {
                    var dx = (float)Math.Sin(phase) * S(40); var dy = (float)Math.Cos(phase * 0.8f) * S(14);
                    g.FillEllipse(b1, width - S(240) + dx, -S(90) + dy, S(320), S(320));
                    g.FillEllipse(b2, S(300) - dx, S(60) - dy, S(220), S(220));
                }
                g.Restore(st);

                var tile = new RectangleF(margin, (bannerH - S(88)) / 2f, S(88), S(88));
                Gfx.FillRound(g, Color.White, tile, S(20));
                TextRenderer.DrawText(g, "\uE8A5", Theme.Icons(34f), Rectangle.Round(tile), Theme.Accent, Base | TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter);
                var tx = margin + S(88) + S(24);
                TextRenderer.DrawText(g, AppInfo.Name, Theme.Ui(28f, FontStyle.Bold), new Rectangle(tx, S(36), width - tx - margin, S(48)), Color.White, Base | TextFormatFlags.EndEllipsis | TextFormatFlags.SingleLine);

                // version pill + tagline
                var pillText = $"Version {AppInfo.Version}";
                var pw = TextRenderer.MeasureText(g, pillText, Theme.Ui(9f, FontStyle.Bold), new Size(1000, 100), Base).Width + S(24);
                var pill = new RectangleF(tx, S(92), pw, S(26));
                Gfx.FillRound(g, Color.FromArgb(55, 255, 255, 255), pill, S(13));
                TextRenderer.DrawText(g, pillText, Theme.Ui(9f, FontStyle.Bold), Rectangle.Round(pill), Color.White, Base | TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter);
                TextRenderer.DrawText(g, "Merge · Reorder · Edit · Convert", Theme.Ui(10f), new Rectangle((int)pill.Right + S(12), (int)pill.Y, Math.Max(10, width - (int)pill.Right - S(12) - margin), (int)pill.Height),
                    Color.FromArgb(230, 255, 255, 255), Base | TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis | TextFormatFlags.SingleLine);
            }
            var y = bannerH + S(26);

            // ── what is it ──
            if (draw) TextRenderer.DrawText(g, "What is PDF Studio?", Theme.Ui(12f, FontStyle.Bold), new Rectangle(x, y, w, S(26)), Theme.Text, Base | TextFormatFlags.SingleLine);
            y += S(32);
            var blurbFont = Theme.Ui(10f);
            var ph = TextRenderer.MeasureText(g, Blurb, blurbFont, new Size(w, 0), Base | TextFormatFlags.WordBreak).Height;
            if (draw) TextRenderer.DrawText(g, Blurb, blurbFont, new Rectangle(x, y, w, ph + S(4)), Theme.Muted, Base | TextFormatFlags.WordBreak);
            y += ph + S(22);

            // ── feature chips: use as many columns as still show every caption in full ──
            var chipFont = Theme.Ui(9f, FontStyle.Bold);
            var longest = Chips.Max(c => TextRenderer.MeasureText(g, c.Text, chipFont, new Size(1000, 100), Base).Width);
            var cols = 3;
            while (cols > 1 && (w - gap * (cols - 1)) / cols < longest + S(56)) cols--;
            var cw = (w - gap * (cols - 1)) / cols; var ch = S(44);
            for (var i = 0; i < Chips.Length; i++)
            {
                var r = new Rectangle(x + (i % cols) * (cw + gap), y + (i / cols) * (ch + gap), cw, ch);
                if (!draw) continue;
                Gfx.FillRound(g, Theme.AccentSoft, r, S(10));
                TextRenderer.DrawText(g, Chips[i].Glyph, Theme.Icons(11f), new Rectangle(r.X + S(14), r.Y, S(24), r.Height), Theme.Accent, Base | TextFormatFlags.VerticalCenter);
                TextRenderer.DrawText(g, Chips[i].Text, chipFont, new Rectangle(r.X + S(44), r.Y, r.Width - S(50), r.Height), Theme.Text, Base | TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis | TextFormatFlags.SingleLine);
            }
            var rows = (Chips.Length + cols - 1) / cols;
            y += rows * ch + (rows - 1) * gap + S(28);

            // ── detected tools ──
            if (draw) TextRenderer.DrawText(g, "On this PC", Theme.Ui(12f, FontStyle.Bold), new Rectangle(x, y, w, S(26)), Theme.Text, Base | TextFormatFlags.SingleLine);
            y += S(34);
            y = ToolRow(g, draw, x, y, w, "PDF → Word", "Built in", true);
            y = ToolRow(g, draw, x, y, w, "PDF compression", "Built in", true);
            y += S(18);

            // ── developer card ──
            var cardH = S(96);
            if (draw)
            {
                var card = new RectangleF(x, y, w, cardH);
                Gfx.FillRound(g, Theme.Input, card, S(14));
                Gfx.DrawRound(g, Theme.Border, new RectangleF(card.X + 0.5f, card.Y + 0.5f, card.Width - 1, card.Height - 1), S(14));
                var av = new RectangleF(card.X + S(20), card.Y + (cardH - S(60)) / 2f, S(60), S(60));
                using (var ab = new LinearGradientBrush(av, Color.FromArgb(79, 70, 229), Color.FromArgb(168, 85, 247), 45f))
                    g.FillEllipse(ab, av);
                TextRenderer.DrawText(g, "JR", Theme.Ui(17f, FontStyle.Bold), Rectangle.Round(av), Color.White, Base | TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter);
                var tx = (int)card.X + S(100);
                var tw = Math.Max(20, (int)card.Right - tx - S(20));
                TextRenderer.DrawText(g, "DEVELOPED BY", Theme.Ui(8f, FontStyle.Bold), new Rectangle(tx, (int)card.Y + S(16), tw, S(16)), Theme.Muted, Base | TextFormatFlags.SingleLine);
                TextRenderer.DrawText(g, AppInfo.Developer, Theme.Ui(15f, FontStyle.Bold), new Rectangle(tx, (int)card.Y + S(34), tw, S(28)), Theme.Text, Base | TextFormatFlags.SingleLine | TextFormatFlags.EndEllipsis);
                TextRenderer.DrawText(g, AppInfo.DeveloperRole, Theme.Ui(10f), new Rectangle(tx, (int)card.Y + S(64), tw, S(20)), Theme.Accent, Base | TextFormatFlags.SingleLine | TextFormatFlags.EndEllipsis);
            }
            y += cardH + S(14);

            // ── credits line ──
            var credit = "Built with .NET 8, PDFsharp and PDFium";
            if (draw) TextRenderer.DrawText(g, credit, Theme.Ui(8.75f), new Rectangle(x, y, w, S(20)), Theme.Muted, Base | TextFormatFlags.SingleLine | TextFormatFlags.EndEllipsis);
            y += S(20) + S(24);
            return y;
        }

        /// <summary>A row with a status dot, the feature name and a coloured status pill that always fits.</summary>
        private static int ToolRow(Graphics g, bool draw, int x, int y, int w, string label, string value, bool ok)
        {
            var h = S(44);
            if (draw)
            {
                var r = new RectangleF(x, y, w, h);
                Gfx.FillRound(g, Theme.Input, r, S(10));
                using (var b = new SolidBrush(ok ? Theme.Success : Theme.Muted)) g.FillEllipse(b, x + S(16), y + (h - S(10)) / 2f, S(10), S(10));
                var lf = Theme.Ui(9.5f, FontStyle.Bold); var vf = Theme.Ui(9.25f);
                var vw = TextRenderer.MeasureText(g, value, vf, new Size(1000, 100), Base).Width;
                var vr = new Rectangle(x + w - S(16) - Math.Min(vw, w / 2), y, Math.Min(vw, w / 2), h);
                TextRenderer.DrawText(g, label, lf, new Rectangle(x + S(38), y, Math.Max(10, vr.X - x - S(46)), h), Theme.Text, Base | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine | TextFormatFlags.EndEllipsis);
                TextRenderer.DrawText(g, value, vf, vr, ok ? Theme.Success : Theme.Muted, Base | TextFormatFlags.VerticalCenter | TextFormatFlags.Right | TextFormatFlags.SingleLine | TextFormatFlags.EndEllipsis);
            }
            return y + h + S(8);
        }
    }
}
