using System.Globalization;
using System.IO.Compression;
using System.Text;

namespace PdfStudio.Services;

/// <summary>A piece of text with one font/size/colour inside a <see cref="DocxTextLine"/>.</summary>
public sealed class DocxRun
{
    public string Text { get; init; } = "";
    public string Font { get; init; } = "Arial";
    /// <summary>Fallback / classification data for the font table (optional).</summary>
    public PdfFontInfo? Info { get; init; }
    /// <summary>Font size in points (written to Word in half-points).</summary>
    public double SizePt { get; init; } = 11;
    public bool Bold { get; init; }
    public bool Italic { get; init; }
    /// <summary>Semantic Word underline formatting, not a background line/shape.</summary>
    public bool Underline { get; init; }
    /// <summary>0xRRGGBB</summary>
    public int Rgb { get; init; }
    /// <summary>Extra space after every character of this run, in points (can be negative). Null = use the line's value.</summary>
    public double? SpacingPt { get; init; }
}

/// <summary>One line of text placed at an exact spot on the page (points, origin top-left of the page).</summary>
public sealed class DocxTextLine
{
    public double X { get; init; }
    public double Top { get; init; }
    public double Width { get; init; }
    public double Height { get; init; }
    /// <summary>Extra space after every character, in points (can be negative) so the line is exactly as wide as in the PDF.</summary>
    public double SpacingPt { get; init; }
    /// <summary>Baseline y, ascent / descent of the tallest run and the real width of the text (points) — used to lay the line out inside a table cell.</summary>
    public double Baseline { get; init; }
    public double Ascent { get; init; }
    public double Descent { get; init; }
    public double TextWidth { get; init; }
    public double MaxSize { get; init; }
    public List<DocxRun> Runs { get; } = new();
}

public sealed class DocxPicture
{
    /// <summary>Top-left page coordinates and size, in PDF points.</summary>
    public double X { get; init; }
    public double Y { get; init; }
    public double Width { get; init; }
    public double Height { get; init; }
    public byte[] Data { get; init; } = Array.Empty<byte>();
    public string Ext { get; init; } = "png";
}

public sealed class DocxPage
{
    public double WidthPt { get; init; }
    public double HeightPt { get; init; }
    /// <summary>Optional flattened page artwork. Disabled by default because it is a page-sized draggable picture.</summary>
    public byte[]? Background { get; set; }
    public string BackgroundExt { get; set; } = "png";
    /// <summary>Individual image regions anchored at their original page positions; never page-sized by default.</summary>
    public List<DocxPicture> Pictures { get; } = new();
    public List<DocxTextLine> Lines { get; } = new();
    /// <summary>Real Word tables rebuilt from the page's ruling lines; their text is inside the cells, not in text boxes.</summary>
    public List<DocxTable> Tables { get; } = new();
}

/// <summary>
/// Minimal, dependency-free .docx (WordprocessingML) writer. Every PDF page becomes its own zero-margin section.
/// Tables are real Word tables, loose text is emitted as ordinary WordprocessingML paragraphs/runs (not text boxes),
/// and genuine image objects can be preserved as separate, bounded pictures. A flattened full-page picture is opt-in only.
/// </summary>
public sealed class DocxWriter : IDisposable
{
    // Word's hard limit for a page side is 22 inches.
    private const double MaxPageSidePt = 1584;
    private const double Emu = 12700;                  // EMU per point

    private readonly ZipArchive zip;
    private readonly FileStream file;
    private readonly StringBuilder body = new(1 << 16);
    private readonly List<(string Id, string Target)> media = new();
    private readonly Dictionary<string, PdfFontInfo> fontTable = new(StringComparer.OrdinalIgnoreCase);
    private int shapeId = 1;
    private int pageCount;
    private double lastW = 612, lastH = 792;
    private bool finished;
    // The page being built is held back until the next page arrives: each non-final page ends with a section break.
    private string? pendingSect;
    private readonly StringBuilder pendingTail = new();
    private readonly StringBuilder pendingTables = new();

    public DocxWriter(string path)
    {
        file = new FileStream(path, FileMode.Create, FileAccess.ReadWrite, FileShare.None);
        zip = new ZipArchive(file, ZipArchiveMode.Create, leaveOpen: false);
        WriteContentTypes();
        WriteEntry("_rels/.rels",
            Header + "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">" +
            "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"word/document.xml\"/>" +
            "<Relationship Id=\"rId2\" Type=\"http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties\" Target=\"docProps/core.xml\"/>" +
            "</Relationships>");
        WriteEntry("word/styles.xml", Styles);
        WriteEntry("word/settings.xml", Settings);
    }

    private const string Header = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n";

