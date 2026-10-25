using System.Drawing.Drawing2D;
using System.Drawing.Text;

namespace PdfStudio.UI;

/// <summary>One group of release notes (Added / Changed / Fixed ...).</summary>
public sealed record NoteSection(string Title, List<NoteItem> Items);

/// <summary>One bullet. Lead is the short bold headline in front of the first colon (may be empty).</summary>
public sealed record NoteItem(string Lead, string Text);

/// <summary>Parsed release notes of the update window: an optional one-line summary and the grouped changes.</summary>
public sealed class UpdateNotes
{
    public string Summary { get; init; } = "";
    public List<NoteSection> Sections { get; init; } = new();
    public int Count => Sections.Sum(s => s.Items.Count);

    private static readonly string[] Known = { "added", "new", "changed", "improved", "fixed", "removed", "deprecated", "security", "performance" };

    private static string Clean(string s)
    {
        s = System.Text.RegularExpressions.Regex.Replace(s, @"\[([^\]]+)\]\([^)]*\)", "$1");
        return s.Replace("**", "").Replace("`", "").Replace('\t', ' ').Trim();
    }

    /// <summary>
    /// Reads the notes the monitor sends. Understands the plain format written by publish_to_monitor.ps1
    /// (summary line, ADDED / CHANGED / FIXED headings, "• " bullets) and raw Markdown ("### Added", "- item").
    /// </summary>
    public static UpdateNotes Parse(string? raw)
    {
        var sections = new List<NoteSection>();
        var summary = new List<string>();
        NoteSection? cur = null;
        string? pending = null;                                   // bullet text still being continued on the next line

        NoteSection AddSection(string title) { var s = new NoteSection(title, new()); sections.Add(s); return s; }
        void Flush()
        {
            if (pending == null) return;
            cur ??= AddSection("What's new");
            var t = pending.Trim(); pending = null;
            var lead = ""; var colon = t.IndexOf(": ", StringComparison.Ordinal);
            if (colon is > 2 and <= 40 && !t[..colon].Contains('.')) { lead = t[..colon].Trim(); t = t[(colon + 2)..].Trim(); }
            cur.Items.Add(new NoteItem(lead, t));
        }

        foreach (var line0 in (raw ?? "").Replace("\r\n", "\n").Split('\n'))
        {
            var line = line0.Trim();
            if (line.Length == 0) { Flush(); continue; }
            var bullet = line[0] is '•' or '·' or '▪' || (line.Length > 1 && (line[0] is '-' or '*') && char.IsWhiteSpace(line[1]));
            var head = line.TrimStart('#').Trim().TrimEnd(':');
            var isHeading = line.StartsWith('#') || (!bullet && Known.Contains(head.ToLowerInvariant()));
            if (isHeading && head.Length is > 0 and <= 30)
            {
                Flush();
                cur = AddSection(char.ToUpperInvariant(head[0]) + head[1..].ToLowerInvariant());
            }
            else if (bullet) { Flush(); pending = Clean(line[1..]); }
            else if (pending != null) pending += " " + Clean(line);
            else if (cur == null) summary.Add(Clean(line).Trim('_'));
            else pending = Clean(line);                            // a bare line inside a section is treated as an item
        }
        Flush();
        sections.RemoveAll(s => s.Items.Count == 0);
        return new UpdateNotes { Summary = string.Join(" ", summary).Trim(), Sections = sections };
    }
}

/// <summary>
/// Scrollable, owner-drawn release notes: a summary card, then a coloured badge per group with its bullets.
/// Text wraps to the window, scrolls with the mouse wheel and follows the light / dark theme.
/// </summary>
public sealed class ReleaseNotesView : ScrollableControl
{
    private enum Kind { Summary, Header, Item, Gap }
    private sealed class Block { public Kind K; public string A = "", B = ""; public Color Tone; public string Glyph = ""; public int Count; public int Y, H, LeadH, TextH; }

    private UpdateNotes notes = new();
    private readonly List<Block> blocks = new();
    private int laidOutWidth = -1;
    private bool inRelayout;

