using PdfStudio.Services;
using System.Drawing.Drawing2D;

namespace PdfStudio.UI;

public enum PdfSource { WorkspaceAll, WorkspaceSelected, File }

/// <summary>"Convert what?" radio group shared by the PDF→Images and PDF→Word dialogs.</summary>
internal sealed class SourceGroup
{
    public TableLayoutPanel Host { get; }
    private readonly RadioButton all, sel, file;
    private readonly TextBox path = new() { Dock = DockStyle.Fill, Margin = new Padding(0, 0, 8, 0) };

    public PdfSource Source => file.Checked ? PdfSource.File : sel.Checked ? PdfSource.WorkspaceSelected : PdfSource.WorkspaceAll;
    public string FilePath => path.Text.Trim();
    public event EventHandler? Changed;

    public SourceGroup(int total, int selected)
    {
        Host = new TableLayoutPanel { ColumnCount = 1, AutoSize = true, BackColor = Color.Transparent };
        Host.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        all = new RadioButton { Text = $"All pages in the workspace ({total})", AutoSize = true, Enabled = total > 0, Checked = total > 0 };
        sel = new RadioButton { Text = $"Selected pages only ({selected})", AutoSize = true, Enabled = selected > 0 };
        file = new RadioButton { Text = "Another PDF file", AutoSize = true, Checked = total == 0 };
        foreach (var rb in new[] { all, sel, file }) { rb.Margin = new Padding(0, 3, 0, 3); rb.CheckedChanged += (_, _) => { path.Enabled = file.Checked; Changed?.Invoke(this, EventArgs.Empty); }; Host.RowStyles.Add(new RowStyle()); Host.Controls.Add(rb); }

        var row = new TableLayoutPanel { ColumnCount = 2, AutoSize = true, Dock = DockStyle.Fill, BackColor = Color.Transparent };
        row.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100)); row.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        var browse = new FlatButton { Text = "Browse…", Width = 92, Height = 30, Margin = new Padding(0) };
        browse.Click += (_, _) =>
        {
            using var d = new OpenFileDialog { Filter = "PDF files (*.pdf)|*.pdf" };
            if (d.ShowDialog(Host.FindForm()) == DialogResult.OK) { path.Text = d.FileName; file.Checked = true; }
        };
        row.Controls.Add(path, 0, 0); row.Controls.Add(browse, 1, 0);
        Host.RowStyles.Add(new RowStyle()); Host.Controls.Add(row);
        path.Enabled = file.Checked;
    }

    public string? Validate()
    {
        if (Source != PdfSource.File) return null;
        return File.Exists(FilePath) ? null : "Choose a PDF file to convert.";
    }
}

// ───────────────────────── PDF → Images ─────────────────────────

public sealed class PdfToImagesDialog : ModernDialog
{
    private readonly SourceGroup source;
    private readonly ComboBox format = MakeCombo(("PNG — lossless, supports sharp text", ImageOutputFormat.Png), ("JPEG — small photos", ImageOutputFormat.Jpeg),
        ("WebP — modern, small", ImageOutputFormat.Webp), ("BMP — uncompressed", ImageOutputFormat.Bmp), ("TIFF — archival", ImageOutputFormat.Tiff), ("GIF — 256 colours", ImageOutputFormat.Gif));
    private readonly ComboBox preset = MakeCombo(("Screen — 96 dpi", 96), ("Good — 150 dpi", 150), ("Print — 300 dpi", 300), ("High — 600 dpi", 600), ("Custom", 0));
    private readonly NumericUpDown dpi = Num(36, 1200, 150);
    private readonly NumericUpDown quality = Num(10, 100, 90);
    private readonly TextBox pages = new() { Text = "all" };
    private readonly TextBox prefix = new();
    private readonly TextBox folder;
    private readonly CheckBox openFolder = new() { Text = "Open the folder when finished", AutoSize = true, Checked = true };