    private const string Styles = Header +
        "<w:styles xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\">" +
        "<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii=\"Arial\" w:hAnsi=\"Arial\" w:eastAsia=\"Arial\" w:cs=\"Arial\"/><w:sz w:val=\"22\"/><w:szCs w:val=\"22\"/><w:lang w:val=\"en-US\"/></w:rPr></w:rPrDefault>" +
        "<w:pPrDefault><w:pPr><w:spacing w:after=\"0\" w:line=\"240\" w:lineRule=\"auto\"/></w:pPr></w:pPrDefault></w:docDefaults>" +
        "<w:style w:type=\"paragraph\" w:default=\"1\" w:styleId=\"Normal\"><w:name w:val=\"Normal\"/><w:qFormat/></w:style>" +
        "</w:styles>";

    private const string Settings = Header +
        "<w:settings xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\">" +
        "<w:zoom w:percent=\"100\"/><w:defaultTabStop w:val=\"720\"/>" +
        "<w:compat><w:compatSetting w:name=\"compatibilityMode\" w:uri=\"http://schemas.microsoft.com/office/word\" w:val=\"15\"/></w:compat>" +
        "</w:settings>";

    private void WriteContentTypes() => WriteEntry("[Content_Types].xml",
        Header + "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">" +
        "<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>" +
        "<Default Extension=\"xml\" ContentType=\"application/xml\"/>" +
        "<Default Extension=\"png\" ContentType=\"image/png\"/>" +
        "<Default Extension=\"jpg\" ContentType=\"image/jpeg\"/>" +
        "<Override PartName=\"/word/document.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/>" +
        "<Override PartName=\"/word/styles.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml\"/>" +
        "<Override PartName=\"/word/settings.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml\"/>" +
        "<Override PartName=\"/word/fontTable.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml\"/>" +
        "<Override PartName=\"/docProps/core.xml\" ContentType=\"application/vnd.openxmlformats-package.core-properties+xml\"/>" +
        "</Types>");

    private void WriteEntry(string name, string xml)
    {
        var e = zip.CreateEntry(name, CompressionLevel.Optimal);
        using var s = e.Open();
        var b = new UTF8Encoding(false).GetBytes(xml);
        s.Write(b, 0, b.Length);
    }

    private static string Num(double v) => v.ToString("0.####", CultureInfo.InvariantCulture);
    private static long ToEmu(double pt) => (long)Math.Round(pt * Emu);

    public static string Esc(string s)
    {
        var sb = new StringBuilder(s.Length + 8);
        for (var i = 0; i < s.Length; i++)
        {
            var c = s[i];
            if (c == '&') sb.Append("&amp;");
            else if (c == '<') sb.Append("&lt;");
            else if (c == '>') sb.Append("&gt;");
            else if (c == '"') sb.Append("&quot;");
            else if (c == '\t' || c == '\n' || c == '\r') sb.Append(' ');
            else if (c < ' ' || c == '\uFFFE' || c == '\uFFFF') { }
            else if (char.IsHighSurrogate(c) && i + 1 < s.Length && char.IsLowSurrogate(s[i + 1])) { sb.Append(c).Append(s[++i]); }
            else if (char.IsSurrogate(c)) { }
            else sb.Append(c);
        }
        return sb.ToString();
    }

