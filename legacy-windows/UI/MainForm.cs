using PdfStudio.Models;
using PdfStudio.Services;

namespace PdfStudio.UI;

public sealed partial class MainForm : Form
{
    private readonly PdfService pdf = new();
    private readonly ImagePdfService images = new();
    private readonly PdfToWordService toWord = new();
    private readonly HistoryService history = new();
    private readonly ThumbnailCache thumbs;
    private readonly List<PageItem> pages = new();
    private readonly PageGridView grid;
    private readonly PreviewPane preview = new() { Dock = DockStyle.Fill };
    private readonly ToolTip tips = new() { InitialDelay = 450, ReshowDelay = 120, AutoPopDelay = 7000 };
    private readonly string sessionDir = Path.Combine(Path.GetTempPath(), "PdfStudio", Guid.NewGuid().ToString("N"));

    private readonly Txt statusText = new("", 9f, FontStyle.Regular, true) { Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleLeft, AutoEllipsis = true };
    private readonly Txt countText = new("", 9f, FontStyle.Bold) { AutoSize = true, TextAlign = ContentAlignment.MiddleLeft, Anchor = AnchorStyles.Left };
    private readonly ProgressBar busyBar = new() { Style = ProgressBarStyle.Marquee, MarqueeAnimationSpeed = 28, Width = 120, Height = 8, Visible = false, Anchor = AnchorStyles.None };
    private readonly ModernSlider sizeBar = new() { Minimum = 100, Maximum = 340, Value = 170, Width = 130, Height = 26, SmallChange = 10, LargeChange = 30, Anchor = AnchorStyles.None };
    private Control sizeGroupSep = null!;
    private TableLayoutPanel statusTable = null!, headerTable = null!;
    private readonly SplitContainer split = new() { Dock = DockStyle.Fill, FixedPanel = FixedPanel.None, SplitterWidth = 5 };
    private Surface emptyState = null!, ribbon = null!, header = null!;
    private FlowLayoutPanel ribbonFlow = null!;
    private Txt tagText = null!;
    private HelpDialog? helpWindow;
    private UpdateDownloadDialog? updateDownloadWindow;
    private BackgroundUpdateStatus? lastBackgroundUpdateStatus;
    private BackgroundUpdateSnapshot? pendingReadyUpdatePrompt;
    private readonly HashSet<string> promptedUpdateVersions = new(StringComparer.OrdinalIgnoreCase);
    private Txt appName = null!, sizeLabel = null!;
    private FlatButton zoomOutBtn = null!, zoomInBtn = null!;
    private readonly List<FlatButton> toolButtons = new();
    private readonly Dictionary<FlatButton, (string Text, int W, int H)> toolOriginals = new();

    private FlatButton newBtn = null!, undoBtn = null!, redoBtn = null!, rotLBtn = null!, rotRBtn = null!, delBtn = null!,
        pagesBtn = null!, arrangeBtn = null!, selectBtn = null!, annotateBtn = null!, extractMenuBtn = null!, moreBtn = null!, exportBtn = null!,
        editBtn = null!, pageSizeBtn = null!, addBtn = null!, convertBtn = null!, fitToggle = null!, previewToggle = null!, reviewBtn = null!;
    private FlatButton emptyAddPdfBtn = null!, emptyAddImageBtn = null!;

    private ExportOptions exportOptions = new();
    private bool busy, dirty;
    private bool previewPref = true;
    private string lastPreviewSig = "";
    private bool splitterInitialised;
    private bool hadPages;
    private System.Windows.Forms.Timer? reviewPromptTimer;
    private Panel? accessOverlay;
    private Txt? accessTitle;
    private Txt? accessMessage;
    private Txt? accessMeta;
    private FlatButton? accessCloseButton;
    private bool accessDenied;

    public MainForm()
    {
        AutoScaleDimensions = new SizeF(96f, 96f);
        AutoScaleMode = AutoScaleMode.Dpi;
        Text = "PDF Studio";
        Font = Theme.Ui();
        ClientSize = new Size(1440, 860); // shrunk to the screen in FitToScreen
        MinimumSize = new Size(600, 460);
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Theme.Window;
        KeyPreview = true; AllowDrop = true;
        try { Icon = Icon.ExtractAssociatedIcon(Environment.ProcessPath ?? Application.ExecutablePath); } catch { }
        Directory.CreateDirectory(sessionDir);
        // Tell the user, once and quietly, if PDF previews cannot work (images added as pages still do).
        Shown += (_, _) => { if (!NativeSupport.PdfiumAvailable) SetStatus(NativeSupport.PdfiumMissingMessage); };

        thumbs = new ThumbnailCache();
        thumbs.Attach(this);
        grid = new PageGridView(pages, thumbs) { Dock = DockStyle.Fill };

        previewPref = AppSettings.GetBool("preview", true);
        sizeBar.Value = Math.Clamp(AppSettings.GetInt("thumb", 170), sizeBar.Minimum, sizeBar.Maximum);
        grid.TileWidth = sizeBar.Value;
        grid.AutoFit = AppSettings.GetBool("autofit", true);

        BuildUi();
        WireEvents();
        UpdateUi();
        Theme.Changed += () => { BackColor = Theme.Window; split.BackColor = Theme.Border; };
    }

    // ───────────────────────── UI construction ─────────────────────────

    /// <summary>Button width (design pixels) that fits its caption, so labels are never clipped.</summary>
    private static int FitWidth(string text, float fontPt, int minWidth, int padding)
    {
        var w = TextRenderer.MeasureText(text, Theme.Ui(fontPt), new Size(1000, 100), TextFormatFlags.NoPadding | TextFormatFlags.NoPrefix).Width;
        return Math.Max(minWidth, (int)Math.Ceiling(w / Theme.Scale) + padding);
    }

    private FlatButton Tool(string text, string glyph, Action click, string tip, bool glyphIsText = false, bool danger = false, bool dropdown = false)
    {
        var b = new FlatButton
        {
            Text = text, Glyph = glyph, GlyphIsText = glyphIsText, Kind = BtnKind.Ghost, Vertical = true, DangerStyle = danger,
            Width = FitWidth(text, 8.5f, 62, dropdown ? 30 : 20), Height = 62, Margin = new Padding(1, 0, 1, 2), Font = Theme.Ui(8.5f),
            AutoWidth = true, MinWidth = 62
        };
        b.Click += (_, _) => click();
        tips.SetToolTip(b, tip);
        toolButtons.Add(b);
        return b;
    }