    public PdfSource Source => source.Source;
    public string ExternalPath => source.FilePath;
    public string PageRangeText => pages.Text;
    public string OutputFolder => folder.Text.Trim();
    public bool OpenWhenDone => openFolder.Checked;
    public ImageOutputFormat Format => ValueOf<ImageOutputFormat>(format);
    public int Dpi => (int)dpi.Value;
    public int Quality => (int)quality.Value;
    public string Prefix => prefix.Text.Trim();

    public PdfToImagesDialog(int total, int selected, string defaultFolder)
        : base("PDF → Images", "Export pages as picture files in the format and resolution you choose.", 600, "Convert")
    {
        source = new SourceGroup(total, selected);
        var f = FolderPicker(defaultFolder, "Choose where the images are saved");
        folder = f.Box;
        AddRow("Convert", source.Host);
        AddRow("Pages", pages);
        AddNote("Applies to \"Another PDF file\". Use all, 1-3, 5, odd, even.", 1);
        AddHeading("Output");
        AddRow("Format", format);
        AddRow("Resolution", preset);
        AddRow("DPI", dpi);
        AddRow("Quality (JPEG / WebP)", quality);
        AddRow("File name prefix", prefix);
        AddRow("Save to", f.Host);
        AddWide(openFolder);

        preset.SelectedIndex = 1;
        preset.SelectedIndexChanged += (_, _) => { var v = ValueOf<int>(preset); if (v > 0) dpi.Value = v; };
        dpi.ValueChanged += (_, _) => { var m = new[] { 96, 150, 300, 600 }.ToList().IndexOf((int)dpi.Value); preset.SelectedIndex = m >= 0 ? m : 4; };
        format.SelectedIndexChanged += (_, _) => quality.Enabled = Format is ImageOutputFormat.Jpeg or ImageOutputFormat.Webp;
        quality.Enabled = false;
        source.Changed += (_, _) => pages.Enabled = source.Source == PdfSource.File;
        pages.Enabled = source.Source == PdfSource.File;
    }

    protected override bool ValidateInput(out string error)
    {
        error = source.Validate() ?? (string.IsNullOrWhiteSpace(OutputFolder) ? "Choose an output folder." : "");
        return error.Length == 0;
    }
}

// ───────────────────────── PDF → Word ─────────────────────────

public sealed class PdfToWordDialog : ModernDialog
{
    private readonly SourceGroup source;
    private readonly ComboBox quality = MakeCombo(("Standard — 150 dpi (recommended)", 150), ("High — 220 dpi, sharper graphics, bigger file", 220), ("Draft — 96 dpi, smallest file", 96));
    private readonly CheckBox rasterOcr = new()
    {
        Text = "Recognize text inside images/scans (OCR — editable Word text)", AutoSize = true, Checked = true,
        Margin = new Padding(0, 6, 0, 2)
    };
    private readonly CheckBox fullPageArtwork = new()
    {
        Text = "Preserve full-page artwork as one selectable picture (less editable)", AutoSize = true, Checked = false,
        Margin = new Padding(0, 2, 0, 4)
    };
    public PdfSource Source => source.Source;
    public string ExternalPath => source.FilePath;
    public int GraphicsDpi => ValueOf<int>(quality);
    public bool EnableRasterOcr => rasterOcr.Checked;
    public bool IncludeFullPageArtwork => fullPageArtwork.Checked;

    public PdfToWordDialog(int total, int selected)
        : base("PDF → Word", "Convert PDF text into normal, editable Word paragraphs and tables — not one draggable picture per page.", 600, "Convert")
    {
        source = new SourceGroup(total, selected);
        AddRow("Convert", source.Host);
        AddRow("Image quality", quality);
        AddWide(rasterOcr);
        AddWide(fullPageArtwork);
        AddNote("OCR is enabled by default. Text found inside raster images is added as normal Word paragraphs/runs; text-shaped panels are never exported as draggable pictures when OCR fails (they are reported as omitted instead). OCR is English-focused and may need proofreading. Leave the full-page artwork option off for editability: enabling it inserts one large selectable/draggable picture behind the text. Genuine small photos/logos may remain pictures.", 5);
    }