    /// <summary>Adds one PDF page. Loose text is ordinary editable Word text, never a floating text box.</summary>
    public void AddPage(DocxPage page)
    {
        if (finished) throw new InvalidOperationException("Document already finished.");
        pageCount++;

        // Word cannot make a page larger than 22 in; shrink the whole page proportionally if a PDF is bigger.
        var k = Math.Min(1.0, MaxPageSidePt / Math.Max(page.WidthPt, page.HeightPt));
        double pw = Math.Max(36, page.WidthPt * k), ph = Math.Max(36, page.HeightPt * k);
        lastW = pw; lastH = ph;

        FlushPending(withBreak: true);
        pendingTables.Clear();
        foreach (var table in page.Tables)
            if (table.Cells.Count > 0) AppendTable(pendingTables, table, k);
        pendingSect = SectPr(pw, ph, withBreak: true);
        pendingTail.Clear();

        // A flattened full-page picture is supported only as an explicit opt-in. Normal conversion keeps text as
        // Word paragraphs and uses separate, page-positioned pictures for bounded image objects.
        if (page.Background is { Length: > 0 })
        {
            var ext = page.BackgroundExt == "jpg" ? "jpg" : "png";
            var name = $"page{pageCount}.{ext}";
            var e = zip.CreateEntry("word/media/" + name, CompressionLevel.NoCompression);
            using (var stream = e.Open()) stream.Write(page.Background, 0, page.Background.Length);
            var rid = "rIdImg" + pageCount;
            media.Add((rid, "media/" + name));
            pendingTail.Append("<w:p><w:pPr><w:spacing w:before=\"0\" w:after=\"0\" w:line=\"20\" w:lineRule=\"exact\"/><w:rPr><w:sz w:val=\"2\"/><w:szCs w:val=\"2\"/></w:rPr></w:pPr><w:r>");
            AppendPicture(pendingTail, rid, 0, 0, pw, ph, true, $"Page {pageCount} full-page artwork");
            pendingTail.Append("</w:r></w:p>");
        }

        if (page.Pictures.Count > 0)
        {
            pendingTail.Append("<w:p><w:pPr><w:spacing w:before=\"0\" w:after=\"0\" w:line=\"20\" w:lineRule=\"exact\"/><w:rPr><w:sz w:val=\"2\"/><w:szCs w:val=\"2\"/></w:rPr></w:pPr>");
            var pictureIndex = 0;
            foreach (var picture in page.Pictures)
            {
                if (picture.Data.Length == 0 || picture.Width <= 0 || picture.Height <= 0) continue;
                pictureIndex++;
                var ext = picture.Ext.Equals("jpg", StringComparison.OrdinalIgnoreCase) ? "jpg" : "png";
                var name = $"page{pageCount}-image{pictureIndex}.{ext}";
                var e = zip.CreateEntry("word/media/" + name, CompressionLevel.NoCompression);
                using (var stream = e.Open()) stream.Write(picture.Data, 0, picture.Data.Length);
                var rid = $"rIdPic{pageCount}_{pictureIndex}";
                media.Add((rid, "media/" + name));
                pendingTail.Append("<w:r>");
                AppendPicture(pendingTail, rid, picture.X * k, picture.Y * k,
                    picture.Width * k, picture.Height * k, true, $"Page {pageCount} image {pictureIndex}");
                pendingTail.Append("</w:r>");
            }
            pendingTail.Append("</w:p>");
        }

        AppendFlowParagraphs(pendingTail, page.Lines, k);
    }

    private void FlushPending(bool withBreak)
    {
        if (pendingSect is null && pendingTail.Length == 0 && pendingTables.Length == 0) return;
        body.Append(pendingTables);
        body.Append(pendingTail);
        if (withBreak && pendingSect is not null)
        {
            // Section properties belong to the final paragraph of the section, not the first/background paragraph.
            // A one-point empty paragraph is used so ordinary text above it remains in the section with this page size.
            body.Append("<w:p><w:pPr><w:spacing w:before=\"0\" w:after=\"0\" w:line=\"20\" w:lineRule=\"exact\"/>")
                .Append(pendingSect).Append("</w:pPr></w:p>");
        }
        pendingSect = null;
        pendingTail.Clear();
        pendingTables.Clear();
    }

    private static string SectPr(double wPt, double hPt, bool withBreak)
    {
        var orient = wPt > hPt ? " w:orient=\"landscape\"" : "";
        return "<w:sectPr>" + (withBreak ? "<w:type w:val=\"nextPage\"/>" : "") +
               $"<w:pgSz w:w=\"{Math.Round(wPt * 20)}\" w:h=\"{Math.Round(hPt * 20)}\"{orient}/>" +
               "<w:pgMar w:top=\"0\" w:right=\"0\" w:bottom=\"0\" w:left=\"0\" w:header=\"0\" w:footer=\"0\" w:gutter=\"0\"/>" +
               "<w:cols w:space=\"720\"/></w:sectPr>";
    }

    private static void AnchorOpen(StringBuilder sb, double x, double y, double w, double h, bool behind, int zOrder, int id, string name)
    {
        sb.Append("<w:drawing><wp:anchor distT=\"0\" distB=\"0\" distL=\"0\" distR=\"0\" simplePos=\"0\" relativeHeight=\"")
          .Append(zOrder).Append("\" behindDoc=\"").Append(behind ? 1 : 0)
          .Append("\" locked=\"0\" layoutInCell=\"1\" allowOverlap=\"1\"><wp:simplePos x=\"0\" y=\"0\"/>")
          .Append("<wp:positionH relativeFrom=\"page\"><wp:posOffset>").Append(ToEmu(x)).Append("</wp:posOffset></wp:positionH>")
          .Append("<wp:positionV relativeFrom=\"page\"><wp:posOffset>").Append(ToEmu(y)).Append("</wp:posOffset></wp:positionV>")
          .Append("<wp:extent cx=\"").Append(ToEmu(w)).Append("\" cy=\"").Append(ToEmu(h)).Append("\"/>")
          .Append("<wp:effectExtent l=\"0\" t=\"0\" r=\"0\" b=\"0\"/><wp:wrapNone/>")
          .Append("<wp:docPr id=\"").Append(id).Append("\" name=\"").Append(name).Append("\"/><wp:cNvGraphicFramePr/>");
    }

