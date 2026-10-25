using PdfStudio.Models;
using PdfStudio.Services;

namespace PdfStudio.UI;

public sealed class InputDialog : ModernDialog
{
    private readonly TextBox box = new();
    public string Value => box.Text.Trim();

    private InputDialog(string title, string prompt, string initial, bool password)
        : base(title, prompt, 460)
    {
        box.Text = initial; box.UseSystemPasswordChar = password;
        AddWide(box);
        Shown += (_, _) => { box.Focus(); box.SelectAll(); };
    }

    public static string? Show(IWin32Window owner, string title, string prompt, string initial = "", bool password = false)
    {
        using var d = new InputDialog(title, prompt, initial, password);
        return d.ShowDialog(owner) == DialogResult.OK ? d.Value : null;
    }
}

public enum OverlayScope { ThisPage, SelectedPages, AllPages }

public sealed class TextOverlayDialog : ModernDialog
{
    private readonly TextBox text = new() { Multiline = true, Height = 74, ScrollBars = ScrollBars.Vertical, AcceptsReturn = true };
    private readonly ComboBox font = new ModernCombo();
    private readonly NumericUpDown size = Num(6, 200, 20);
    private readonly CheckBox bold = new() { Text = "Bold", AutoSize = true };
    private readonly CheckBox italic = new() { Text = "Italic", AutoSize = true };
    private readonly ComboBox hAnchor = MakeCombo(("Left", HAnchor.Left), ("Center", HAnchor.Center), ("Right", HAnchor.Right));
    private readonly ComboBox vAnchor = MakeCombo(("Top", VAnchor.Top), ("Middle", VAnchor.Middle), ("Bottom", VAnchor.Bottom));
    private readonly NumericUpDown offX = Num(-600, 600, 0);
    private readonly NumericUpDown offY = Num(-800, 800, 0);
    private readonly ComboBox scope;
    private readonly Panel swatch = new() { Width = 34, Height = 26, BorderStyle = BorderStyle.FixedSingle, Margin = new Padding(0, 2, 10, 2) };
    private string colorHex = "#111111";

    public PageTextAnnotation Annotation => new()
    {
        Text = text.Text, FontName = font.SelectedItem?.ToString() ?? "Arial", FontSize = (double)size.Value,
        Bold = bold.Checked, Italic = italic.Checked, ColorHex = colorHex,
        H = ValueOf<HAnchor>(hAnchor), V = ValueOf<VAnchor>(vAnchor), OffsetX = (double)offX.Value, OffsetY = (double)offY.Value
    };
    public OverlayScope Scope => ValueOf<OverlayScope>(scope);

    public TextOverlayDialog(int selectedCount)
        : base("Add text to pages", "Place a text label, stamp or note. It is saved into the exported PDF.", 560, "Add text")
    {
        font.Items.AddRange(new object[] { "Arial", "Times New Roman", "Courier New", "Verdana", "Segoe UI", "Calibri", "Tahoma", "Georgia" });
        font.SelectedIndex = 0;
        scope = MakeCombo(("This page only", OverlayScope.ThisPage),
                          ($"Selected pages ({selectedCount})", OverlayScope.SelectedPages),
                          ("All pages", OverlayScope.AllPages));

        AddRow("Text", text);
        AddRow("Font", font);
        AddRow("Size (pt)", size);

        var style = new FlowLayoutPanel { AutoSize = true, BackColor = Color.Transparent, WrapContents = false };
        var pick = new FlatButton { Text = "Colour…", Width = 96, Height = 30, Margin = new Padding(0, 0, 14, 0) };
        swatch.BackColor = ColorTranslator.FromHtml(colorHex);
        pick.Click += (_, _) =>
        {
            using var cd = new ColorDialog { Color = swatch.BackColor, FullOpen = true };
            if (cd.ShowDialog(this) == DialogResult.OK) { swatch.BackColor = cd.Color; colorHex = $"#{cd.Color.R:X2}{cd.Color.G:X2}{cd.Color.B:X2}"; }
        };
        bold.Margin = new Padding(0, 4, 14, 0); italic.Margin = new Padding(0, 4, 0, 0);
        style.Controls.AddRange(new Control[] { swatch, pick, bold, italic });
        AddRow("Style", style);

        AddHeading("Position");
        AddRow("Horizontal", hAnchor);
        AddRow("Vertical", vAnchor);
        AddRow("Nudge right (pt)", offX);
        AddRow("Nudge down (pt)", offY);
        AddHeading("Apply to");
        AddRow("Pages", scope);
        AddNote("Positions are anchored to the page edges, so the same setting works on A4, Letter and landscape pages alike.");
        if (selectedCount > 1) SelectValue(scope, OverlayScope.SelectedPages);
    }

