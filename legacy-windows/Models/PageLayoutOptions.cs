namespace PdfStudio.Models;

/// <summary>Which page size the whole exported document should use.</summary>
public enum TargetPageSize { Original, SameAsFirst, Largest, A3, A4, A5, B5, Letter, Legal, Tabloid, Custom }

public enum TargetOrientation { Auto, Portrait, Landscape }

/// <summary>How each page's content is placed on the target page.</summary>
public enum PageFitMode { Contain, ShrinkOnly, Cover, Stretch, ActualSize }

/// <summary>"Page size for all pages" settings. <see cref="TargetPageSize.Original"/> keeps every page exactly as it is.</summary>
public sealed class PageLayoutOptions
{
    public TargetPageSize Size { get; set; } = TargetPageSize.Original;
    public TargetOrientation Orientation { get; set; } = TargetOrientation.Auto;
    public PageFitMode Fit { get; set; } = PageFitMode.Contain;
    public double MarginMm { get; set; }
    public double CustomWidthMm { get; set; } = 210;
    public double CustomHeightMm { get; set; } = 297;

    public bool IsOriginal => Size == TargetPageSize.Original;
    public PageLayoutOptions Clone() => (PageLayoutOptions)MemberwiseClone();
}