    private void AppendPicture(StringBuilder sb, string rid, double x, double y, double width, double height, bool behind, string name)
    {
        var id = shapeId++;
        AnchorOpen(sb, x, y, width, height, behind, id, id, name);
        sb.Append("<a:graphic xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\">")
          .Append("<a:graphicData uri=\"http://schemas.openxmlformats.org/drawingml/2006/picture\">")
          .Append("<pic:pic xmlns:pic=\"http://schemas.openxmlformats.org/drawingml/2006/picture\">")
          .Append("<pic:nvPicPr><pic:cNvPr id=\"").Append(id).Append("\" name=\"").Append(Esc(name)).Append("\"/><pic:cNvPicPr/></pic:nvPicPr>")
          .Append("<pic:blipFill><a:blip r:embed=\"").Append(rid).Append("\"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>")
          .Append("<pic:spPr><a:xfrm><a:off x=\"0\" y=\"0\"/><a:ext cx=\"").Append(ToEmu(width)).Append("\" cy=\"").Append(ToEmu(height)).Append("\"/></a:xfrm>")
          .Append("<a:prstGeom prst=\"rect\"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:anchor>");
    }

    private sealed class FlowRow
    {
        public List<DocxTextLine> Segments { get; } = new();
        public double Baseline => Segments.Count == 0 ? 0 : Segments.Average(l => l.Baseline);
        public double Top => Segments.Count == 0 ? 0 : Segments.Min(l => l.Top);
        public double MaxSize => Math.Max(4, Segments.Count == 0 ? 11 : Segments.Max(l => l.MaxSize));
        public string Text => string.Join("\t", Segments.Select(DocxWriter.LineText));
    }

    private sealed class FlowParagraph
    {
        public List<FlowRow> Rows { get; } = new();
        public double Top => Rows.Count == 0 ? 0 : Rows[0].Top;
        public double MaxSize => Math.Max(4, Rows.Count == 0 ? 11 : Rows.Max(r => r.MaxSize));
        public bool IsBullet => Rows.Count > 0 && DocxWriter.IsBulletText(Rows[0].Text);
    }

    private static string LineText(DocxTextLine line) => string.Concat(line.Runs.Select(r => r.Text));

    private static List<FlowRow> BuildFlowRows(IEnumerable<DocxTextLine> lines)
    {
        var rows = new List<FlowRow>();
        foreach (var line in lines.Where(l => l.Runs.Count > 0 && LineText(l).Length > 0)
                                  .OrderBy(l => l.Baseline).ThenBy(l => l.X))
        {
            FlowRow? row = null;
            if (rows.Count > 0)
            {
                var candidate = rows[^1];
                if (Math.Abs(candidate.Baseline - line.Baseline) < 0.3 * Math.Max(candidate.MaxSize, line.MaxSize))
                    row = candidate;
            }
            if (row is null) { row = new FlowRow(); rows.Add(row); }
            row.Segments.Add(line);
        }
        foreach (var row in rows) row.Segments.Sort((a, b) => a.X.CompareTo(b.X));
        return rows;
    }

    private static bool IsBulletText(string text)
    {
        var t = text.TrimStart();
        return t.StartsWith("•", StringComparison.Ordinal) || t.StartsWith("▪", StringComparison.Ordinal) ||
               t.StartsWith("◦", StringComparison.Ordinal) || t.StartsWith("‣", StringComparison.Ordinal) ||
               t.StartsWith("□", StringComparison.Ordinal) || t.StartsWith("☐", StringComparison.Ordinal) ||
               t.StartsWith("- ", StringComparison.Ordinal) || t.StartsWith("– ", StringComparison.Ordinal) ||
               t.StartsWith("— ", StringComparison.Ordinal) || t.StartsWith("* ", StringComparison.Ordinal);
    }

    private static bool IsHeading(FlowRow row)
    {
        var t = row.Text.Replace("\t", " ").Trim();
        if (t.Length == 0 || t.Length > 72 || t.Contains('.') || t.Contains('?') || t.Contains('!')) return false;
        var letters = t.Where(char.IsLetter).ToArray();
        return letters.Length >= 3 && letters.Count(char.IsUpper) >= Math.Ceiling(letters.Length * 0.82);
    }