    protected override bool ValidateInput(out string error)
    {
        error = string.IsNullOrWhiteSpace(text.Text) ? "Enter the text to add." : "";
        return error.Length == 0;
    }
}

public sealed class ImageOverlayDialog : ModernDialog
{
    private readonly TextBox path = new();
    private readonly NumericUpDown widthMm = Num(5, 400, 40);
    private readonly ComboBox hAnchor = MakeCombo(("Left", HAnchor.Left), ("Center", HAnchor.Center), ("Right", HAnchor.Right));
    private readonly ComboBox vAnchor = MakeCombo(("Top", VAnchor.Top), ("Middle", VAnchor.Middle), ("Bottom", VAnchor.Bottom));
    private readonly NumericUpDown offX = Num(-600, 600, 0);
    private readonly NumericUpDown offY = Num(-800, 800, 0);
    private readonly ComboBox scope;

    public PageImageAnnotation Annotation => new()
    {
        Path = path.Text.Trim(), WidthPt = (double)widthMm.Value * 72.0 / 25.4,
        H = ValueOf<HAnchor>(hAnchor), V = ValueOf<VAnchor>(vAnchor), OffsetX = (double)offX.Value, OffsetY = (double)offY.Value
    };
    public OverlayScope Scope => ValueOf<OverlayScope>(scope);

    public ImageOverlayDialog(int selectedCount)
        : base("Add an image to pages", "Place a logo, stamp or signature picture. It is saved into the exported PDF.", 560, "Add image")
    {
        scope = MakeCombo(("This page only", OverlayScope.ThisPage),
                          ($"Selected pages ({selectedCount})", OverlayScope.SelectedPages),
                          ("All pages", OverlayScope.AllPages));

        var host = new TableLayoutPanel { ColumnCount = 2, RowCount = 1, AutoSize = true, BackColor = Color.Transparent };
        host.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        host.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        path.Dock = DockStyle.Fill; path.Margin = new Padding(0, 0, 8, 0);
        var browse = new FlatButton { Text = "Browse…", Width = 92, Height = 30, Margin = new Padding(0) };
        browse.Click += (_, _) =>
        {
            using var d = new OpenFileDialog { Title = "Choose a picture", Filter = "Pictures|*.png;*.jpg;*.jpeg;*.bmp;*.gif;*.tif;*.tiff|All files|*.*" };
            if (d.ShowDialog(this) == DialogResult.OK) path.Text = d.FileName;
        };
        host.Controls.Add(path, 0, 0); host.Controls.Add(browse, 1, 0);

        AddRow("Picture", host);
        var savedSigs = SignatureStore.List();
        if (savedSigs.Count > 0)
        {
            var savedBox = new ModernCombo();
            savedBox.Items.Add("Choose one of your saved signatures…");
            foreach (var s in savedSigs) savedBox.Items.Add(new Choice<SavedSignature>(s.Name, s));
            savedBox.SelectedIndex = 0;
            savedBox.SelectedIndexChanged += (_, _) =>
            {
                if (savedBox.SelectedItem is Choice<SavedSignature> c && File.Exists(c.Value.Path)) path.Text = CopyForExport(c.Value.Path);
            };
            AddRow("Saved signature", savedBox);
        }
        AddRow("Width (mm)", widthMm);
        AddHeading("Position");
        AddRow("Horizontal", hAnchor);
        AddRow("Vertical", vAnchor);
        AddRow("Nudge right (pt)", offX);
        AddRow("Nudge down (pt)", offY);
        AddHeading("Apply to");
        AddRow("Pages", scope);
        AddNote("PNG pictures with a transparent background make the best signatures and logos. Positions are anchored to the page edges.");
        SelectValue(hAnchor, HAnchor.Right); SelectValue(vAnchor, VAnchor.Bottom);
        if (selectedCount > 1) SelectValue(scope, OverlayScope.SelectedPages);
    }

    /// <summary>A private copy, so deleting the signature from the library later cannot break the export.</summary>
    private static string CopyForExport(string source)
    {
        try
        {
            var dir = Path.Combine(Path.GetTempPath(), "PdfStudio"); Directory.CreateDirectory(dir);
            var copy = Path.Combine(dir, $"sig_{Guid.NewGuid():N}.png");
            File.Copy(source, copy, true);
            return copy;
        }
        catch { return source; }
    }

