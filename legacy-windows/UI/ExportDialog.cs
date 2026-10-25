using PdfStudio.Models;
using PdfStudio.Services;

namespace PdfStudio.UI;

/// <summary>
/// Export options: details, page size, page numbers, watermark, compression and password protection.
/// A segmented tab strip (with a dot on every tab that has settings switched on) sits above one settings page per tab;
/// the footer summarises everything that will be applied. Ctrl+Tab / Ctrl+Shift+Tab (or Ctrl+PageDown / PageUp) move
/// between tabs; Tab walks through the fields of the visible page and then the buttons.
/// </summary>
public sealed class ExportDialog : ModernDialog
{
    private const int TabDetails = 0, TabSize = 1, TabNumbers = 2, TabWatermark = 3, TabCompress = 4, TabProtect = 5;

    private readonly ExportOptions o;
    private PageLayoutOptions layout;
    private bool building = true;

    private readonly SegmentedTabs tabs = new() { Dock = DockStyle.Top, Height = 44 };
    private readonly Panel host = new() { Dock = DockStyle.Fill };
    private readonly List<SettingsPage> tabPages = new();
    private readonly Txt footerNote = new("", 9f, FontStyle.Regular, true) { Width = 400, TextAlign = ContentAlignment.MiddleLeft, AutoEllipsis = true };

    // details
    private readonly InputField title = new(false, "Document title");
    private readonly InputField author = new(false, "Author name");
    private readonly InputField subject = new(false, "What the document is about");
    private readonly InputField keywords = new(false, "Words separated by commas");

    // page size
    private readonly NoteCard layoutCard = new("", "\uE7C3");

    // page numbers
    private readonly ToggleSwitch numbers = new("Add page numbers to every page");
    private readonly ComboBox numPos = MakeCombo(("Bottom centre", PageNumberPosition.BottomCenter), ("Bottom right", PageNumberPosition.BottomRight), ("Bottom left", PageNumberPosition.BottomLeft),
        ("Top centre", PageNumberPosition.TopCenter), ("Top right", PageNumberPosition.TopRight), ("Top left", PageNumberPosition.TopLeft));
    private readonly ComboBox numFmt = MakeCombo(("1", PageNumberFormat.Number), ("Page 1", PageNumberFormat.PageN), ("Page 1 of 10", PageNumberFormat.PageNOfTotal), ("1 / 10", PageNumberFormat.NSlashTotal));
    private readonly ModernNumber numStart = new(0, 9999, 1);
    private readonly ModernNumber numSize = new(6, 40, 10, 0, 1, " pt");
    private readonly ToggleSwitch skipFirst = new("Skip the first page (cover)");

    // watermark
    private readonly ToggleSwitch watermark = new("Add a text watermark");
    private readonly InputField wmText = new(false, "CONFIDENTIAL");
    private readonly ModernNumber wmOpacity = new(3, 100, 20, 0, 1, " %");
    private readonly ModernNumber wmSize = new(10, 300, 64, 0, 1, " pt");
    private readonly ModernNumber wmAngle = new(-90, 90, -35, 0, 1, " °");

    // compression
    private readonly SegmentedTabs method = new() { Height = 36 };
    private readonly ComboBox compression = MakeCombo(("None (keep original quality)", PdfCompression.None), ("Light — print quality", PdfCompression.Light),
        ("Balanced — good for email", PdfCompression.Balanced), ("Strong — smallest file", PdfCompression.Strong));
    private readonly ModernNumber reducePct = new(1, 95, 50, 0, 1, " %");
    private readonly ModernNumber targetMb = new(0.05m, 4096m, 2m, 2, 0.5m, " MB");
    private readonly ToggleSwitch grayscale = new("Convert to grayscale (saves ink, smaller scans)");
    private readonly NoteCard compCard = new(
        "Built in, nothing to install. Percentage and target size are measured against the file as it would be saved without compression: " +
        "pictures are re-encoded as gently as possible to reach the goal, and text stays sharp. If a target is too small to reach " +
        "(mostly-text files), you are told.", "\uE946", "How compression works");

    // protection
    private readonly InputField userPw = new(true, "Leave empty for no password");
    private readonly InputField ownerPw = new(true, "Leave empty for no restrictions");
    private readonly ToggleSwitch allowPrint = new("Printing");
    private readonly ToggleSwitch allowCopy = new("Copying text and images");
    private readonly ToggleSwitch allowEdit = new("Editing");

    private SettingsPage pgNumbers = null!, pgWatermark = null!, pgCompress = null!, pgProtect = null!;

    public ExportOptions Result { get; private set; }