    private static bool CanContinueParagraph(FlowParagraph paragraph, FlowRow next)
    {
        if (paragraph.Rows.Count == 0) return false;
        var prev = paragraph.Rows[^1];
        var size = Math.Max(prev.MaxSize, next.MaxSize);
        var lineHeight = Math.Max(4, size * 1.25);
        var verticalGap = next.Baseline - prev.Baseline;
        if (verticalGap < 0 || verticalGap > lineHeight * 1.65) return false;
        if (IsBulletText(next.Text) || IsHeading(next)) return false;
        if (paragraph.Rows.Count == 1 && IsHeading(paragraph.Rows[0])) return false;

        var firstX = paragraph.Rows[0].Segments[0].X;
        var currentX = next.Segments[0].X;
        if (paragraph.IsBullet)
        {
            // Bulleted paragraphs commonly use a hanging indent: wrapped lines start just to the right of the bullet.
            return currentX >= firstX - 2 && currentX <= firstX + Math.Max(28, paragraph.MaxSize * 4.2);
        }
        var tolerance = Math.Max(16, size * 2.2);
        return Math.Abs(currentX - firstX) <= tolerance ||
               Math.Abs(currentX - prev.Segments[0].X) <= tolerance;
    }

    private static List<FlowParagraph> BuildFlowParagraphs(IEnumerable<DocxTextLine> lines)
    {
        var paragraphs = new List<FlowParagraph>();
        foreach (var row in BuildFlowRows(lines))
        {
            if (paragraphs.Count == 0 || !CanContinueParagraph(paragraphs[^1], row))
                paragraphs.Add(new FlowParagraph());
            paragraphs[^1].Rows.Add(row);
        }
        return paragraphs;
    }

    private static (double Left, double FirstLine, double Hanging) FlowIndent(FlowParagraph paragraph)
    {
        var firstX = Math.Max(0, paragraph.Rows[0].Segments[0].X);
        if (paragraph.Rows.Count < 2) return (firstX, 0, 0);
        var nextXs = paragraph.Rows.Skip(1).Select(r => Math.Max(0, r.Segments[0].X)).OrderBy(x => x).ToArray();
        if (nextXs.Length == 0) return (firstX, 0, 0);
        var continuationX = nextXs[nextXs.Length / 2];
        if (Math.Abs(continuationX - firstX) < 2) return (firstX, 0, 0);
        // Word's left indent is used for wrapped lines; firstLine/hanging reconstructs the actual first-line start.
        return continuationX <= firstX
            ? (continuationX, firstX - continuationX, 0)
            : (continuationX, 0, continuationX - firstX);
    }

    private void AppendFlowParagraphs(StringBuilder sb, IReadOnlyList<DocxTextLine> lines, double k)
    {
        var paragraphs = BuildFlowParagraphs(lines);
        var cursorY = 1.0; // the page-artwork anchor paragraph above is one point tall at most
        foreach (var paragraph in paragraphs)
        {
            var indent = FlowIndent(paragraph);
            var before = Math.Max(0, paragraph.Top - cursorY);
            var lineHeight = Math.Max(4, paragraph.MaxSize * 1.25);
            var first = paragraph.Rows[0];
            var tabs = paragraph.Rows.SelectMany(r => r.Segments.Skip(1))
                .Select(l => (int)Math.Round(Math.Max(1, l.X * k) * 20))
                .Where(t => t > 0).Distinct().OrderBy(t => t).ToArray();

            sb.Append("<w:p><w:pPr><w:widowControl/>");
            if (tabs.Length > 0)
            {
                sb.Append("<w:tabs>");
                foreach (var tab in tabs) sb.Append("<w:tab w:val=\"left\" w:pos=\"").Append(tab).Append("\"/>");
                sb.Append("</w:tabs>");
            }
            sb.Append("<w:spacing w:before=\"").Append(Tw(before * k))
              .Append("\" w:after=\"0\" w:line=\"").Append(Math.Max(20, Tw(lineHeight * k)))
              .Append("\" w:lineRule=\"exact\"/><w:ind w:left=\"").Append(Tw(indent.Left * k)).Append('"');
            if (indent.FirstLine > 0.5) sb.Append(" w:firstLine=\"").Append(Tw(indent.FirstLine * k)).Append('"');
            if (indent.Hanging > 0.5) sb.Append(" w:hanging=\"").Append(Tw(indent.Hanging * k)).Append('"');
            sb.Append("/></w:pPr>");

            for (var rowIndex = 0; rowIndex < paragraph.Rows.Count; rowIndex++)
            {
                var row = paragraph.Rows[rowIndex];
                if (rowIndex > 0)
                {
                    var prevText = paragraph.Rows[rowIndex - 1].Text.TrimEnd();
                    var nextText = row.Text.TrimStart();
                    var last = prevText.Length > 0 ? prevText[^1] : '\0';
                    var next = nextText.Length > 0 ? nextText[0] : '\0';
                    var needsSpace = last is not ('-' or '–' or '—') && next is not ('.' or ',' or ';' or ':' or ')' or ']' or '?');
                    if (needsSpace) sb.Append("<w:r><w:t xml:space=\"preserve\"> </w:t></w:r>");
                }
                for (var segmentIndex = 0; segmentIndex < row.Segments.Count; segmentIndex++)
                {
                    if (segmentIndex > 0) sb.Append("<w:r><w:tab/></w:r>");
                    AppendInlineRuns(sb, row.Segments[segmentIndex], k);
                }
            }
            sb.Append("</w:p>");
            cursorY = Math.Max(cursorY, paragraph.Top) + paragraph.Rows.Count * lineHeight;
        }
    }