    protected override bool ValidateInput(out string error) { error = source.Validate() ?? ""; return error.Length == 0; }
}

// ───────────────────────── Images → PDF ─────────────────────────

/// <summary>Draws a to-scale mock page showing exactly where the image will land.</summary>
internal sealed class PagePreviewCanvas : Control
{
    public PageImageLayout? Placement { get; set; }
    public Bitmap? Picture { get; set; }
    public string EmptyText { get; set; } = "Add images to see a preview";

    public PagePreviewCanvas()
    {
        SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        g.Clear(Theme.Canvas);
        g.SmoothingMode = SmoothingMode.AntiAlias; g.InterpolationMode = InterpolationMode.HighQualityBicubic;
        if (Placement is not { } L)
        {
            TextRenderer.DrawText(g, EmptyText, Theme.Ui(9f), ClientRectangle, Theme.Muted, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter);
            return;
        }
        var m = 14;
        var s = Math.Min((Width - m * 2) / L.PageW, (Height - m * 2 - 16) / L.PageH);
        var pw = (float)(L.PageW * s); var ph = (float)(L.PageH * s);
        var page = new RectangleF((Width - pw) / 2, m + (Height - m * 2 - 16 - ph) / 2, pw, ph);
        using (var sh = new SolidBrush(Color.FromArgb(40, 0, 0, 0))) g.FillRectangle(sh, page.X + 2, page.Y + 3, page.Width, page.Height);
        g.FillRectangle(Brushes.White, page);

        var content = new RectangleF(page.X + (float)(L.ContentX * s), page.Y + (float)(L.ContentY * s), (float)(L.ContentW * s), (float)(L.ContentH * s));
        var draw = new RectangleF(page.X + (float)(L.DrawX * s), page.Y + (float)(L.DrawY * s), (float)(L.DrawW * s), (float)(L.DrawH * s));
        var st = g.Save();
        g.SetClip(content, CombineMode.Intersect);
        if (Picture is not null) g.DrawImage(Picture, draw);
        else using (var b = new SolidBrush(Color.FromArgb(60, Theme.Accent))) g.FillRectangle(b, draw);
        g.Restore(st);
        using (var pen = new Pen(Color.FromArgb(120, 130, 140), 1f) { DashStyle = DashStyle.Dash }) g.DrawRectangle(pen, content.X, content.Y, content.Width, content.Height);
        using (var pen = new Pen(Color.FromArgb(90, 0, 0, 0))) g.DrawRectangle(pen, page.X, page.Y, page.Width, page.Height);
        TextRenderer.DrawText(g, $"{L.PageW * 25.4 / 72:0.#} × {L.PageH * 25.4 / 72:0.#} mm", Theme.Ui(8.5f),
            new Rectangle(0, Height - 20, Width, 18), Theme.Muted, TextFormatFlags.HorizontalCenter);
    }
}

public sealed class ImageToPdfDialog : ModernDialog
{
    private sealed record Entry(string Path) { public override string ToString() => System.IO.Path.GetFileName(Path); }

    private readonly ListBox list = new() { Dock = DockStyle.Fill, SelectionMode = SelectionMode.MultiExtended, AllowDrop = true, IntegralHeight = false };
    private readonly PagePreviewCanvas canvas = new() { Dock = DockStyle.Top, Height = 190 };
    private readonly ComboBox pageSize = MakeCombo(("Same size as image", ImagePdfPageSize.FitToImage), ("A4", ImagePdfPageSize.A4), ("A3", ImagePdfPageSize.A3), ("A5", ImagePdfPageSize.A5),
        ("B5", ImagePdfPageSize.B5), ("Letter", ImagePdfPageSize.Letter), ("Legal", ImagePdfPageSize.Legal), ("Tabloid", ImagePdfPageSize.Tabloid), ("Custom size…", ImagePdfPageSize.Custom));
    private readonly ComboBox orientation = MakeCombo(("Auto (match each image)", ImagePdfOrientation.Auto), ("Portrait", ImagePdfOrientation.Portrait), ("Landscape", ImagePdfOrientation.Landscape));
    private readonly ComboBox fit = MakeCombo(("Fit inside page", ImagePdfFit.Contain), ("Fill page (crop edges)", ImagePdfFit.Cover), ("Stretch to page", ImagePdfFit.Stretch), ("Actual size (from DPI)", ImagePdfFit.ActualSize));
    private readonly NumericUpDown margin = Num(0, 100, 10, 1);
    private readonly NumericUpDown customW = Num(10, 2000, 210, 1);
    private readonly NumericUpDown customH = Num(10, 2000, 297, 1);
    private Bitmap? previewBmp;
    private string? previewPath;

