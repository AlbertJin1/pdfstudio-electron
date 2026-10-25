using PdfStudio.Models;
using PdfStudio.Services;

namespace PdfStudio.UI;

/// <summary>Choose one page size for the whole exported PDF and how pages of other sizes are fitted into it.</summary>
public sealed class PageSizeDialog : ModernDialog
{
    private readonly IReadOnlyList<PageItem> pages;
    private readonly ComboBox size = MakeCombo(
        ("Keep each page's own size", TargetPageSize.Original),
        ("Same as the first page", TargetPageSize.SameAsFirst),
        ("Same as the largest page", TargetPageSize.Largest),
        ("A4  (210 × 297 mm)", TargetPageSize.A4), ("A3  (297 × 420 mm)", TargetPageSize.A3),
        ("A5  (148 × 210 mm)", TargetPageSize.A5), ("B5  (176 × 250 mm)", TargetPageSize.B5),
        ("Letter  (8.5 × 11 in)", TargetPageSize.Letter), ("Legal  (8.5 × 14 in)", TargetPageSize.Legal),
        ("Tabloid  (11 × 17 in)", TargetPageSize.Tabloid), ("Custom size…", TargetPageSize.Custom));
    private readonly ComboBox orientation = MakeCombo(
        ("Auto — match each page", TargetOrientation.Auto), ("Portrait", TargetOrientation.Portrait), ("Landscape", TargetOrientation.Landscape));
    private readonly ComboBox fit = MakeCombo(
        ("Fit inside page (keep proportions)", PageFitMode.Contain),
        ("Shrink only if larger (never enlarge)", PageFitMode.ShrinkOnly),
        ("Fill page (crop the edges)", PageFitMode.Cover),
        ("Stretch to page", PageFitMode.Stretch),
        ("Actual size (centred, no scaling)", PageFitMode.ActualSize));
    private readonly NumericUpDown margin = Num(0, 100, 0, 1);
    private readonly NumericUpDown customW = Num(10, 5000, 210, 1);
    private readonly NumericUpDown customH = Num(10, 5000, 297, 1);
    private readonly PagePreviewCanvas canvas = new() { Dock = DockStyle.Fill, EmptyText = "No pages to preview" };
    private readonly Txt sampleLabel = new("", 9f, FontStyle.Regular, true) { Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleCenter };
    private int sample;

    public PageLayoutOptions Result { get; private set; }