    /// <summary>Writes ordinary inline Word runs. Letter-spacing corrections used for pixel-perfect text boxes are intentionally omitted so Word can reflow text naturally.</summary>
    private void AppendInlineRuns(StringBuilder sb, DocxTextLine line, double k)
    {
        foreach (var r in line.Runs)
        {
            if (r.Text.Length == 0) continue;
            var half = Math.Max(2, (int)Math.Round(r.SizePt * k * 2));
            RegisterFont(r);
            var font = Esc(r.Font);
            sb.Append("<w:r><w:rPr><w:rFonts w:ascii=\"").Append(font).Append("\" w:hAnsi=\"").Append(font)
              .Append("\" w:eastAsia=\"").Append(font).Append("\" w:cs=\"").Append(font).Append("\"/>");
            if (r.Bold) sb.Append("<w:b/><w:bCs/>");
            if (r.Italic) sb.Append("<w:i/><w:iCs/>");
            if (r.Underline) sb.Append("<w:u w:val=\"single\"/>");
            sb.Append("<w:color w:val=\"").Append((r.Rgb & 0xFFFFFF).ToString("X6")).Append("\"/>")
              .Append("<w:sz w:val=\"").Append(half).Append("\"/><w:szCs w:val=\"").Append(half).Append("\"/></w:rPr>")
              .Append("<w:t xml:space=\"preserve\">").Append(Esc(r.Text)).Append("</w:t></w:r>");
        }
    }

    // ───────────────────────── tables ─────────────────────────

    private static int Tw(double pt) => (int)Math.Round(pt * 20);

    private const string TinyPara = "<w:p><w:pPr><w:spacing w:before=\"0\" w:after=\"0\" w:line=\"20\" w:lineRule=\"exact\"/><w:rPr><w:sz w:val=\"2\"/><w:szCs w:val=\"2\"/></w:rPr></w:pPr></w:p>";

    private static void AppendBorder(StringBuilder sb, string side, DocxBorder? b)
    {
        if (b is null) { sb.Append("<w:").Append(side).Append(" w:val=\"nil\"/>"); return; }
        var sz = Math.Clamp((int)Math.Round(b.Width * 8), 2, 96);
        sb.Append("<w:").Append(side).Append(" w:val=\"single\" w:sz=\"").Append(sz).Append("\" w:space=\"0\" w:color=\"")
          .Append((b.Rgb & 0xFFFFFF).ToString("X6")).Append("\"/>");
    }