    public IReadOnlyList<string> Images => list.Items.Cast<Entry>().Select(e => e.Path).ToList();
    public ImagePdfOptions Options => new()
    {
        PageSize = ValueOf<ImagePdfPageSize>(pageSize), Orientation = ValueOf<ImagePdfOrientation>(orientation), Fit = ValueOf<ImagePdfFit>(fit),
        MarginMm = (double)margin.Value, CustomWidthMm = (double)customW.Value, CustomHeightMm = (double)customH.Value
    };

    public ImageToPdfDialog(IEnumerable<string> paths) : base("Images → PDF", "Choose the page size and how each picture sits on its page.", 860, "Create PDF")
    {
        FixedBodyHeight = 400;
        foreach (var p in paths) list.Items.Add(new Entry(p));

        var left = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 3, BackColor = Color.Transparent, Margin = new Padding(0, 0, 14, 0) };
        left.RowStyles.Add(new RowStyle(SizeType.AutoSize)); left.RowStyles.Add(new RowStyle(SizeType.Percent, 100)); left.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        left.Controls.Add(new Txt("Images (page order)", 9.5f, FontStyle.Bold) { AutoSize = true, Margin = new Padding(0, 4, 0, 6) }, 0, 0);
        left.Controls.Add(list, 0, 1);
        var bar = new FlowLayoutPanel { AutoSize = true, WrapContents = true, BackColor = Color.Transparent, Margin = new Padding(0, 8, 0, 0), Dock = DockStyle.Fill };
        FlatButton Btn(string text, int w, Action a) { var b = new FlatButton { Text = text, Width = w, Height = 30, Margin = new Padding(0, 0, 6, 6) }; b.Click += (_, _) => a(); return b; }
        bar.Controls.Add(Btn("Add…", 70, AddFiles)); bar.Controls.Add(Btn("Remove", 76, RemoveSelected));
        bar.Controls.Add(Btn("▲", 40, () => MoveItems(-1))); bar.Controls.Add(Btn("▼", 40, () => MoveItems(1))); bar.Controls.Add(Btn("Clear", 64, () => { list.Items.Clear(); Refresh2(); }));
        left.Controls.Add(bar, 0, 2);