    private static Surface Sep()
    {
        var s = new Surface { Width = 1, Height = 44, Margin = new Padding(8, 9, 8, 0) };
        s.UseRole(() => Theme.Border);
        return s;
    }

    private void BuildUi()
    {
        // ── header: brand on the left, actions on the right, everything vertically centred ──
        header = new Surface { Dock = DockStyle.Top, Height = 66, Padding = new Padding(20, 0, 20, 0), BorderBottom = true };
        header.UseRole(() => Theme.Surface);

        var logo = new Txt("\uE8A5", 17f) { Font = Theme.Icons(22f), ForeColor = Theme.Accent, AutoSize = true, Anchor = AnchorStyles.Left, Margin = new Padding(0, 0, 12, 0) };
        Theme.Changed += () => logo.ForeColor = Theme.Accent;
        appName = new Txt("PDF Studio", 14f, FontStyle.Bold) { AutoSize = true, Margin = new Padding(0), Anchor = AnchorStyles.Left };
        tagText = new Txt("Merge · Reorder · Edit · Convert", 8.75f, FontStyle.Regular, true) { AutoSize = true, Margin = new Padding(0, 1, 0, 0), Anchor = AnchorStyles.Left };
        var brand = new TableLayoutPanel { AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink, ColumnCount = 1, RowCount = 2, BackColor = Color.Transparent, Margin = new Padding(0), Anchor = AnchorStyles.Left };
        brand.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        brand.RowStyles.Add(new RowStyle(SizeType.AutoSize)); brand.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        brand.Controls.Add(appName, 0, 0); brand.Controls.Add(tagText, 0, 1);

        FlatButton Hb(string text, string glyph, BtnKind kind, Action a, string tip, int minW = 44)
        {
            var b = new FlatButton { Text = text, Glyph = glyph, Kind = kind, Height = 38, AutoWidth = true, MinWidth = minW, Margin = new Padding(3, 0, 3, 0) };
            b.Click += (_, _) => a();
            tips.SetToolTip(b, tip);
            return b;
        }
        addBtn = Hb("Add files", "\uE710", BtnKind.Secondary, () => { }, "Add PDFs or pictures (Ctrl+O)", 48);
        addBtn.DropMenu = Menus.Make(
            ("Add PDF / image…", () => Fire(AddFilesFlow())),
            ("Add PDFs only…", () => Fire(AddPdfsFlow())),
            ("Add images (as pages)…", () => Fire(PickImagesFlow())));
        convertBtn = Hb("Convert", "\uE8AB", BtnKind.Secondary, () => { }, "Convert PDF to Word or images, and images to PDF", 48);
        convertBtn.DropMenu = Menus.Make(
            ("PDF → Word…", () => Fire(PdfToWordFlow())),
            ("-", null),
            ("PDF → Images…", () => Fire(PdfToImagesFlow())),
            ("Images → PDF…", () => Fire(ImagesToPdfFlow())));
        var helpBtn = Hb("", "\uE897", BtnKind.Secondary, () => ShowHelp(), "Help and user guide (F1)");
        var aboutBtn = Hb("", "\uE946", BtnKind.Secondary, ShowAbout, "About PDF Studio and the developer");
        reviewBtn = Hb("Review", "\uE734", BtnKind.Secondary, ShowReview, "Rate PDF Studio and send the developer a review", 48);
        var themeBtn = Hb("", "\uE706", BtnKind.Secondary, ToggleTheme, "Switch between light and dark theme");
        exportBtn = Hb("Export PDF", "\uE896", BtnKind.Primary, () => Fire(ExportAsync(false)), "Export the pages as one PDF (Ctrl+S)", 96);

        Surface HSep()
        {
            var sp = new Surface { Width = 1, Height = 26, Margin = new Padding(8, 0, 8, 0), Anchor = AnchorStyles.None };
            sp.UseRole(() => Theme.Border);
            return sp;
        }
        var actions = new FlowLayoutPanel { AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink, WrapContents = false, FlowDirection = FlowDirection.LeftToRight, BackColor = Color.Transparent, Margin = new Padding(0), Anchor = AnchorStyles.None };
        // a FlowLayoutPanel does not centre its children vertically, so give the narrow separator the same height as the buttons
        var s1 = HSep(); s1.Height = 26; s1.Margin = new Padding(8, 6, 8, 6);
        var s2 = HSep(); s2.Height = 26; s2.Margin = new Padding(8, 6, 8, 6);
        actions.Controls.AddRange(new Control[] { addBtn, convertBtn, s1, reviewBtn, helpBtn, aboutBtn, themeBtn, s2, exportBtn });

        headerTable = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 3, RowCount = 1, BackColor = Color.Transparent, Margin = new Padding(0) };
        headerTable.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        headerTable.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        headerTable.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        headerTable.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        var brandRow = new TableLayoutPanel { AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink, ColumnCount = 2, RowCount = 1, BackColor = Color.Transparent, Margin = new Padding(0), Anchor = AnchorStyles.Left };
        brandRow.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize)); brandRow.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        brandRow.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        brandRow.Controls.Add(logo, 0, 0); brandRow.Controls.Add(brand, 1, 0);
        logo.Anchor = AnchorStyles.None; brand.Anchor = AnchorStyles.None;
        headerTable.Controls.Add(brandRow, 0, 0);
        headerTable.Controls.Add(actions, 2, 0);
        header.Controls.Add(headerTable);

        // ── ribbon (wraps onto extra rows on narrow windows, so nothing is ever hidden) ──
        ribbon = new Surface { Dock = DockStyle.Top, Height = 74, Padding = new Padding(10, 6, 10, 2), BorderBottom = true };
        ribbon.UseRole(() => Theme.Surface);
        ribbonFlow = new FlowLayoutPanel { Dock = DockStyle.Top, AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink, WrapContents = true, BackColor = Color.Transparent };
        ribbonFlow.SizeChanged += (_, _) => ribbon.Height = ribbonFlow.Height + ribbon.Padding.Vertical + 2;

        newBtn = Tool("New", "\uE8F4", NewDocument, "Start fresh: remove all pages and clear undo history (Ctrl+N)");
        undoBtn = Tool("Undo", "\uE7A7", Undo, "Undo the last change (Ctrl+Z)");
        redoBtn = Tool("Redo", "\uE7A6", Redo, "Redo (Ctrl+Y)");
        rotLBtn = Tool("Rotate left", "↺", () => Rotate(-90), "Rotate the selected pages left (Ctrl+←)", true);
        rotLBtn.GlyphTextSize = 19f;
        rotRBtn = Tool("Rotate right", "↻", () => Rotate(90), "Rotate the selected pages right (Ctrl+→)", true);
        rotRBtn.GlyphTextSize = 19f;
        delBtn = Tool("Delete", "\uE74D", DeleteSelected, "Remove the selected pages (Del)", false, true);

        // grouped drop-downs (one button each instead of a long row of small ones)
        pagesBtn = Tool("Pages", "\uE8C8", () => { }, "Duplicate, insert, rotate or delete pages", false, false, true);
        pagesBtn.DropMenu = Menus.Make(
            ("Duplicate\tCtrl+D", DuplicateSelected),
            ("Insert blank page…", InsertBlank),
            ("Insert PDF after selection…", () => Fire(InsertPdfAfterSelection())), ("-", null),
            ("Rotate 180°", () => Rotate(180)),
            ("Reset rotation", ResetRotation),
            ("Rotate ALL pages right", () => RotateAll(90)), ("-", null),
            ("Delete pages by range…", DeleteByRange));
        arrangeBtn = Tool("Arrange", "\uE8CB", () => { }, "Change the order of pages", false, false, true);
        arrangeBtn.DropMenu = Menus.Make(
            ("Move earlier\tCtrl+Shift+←", () => MoveSelected(-1)),
            ("Move later\tCtrl+Shift+→", () => MoveSelected(1)), ("-", null),
            ("Move to the start", () => MoveToEdge(true)),
            ("Move to the end", () => MoveToEdge(false)),
            ("Move to page number…", MoveToPosition), ("-", null),
            ("Reverse order", ReversePages));
        selectBtn = Tool("Select", "\uE762", () => { }, "Selection helpers", false, false, true);
        selectBtn.DropMenu = Menus.Make(
            ("Select all\tCtrl+A", () => grid.SelectAll()), ("Clear selection\tEsc", () => grid.ClearSelection()), ("Invert selection\tCtrl+I", () => grid.InvertSelection()), ("-", null),
            ("Odd pages", () => grid.SelectIndices(Enumerable.Range(0, pages.Count).Where(i => i % 2 == 0))),
            ("Even pages", () => grid.SelectIndices(Enumerable.Range(0, pages.Count).Where(i => i % 2 == 1))),
            ("By page range…", SelectByRange), ("-", null),
            ("Blank / nearly blank pages", () => Fire(SelectBlankPagesAsync())),
            ("Pages from the same file", SelectSameSource));
        pageSizeBtn = Tool("Page size", "\uE7C3", ChoosePageSize, "Make every page the same size (A4, Letter, custom…) and choose how other sizes are fitted");
        editBtn = Tool("Edit PDF", "\uE70F", EditPdf, "Open the PDF editor: change the text already in the PDF, add text, pictures and signatures, move and resize them, change fonts (Ctrl+E)");
        annotateBtn = Tool("Add to page", "\uE8D2", () => { }, "Add text or a picture to the selected pages", false, false, true);
        annotateBtn.DropMenu = Menus.Make(
            ("Add text…\tCtrl+T", AddText),
            ("Add image…", AddImageOverlay), ("-", null),
            ("Remove added text and images", ClearOverlays));
        extractMenuBtn = Tool("Extract", "\uE74E", () => { }, "Save part of the document as a new PDF", false, false, true);
        extractMenuBtn.DropMenu = Menus.Make(
            ("Extract selected pages…", () => Fire(ExtractSelectedAsync())),
            ("Split into several files…", () => Fire(SplitAsync())),
            ("Export selected pages…\tCtrl+Shift+S", () => Fire(ExportAsync(true))));
        moreBtn = Tool("More", "\uE712", () => { }, "Export options and viewer", false, false, true);
        moreBtn.DropMenu = Menus.Make(
            ("Page numbers, watermark, compression, password…", () => Fire(ExportAsync(false))),
            ("Open result in PDF viewer…\tCtrl+P", () => Fire(OpenInViewerAsync())));

        ribbonFlow.Controls.AddRange(new Control[]
        {
            newBtn, Sep(), undoBtn, redoBtn, Sep(), rotLBtn, rotRBtn, delBtn, Sep(),
            pagesBtn, arrangeBtn, selectBtn, Sep(), pageSizeBtn, Sep(),
            editBtn, annotateBtn, Sep(), extractMenuBtn, moreBtn
        });
        ribbon.Controls.Add(ribbonFlow);

        // ── status bar: [count] [message ……………] [busy]            [Thumbnails − slider +] | [Fit columns] [Preview] ──
        var status = new Surface { Dock = DockStyle.Bottom, Height = 46, Padding = new Padding(20, 0, 20, 0), BorderTop = true };
        status.UseRole(() => Theme.Surface);

        FlatButton Sb(string text, string glyph, bool glyphText, string tip, int minW = 34)
        {
            var b = new FlatButton { Text = text, Glyph = glyph, GlyphIsText = glyphText, Kind = BtnKind.Ghost, Height = 32, AutoWidth = true, MinWidth = minW, Margin = new Padding(2, 0, 2, 0), Anchor = AnchorStyles.None };
            tips.SetToolTip(b, tip);
            return b;
        }
        sizeLabel = new Txt("Thumbnails", 8.5f, FontStyle.Regular, true) { AutoSize = true, Anchor = AnchorStyles.None, Margin = new Padding(0, 0, 6, 0) };
        var zoomOut = zoomOutBtn = Sb("", "−", true, "Smaller thumbnails (Ctrl + minus)");
        var zoomIn = zoomInBtn = Sb("", "+", true, "Larger thumbnails (Ctrl + plus)");
        zoomOut.Click += (_, _) => sizeBar.Value = Math.Max(sizeBar.Minimum, sizeBar.Value - 20);
        zoomIn.Click += (_, _) => sizeBar.Value = Math.Min(sizeBar.Maximum, sizeBar.Value + 20);
        sizeBar.Margin = new Padding(4, 0, 4, 0);
        tips.SetToolTip(sizeBar, "Thumbnail size (Ctrl + mouse wheel)");

        fitToggle = Sb("Fit columns", "\uE8A9", false, "Stretch thumbnails so every row fills the window width", 40);
        fitToggle.Active = grid.AutoFit;
        fitToggle.Click += (_, _) => { grid.AutoFit = !grid.AutoFit; fitToggle.Active = grid.AutoFit; fitToggle.Invalidate(); };
        previewToggle = Sb("Preview", "\uE7B3", false, "Show or hide the page preview pane", 40);
        previewToggle.Click += (_, _) => { previewPref = !previewPref; ApplyPreviewVisibility(); };

        var sizeGroup = new TableLayoutPanel { AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink, ColumnCount = 4, RowCount = 1, BackColor = Color.Transparent, Margin = new Padding(0), Anchor = AnchorStyles.None };
        for (var i = 0; i < 4; i++) sizeGroup.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        sizeGroup.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        sizeGroup.Controls.Add(sizeLabel, 0, 0); sizeGroup.Controls.Add(zoomOut, 1, 0); sizeGroup.Controls.Add(sizeBar, 2, 0); sizeGroup.Controls.Add(zoomIn, 3, 0);
        sizeGroupSep = new Surface { Width = 1, Height = 24, Margin = new Padding(12, 0, 12, 0), Anchor = AnchorStyles.None };
        ((Surface)sizeGroupSep).UseRole(() => Theme.Border);

        statusText.Margin = new Padding(14, 0, 8, 0);
        busyBar.Margin = new Padding(0, 0, 14, 0);
        statusTable = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 8, RowCount = 1, BackColor = Color.Transparent, Margin = new Padding(0) };
        statusTable.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));          // count
        statusTable.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));      // message
        statusTable.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));          // busy bar
        statusTable.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));          // size group
        statusTable.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));          // separator
        statusTable.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));          // fit columns
        statusTable.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));          // preview
        statusTable.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));          // spare
        statusTable.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        statusTable.Controls.Add(countText, 0, 0);
        statusTable.Controls.Add(statusText, 1, 0);
        statusTable.Controls.Add(busyBar, 2, 0);
        statusTable.Controls.Add(sizeGroup, 3, 0);
        statusTable.Controls.Add(sizeGroupSep, 4, 0);
        statusTable.Controls.Add(fitToggle, 5, 0);
        statusTable.Controls.Add(previewToggle, 6, 0);
        status.Controls.Add(statusTable);

        // ── developer footer ──
        var footer = new DeveloperFooter();
        footer.Clicked += ShowAbout;
        tips.SetToolTip(footer, "About PDF Studio");

        // ── body ──
        split.BackColor = Theme.Border;
        split.Panel1.BackColor = Theme.Canvas; split.Panel2.BackColor = Theme.Surface;
        Theme.Changed += () => { split.Panel1.BackColor = Theme.Canvas; split.Panel2.BackColor = Theme.Surface; };
        split.Panel1.Controls.Add(grid);
        emptyState = BuildEmptyState();
        split.Panel1.Controls.Add(emptyState);
        split.Panel2.Controls.Add(preview);

        Controls.Add(split); Controls.Add(status); Controls.Add(footer); Controls.Add(ribbon); Controls.Add(header);
        BuildAccessOverlay();
    }

    private void BuildAccessOverlay()
    {
        accessOverlay = new Panel
        {
            Dock = DockStyle.Fill,
            Visible = false,
            BackColor = Theme.Window,
            Padding = new Padding(24)
        };

        var card = new Surface
        {
            Width = Theme.S(620),
            Height = Theme.S(330),
            BackColor = Theme.Surface,
            Padding = new Padding(Theme.S(34)),
            Anchor = AnchorStyles.None
        };
        card.UseRole(() => Theme.Surface);

        var icon = new Txt("\uE72E", 30f, FontStyle.Regular)
        {
            Font = Theme.Icons(34f),
            ForeColor = Theme.Accent,
            Dock = DockStyle.Top,
            Height = Theme.S(62),
            TextAlign = ContentAlignment.MiddleCenter
        };
        accessTitle = new Txt("Checking device access…", 16f, FontStyle.Bold)
        {
            Dock = DockStyle.Top,
            Height = Theme.S(40),
            TextAlign = ContentAlignment.MiddleCenter
        };
        accessMessage = new Txt("PDF Studio is checking the access policy for this device. You do not need to sign in.", 10f, FontStyle.Regular, true)
        {
            Dock = DockStyle.Top,
            Height = Theme.S(70),
            TextAlign = ContentAlignment.TopCenter
        };
        accessMeta = new Txt("", 8.5f, FontStyle.Regular, true)
        {
            Dock = DockStyle.Top,
            Height = Theme.S(34),
            TextAlign = ContentAlignment.MiddleCenter
        };
        accessCloseButton = new FlatButton
        {
            Text = "Close PDF Studio",
            Glyph = "\uE8BB",
            Kind = BtnKind.Secondary,
            Height = Theme.S(40),
            AutoWidth = true,
            MinWidth = Theme.S(150),
            Anchor = AnchorStyles.None
        };
        accessCloseButton.Click += (_, _) => Close();
        accessCloseButton.FitNow();

        var buttonHost = new TableLayoutPanel
        {
            Dock = DockStyle.Top,
            Height = Theme.S(52),
            ColumnCount = 3,
            RowCount = 1,
            BackColor = Color.Transparent,
            Margin = Padding.Empty,
            Padding = Padding.Empty
        };
        buttonHost.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));
        buttonHost.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        buttonHost.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));
        buttonHost.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        accessCloseButton.Anchor = AnchorStyles.None;
        accessCloseButton.Margin = Padding.Empty;
        buttonHost.Controls.Add(accessCloseButton, 1, 0);

        card.Controls.Add(buttonHost);
        card.Controls.Add(accessMeta);
        card.Controls.Add(accessMessage);
        card.Controls.Add(accessTitle);
        card.Controls.Add(icon);

        accessOverlay.Controls.Add(card);
        Controls.Add(accessOverlay);
        accessOverlay.BringToFront();

        void LayoutCard()
        {
            if (accessOverlay == null) return;
            card.Location = new Point(
                Math.Max(Theme.S(12), (accessOverlay.ClientSize.Width - card.Width) / 2),
                Math.Max(Theme.S(12), (accessOverlay.ClientSize.Height - card.Height) / 2));
        }
        accessOverlay.Resize += (_, _) => LayoutCard();
        Theme.Changed += () =>
        {
            if (accessOverlay == null || accessTitle == null || accessMessage == null || accessMeta == null) return;
            accessOverlay.BackColor = Theme.Window;
            card.UseRole(() => Theme.Surface);
            accessTitle.ForeColor = Theme.Text;
            accessMessage.ForeColor = Theme.Muted;
            accessMeta.ForeColor = Theme.Muted;
            icon.ForeColor = accessDenied ? Theme.Danger : Theme.Accent;
            LayoutCard();
        };
        LayoutCard();
    }

    private void SetAccessOverlay(bool visible, bool denied, string reason = "")
    {
        if (IsDisposed || accessOverlay == null || accessTitle == null || accessMessage == null || accessMeta == null || accessCloseButton == null) return;
        accessDenied = denied;
        accessTitle.Text = denied ? "PDF Studio access is disabled" : "Checking device access…";
        accessMessage.Text = denied
            ? "An administrator has disabled PDF Studio for this device. The application will remain locked until access is restored in the PDF Studio Monitor."
            : "PDF Studio is checking the access policy for this device. You do not need to sign in.";
        accessMeta.Text = denied
            ? (string.IsNullOrWhiteSpace(reason) ? "Contact your administrator to restore access." : reason)
            : "If the monitor is unavailable, PDF Studio remains usable unless this device was previously disabled.";
        accessCloseButton.Text = "Close PDF Studio";
        accessCloseButton.FitNow();
        UpdateUi();
        accessOverlay.Visible = visible;
        accessOverlay.BringToFront();
        accessOverlay.Invalidate(true);
        if (visible) accessCloseButton.Focus();
    }

    private void OnAccessStateChanged(AccessControlService.AccessResult result)
    {
        if (IsDisposed || !IsHandleCreated) return;
        BeginInvoke(new Action(() =>
        {
            if (result.State == AccessControlService.AccessState.Denied)
            {
                reviewPromptTimer?.Stop();
                foreach (Form open in Application.OpenForms.Cast<Form>().ToArray())
                {
                    if (ReferenceEquals(open, this)) continue;
                    if (open is EditorForm || open is ModernDialog)
                    {
                        try { open.DialogResult = DialogResult.Cancel; } catch { }
                        try { open.Close(); } catch { }
                    }
                }
                SetAccessOverlay(true, true, result.Reason);
                SetStatus("Access disabled by administrator.");
            }
            else
            {
                SetAccessOverlay(false, false);
                if (!accessDenied) SetStatus("Ready");
            }
        }));
    }

    private Surface BuildEmptyState()
    {
        var s = new Surface { Dock = DockStyle.Fill };
        s.UseRole(() => Theme.Canvas);
        var card = new Surface { Width = 660, Height = 330, Padding = new Padding(28) };
        card.UseRole(() => Theme.Surface);
        void RoundCard()
        {
            if (card.Width <= 0 || card.Height <= 0) return;
            using var path = Gfx.Round(new RectangleF(0, 0, card.Width - 1, card.Height - 1), Theme.S(16));
            card.Region = new Region(path);
        }
        card.Resize += (_, _) => RoundCard();
        card.Paint += (_, e) =>
        {
            e.Graphics.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
            Gfx.FillRound(e.Graphics, Theme.Surface, new RectangleF(0, 0, card.Width - 1, card.Height - 1), Theme.S(16));
            Gfx.DrawRound(e.Graphics, Theme.Border, new RectangleF(0.5f, 0.5f, card.Width - 2, card.Height - 2), Theme.S(16), 1.2f);
        };
        RoundCard();
        var icon = new Txt("\uE8E5", 30f) { Font = Theme.Icons(40f), ForeColor = Theme.Accent, Dock = DockStyle.Top, Height = 70, TextAlign = ContentAlignment.MiddleCenter };
        Theme.Changed += () => icon.ForeColor = Theme.Accent;
        var title = new Txt("Drop your files here", 17f, FontStyle.Bold) { Dock = DockStyle.Top, Height = 38, TextAlign = ContentAlignment.MiddleCenter };
        var sub = new Txt("PDFs and pictures. Then drag pages to reorder, merge, rotate and export.", 10f, FontStyle.Regular, true)
        { Dock = DockStyle.Top, Height = 48, TextAlign = ContentAlignment.TopCenter };
        var buttons = new Panel { Dock = DockStyle.Top, Height = 54, BackColor = Color.Transparent };
        FlatButton B(string text, string glyph, BtnKind k, int w, Action a)
        {
            var b = new FlatButton { Text = text, Glyph = glyph, Kind = k, Width = w, Height = 40, Margin = new Padding(0) };
            b.Click += (_, _) => a(); return b;
        }
        buttons.Controls.Add(emptyAddPdfBtn = B("Add PDF / image", "\uE710", BtnKind.Primary, 156, () => Fire(AddFilesFlow())));
        buttons.Controls.Add(emptyAddImageBtn = B("Add images", "\uE91B", BtnKind.Secondary, 132, () => Fire(PickImagesFlow())));
        buttons.Controls.Add(B("Help guide", "\uE897", BtnKind.Ghost, 124, () => ShowHelp()));
        var hint = new Txt("Tip: you can also drop files anywhere on this window.  Press F1 for the full guide.", 9f, FontStyle.Regular, true)
        { Dock = DockStyle.Top, Height = 30, TextAlign = ContentAlignment.MiddleCenter };
        card.Controls.Add(hint); card.Controls.Add(buttons); card.Controls.Add(sub); card.Controls.Add(title); card.Controls.Add(icon);
        s.Controls.Add(card);

        // Wrap the buttons into centred rows for whatever width the card has.
        void LayoutButtons(int avail)
        {
            var gapX = Theme.S(8); var gapY = Theme.S(8);
            var rows = new List<List<Control>> { new() };
            var rowW = 0;
            foreach (Control c in buttons.Controls)
            {
                var need = c.Width + (rows[^1].Count > 0 ? gapX : 0);
                if (rows[^1].Count > 0 && rowW + need > avail) { rows.Add(new List<Control>()); rowW = 0; need = c.Width; }
                rows[^1].Add(c); rowW += need;
            }
            var y = Theme.S(10);
            foreach (var row in rows)
            {
                var total = row.Sum(c => c.Width) + gapX * (row.Count - 1);
                var x = (avail - total) / 2;
                foreach (var c in row) { c.Location = new Point(Math.Max(0, x), y); x += c.Width + gapX; }
                y += row[0].Height + gapY;
            }
            buttons.Height = y + 2;
        }

        // The card grows and shrinks with the window; text and buttons re-wrap to fit.
        void LayoutEmpty()
        {
            if (s.Width <= 0 || s.Height <= 0) return;
            var margin = Theme.S(20);
            var maxW = (int)Math.Clamp(s.Width * 0.72, Theme.S(520), Theme.S(980));
            card.Width = Math.Max(Theme.S(240), Math.Min(maxW, s.Width - margin * 2));
            var inner = Math.Max(60, card.Width - card.Padding.Horizontal);
            int Measure(Txt t) => TextRenderer.MeasureText(t.Text, t.Font, new Size(inner, 0), TextFormatFlags.WordBreak | TextFormatFlags.NoPadding).Height + Theme.S(8);
            sub.Height = Math.Max(Theme.S(24), Measure(sub));
            hint.Height = Math.Max(Theme.S(24), Measure(hint));
            LayoutButtons(inner);
            card.Height = card.Padding.Vertical + icon.Height + title.Height + sub.Height + buttons.Height + hint.Height + Theme.S(6);
            card.Location = new Point((s.Width - card.Width) / 2, Math.Max(margin / 2, (s.Height - card.Height) / 2 - Theme.S(20)));
        }
        s.Resize += (_, _) => LayoutEmpty();
        s.VisibleChanged += (_, _) => { if (s.Visible) LayoutEmpty(); };
        return s;
    }

    private void WireEvents()
    {
        grid.StateChanged += (_, _) => { UpdateUi(); ShowPreview(false); };
        grid.ReorderRequested += OnReorder;
        grid.FilesDropped += (files, at) => { if (!accessDenied) Fire(AddFilesAsync(files, at)); };
        grid.AddFilesRequested += () => { if (!accessDenied) Fire(AddFilesFlow()); };
        grid.QuickRotate += p => { if (!accessDenied) Edit(() => p.Rotation = PdfService.Norm(p.Rotation + 90)); };
        grid.QuickDelete += p => { if (!accessDenied) Edit(() => pages.Remove(p)); };
        grid.PageOpened += p => { grid.SelectOnly(pages.IndexOf(p)); };
        grid.ZoomWheel += d => { if (!accessDenied) sizeBar.Value = Math.Clamp(sizeBar.Value + d * 12, sizeBar.Minimum, sizeBar.Maximum); };
        grid.ContextRequested += ShowContextMenu;
        sizeBar.ValueChanged += (_, _) => grid.TileWidth = sizeBar.Value;

        preview.RotateLeftClicked += () => Rotate(-90);
        preview.RotateRightClicked += () => Rotate(90);
        preview.AddTextClicked += AddText;
        preview.AddImageClicked += AddImageOverlay;
        preview.ClearTextClicked += ClearOverlays;
        preview.PrevClicked += () => { if (pages.Count > 0) grid.SelectOnly(Math.Max(0, grid.ActiveIndex - 1)); grid.EnsureVisible(grid.ActiveIndex); };
        preview.NextClicked += () => { if (pages.Count > 0) grid.SelectOnly(Math.Min(pages.Count - 1, Math.Max(0, grid.ActiveIndex) + 1)); grid.EnsureVisible(grid.ActiveIndex); };

        DragEnter += (_, e) => e.Effect = !accessDenied && e.Data?.GetDataPresent(DataFormats.FileDrop) == true ? DragDropEffects.Copy : DragDropEffects.None;
        DragDrop += (_, e) => { if (!accessDenied && e.Data?.GetData(DataFormats.FileDrop) is string[] f) Fire(AddFilesAsync(f, -1)); };
        KeyDown += OnKey;
        Shown += (_, _) =>
        {
            FitToScreen();
            FlatButton.LayoutReady = true;
            CaptureToolOriginals();
            ApplyResponsive();
            preview.RefreshLayout();
            ApplyPreviewVisibility();
            grid.Relayout();
            if (AccessControlService.State == AccessControlService.AccessState.Denied)
                SetAccessOverlay(true, true, AccessControlService.Reason);
            AccessControlService.StateChanged -= OnAccessStateChanged;
            AccessControlService.StateChanged += OnAccessStateChanged;
            AccessControlService.Start();
            UsageTracker.Start();
            BackgroundUpdateService.StateChanged -= OnBackgroundUpdateChanged;
            BackgroundUpdateService.StateChanged += OnBackgroundUpdateChanged;
            var restoredUpdate = BackgroundUpdateService.Current;
            if (restoredUpdate.Status == BackgroundUpdateStatus.Ready)
            {
                // Let the splash finish closing and the main window become visible before a restored-update prompt appears.
                var restorePromptTimer = new System.Windows.Forms.Timer { Interval = 1400 };
                restorePromptTimer.Tick += (_, _) =>
                {
                    restorePromptTimer.Stop(); restorePromptTimer.Dispose();
                    if (!IsDisposed) HandleBackgroundUpdateState(restoredUpdate);
                };
                restorePromptTimer.Start();
            }
            else HandleBackgroundUpdateState(restoredUpdate);
            ScheduleRandomReviewPrompt();
            if (UpdateService.AutoCheck)
            {
                // quiet check a few seconds after start; nothing is shown unless a newer release exists
                var t = new System.Windows.Forms.Timer { Interval = 4000 };
                t.Tick += (_, _) => { t.Stop(); t.Dispose(); Fire(CheckForUpdatesAsync(false)); };
                t.Start();
            }
        };
        Resize += (_, _) =>
        {
            if (!IsHandleCreated || split.Width <= 0) return;
            ApplyResponsive();
            ApplyPreviewVisibility();
        };
        DpiChanged += (_, _) => { Theme.Init(); FlatButton.FitTree(this); };
        FormClosing += (_, e) =>
        {
            if (busy) { e.Cancel = true; return; }
            if (dirty && pages.Count > 0 &&
                MessageBox.Show(this, "You have page changes that haven't been exported. Close anyway?", "PDF Studio", MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes)
                e.Cancel = true;
        };
        FormClosed += (_, _) =>
        {
            AppSettings.SetInt("thumb", sizeBar.Value);
            AppSettings.SetBool("autofit", grid.AutoFit);
            AppSettings.SetBool("preview", previewPref);
            UsageTracker.Stop();
            BackgroundUpdateService.StateChanged -= OnBackgroundUpdateChanged;
            if (updateDownloadWindow is { IsDisposed: false }) updateDownloadWindow.ClosePermanently();
            updateDownloadWindow = null;
            AccessControlService.StateChanged -= OnAccessStateChanged;
            AccessControlService.Stop();
            try { reviewPromptTimer?.Stop(); reviewPromptTimer?.Dispose(); } catch { }
            reviewPromptTimer = null;
            thumbs.Dispose();
            try { Directory.Delete(sessionDir, true); } catch { }
        };
    }

    /// <summary>Occasionally asks for a review without nagging the user. A submitted/queued review permanently opts the install out.</summary>
    private void ScheduleRandomReviewPrompt()
    {
        if (UsageTracker.HasReviewed || Random.Shared.NextDouble() >= 0.125) return; // about one in eight sessions
        reviewPromptTimer?.Stop();
        reviewPromptTimer?.Dispose();
        reviewPromptTimer = new System.Windows.Forms.Timer { Interval = 15000 };
        reviewPromptTimer.Tick += (_, _) =>
        {
            reviewPromptTimer?.Stop();
            if (IsDisposed || UsageTracker.HasReviewed || !Visible || ActiveForm != this) return;
            ShowReview();
        };
        reviewPromptTimer.Start();
    }

    /// <summary>Opens at about 94 % of the usable screen (never larger than it), centred.</summary>
    private void FitToScreen()
    {
        var wa = Screen.FromControl(this).WorkingArea;
        MinimumSize = new Size(Math.Min(MinimumSize.Width, wa.Width), Math.Min(MinimumSize.Height, wa.Height));
        if (WindowState != FormWindowState.Normal) return;
        var w = Math.Min(wa.Width, Math.Max(MinimumSize.Width, (int)(wa.Width * 0.94)));
        var h = Math.Min(wa.Height, Math.Max(MinimumSize.Height, (int)(wa.Height * 0.94)));
        Size = new Size(w, h);
        Location = new Point(wa.Left + (wa.Width - w) / 2, wa.Top + (wa.Height - h) / 2);
    }

    private void CaptureToolOriginals()
    {
        if (toolOriginals.Count > 0) return;
        foreach (var b in toolButtons) toolOriginals[b] = (b.Text, b.Width, b.Height);
    }

    /// <summary>
    /// Every strip of the window adapts to its width in steps: header (tagline, labels), ribbon (labels become icon-only),
    /// status bar (zoom controls, captions) — so nothing overlaps or gets clipped at any size.
    /// </summary>
    private void ApplyResponsive()
    {
        var w = ClientSize.Width;
        var wide = w >= Theme.S(1180);
        var mid = w >= Theme.S(860);
        var narrow = w < Theme.S(700);

        SuspendLayout();
        // header: tagline and captions disappear step by step; whatever stays is measured, never clipped
        tagText.Visible = w >= Theme.S(1000);
        appName.Visible = w >= Theme.S(560);
        void Cap(FlatButton b, string text) { var t = wide ? text : ""; if (b.Text != t) b.Text = t; }
        Cap(addBtn, "Add files");
        Cap(convertBtn, "Convert");
        Cap(reviewBtn, "Review");
        var exportText = wide ? "Export PDF" : mid ? "Export" : "";
        if (exportBtn.Text != exportText) exportBtn.Text = exportText;

        // ribbon: icon-only below the "mid" width
        if (toolOriginals.Count > 0)
        {
            ribbonFlow.SuspendLayout();
            foreach (var bt in toolButtons)
            {
                var o = toolOriginals[bt];
                var t = mid ? o.Text : "";
                if (bt.Text != t) bt.Text = t;
                var nh = mid ? o.H : Theme.S(44);
                if (bt.Height != nh) bt.Height = nh;
                bt.MinWidth = mid ? 62 : (bt.DropMenu is not null ? 54 : 46);
            }
            ribbonFlow.ResumeLayout(true);
        }

        // status bar
        sizeLabel.Visible = w >= Theme.S(1100);
        var showZoom = w >= Theme.S(780);
        sizeBar.Visible = zoomOutBtn.Visible = zoomInBtn.Visible = sizeGroupSep.Visible = showZoom;
        sizeBar.Width = Math.Clamp(w / 9, Theme.S(80), Theme.S(220));
        var fitText = mid ? "Fit columns" : ""; if (fitToggle.Text != fitText) fitToggle.Text = fitText;
        var prevText = mid ? "Preview" : ""; if (previewToggle.Text != prevText) previewToggle.Text = prevText;
        countText.Visible = !narrow || !busy;
        ResumeLayout(true);
        FlatButton.FitTree(this);
    }

    /// <summary>
    /// Preview pane layout follows the window: beside the pages on wide windows, underneath them on narrow-but-tall
    /// windows, hidden only when there is genuinely no room.
    /// </summary>
    private void ApplyPreviewVisibility()
    {
        var w = ClientSize.Width; var h = ClientSize.Height;
        var side = w >= Theme.S(980);
        var stacked = !side && w >= Theme.S(520) && h >= Theme.S(720);
        var hasPages = pages.Count > 0;
        // The preview pane stays hidden until a PDF / image page has been added (nothing to preview yet).
        var show = previewPref && hasPages && (side || stacked);
        var orient = side ? Orientation.Vertical : Orientation.Horizontal; // Vertical splitter = panes side by side

        if (show && split.Orientation != orient)
        {
            try { split.Panel1MinSize = 0; split.Panel2MinSize = 0; split.Orientation = orient; } catch { }
            splitterInitialised = false;
        }
        preview.BorderLeft = side; preview.BorderTop = !side; preview.Invalidate();

        var wasHidden = split.Panel2Collapsed;
        if (wasHidden == show)
        {
            split.Panel2Collapsed = !show;
            if (show) { splitterInitialised = false; ConfigureSplitter(); ShowPreview(true); }
        }
        else if (show) ConfigureSplitter();
        previewToggle.Active = show;
        previewToggle.Enabled = !accessDenied && AccessControlService.State != AccessControlService.AccessState.Denied && hasPages && (side || stacked);
        previewToggle.Invalidate();
    }

    /// <summary>Applies min sizes and the preview size only once the container has a real size (setting them earlier throws).</summary>
    private void ConfigureSplitter()
    {
        try
        {
            if (split.Panel2Collapsed) return;
            var sideBySide = split.Orientation == Orientation.Vertical;
            var total = sideBySide ? split.Width : split.Height;
            var p1 = Theme.S(sideBySide ? 300 : 200); var p2 = Theme.S(sideBySide ? 280 : 220);
            if (total < p1 + p2 + split.SplitterWidth + 10) return;
            if (!splitterInitialised)
            {
                splitterInitialised = true;
                var previewSize = sideBySide
                    ? Math.Clamp((int)(total * 0.34), Theme.S(320), Theme.S(900))
                    : Math.Clamp((int)(total * 0.42), p2, total - p1 - split.SplitterWidth);
                split.SplitterDistance = Math.Clamp(total - previewSize, p1, total - p2 - split.SplitterWidth);
            }
            if (split.Panel1MinSize != p1) split.Panel1MinSize = p1;
            if (split.Panel2MinSize != p2) split.Panel2MinSize = p2;
        }
        catch { /* never let layout tuning crash the app */ }
    }

    private void OnKey(object? sender, KeyEventArgs e)
    {
        if (busy) return;
        bool Do(Action a) { a(); e.SuppressKeyPress = true; e.Handled = true; return true; }
        if (e.KeyCode == Keys.F1) Do(() => ShowHelp());
        else if (accessDenied || AccessControlService.State == AccessControlService.AccessState.Denied) return;
        else if (e.Control && e.Shift && e.KeyCode == Keys.Left) Do(() => MoveSelected(-1));
        else if (e.Control && e.Shift && e.KeyCode == Keys.Right) Do(() => MoveSelected(1));
        else if (e.Control && e.Shift && e.KeyCode == Keys.S) Do(() => Fire(ExportAsync(true)));
        else if (e.Control && e.KeyCode == Keys.A) Do(grid.SelectAll);
        else if (e.Control && e.KeyCode == Keys.I) Do(grid.InvertSelection);
        else if (e.Control && e.KeyCode == Keys.N) Do(NewDocument);
        else if (e.Control && e.KeyCode == Keys.Z) Do(Undo);
        else if (e.Control && e.KeyCode == Keys.Y) Do(Redo);
        else if (e.Control && e.KeyCode == Keys.D) Do(DuplicateSelected);
        else if (e.Control && e.KeyCode == Keys.T) Do(AddText);
        else if (e.Control && e.KeyCode == Keys.E) Do(EditPdf);
        else if (e.Control && e.KeyCode == Keys.P) Do(() => Fire(OpenInViewerAsync()));
        else if (e.Control && e.KeyCode == Keys.O) Do(() => Fire(AddFilesFlow()));
        else if (e.Control && e.KeyCode == Keys.S) Do(() => Fire(ExportAsync(false)));
        else if (e.Control && e.KeyCode == Keys.Left) Do(() => Rotate(-90));
        else if (e.Control && e.KeyCode == Keys.Right) Do(() => Rotate(90));
        else if (e.Control && (e.KeyCode == Keys.Oemplus || e.KeyCode == Keys.Add)) Do(() => sizeBar.Value = Math.Min(sizeBar.Maximum, sizeBar.Value + 20));
        else if (e.Control && (e.KeyCode == Keys.OemMinus || e.KeyCode == Keys.Subtract)) Do(() => sizeBar.Value = Math.Max(sizeBar.Minimum, sizeBar.Value - 20));
        else if (e.Control && e.KeyCode == Keys.D0) Do(() => sizeBar.Value = 170);
        else if (e.KeyCode == Keys.Delete) Do(DeleteSelected);
        else if (e.KeyCode == Keys.Escape && !grid.IsDragging && grid.Selection.Count > 0) Do(grid.ClearSelection);
    }

    private void ShowContextMenu(Point at)
    {
        if (busy || accessDenied || AccessControlService.State == AccessControlService.AccessState.Denied || pages.Count == 0) return;
        var m = Menus.Make(
            ("Rotate right\tCtrl+→", () => Rotate(90)), ("Rotate left\tCtrl+←", () => Rotate(-90)), ("Rotate 180°", () => Rotate(180)),
            ("Duplicate\tCtrl+D", DuplicateSelected), ("Delete\tDel", DeleteSelected), ("-", null),
            ("Move to the start", () => MoveToEdge(true)), ("Move to the end", () => MoveToEdge(false)), ("Move to page number…", MoveToPosition), ("-", null),
            ("Insert blank page…", InsertBlank), ("Edit PDF…\tCtrl+E", EditPdf), ("Add text…\tCtrl+T", AddText), ("Add image…", AddImageOverlay), ("-", null),
            ("Select pages from the same file", SelectSameSource), ("Select all\tCtrl+A", () => grid.SelectAll()), ("-", null),
            ("Extract to new PDF…", () => Fire(ExtractSelectedAsync())));
        m.Show(grid, at);
    }

    private void ToggleTheme()
    {
        Theme.SetDark(!Theme.Dark);
        AppSettings.SaveDark(Theme.Dark);
        Invalidate(true);
    }
}