    /// <summary>
    /// A real table (w:tbl): fixed grid, merged cells, borders, and every cell's text as ordinary paragraphs. It floats at an exact
    /// page position (w:tblpPr relative to the page) so the page keeps the PDF's layout; with zero cell margins the cell
    /// content starts exactly at the cell's edge, and paragraph indent / spacing put each line on its original baseline.
    /// </summary>
    private void AppendTable(StringBuilder sb, DocxTable t, double k)
    {
        int R = t.RowH.Length, C = t.ColW.Length;
        var at = new DocxCell?[R, C];
        foreach (var c in t.Cells)
            for (var i = c.Row; i < c.Row + c.RowSpan && i < R; i++)
                for (var j = c.Col; j < c.Col + c.ColSpan && j < C; j++) at[i, j] = c;

        var colTw = t.ColW.Select(w => Math.Max(1, Tw(w * k))).ToArray();
        sb.Append("<w:tbl><w:tblPr><w:tblpPr w:leftFromText=\"0\" w:rightFromText=\"0\" w:topFromText=\"0\" w:bottomFromText=\"0\" w:vertAnchor=\"page\" w:horzAnchor=\"page\" w:tblpX=\"")
          .Append(Tw(t.X * k)).Append("\" w:tblpY=\"").Append(Tw(t.Y * k)).Append("\"/><w:tblOverlap w:val=\"overlap\"/>")
          .Append("<w:tblW w:w=\"").Append(colTw.Sum()).Append("\" w:type=\"dxa\"/><w:tblInd w:w=\"0\" w:type=\"dxa\"/><w:tblLayout w:type=\"fixed\"/>")
          .Append("<w:tblCellMar><w:top w:w=\"0\" w:type=\"dxa\"/><w:left w:w=\"0\" w:type=\"dxa\"/><w:bottom w:w=\"0\" w:type=\"dxa\"/><w:right w:w=\"0\" w:type=\"dxa\"/></w:tblCellMar>")
          .Append("<w:tblLook w:val=\"0000\"/></w:tblPr><w:tblGrid>");
        foreach (var w in colTw) sb.Append("<w:gridCol w:w=\"").Append(w).Append("\"/>");
        sb.Append("</w:tblGrid>");

        for (var i = 0; i < R; i++)
        {
            sb.Append("<w:tr><w:trPr><w:cantSplit/><w:trHeight w:val=\"").Append(Math.Max(20, Tw(t.RowH[i] * k))).Append("\" w:hRule=\"atLeast\"/></w:trPr>");
            for (var j = 0; j < C;)
            {
                var c = at[i, j];
                if (c is null)
                {
                    sb.Append("<w:tc><w:tcPr><w:tcW w:w=\"").Append(colTw[j]).Append("\" w:type=\"dxa\"/></w:tcPr>").Append(TinyPara).Append("</w:tc>");
                    j++; continue;
                }
                var span = Math.Min(c.ColSpan, C - j);
                var width = 0; for (var q = j; q < j + span; q++) width += colTw[q];
                var firstRow = i == c.Row; var lastRow = i == c.Row + c.RowSpan - 1;
                sb.Append("<w:tc><w:tcPr><w:tcW w:w=\"").Append(width).Append("\" w:type=\"dxa\"/>");
                if (span > 1) sb.Append("<w:gridSpan w:val=\"").Append(span).Append("\"/>");
                if (c.RowSpan > 1) sb.Append(firstRow ? "<w:vMerge w:val=\"restart\"/>" : "<w:vMerge/>");
                sb.Append("<w:tcBorders>");
                var ri = Math.Clamp(i - c.Row, 0, c.Left.Length - 1);
                AppendBorder(sb, "top", firstRow ? c.Top : null);
                AppendBorder(sb, "left", c.Left.Length > 0 ? c.Left[ri] : null);
                AppendBorder(sb, "bottom", lastRow ? c.Bottom : null);
                AppendBorder(sb, "right", c.Right.Length > 0 ? c.Right[ri] : null);
                sb.Append("</w:tcBorders><w:vAlign w:val=\"top\"/></w:tcPr>");
                if (firstRow && c.Paras.Count > 0) foreach (var p in c.Paras) AppendCellPara(sb, c, p, k);
                else sb.Append(TinyPara);
                sb.Append("</w:tc>");
                j += span;
            }
            sb.Append("</w:tr>");
        }
        sb.Append("</w:tbl>").Append(TinyPara);   // the paragraph keeps neighbouring tables from fusing into one
    }

    private void AppendCellPara(StringBuilder sb, DocxCell cell, DocxCellPara p, double k)
    {
        sb.Append("<w:p><w:pPr>");
        if (p.Segs.Count > 1)
        {
            sb.Append("<w:tabs>");
            for (var s = 1; s < p.Segs.Count; s++)
                sb.Append("<w:tab w:val=\"left\" w:pos=\"").Append(Math.Max(1, Tw((p.Segs[s].X - cell.X0) * k))).Append("\"/>");
            sb.Append("</w:tabs>");
        }
        sb.Append("<w:spacing w:before=\"").Append(Math.Max(0, Tw(p.Before * k))).Append("\" w:after=\"0\" w:line=\"").Append(Math.Max(20, Tw(p.LineHeight * k)))
          .Append("\" w:lineRule=\"exact\"/>");
        if (p.IndentLeft != 0 || p.IndentRight != 0)
            sb.Append("<w:ind w:left=\"").Append(Tw(p.IndentLeft * k)).Append("\" w:right=\"").Append(Tw(p.IndentRight * k)).Append("\"/>");
        if (p.Align == 1) sb.Append("<w:jc w:val=\"center\"/>");
        else if (p.Align == 2) sb.Append("<w:jc w:val=\"right\"/>");
        sb.Append("</w:pPr>");
        for (var s = 0; s < p.Segs.Count; s++)
        {
            if (s > 0) sb.Append("<w:r><w:tab/></w:r>");
            AppendInlineRuns(sb, p.Segs[s], k);
        }
        sb.Append("</w:p>");
    }