    private static int S(int v) => Theme.S(v);
    private static readonly TextFormatFlags Wrap = TextFormatFlags.WordBreak | TextFormatFlags.NoPadding | TextFormatFlags.NoPrefix | TextFormatFlags.Left | TextFormatFlags.Top;

    public ReleaseNotesView()
    {
        SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
        AutoScroll = true; TabStop = true;
        BackColor = Theme.Input;
        Theme.Changed += OnTheme;
    }

    protected override void Dispose(bool disposing) { if (disposing) Theme.Changed -= OnTheme; base.Dispose(disposing); }
    private void OnTheme() { if (IsDisposed) return; BackColor = Theme.Input; Invalidate(); }

    public void SetNotes(UpdateNotes n) { notes = n; laidOutWidth = -1; BuildBlocks(); LayoutBlocks(); Invalidate(); }

    private static (Color tone, string glyph) Style(string title) => title.ToLowerInvariant() switch
    {
        "added" or "new" => (Theme.Success, "\uE710"),
        "changed" or "improved" => (Theme.Accent, "\uE70F"),
        "fixed" => (Color.FromArgb(217, 119, 6), "\uE73E"),
        "removed" or "deprecated" => (Theme.Danger, "\uE74D"),
        "security" => (Color.FromArgb(13, 148, 136), "\uE72E"),
        "performance" => (Color.FromArgb(2, 132, 199), "\uE945"),
        _ => (Theme.Muted, "\uE946"),
    };

    private void BuildBlocks()
    {
        blocks.Clear();
        if (notes.Summary.Length > 0) blocks.Add(new Block { K = Kind.Summary, A = notes.Summary });
        foreach (var s in notes.Sections)
        {
            var (tone, glyph) = Style(s.Title);
            if (blocks.Count > 0) blocks.Add(new Block { K = Kind.Gap });
            blocks.Add(new Block { K = Kind.Header, A = s.Title, Tone = tone, Glyph = glyph, Count = s.Items.Count });
            foreach (var it in s.Items) blocks.Add(new Block { K = Kind.Item, A = it.Lead, B = it.Text, Tone = tone });
        }
    }

    private int PadX => S(18);
    private Font LeadFont => Theme.Ui(9.5f, FontStyle.Bold);
    private Font BodyFont => Theme.Ui(9.5f);
    private Font SummaryFont => Theme.Ui(10f, FontStyle.Italic);

    private void LayoutBlocks()
    {
        var w = ClientSize.Width;
        if (w <= 0) return;
        int y = S(16);
        var inner = w - PadX * 2;
        foreach (var b in blocks)
        {
            b.Y = y;
            switch (b.K)
            {
                case Kind.Summary:
                    b.TextH = Measure(b.A, SummaryFont, inner - S(28));
                    b.H = b.TextH + S(24); y += b.H + S(16); break;
                case Kind.Gap: b.H = S(8); y += b.H; break;
                case Kind.Header: b.H = S(28); y += b.H + S(8); break;
                case Kind.Item:
                    var tw = inner - S(22);
                    b.LeadH = b.A.Length > 0 ? Measure(b.A, LeadFont, tw) : 0;
                    b.TextH = Measure(b.B, BodyFont, tw);
                    b.H = b.LeadH + (b.LeadH > 0 ? S(1) : 0) + b.TextH;
                    y += b.H + S(10); break;
            }
        }
        y += S(10);
        laidOutWidth = w;
        AutoScrollMinSize = new Size(0, y);
        if (ClientSize.Width != w && !inRelayout)                                       // the scroll bar appeared: wrap again at the new width
        {
            inRelayout = true;
            try { LayoutBlocks(); } finally { inRelayout = false; }
        }
    }

    private static int Measure(string text, Font f, int width) =>
        TextRenderer.MeasureText(text, f, new Size(Math.Max(20, width), int.MaxValue), Wrap).Height;