    public ExportDialog(ExportOptions current, int pageCount, string okText = "Export PDF", IReadOnlyList<PageItem>? pages = null)
        : base("Export PDF", $"{pageCount} page(s) will be written in the exact order shown.", 780, okText)
    {
        o = current; Result = current;
        layout = current.Layout.Clone();
        FixedBodyHeight = 44 + 14 + 350;

        // the base class' two-column form grid is not used: this dialog lays out its own tabbed content
        Root.Controls.Remove(Grid);
        Root.Padding = new Padding(24, 8, 24, 10);
        AddFooterNote(footerNote);

        tabs.SetItems("Details", "Page size", "Page numbers", "Watermark", "Compress", "Protect");
        method.SetItems("Preset", "Percentage", "Target size");

        AddPage(BuildDetails());
        AddPage(BuildPageSize(pages ?? Array.Empty<PageItem>()));
        AddPage(pgNumbers = BuildNumbers());
        AddPage(pgWatermark = BuildWatermark());
        AddPage(pgCompress = BuildCompress());
        AddPage(pgProtect = BuildProtect());

        // content = tab strip, a little air, then the page area (docking is resolved bottom-up, so Fill goes in first)
        var content = new Panel { Dock = DockStyle.Fill };
        content.Controls.Add(host);
        content.Controls.Add(new Panel { Dock = DockStyle.Top, Height = 14, TabStop = false });
        content.Controls.Add(tabs);
        Root.Controls.Add(content);
        tabs.TabIndex = 0; host.TabIndex = 1;

        LoadValues();

        EventHandler changed = (_, _) => SyncState();
        foreach (var t in new[] { title, author, subject, keywords, wmText, userPw, ownerPw }) t.TextChanged += changed;
        foreach (var t in new[] { numbers, watermark, grayscale }) t.CheckedChanged += changed;
        compression.SelectedIndexChanged += changed;
        method.SelectedIndexChanged += changed;
        reducePct.ValueChanged += changed;
        targetMb.ValueChanged += changed;
        tabs.SelectedIndexChanged += (_, _) => ShowPage(tabs.SelectedIndex);

        building = false;
        ShowPage(TabDetails);
        SyncState();
        ActiveControl = tabs;
    }

    // ───────── pages ─────────

    private void AddPage(SettingsPage p)
    {
        p.Dock = DockStyle.Fill;
        p.HeightSource = compression;
        host.Controls.Add(p);
        tabPages.Add(p);
    }

    private SettingsPage BuildDetails()
    {
        var p = new SettingsPage("Document details", "Stored in the file properties. Shown by PDF readers and search tools.");
        p.Row("Title", title);
        p.Row("Author", author);
        p.Row("Subject", subject);
        p.Row("Keywords", keywords);
        return p;
    }

    private SettingsPage BuildPageSize(IReadOnlyList<PageItem> pages)
    {
        var p = new SettingsPage("Page size", "Make every page the same size, or keep each page as it is.");
        var choose = new FlatButton { Text = "Choose page size…", Glyph = "\uE7C3", Kind = BtnKind.Secondary };
        choose.Click += (_, _) =>
        {
            using var d = new PageSizeDialog(layout, pages);
            if (d.ShowDialog(this) == DialogResult.OK) { layout = d.Result; UpdateLayoutSummary(); SyncState(); }
        };
        UpdateLayoutSummary();
        p.Note(layoutCard);
        p.Gap(4);
        p.Full(choose, 220, 34);
        return p;
    }

    private SettingsPage BuildNumbers()
    {
        var p = new SettingsPage("Page numbers", "Stamp a number on each page when the file is written.");
        p.Full(numbers);
        p.Divider();
        p.Row("Position", numPos);
        p.Row("Format", numFmt);
        p.Row("Start at", numStart, 132);
        p.Row("Font size", numSize, 132);
        p.Full(skipFirst);
        return p;
    }

    private SettingsPage BuildWatermark()
    {
        var p = new SettingsPage("Text watermark", "A faint diagonal label across every page, such as CONFIDENTIAL or DRAFT.");
        p.Full(watermark);
        p.Divider();
        p.Row("Text", wmText);
        p.Row("Opacity", wmOpacity, 132);
        p.Row("Font size", wmSize, 132);
        p.Row("Angle", wmAngle, 132);
        return p;
    }

