namespace PdfStudio.Models;

/// <summary>
/// Layout margins of one page, in points (72 pt = 1 inch). They are guides for the Edit PDF window: objects snap to them
/// and they can be shown on the page. They are never printed.
/// </summary>
public sealed class PageMargins
{
    public const double DefaultPt = 36;   // 0.5 inch

    public double Top { get; set; } = DefaultPt;
    public double Bottom { get; set; } = DefaultPt;
    public double Left { get; set; } = DefaultPt;
    public double Right { get; set; } = DefaultPt;

    /// <summary>
    /// True once the user has set these margins (dragged a guide, typed a value, pressed Reset or "Use on all pages").
    /// Until then the Edit PDF window sets them from where the text of the page really starts and ends.
    /// </summary>
    public bool Custom { get; set; }

    public PageMargins Clone() => (PageMargins)MemberwiseClone();

    public bool IsDefault => Top == DefaultPt && Bottom == DefaultPt && Left == DefaultPt && Right == DefaultPt;
}