    protected override void OnResize(EventArgs e) { base.OnResize(e); if (ClientSize.Width != laidOutWidth) LayoutBlocks(); Invalidate(); }
    protected override void OnScroll(ScrollEventArgs se) { base.OnScroll(se); Invalidate(); }
    protected override void OnMouseEnter(EventArgs e) { base.OnMouseEnter(e); Focus(); }          // the mouse wheel works without a click

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        g.Clear(BackColor);
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.TextRenderingHint = TextRenderingHint.ClearTypeGridFit;
        if (blocks.Count == 0)
        {
            TextRenderer.DrawText(g, "No release notes were provided for this version.", BodyFont, ClientRectangle, Theme.Muted,
                TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.WordBreak | TextFormatFlags.NoPadding);
            return;
        }
        var dy = AutoScrollPosition.Y;
        var inner = ClientSize.Width - PadX * 2;
        foreach (var b in blocks)
        {
            var top = b.Y + dy;
            var bottom = top + Math.Max(b.H, 1) + S(16);
            if (bottom < 0 || top > ClientSize.Height) continue;
            switch (b.K)
            {
                case Kind.Summary: PaintSummary(g, b, top, inner); break;
                case Kind.Header: PaintHeader(g, b, top, inner); break;
                case Kind.Item: PaintItem(g, b, top, inner); break;
            }
        }
    }

    private void PaintSummary(Graphics g, Block b, int top, int inner)
    {
        Gfx.FillRound(g, Theme.AccentSoft, new RectangleF(PadX, top, inner, b.H), S(10));
        using (var br = new SolidBrush(Theme.Accent)) g.FillRectangle(br, PadX + S(1), top + S(10), S(3), b.H - S(20));
        TextRenderer.DrawText(g, b.A, SummaryFont, new Rectangle(PadX + S(16), top + S(12), inner - S(28), b.TextH + S(2)),
            Theme.Dark ? Color.FromArgb(214, 212, 255) : Color.FromArgb(55, 48, 163), Wrap);
    }

    private void PaintHeader(Graphics g, Block b, int top, int inner)
    {
        var label = b.A.ToUpperInvariant();
        var font = Theme.Ui(8.5f, FontStyle.Bold);
        var tw = TextRenderer.MeasureText(g, label, font, new Size(int.MaxValue, int.MaxValue), TextFormatFlags.NoPadding).Width;
        var pillW = S(12) + S(16) + tw + S(14);
        Gfx.FillRound(g, Color.FromArgb(Theme.Dark ? 52 : 30, b.Tone), new RectangleF(PadX, top, pillW, b.H), b.H / 2f);
        TextRenderer.DrawText(g, b.Glyph, Theme.Icons(9f), new Rectangle(PadX + S(8), top, S(18), b.H), b.Tone,
            TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
        TextRenderer.DrawText(g, label, font, new Rectangle(PadX + S(28), top, tw + S(6), b.H), b.Tone,
            TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
        var count = b.Count == 1 ? "1 change" : b.Count + " changes";
        var cf = Theme.Ui(8.5f);
        var cw = TextRenderer.MeasureText(g, count, cf, new Size(int.MaxValue, int.MaxValue), TextFormatFlags.NoPadding).Width;
        var lineL = PadX + pillW + S(10); var lineR = PadX + inner - cw - S(10);
        using (var pen = new Pen(Theme.Border)) if (lineR > lineL) g.DrawLine(pen, lineL, top + b.H / 2, lineR, top + b.H / 2);
        TextRenderer.DrawText(g, count, cf, new Rectangle(PadX + inner - cw, top, cw + S(2), b.H), Theme.Muted,
            TextFormatFlags.Right | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
    }

    private void PaintItem(Graphics g, Block b, int top, int inner)
    {
        var x = PadX + S(22); var tw = inner - S(22);
        var dot = S(7);
        var firstLineH = b.LeadH > 0 ? Math.Min(b.LeadH, LeadFont.Height) : Math.Min(b.TextH, BodyFont.Height);
        using (var br = new SolidBrush(b.Tone)) g.FillEllipse(br, PadX + S(6), top + (firstLineH - dot) / 2f + S(1), dot, dot);
        var y = top;
        if (b.LeadH > 0)
        {
            TextRenderer.DrawText(g, b.A, LeadFont, new Rectangle(x, y, tw, b.LeadH + S(2)), Theme.Text, Wrap);
            y += b.LeadH + S(1);
        }
        TextRenderer.DrawText(g, b.B, BodyFont, new Rectangle(x, y, tw, b.TextH + S(2)), b.LeadH > 0 ? Theme.Muted : Theme.Text, Wrap);
    }
}

/// <summary>Top band of the update window: icon badge, title and the "current → new" version chips.</summary>
public sealed class UpdateHero : Control
{
    private readonly string title, subtitle, from, to;
    private static int S(int v) => Theme.S(v);

    public UpdateHero(string title, string subtitle, string from, string to)
    {
        SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
        this.title = title; this.subtitle = subtitle; this.from = from; this.to = to;
        BackColor = Theme.Surface; Theme.Changed += OnTheme;
    }
    protected override void Dispose(bool disposing) { if (disposing) Theme.Changed -= OnTheme; base.Dispose(disposing); }
    private void OnTheme() { if (IsDisposed) return; BackColor = Theme.Surface; Invalidate(); }

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics; g.Clear(BackColor); g.SmoothingMode = SmoothingMode.AntiAlias; g.TextRenderingHint = TextRenderingHint.ClearTypeGridFit;
        var d = S(52);
        var badge = new RectangleF(0, (Height - d) / 2f, d, d);
        using (var br = new LinearGradientBrush(badge, Theme.AccentHover, Theme.AccentPressed, 45f))
        using (var path = Gfx.Round(badge, S(14))) g.FillPath(br, path);
        TextRenderer.DrawText(g, "\uE896", Theme.Icons(20f), Rectangle.Round(badge), Color.White,
            TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);

        // chips on the right: [ v2.6.0 ]  →  [ v2.6.1 ]
        var cf = Theme.Ui(9.5f, FontStyle.Bold);
        int Wd(string t) => TextRenderer.MeasureText(g, t, cf, new Size(int.MaxValue, int.MaxValue), TextFormatFlags.NoPadding).Width + S(22);
        string chipFrom = "v" + from.TrimStart('v', 'V'), chipTo = "v" + to.TrimStart('v', 'V');
        var h = S(28); var arrow = S(26);
        var wTo = Wd(chipTo); var wFrom = Wd(chipFrom);
        var y = (Height - h) / 2f;
        var rTo = new RectangleF(Width - wTo, y, wTo, h);
        var rFrom = new RectangleF(rTo.X - arrow - wFrom, y, wFrom, h);
        Gfx.FillRound(g, Theme.Accent, rTo, h / 2f);
        TextRenderer.DrawText(g, chipTo, cf, Rectangle.Round(rTo), Color.White, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
        Gfx.FillRound(g, Theme.SurfaceAlt, rFrom, h / 2f);
        TextRenderer.DrawText(g, chipFrom, cf, Rectangle.Round(rFrom), Theme.Muted, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
        TextRenderer.DrawText(g, "\uE72A", Theme.Icons(9f), new Rectangle((int)rFrom.Right, (int)y, arrow, (int)h), Theme.Muted,
            TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);

        var tx = d + S(16);
        var tw = Math.Max(S(80), (int)rFrom.X - tx - S(12));
        TextRenderer.DrawText(g, title, Theme.Ui(15f, FontStyle.Bold), new Rectangle(tx, (Height - d) / 2 + S(2), tw, S(28)), Theme.Text,
            TextFormatFlags.Left | TextFormatFlags.NoPadding | TextFormatFlags.EndEllipsis);
        TextRenderer.DrawText(g, subtitle, Theme.Ui(9.5f), new Rectangle(tx, (Height - d) / 2 + S(32), tw, S(20)), Theme.Muted,
            TextFormatFlags.Left | TextFormatFlags.NoPadding | TextFormatFlags.EndEllipsis);
    }
}