    private SettingsPage BuildCompress()
    {
        var p = new SettingsPage("Compress", "Make the file smaller: pick a preset, a percentage, or an exact size limit.");
        p.Row("Method", method, 400, 36);
        p.Row("Quality preset", compression);
        p.Row("Make it smaller by", reducePct, 132, 0, "", Chips(reducePct, new[] { 25m, 50m, 75m }, v => v + "%", 52));
        p.Row("Keep it under", targetMb, 132, 0, "", Chips(targetMb, new[] { 1m, 2m, 5m, 10m }, v => v + " MB", 58));
        p.Divider();
        p.Full(grayscale);
        p.Gap(4);
        p.Note(compCard);
        return p;
    }

    private SettingsPage BuildProtect()
    {
        var p = new SettingsPage("Password protection", "Lock the file with a password and choose what readers may do.");
        p.Row("Open password", userPw, 0, 0, "Readers must type it to open the file.");
        p.Row("Owner password", ownerPw, 0, 0, "Needed to enforce the permissions below.");
        p.Divider();
        p.Section("READERS MAY");
        p.Full(allowPrint);
        p.Full(allowCopy);
        p.Full(allowEdit);
        return p;
    }

    /// <summary>Quick-pick buttons that sit next to a number field and fill it in.</summary>
    private static (Control C, int W)[] Chips(ModernNumber target, decimal[] values, Func<decimal, string> label, int width)
    {
        var list = new List<(Control, int)>();
        foreach (var v in values)
        {
            var b = new FlatButton { Text = label(v), Kind = BtnKind.Secondary };
            var value = v;
            b.Click += (_, _) => target.Value = value;
            list.Add((b, width));
        }
        return list.ToArray();
    }

    // ───────── state ─────────

    private void LoadValues()
    {
        title.Text = o.Title; author.Text = o.Author; subject.Text = o.Subject; keywords.Text = o.Keywords;
        numbers.Checked = o.PageNumbers; SelectValue(numPos, o.NumberPosition); SelectValue(numFmt, o.NumberFormat);
        numStart.Value = Math.Clamp(o.StartNumber, 0, 9999); numSize.Value = (decimal)Math.Clamp(o.NumberFontSize, 6, 40);
        skipFirst.Checked = o.SkipFirstPage;
        watermark.Checked = o.Watermark; wmText.Text = o.WatermarkText;
        wmOpacity.Value = Math.Clamp(o.WatermarkOpacityPercent, 3, 100); wmSize.Value = (decimal)Math.Clamp(o.WatermarkFontSize, 10, 300);
        wmAngle.Value = (decimal)Math.Clamp(o.WatermarkAngle, -90, 90);
        method.SelectedIndex = (int)o.CompressionKind; SelectValue(compression, o.Compression);
        reducePct.Value = Math.Clamp(o.ReducePercent, 1, 95); targetMb.Value = (decimal)Math.Clamp(o.TargetSizeMb, 0.05, 4096);
        grayscale.Checked = o.Grayscale;
        userPw.Text = o.UserPassword; ownerPw.Text = o.OwnerPassword;
        allowPrint.Checked = o.AllowPrint; allowCopy.Checked = o.AllowCopy; allowEdit.Checked = o.AllowEdit;
    }

    private CompressionTargetKind Kind => (CompressionTargetKind)Math.Clamp(method.SelectedIndex, 0, 2);

    private void ShowPage(int index)
    {
        for (var i = 0; i < tabPages.Count; i++) tabPages[i].Visible = i == index;
        tabPages[Math.Clamp(index, 0, tabPages.Count - 1)].PerformLayout();
    }

    /// <summary>Enables / hides rows to match the switches, refreshes the tab dots and the footer summary.</summary>
    private void SyncState()
    {
        if (building) return;

        foreach (var c in new Control[] { numPos, numFmt, numStart, numSize, skipFirst }) pgNumbers.SetEnabled(c, numbers.Checked);
        foreach (var c in new Control[] { wmText, wmOpacity, wmSize, wmAngle }) pgWatermark.SetEnabled(c, watermark.Checked);

        var kind = Kind;
        pgCompress.SetShown(compression, kind == CompressionTargetKind.Preset);
        pgCompress.SetShown(reducePct, kind == CompressionTargetKind.ReducePercent);
        pgCompress.SetShown(targetMb, kind == CompressionTargetKind.TargetSize);

        var hasOwner = ownerPw.Text.Length > 0;
        foreach (var c in new Control[] { allowPrint, allowCopy, allowEdit }) pgProtect.SetEnabled(c, hasOwner);

        var compressing = grayscale.Checked || kind != CompressionTargetKind.Preset || ValueOf<PdfCompression>(compression) != PdfCompression.None;
        tabs.SetBadge(TabDetails, title.Text.Length + author.Text.Length + subject.Text.Length + keywords.Text.Length > 0);
        tabs.SetBadge(TabSize, !layout.IsOriginal);
        tabs.SetBadge(TabNumbers, numbers.Checked);
        tabs.SetBadge(TabWatermark, watermark.Checked);
        tabs.SetBadge(TabCompress, compressing);
        tabs.SetBadge(TabProtect, userPw.Text.Length > 0 || hasOwner);

        var parts = new List<string>();
        if (!layout.IsOriginal) parts.Add(PageSizing.Name(layout));
        if (numbers.Checked) parts.Add("page numbers");
        if (watermark.Checked) parts.Add("watermark");
        switch (kind)
        {
            case CompressionTargetKind.ReducePercent: parts.Add($"{(int)reducePct.Value}% smaller"); break;
            case CompressionTargetKind.TargetSize: parts.Add($"under {targetMb.Value:0.##} MB"); break;
            default:
                var level = ValueOf<PdfCompression>(compression);
                if (level != PdfCompression.None) parts.Add(level.ToString().ToLowerInvariant() + " compression");
                break;
        }
        if (grayscale.Checked) parts.Add("grayscale");
        if (userPw.Text.Length > 0 || hasOwner) parts.Add("password");
        footerNote.Text = parts.Count == 0 ? "Pages are exported exactly as they are." : "Applying:  " + string.Join("  ·  ", parts);
    }

