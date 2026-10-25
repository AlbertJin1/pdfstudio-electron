namespace PdfStudio.Models;

public sealed class PageItem
{
    public Guid Id { get; init; } = Guid.NewGuid();
    public string SourcePath { get; init; } = string.Empty;
    public int SourcePageIndex { get; init; }
    public string SourceName { get; init; } = string.Empty;
    /// <summary>Extra clockwise rotation applied by the user (0/90/180/270).</summary>
    public int Rotation { get; set; }
    public bool IsBlank { get; init; }
    /// <summary>Media box size in points, before any rotation.</summary>
    public double WidthPt { get; init; } = 595.28;
    public double HeightPt { get; init; } = 841.89;
    /// <summary>The /Rotate value stored in the source PDF page.</summary>
    public int SourceRotate { get; init; }
    public List<PageTextAnnotation> TextAnnotations { get; set; } = new();
    public List<PageImageAnnotation> ImageAnnotations { get; set; } = new();
    /// <summary>Objects from the Edit PDF window (edited text, covers, pictures, signatures, shapes), in paint order.</summary>
    public List<PageEditObject> Edits { get; set; } = new();
    /// <summary>Margin guides set in the Edit PDF window (snapping targets). Not printed.</summary>
    public PageMargins Margins { get; set; } = new();
    public bool HasOverlays => TextAnnotations.Count > 0 || ImageAnnotations.Count > 0 || Edits.Count > 0;

    public string DisplayName => IsBlank ? "Blank page" : $"{SourceName} • p.{SourcePageIndex + 1}";
    public string ThumbKey => $"{SourcePath}|{SourcePageIndex}";
    public int EffectiveRotation => (((SourceRotate + Rotation) % 360) + 360) % 360;

    /// <summary>Page size as the viewer sees it. includeUserRotation=false gives the frame text overlays are authored in.</summary>
    public (double W, double H) DisplaySizePt(bool includeUserRotation)
    {
        var rot = includeUserRotation ? EffectiveRotation : ((SourceRotate % 360) + 360) % 360;
        return rot % 180 == 0 ? (WidthPt, HeightPt) : (HeightPt, WidthPt);
    }

    public PageItem Clone() => Copy(Id);
    public PageItem CloneNewId() => Copy(Guid.NewGuid());

    private PageItem Copy(Guid id) => new()
    {
        Id = id, SourcePath = SourcePath, SourcePageIndex = SourcePageIndex, SourceName = SourceName,
        Rotation = Rotation, IsBlank = IsBlank, WidthPt = WidthPt, HeightPt = HeightPt, SourceRotate = SourceRotate,
        TextAnnotations = TextAnnotations.Select(a => a.Clone()).ToList(),
        ImageAnnotations = ImageAnnotations.Select(a => a.Clone()).ToList(),
        Edits = Edits.Select(a => a.Clone()).ToList(),
        Margins = Margins.Clone()
    };
}