        var opts = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2, AutoSize = true, BackColor = Color.Transparent };
        opts.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 38)); opts.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 62));
        void Row(string label, Control c)
        {
            var r = opts.RowCount++; opts.RowStyles.Add(new RowStyle());
            opts.Controls.Add(new Txt(label) { AutoSize = true, Anchor = AnchorStyles.Left, Margin = new Padding(0, 5, 6, 5), ForeColor = Theme.Muted, Muted = true }, 0, r);
            c.Dock = DockStyle.Fill; c.Margin = new Padding(0, 3, 0, 3); opts.Controls.Add(c, 1, r);
        }
        Row("Page size", pageSize); Row("Custom W (mm)", customW); Row("Custom H (mm)", customH); Row("Orientation", orientation);
        Row("Image fit", fit); Row("Margin (mm)", margin);

        var right = new Panel { Dock = DockStyle.Fill, BackColor = Color.Transparent };
        right.Controls.Add(opts); canvas.Margin = new Padding(0); right.Controls.Add(canvas);

        var split = new TableLayoutPanel { Dock = DockStyle.Top, Height = 400, ColumnCount = 2, BackColor = Color.Transparent };
        split.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 42)); split.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 58));
        split.Controls.Add(left, 0, 0); split.Controls.Add(right, 1, 0);
        AddWide(split, 0);
        StretchTarget = split;

        list.DragEnter += (_, e) => e.Effect = e.Data?.GetDataPresent(DataFormats.FileDrop) == true ? DragDropEffects.Copy : DragDropEffects.None;
        list.DragDrop += (_, e) => { if (e.Data?.GetData(DataFormats.FileDrop) is string[] fs) AddPaths(fs); };
        list.SelectedIndexChanged += (_, _) => Refresh2();
        foreach (var c in new Control[] { pageSize, orientation, fit, margin, customW, customH })
        {
            if (c is ComboBox cb) cb.SelectedIndexChanged += (_, _) => Refresh2();
            else if (c is NumericUpDown n) n.ValueChanged += (_, _) => Refresh2();
        }
        pageSize.SelectedIndexChanged += (_, _) => UpdateEnabled();
        fit.SelectedIndexChanged += (_, _) => UpdateEnabled();
        Shown += (_, _) => { if (list.Items.Count > 0 && list.SelectedIndex < 0) list.SelectedIndex = 0; UpdateEnabled(); Refresh2(); };
    }

    private void UpdateEnabled()
    {
        var size = ValueOf<ImagePdfPageSize>(pageSize);
        customW.Enabled = customH.Enabled = size == ImagePdfPageSize.Custom;
        orientation.Enabled = size != ImagePdfPageSize.FitToImage;
    }

    private void AddFiles()
    {
        using var d = new OpenFileDialog { Filter = ImagePdfService.ImageFilter, Multiselect = true };
        if (d.ShowDialog(this) == DialogResult.OK) AddPaths(d.FileNames);
    }

    private void AddPaths(IEnumerable<string> paths)
    {
        foreach (var p in paths.Where(ImagePdfService.IsImage).OrderBy(p => p, StringComparer.OrdinalIgnoreCase))
            list.Items.Add(new Entry(p));
        if (list.SelectedIndex < 0 && list.Items.Count > 0) list.SelectedIndex = 0;
        Refresh2();
    }

    private void RemoveSelected()
    {
        foreach (var i in list.SelectedItems.Cast<object>().ToList()) list.Items.Remove(i);
        Refresh2();
    }

    private void MoveItems(int dir)
    {
        var idx = list.SelectedIndices.Cast<int>().OrderBy(i => i).ToList();
        if (idx.Count == 0) return;
        if (dir < 0 && idx[0] == 0 || dir > 0 && idx[^1] == list.Items.Count - 1) return;
        if (dir > 0) idx.Reverse();
        foreach (var i in idx) { var it = list.Items[i]; list.Items.RemoveAt(i); list.Items.Insert(i + dir, it); }
        list.ClearSelected();
        foreach (var i in idx) list.SetSelected(i + dir, true);
    }

    private void Refresh2()
    {
        if (IsDisposed) return;
        var entry = (list.SelectedItem ?? (list.Items.Count > 0 ? list.Items[0] : null)) as Entry;
        if (entry is null) { canvas.Placement = null; canvas.Picture = null; canvas.Invalidate(); return; }
        try
        {
            if (previewPath != entry.Path) { previewBmp?.Dispose(); previewBmp = ImagePdfService.LoadPreview(entry.Path); previewPath = entry.Path; }
            var info = ImagePdfService.ReadInfo(entry.Path);
            canvas.Placement = ImagePdfService.ComputeLayout(info.Width, info.Height, info.XDpi, info.YDpi, Options);
            canvas.Picture = previewBmp;
        }
        catch { canvas.Placement = null; canvas.Picture = null; }
        canvas.Invalidate();
    }

    protected override bool ValidateInput(out string error)
    {
        error = list.Items.Count == 0 ? "Add at least one image." : "";
        return error.Length == 0;
    }

    protected override void OnFormClosed(FormClosedEventArgs e) { previewBmp?.Dispose(); base.OnFormClosed(e); }
}