    private void UpdateLayoutSummary()
    {
        if (layout.IsOriginal)
        {
            layoutCard.Title = "Original sizes";
            layoutCard.Body = "Every page keeps its own size. Choose a size to make all pages the same.";
            return;
        }
        var orient = layout.Orientation == TargetOrientation.Portrait ? "portrait"
                   : layout.Orientation == TargetOrientation.Landscape ? "landscape" : "orientation per page";
        var fitText = layout.Fit switch
        {
            PageFitMode.ShrinkOnly => "shrink only", PageFitMode.Cover => "fill (crop)",
            PageFitMode.Stretch => "stretch", PageFitMode.ActualSize => "actual size", _ => "fit inside"
        };
        layoutCard.Title = PageSizing.Name(layout) + "  ·  " + orient;
        layoutCard.Body = "All pages will be this size. Pages of other sizes are fitted: " + fitText + ".";
    }

    protected override void OnShown(EventArgs e)
    {
        base.OnShown(e);
        // drop-down heights are only final once the window exists, so lay the visible page out once more
        tabPages[Math.Clamp(tabs.SelectedIndex, 0, tabPages.Count - 1)].PerformLayout();
    }

    // ───────── keyboard ─────────

    protected override bool ProcessCmdKey(ref Message msg, Keys keyData)
    {
        switch (keyData)
        {
            case Keys.Control | Keys.Tab:
            case Keys.Control | Keys.PageDown:
                tabs.Step(1, true); return true;
            case Keys.Control | Keys.Shift | Keys.Tab:
            case Keys.Control | Keys.PageUp:
                tabs.Step(-1, true); return true;
        }
        return base.ProcessCmdKey(ref msg, keyData);
    }

    // ───────── result ─────────

    protected override bool ValidateInput(out string error)
    {
        error = "";
        if (watermark.Checked && string.IsNullOrWhiteSpace(wmText.Text))
        {
            error = "Enter the watermark text, or turn the watermark off.";
            tabs.SelectedIndex = TabWatermark;
            wmText.FocusInput();
        }

        Result = new ExportOptions
        {
            Title = title.Text.Trim(), Author = author.Text.Trim(), Subject = subject.Text.Trim(), Keywords = keywords.Text.Trim(),
            Grayscale = grayscale.Checked,
            PageNumbers = numbers.Checked, NumberPosition = ValueOf<PageNumberPosition>(numPos), NumberFormat = ValueOf<PageNumberFormat>(numFmt),
            StartNumber = (int)numStart.Value, NumberFontSize = (double)numSize.Value, SkipFirstPage = skipFirst.Checked,
            Watermark = watermark.Checked, WatermarkText = wmText.Text.Trim(), WatermarkOpacityPercent = (int)wmOpacity.Value,
            WatermarkFontSize = (double)wmSize.Value, WatermarkAngle = (double)wmAngle.Value,
            Compression = ValueOf<PdfCompression>(compression), CompressionKind = Kind,
            ReducePercent = (int)reducePct.Value, TargetSizeMb = (double)targetMb.Value,
            UserPassword = userPw.Text, OwnerPassword = ownerPw.Text,
            AllowPrint = allowPrint.Checked, AllowCopy = allowCopy.Checked, AllowEdit = allowEdit.Checked,
            Layout = layout.Clone()
        };
        return error.Length == 0;
    }
}
