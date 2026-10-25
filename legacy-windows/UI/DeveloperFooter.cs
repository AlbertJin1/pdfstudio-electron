namespace PdfStudio.UI;

/// <summary>Slim footer strip crediting the developer. Clicking it opens the About window.</summary>
public sealed class DeveloperFooter : Surface
{
    public event Action? Clicked;
    private bool hover;

    public DeveloperFooter()
    {
        Height = 32; Dock = DockStyle.Bottom; BorderTop = true; Cursor = Cursors.Hand;
        UseRole(() => Theme.Surface);
    }

    protected override void OnMouseEnter(EventArgs e) { hover = true; base.OnMouseEnter(e); Invalidate(); }
    protected override void OnMouseLeave(EventArgs e) { hover = false; base.OnMouseLeave(e); Invalidate(); }
    protected override void OnClick(EventArgs e) { base.OnClick(e); Clicked?.Invoke(); }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        var g = e.Graphics;
        var flags = TextFormatFlags.NoPadding | TextFormatFlags.NoPrefix | TextFormatFlags.SingleLine | TextFormatFlags.VerticalCenter;
        var pad = Theme.S(20);                      // same side margin as the header and status bar
        var small = Theme.Ui(8.75f);
        var bold = Theme.Ui(8.75f, FontStyle.Bold);
        var gap = Theme.S(24);

        int W(string text, Font f) => TextRenderer.MeasureText(g, text, f, new Size(4000, Height), flags).Width;
        void Draw(string text, Font f, Color c, int x) =>
            TextRenderer.DrawText(g, text, f, new Rectangle(x, 0, W(text, f) + 2, Height), c, flags);

        var lead = "Developed by ";
        var role = "   ·   " + AppInfo.DeveloperRole;
        var right = $"{AppInfo.Name} v{AppInfo.Version}   ·   © {DateTime.Now.Year}";
        var avail = Width - pad * 2;

        var leadW = W(lead, small); var nameW = W(AppInfo.Developer, bold); var roleW = W(role, small); var rightW = W(right, small);

        // Drop the least important parts first: version/copyright, then the role, then the "Developed by" lead-in.
        var showRight = leadW + nameW + roleW + gap + rightW <= avail;
        var showRole = showRight || leadW + nameW + roleW <= avail;
        var showLead = showRole || leadW + nameW <= avail;

        var x = pad;
        if (showLead) { Draw(lead, small, Theme.Muted, x); x += leadW; }
        var shownName = AppInfo.Developer;
        if (!showLead && nameW > avail)
        {
            // very narrow window: end the name with an ellipsis instead of cutting it mid-letter
            TextRenderer.DrawText(g, shownName, bold, new Rectangle(x, 0, Math.Max(10, avail), Height), hover ? Theme.Accent : Theme.Text, flags | TextFormatFlags.EndEllipsis);
            return;
        }
        Draw(shownName, bold, hover ? Theme.Accent : Theme.Text, x); x += nameW;
        if (showRole) Draw(role, small, Theme.Muted, x);
        if (showRight) Draw(right, small, Theme.Muted, Width - pad - rightW);
    }
}
