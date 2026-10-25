namespace PdfStudio.Models;

public enum EditKind { Text, Image, Rect, Ellipse, Line }

/// <summary>
/// One object placed with the Edit PDF window. Unlike the anchor-based text/image overlays, edit objects use absolute
/// coordinates: points, top-left origin, in the page as first displayed (the PDF's own /Rotate applied, user rotation not).
/// Text: X/Y is the top-left corner; width and height follow the text. Line: runs from (X,Y) to (X+W, Y+H).
/// </summary>
public sealed class PageEditObject
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public EditKind Kind { get; set; }
    public double X { get; set; }
    public double Y { get; set; }
    public double W { get; set; }
    public double H { get; set; }

    // text
    public string Text { get; set; } = string.Empty;
    public string FontName { get; set; } = "Arial";
    public double FontSize { get; set; } = 14;
    public bool Bold { get; set; }
    public bool Italic { get; set; }
    public bool Underline { get; set; }
    public string ColorHex { get; set; } = "#000000";

    /// <summary>Optional per-character formatting. Empty means the object-level text style applies to the whole text.</summary>
    public List<TextStyleRun> TextStyles { get; set; } = new();

    /// <summary>
    /// Fixed horizontal scale (1 = natural), calibrated once for imported PDF text. Never recalculated from the replacement length.
    /// </summary>
    public double HScale { get; set; } = 1.0;

    /// <summary>
    /// Available horizontal space to the next field/page edge for a line converted from existing PDF text. This is a
    /// collision warning/cover limit only; it does not squeeze replacement text to fit.
    /// Zero means ordinary added text with no original-width constraint.
    /// </summary>
    public double EditFitWidthPt { get; set; }

    /// <summary>The maximum horizontal scale permitted for a converted existing line (its original scale).</summary>
    public double EditFitMaxScale { get; set; } = 1.0;

    /// <summary>
    /// Preserved baseline offset from the text object's top, measured with its current first-line font metrics.
    /// Null for newly added text; used to keep the baseline stationary when an existing line's font or size changes.
    /// </summary>
    public double? EditBaselineOffsetPt { get; set; }

    // image
    public string ImagePath { get; set; } = string.Empty;

    // shapes (empty hex = none). Alpha 0-255.
    public string FillHex { get; set; } = string.Empty;
    public int FillAlpha { get; set; } = 255;
    public string StrokeHex { get; set; } = "#000000";
    public double StrokeWidth { get; set; } = 1.5;

    /// <summary>Set on the cover + text pair created when an existing PDF text line is edited.</summary>
    public string Tag { get; set; } = string.Empty;

    public PageEditObject Clone()
    {
        var c = (PageEditObject)MemberwiseClone();
        c.TextStyles = TextStyles.Select(r => r.Clone()).ToList();
        return c;
    }

    public static string Hex(System.Drawing.Color c) => $"#{c.R:X2}{c.G:X2}{c.B:X2}";
}
