namespace PdfStudio.Models;

/// <summary>
/// A picture (logo, signature, stamp) placed on a page by anchor, exactly like <see cref="PageTextAnnotation"/>.
/// The width is in PDF points; the height follows the picture's aspect ratio.
/// </summary>
public sealed class PageImageAnnotation
{
    public string Path { get; set; } = string.Empty;
    public HAnchor H { get; set; } = HAnchor.Right;
    public VAnchor V { get; set; } = VAnchor.Bottom;
    public double OffsetX { get; set; }
    public double OffsetY { get; set; }
    public double WidthPt { get; set; } = 120;

    public PageImageAnnotation Clone() => (PageImageAnnotation)MemberwiseClone();

    /// <summary>Top-left corner of the picture in the displayed page frame (top-left origin, points).</summary>
    public (double X, double Y) TopLeft(double pageW, double pageH, double w, double h)
    {
        var m = PageTextAnnotation.EdgeMargin;
        var ax = H switch { HAnchor.Left => m, HAnchor.Right => pageW - m, _ => pageW / 2 } + OffsetX;
        var ay = V switch { VAnchor.Top => m, VAnchor.Bottom => pageH - m, _ => pageH / 2 } + OffsetY;
        var x = H switch { HAnchor.Left => ax, HAnchor.Right => ax - w, _ => ax - w / 2 };
        var y = V switch { VAnchor.Top => ay, VAnchor.Bottom => ay - h, _ => ay - h / 2 };
        return (x, y);
    }
}