    protected override bool ValidateInput(out string error)
    {
        error = File.Exists(path.Text.Trim()) ? "" : "Choose a picture file (PNG, JPG, BMP, GIF or TIFF).";
        return error.Length == 0;
    }
}

public enum BlankSize { MatchPage, A4, A3, A5, Letter, Legal }
public enum BlankPosition { AfterActive, AtEnd, AtStart }

public sealed class BlankPageDialog : ModernDialog
{
    private readonly ComboBox size = MakeCombo(("Same as current page", BlankSize.MatchPage), ("A4", BlankSize.A4), ("A3", BlankSize.A3),
        ("A5", BlankSize.A5), ("Letter", BlankSize.Letter), ("Legal", BlankSize.Legal));
    private readonly ComboBox orient = MakeCombo(("Portrait", false), ("Landscape", true));
    private readonly NumericUpDown count = Num(1, 200, 1);
    private readonly ComboBox placement = MakeCombo(("After the active page", BlankPosition.AfterActive), ("At the end", BlankPosition.AtEnd), ("At the start", BlankPosition.AtStart));

    public BlankSize PageSizeChoice => ValueOf<BlankSize>(size);
    public bool Landscape => ValueOf<bool>(orient);
    public int Count => (int)count.Value;
    public BlankPosition Position => ValueOf<BlankPosition>(placement);

    public BlankPageDialog() : base("Insert blank pages", "Add empty pages for notes, separators or double-sided printing.", 480, "Insert")
    {
        AddRow("Page size", size); AddRow("Orientation", orient); AddRow("How many", count); AddRow("Insert", placement);
    }
}

public enum SplitMode { EveryN, EachPage, AtActive, Ranges }

public sealed class SplitDialog : ModernDialog
{
    private readonly ComboBox mode;
    private readonly NumericUpDown every = Num(1, 5000, 1);
    private readonly TextBox ranges = new() { Text = "1-3, 4-6" };
    private readonly TextBox baseName = new();
    private readonly TextBox folder;
    private readonly int pageCount, active;

    public SplitMode Mode => ValueOf<SplitMode>(mode);
    public int EveryN => (int)every.Value;
    public string Ranges => ranges.Text;
    public string BaseName => string.IsNullOrWhiteSpace(baseName.Text) ? "Part" : baseName.Text.Trim();
    public string Folder => folder.Text.Trim();

    public SplitDialog(int pageCount, int activeIndex, string defaultFolder)
        : base("Split document", $"Cut the current {pageCount}-page sequence into separate PDF files.", 540, "Split")
    {
        this.pageCount = pageCount; active = activeIndex;
        mode = MakeCombo(("Every N pages", SplitMode.EveryN), ("Each page as its own PDF", SplitMode.EachPage),
                         (activeIndex >= 0 ? $"Two parts — split after page {activeIndex + 1}" : "Two parts — split after the active page", SplitMode.AtActive),
                         ("Custom page ranges", SplitMode.Ranges));
        every.Value = Math.Min(every.Maximum, Math.Max(1, pageCount / 2));
        baseName.Text = "Part";
        var f = FolderPicker(defaultFolder, "Choose where the split files are saved");
        folder = f.Box;
        AddRow("Split", mode);
        AddRow("Pages per file", every);
        AddRow("Ranges", ranges);
        AddNote("Ranges: one file per comma-separated item, e.g. \"1-3, 4-6, 9\".", 1);
        AddRow("File name", baseName);
        AddRow("Save to", f.Host);
        mode.SelectedIndexChanged += (_, _) => UpdateEnabled();
        UpdateEnabled();
    }

    private void UpdateEnabled()
    {
        every.Enabled = Mode == SplitMode.EveryN;
        ranges.Enabled = Mode == SplitMode.Ranges;
    }

    protected override bool ValidateInput(out string error)
    {
        error = "";
        if (!Directory.Exists(Folder) && string.IsNullOrWhiteSpace(Folder)) error = "Choose a folder to save the split files.";
        else if (Mode == SplitMode.AtActive && (active < 0 || active >= pageCount - 1)) error = "Select a page that is not the last page, then try again.";
        else if (Mode == SplitMode.Ranges)
        {
            try { PageRange.ParseGroups(Ranges, pageCount); } catch (FormatException ex) { error = ex.Message; }
        }
        return error.Length == 0;
    }
}