    private void RegisterFont(DocxRun r)
    {
        if (string.IsNullOrWhiteSpace(r.Font) || fontTable.ContainsKey(r.Font)) return;
        fontTable[r.Font] = r.Info ?? new PdfFontInfo { Family = r.Font };
    }

    /// <summary>
    /// word/fontTable.xml: for every font the text uses, the generic class, pitch, panose and an alternate name.
    /// When the reader's computer lacks the real font, Word / LibreOffice use these to substitute a similar-looking one
    /// instead of an arbitrary default (typically Times New Roman).
    /// </summary>
    private string BuildFontTable()
    {
        var sb = new StringBuilder(Header);
        sb.Append("<w:fonts xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\">");
        if (!fontTable.ContainsKey("Arial"))
            sb.Append("<w:font w:name=\"Arial\"><w:altName w:val=\"Liberation Sans\"/><w:panose1 w:val=\"020B0604020202020204\"/><w:charset w:val=\"00\"/><w:family w:val=\"swiss\"/><w:pitch w:val=\"variable\"/></w:font>");
        foreach (var (name, info) in fontTable)
        {
            sb.Append("<w:font w:name=\"").Append(Esc(name)).Append("\">");
            if (!string.IsNullOrWhiteSpace(info.AltName) && !string.Equals(info.AltName, name, StringComparison.OrdinalIgnoreCase))
                sb.Append("<w:altName w:val=\"").Append(Esc(info.AltName)).Append("\"/>");
            if (info.Panose is { Length: 20 }) sb.Append("<w:panose1 w:val=\"").Append(info.Panose).Append("\"/>");
            sb.Append("<w:charset w:val=\"00\"/>");
            var fam = info.Kind is "swiss" or "roman" or "modern" or "script" or "decorative" ? info.Kind : "auto";
            sb.Append("<w:family w:val=\"").Append(fam).Append("\"/>");
            sb.Append("<w:pitch w:val=\"").Append(info.IsFixedPitch ? "fixed" : "variable").Append("\"/>");
            sb.Append("</w:font>");
        }
        sb.Append("</w:fonts>");
        return sb.ToString();
    }

    /// <summary>Writes the document body and closes the file.</summary>
    public void Finish(string title = "")
    {
        if (finished) return;
        finished = true;
        if (pageCount == 0) throw new InvalidOperationException("There are no pages to write.");

        FlushPending(withBreak: false);   // the last page's section properties are the body-level ones below
        var xml = new StringBuilder(body.Length + 1024);
        xml.Append(Header)
           .Append("<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\" ")
           .Append("xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\" ")
           .Append("xmlns:wp=\"http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing\" ")
           .Append("xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" ")
           .Append("xmlns:pic=\"http://schemas.openxmlformats.org/drawingml/2006/picture\"><w:body>")
           .Append(body)
           .Append(SectPr(lastW, lastH, withBreak: false))
           .Append("</w:body></w:document>");
        WriteEntry("word/document.xml", xml.ToString());

        var rels = new StringBuilder(Header + "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">" +
            "<Relationship Id=\"rIdStyles\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles\" Target=\"styles.xml\"/>" +
            "<Relationship Id=\"rIdSettings\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings\" Target=\"settings.xml\"/>" +
            "<Relationship Id=\"rIdFonts\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable\" Target=\"fontTable.xml\"/>");
        foreach (var (id, target) in media)
            rels.Append("<Relationship Id=\"").Append(id).Append("\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/image\" Target=\"").Append(target).Append("\"/>");
        rels.Append("</Relationships>");
        WriteEntry("word/_rels/document.xml.rels", rels.ToString());

        var now = DateTime.UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", CultureInfo.InvariantCulture);
        WriteEntry("docProps/core.xml", Header +
            "<cp:coreProperties xmlns:cp=\"http://schemas.openxmlformats.org/package/2006/metadata/core-properties\" xmlns:dc=\"http://purl.org/dc/elements/1.1/\" " +
            "xmlns:dcterms=\"http://purl.org/dc/terms/\" xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\">" +
            $"<dc:title>{Esc(title)}</dc:title><dc:creator>PDF Studio</dc:creator>" +
            $"<dcterms:created xsi:type=\"dcterms:W3CDTF\">{now}</dcterms:created><dcterms:modified xsi:type=\"dcterms:W3CDTF\">{now}</dcterms:modified>" +
            "</cp:coreProperties>");

        WriteEntry("word/fontTable.xml", BuildFontTable());

        zip.Dispose();   // also closes the file
    }

    public void Dispose()
    {
        if (!finished) { finished = true; try { zip.Dispose(); } catch { } try { file.Dispose(); } catch { } }
    }
}