    public PageSizeDialog(PageLayoutOptions current, IReadOnlyList<PageItem> pages, string okText = "Apply")
        : base("Page size for all pages", "Give every page the same size — mixed sizes are fitted into it.", 820, okText)
    {
        this.pages = pages;
        Result = current.Clone();
        FixedBodyHeight = 410;

        SelectValue(size, current.Size); SelectValue(orientation, current.Orientation); SelectValue(fit, current.Fit);
        margin.Value = Math.Clamp((decimal)current.MarginMm, 0, 100);
        customW.Value = Math.Clamp((decimal)current.CustomWidthMm, 10, 5000);
        customH.Value = Math.Clamp((decimal)current.CustomHeightMm, 10, 5000);

        // left: what the document has now + the options
        var info = new Txt(pages.Count == 0 ? "No pages loaded yet — this applies to the next export."
                                           : "Your pages:  " + PageSizing.SummariseSizes(pages), 9f)
        { Dock = DockStyle.Top, Height = 48, Margin = new Padding(0) };
        var opts = new TableLayoutPanel { Dock = DockStyle.Top, ColumnCount = 2, AutoSize = true, BackColor = Color.Transparent };
        opts.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 34)); opts.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 66));
        void Row(string label, Control c)
        {
            var r = opts.RowCount++; opts.RowStyles.Add(new RowStyle());
            opts.Controls.Add(new Txt(label) { AutoSize = true, Anchor = AnchorStyles.Left, Margin = new Padding(0, 5, 6, 5), ForeColor = Theme.Muted, Muted = true }, 0, r);
            c.Dock = DockStyle.Fill; c.Margin = new Padding(0, 3, 0, 3); opts.Controls.Add(c, 1, r);
        }
        Row("Page size", size); Row("Custom W (mm)", customW); Row("Custom H (mm)", customH);
        Row("Orientation", orientation); Row("Fit pages", fit); Row("Margin (mm)", margin);
        var note = new Txt("Pages that already match are copied untouched. Other pages are redrawn onto the new size as vector, so text stays sharp. " +
                           "Links and form fields on resized pages are not kept.", 8.5f, FontStyle.Regular, true) { Dock = DockStyle.Bottom, Height = 70 };
        var left = new Panel { Dock = DockStyle.Fill, BackColor = Color.Transparent, Margin = new Padding(0, 0, 14, 0) };
        left.Controls.Add(note); left.Controls.Add(opts); left.Controls.Add(info);

        // right: live preview with a page picker
        FlatButton Nav(string text, int dir)
        {
            var b = new FlatButton { Text = text, Width = 44, Height = 30, Margin = new Padding(0, 3, 6, 3) };
            b.Click += (_, _) => { if (pages.Count > 0) { sample = (sample + dir + pages.Count) % pages.Count; RefreshPreview(); } };
            return b;
        }
        var nav = new TableLayoutPanel { Dock = DockStyle.Bottom, Height = 38, ColumnCount = 3, RowCount = 1, BackColor = Color.Transparent };
        nav.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize)); nav.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize)); nav.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        nav.Controls.Add(Nav("◀", -1), 0, 0); nav.Controls.Add(Nav("▶", 1), 1, 0); nav.Controls.Add(sampleLabel, 2, 0);
        var right = new Panel { Dock = DockStyle.Fill, BackColor = Color.Transparent };
        right.Controls.Add(canvas); right.Controls.Add(nav);

        var split = new TableLayoutPanel { Dock = DockStyle.Top, Height = 410, ColumnCount = 2, BackColor = Color.Transparent };
        split.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 48)); split.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 52));
        split.Controls.Add(left, 0, 0); split.Controls.Add(right, 1, 0);
        AddWide(split, 0);
        StretchTarget = split;

        foreach (var c in new ComboBox[] { size, orientation, fit }) c.SelectedIndexChanged += (_, _) => { UpdateEnabled(); RefreshPreview(); };
        foreach (var n in new[] { margin, customW, customH }) n.ValueChanged += (_, _) => RefreshPreview();
        Shown += (_, _) => { UpdateEnabled(); RefreshPreview(); };
    }

    private PageLayoutOptions Current() => new()
    {
        Size = ValueOf<TargetPageSize>(size), Orientation = ValueOf<TargetOrientation>(orientation), Fit = ValueOf<PageFitMode>(fit),
        MarginMm = (double)margin.Value, CustomWidthMm = (double)customW.Value, CustomHeightMm = (double)customH.Value
    };

    private void UpdateEnabled()
    {
        var o = Current();
        customW.Enabled = customH.Enabled = o.Size == TargetPageSize.Custom;
        orientation.Enabled = fit.Enabled = margin.Enabled = !o.IsOriginal;
    }

    private void RefreshPreview()
    {
        if (IsDisposed) return;
        var o = Current();
        PageItem? p = pages.Count > 0 ? pages[Math.Clamp(sample, 0, pages.Count - 1)] : null;
        double cw = 595.28, ch = 841.89;
        if (p is not null) (cw, ch) = p.DisplaySizePt(true);

        if (o.IsOriginal) canvas.Placement = new PageImageLayout(cw, ch, 0, 0, cw, ch, 0, 0, cw, ch);
        else
        {
            var pl = PageSizing.Place(cw, ch, o, PageSizing.ResolveBase(o, pages));
            canvas.Placement = new PageImageLayout(pl.PageW, pl.PageH, pl.X, pl.Y, pl.W, pl.H, pl.ClipX, pl.ClipY, pl.ClipW, pl.ClipH);
        }
        sampleLabel.Text = p is null ? "" : $"Page {sample + 1} of {pages.Count}  ·  now {PageSizing.Describe(cw, ch)}";
        canvas.Invalidate();
    }

    protected override bool ValidateInput(out string error)
    {
        error = "";
        Result = Current();
        return true;
    }
}
