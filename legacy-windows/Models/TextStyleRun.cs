namespace PdfStudio.Models;

/// <summary>Formatting applied to a contiguous range of characters inside a PDF Studio text edit.</summary>
public sealed class TextStyleRun
{
    public int Start { get; set; }
    public int Length { get; set; }
    public string FontName { get; set; } = "Arial";
    public double FontSize { get; set; } = 14;
    public bool Bold { get; set; }
    public bool Italic { get; set; }
    public bool Underline { get; set; }
    public string ColorHex { get; set; } = "#000000";

    public TextStyleRun Clone() => (TextStyleRun)MemberwiseClone();

    public bool SameStyle(TextStyleRun other) =>
        string.Equals(FontName, other.FontName, StringComparison.OrdinalIgnoreCase) &&
        Math.Abs(FontSize - other.FontSize) < 0.001 &&
        Bold == other.Bold && Italic == other.Italic && Underline == other.Underline &&
        string.Equals(ColorHex, other.ColorHex, StringComparison.OrdinalIgnoreCase);
}
