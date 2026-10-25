namespace PdfStudio.Models;

public enum HAnchor { Left = 0, Center = 1, Right = 2 }
public enum VAnchor { Top = 0, Middle = 1, Bottom = 2 }

/// <summary>
/// Text placed on a page by anchor (not absolute coordinates) so it stays correct on any page size.
/// Offsets are in PDF points, positive = right / down, measured from the anchor.
/// </summary>
public sealed class PageTextAnnotation
{
    public const double EdgeMargin = 36; // 0.5 inch

    public string Text { get; set; } = string.Empty;
    public string FontName { get; set; } = "Arial";
    public double FontSize { get; set; } = 18;
    public bool Bold { get; set; }
    public bool Italic { get; set; }
    public string ColorHex { get; set; } = "#111111";
    public HAnchor H { get; set; } = HAnchor.Center;
    public VAnchor V { get; set; } = VAnchor.Top;
    public double OffsetX { get; set; }
    public double OffsetY { get; set; }

    public PageTextAnnotation Clone() => (PageTextAnnotation)MemberwiseClone();

    /// <summary>Anchor point in the displayed (unrotated by user) page frame, top-left origin.</summary>
    public (double X, double Y) AnchorPoint(double pageW, double pageH)
    {
        var x = H switch { HAnchor.Left => EdgeMargin, HAnchor.Right => pageW - EdgeMargin, _ => pageW / 2 } + OffsetX;
        var y = V switch { VAnchor.Top => EdgeMargin, VAnchor.Bottom => pageH - EdgeMargin, _ => pageH / 2 } + OffsetY;
        return (x, y);
    }
}
