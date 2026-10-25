namespace PdfStudio.Services;

/// <summary>A cell border line: thickness in points and colour 0xRRGGBB. A null border means "no line".</summary>
public sealed class DocxBorder
{
    public double Width { get; init; } = 0.5;
    public int Rgb { get; init; }
}

/// <summary>
/// One paragraph inside a table cell. Its text lines share a baseline (several lines = several columns joined by tab
/// stops). Vertical position comes from <see cref="Before"/> + the exact <see cref="LineHeight"/>, horizontal position
/// from the indent / tab stops / alignment, so the text sits where it sat in the PDF while staying ordinary Word text.
/// </summary>
public sealed class DocxCellPara
{
    public List<DocxTextLine> Segs { get; } = new();
    /// <summary>Space above the paragraph, in points.</summary>
    public double Before { get; set; }
    /// <summary>Exact line height in points.</summary>
    public double LineHeight { get; set; }
    /// <summary>Indents in points; negative values let text run a little past the cell edge instead of wrapping.</summary>
    public double IndentLeft { get; set; }
    public double IndentRight { get; set; }
    /// <summary>0 = left, 1 = centre, 2 = right.</summary>
    public int Align { get; set; }
}

/// <summary>A (possibly merged) cell of a <see cref="DocxTable"/>. Coordinates are page points, origin top-left.</summary>
public sealed class DocxCell
{
    public int Row { get; init; }
    public int Col { get; init; }
    public int RowSpan { get; init; } = 1;
    public int ColSpan { get; init; } = 1;
    public double X0 { get; init; }
    public double Y0 { get; init; }
    public double X1 { get; init; }
    public double Y1 { get; init; }
    /// <summary>Outer top / bottom border of the whole (merged) cell.</summary>
    public DocxBorder? Top { get; init; }
    public DocxBorder? Bottom { get; init; }
    /// <summary>Left / right border for each spanned row.</summary>
    public DocxBorder?[] Left { get; init; } = Array.Empty<DocxBorder?>();
    public DocxBorder?[] Right { get; init; } = Array.Empty<DocxBorder?>();
    public List<DocxCellPara> Paras { get; } = new();
}

/// <summary>
/// A real Word table (w:tbl) rebuilt from the ruling lines of a PDF page: grid, merged cells, borders and the text of
/// every cell. It is placed on the page at an exact spot as a floating table.
/// </summary>
public sealed class DocxTable
{
    public double X { get; init; }
    public double Y { get; init; }
    public double[] ColW { get; init; } = Array.Empty<double>();
    public double[] RowH { get; init; } = Array.Empty<double>();
    public List<DocxCell> Cells { get; } = new();
    /// <summary>The PDF line objects that drew this table; they are removed from the background picture.</summary>
    internal List<RuleLine> Rules { get; } = new();

    public double Width => ColW.Sum();
    public double Height => RowH.Sum();
    public int LineCount => Cells.Sum(c => c.Paras.Sum(p => p.Segs.Count));
}
