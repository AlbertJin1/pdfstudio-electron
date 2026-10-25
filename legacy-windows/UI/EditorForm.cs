using PdfStudio.Models;
using PdfStudio.Services;
using System.Drawing.Drawing2D;
using System.Drawing.Text;
using System.Runtime.InteropServices;

namespace PdfStudio.UI;

/// <summary>
/// The Edit PDF window: edit the text that is already in the PDF, add text / pictures / signatures / shapes,
/// move and resize every object, change fonts. Nothing touches the source file; the result is stored on the pages
/// and written into the PDF on export.
/// </summary>
public sealed partial class EditorForm : Form
{
    private enum Tool { Select, EditText, AddText, Rect, Ellipse, Line, Highlight, Whiteout, Redact }
    private enum DragMode { None, Move, Resize, Create, Margin }

    private sealed class Canvas : Control
    {
        public Canvas() { SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw | ControlStyles.Selectable, true); TabStop = true; }
    }

    // ── data ──
    private readonly IReadOnlyList<PageItem> pages;
    private readonly Dictionary<Guid, List<PageEditObject>> edits = new();
    private readonly Dictionary<Guid, List<PdfTextBlock>> blockCache = new();
    private readonly ImagePdfService renderer = new();
    private readonly List<(int Page, List<PageEditObject> Objs)> undo = new(), redo = new();
    private int index;
    private bool dirty;
    private string? textReadError;

    // ── view ──
    private const int Pad = 24;
    private float zoom = 1f;
    private Bitmap? pageBmp;
    private int renderVer;
    private readonly System.Windows.Forms.Timer renderTimer = new() { Interval = 160 };
    private bool inLayout;

    // ── interaction ──
    private Tool tool = Tool.EditText;
    private PageEditObject? sel;
    private PdfTextBlock? hoverBlock;
    private DragMode drag = DragMode.None;
    private PointF dragStart;
    private PageEditObject? dragOrig;
    private RectangleF dragBounds;
    private int dragHandle = -1;
    private bool dragUndoPushed;
    private RichTextBox? editBox;
    private EditFrame? editFrame;                // the visible frame around the text box while editing
    private PageEditObject? editObj;
    private List<PageEditObject>? editBeforeSnapshot;
    private List<(int Page, List<PageEditObject> Objs)>? editUndoSnapshot, editRedoSnapshot;
    private bool editIsNew;
    private (string OrigText, List<PageEditObject> Before)? pendingConv;
    private bool convDirty;
    private PdfTextBlock? pendingBlock;          // text line pressed but not yet converted: click = edit it, drag = move it
    private Point pendingDown;
    private bool gripMoving, gripUndoPushed;
    private Point gripAnchor;
    private const string TypingHint = "Edit text in place. The source baseline, font proportions and character formatting are preserved; text is never auto-squeezed as you type. If it reaches another field, reduce the font size or move/resize it. Esc cancels.";
    private readonly PageEditObject defaults = new() { Kind = EditKind.Text, FontName = "Arial", FontSize = 14, ColorHex = "#000000" };
    private string lastUndoKey = ""; private long lastUndoTick;
    private bool updatingUi;

    // ── controls ──
    private readonly Canvas canvas = new();
    private readonly ViewPanel scroller = new() { Dock = DockStyle.Fill, AutoScroll = true };
    private FlatButton undoBtn = null!, redoBtn = null!, selectBtn = null!, editTextBtn = null!, addTextBtn = null!, shapesBtn = null!, prevBtn = null!, nextBtn = null!;
    private readonly Txt pageLabel = new("", 9.5f, FontStyle.Bold) { TextAlign = ContentAlignment.MiddleCenter, Width = 120, Height = 34 };
    private readonly Txt zoomLabel = new("100%", 9.5f, FontStyle.Bold) { TextAlign = ContentAlignment.MiddleCenter, Width = 62, Height = 34 };
    private readonly Txt hint = new("", 9f, FontStyle.Regular, true) { Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleLeft, AutoEllipsis = true };
    private readonly ToolTip tips = new() { InitialDelay = 350 };
    private Surface props = null!;
    private PropsGrip propsGrip = null!;
    private int propsGripStartX, propsGripStartW;
    private bool applyingPropsWidth;
    private const int PropsWidthMin = 270, PropsWidthDefault = 320, PropsWidthMax = 640;   // design pixels
    private readonly List<FlowLayoutPanel> propsFlows = new();                          // button rows that fill the panel's width
    private readonly List<(FlatButton Button, int PerRow)> propsButtons = new();        // buttons that share a row equally
    private FlowLayoutPanel propsFlow = null!;
    private TableLayoutPanel textGroup = null!, shapeGroup = null!, posGroup = null!, actionGroup = null!;
    private Txt propsTitle = null!;
    private readonly ComboBox fontBox = new ModernCombo { MaxDropDownItems = 16 };
    private readonly NumericUpDown sizeNum = new() { Minimum = 4, Maximum = 400, DecimalPlaces = 1, Value = 14 };
    private FlatButton boldBtn = null!, italicBtn = null!, underBtn = null!;
    private readonly Panel textSwatch = Swatch(), fillSwatch = Swatch(), strokeSwatch = Swatch();
    private readonly CheckBox fillCheck = new() { Text = "Fill", AutoSize = true }, strokeCheck = new() { Text = "Outline", AutoSize = true };
    private readonly NumericUpDown opacityNum = new() { Minimum = 0, Maximum = 100, Value = 100 };
    private readonly NumericUpDown strokeNum = new() { Minimum = 0, Maximum = 60, DecimalPlaces = 2, Increment = 0.25m, Value = 1.5m };
    private readonly NumericUpDown xNum = PosNum(), yNum = PosNum(), wNum = PosNum(), hNum = PosNum();
    private Control[] fillRows = Array.Empty<Control>();

    public bool Changed => dirty;
    public Dictionary<Guid, List<PageEditObject>> Result =>
        edits.ToDictionary(k => k.Key, v => v.Value.Select(o => o.Clone()).ToList());

    private List<PageEditObject> Objs => edits[pages[index].Id];
    private (double W, double H) PageSize => pages[index].DisplaySizePt(false);

    private static Panel Swatch() => new() { Width = 30, Height = 24, BorderStyle = BorderStyle.FixedSingle, BackColor = Color.White, Margin = new Padding(0, 3, 8, 3), Cursor = Cursors.Hand };
    private static NumericUpDown PosNum() => new() { Minimum = -9999, Maximum = 9999, DecimalPlaces = 1 };

    public EditorForm(IReadOnlyList<PageItem> source, int startIndex)
    {
        pages = source;
        foreach (var p in pages) edits[p.Id] = p.Edits.Select(e => e.Clone()).ToList();
        foreach (var p in pages) margins[p.Id] = p.Margins.Clone();
        index = Math.Clamp(startIndex, 0, Math.Max(0, pages.Count - 1));

        AutoScaleDimensions = new SizeF(96f, 96f); AutoScaleMode = AutoScaleMode.Dpi;
        Text = "Edit PDF"; Font = Theme.Ui(); BackColor = Theme.Window;
        StartPosition = FormStartPosition.CenterParent; ShowInTaskbar = false; MinimizeBox = false;
        WindowState = FormWindowState.Maximized; MinimumSize = new Size(900, 600);
        KeyPreview = false;

        BuildUi();
        renderTimer.Tick += (_, _) => { renderTimer.Stop(); RenderPage(); };
        Shown += (_, _) =>
        {
            FlatButton.FitTree(this);
            SetPropsWidth(props.Width); ApplyPropsWidth();
            FitZoom(); GoToPage(index, true);
            SetTool(Tool.EditText);
        };
        scroller.SizeChanged += (_, _) => { if (!inLayout) Relayout(); };
        SizeChanged += (_, _) => { if (props != null) SetPropsWidth(props.Width); };   // keep room for the page when the window shrinks
        FormClosed += (_, _) => { renderTimer.Dispose(); pageBmp?.Dispose(); };
    }

    // ═════════════════════════ UI construction ═════════════════════════

    private FlatButton Btn(string text, string glyph, Action click, string tip, bool glyphIsText = false)
    {
        var b = new FlatButton
        {
            Text = text, Glyph = glyph, GlyphIsText = glyphIsText, Kind = BtnKind.Ghost, Vertical = true,
            Width = Theme.S(64), Height = Theme.S(60), Margin = new Padding(1, 0, 1, 2), Font = Theme.Ui(8.5f), AutoWidth = true, MinWidth = 56
        };
        b.Click += (_, _) => click();
        tips.SetToolTip(b, tip);
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
        // ── top toolbar ──
        var bar = new Surface { Dock = DockStyle.Top, Height = Theme.S(72), Padding = new Padding(10, 4, 10, 2), BorderBottom = true };
        bar.UseRole(() => Theme.Surface);
        var flow = new FlowLayoutPanel { Dock = DockStyle.Fill, WrapContents = false, BackColor = Color.Transparent, AutoScroll = false };
        undoBtn = Btn("Undo", "\uE7A7", DoUndo, "Undo (Ctrl+Z)");
        redoBtn = Btn("Redo", "\uE7A6", DoRedo, "Redo (Ctrl+Y)");
        selectBtn = Btn("Select", "\uE7C9", () => SetTool(Tool.Select), "Select, move and resize objects you added (Esc)");
        editTextBtn = Btn("Edit text", "\uE70F", () => SetTool(Tool.EditText), "Click any existing text in the PDF to change it. Also selects, moves and resizes added objects.");
        addTextBtn = Btn("Add text", "\uE8D2", () => SetTool(Tool.AddText), "Click on the page to type new text");
        var imageBtn = Btn("Image", "\uE91B", AddImage, "Insert a picture or logo, then drag and resize it");
        var sigBtn = Btn("Signature", "\u270D", () => { }, "Insert one of your saved signatures, add a signature picture (transparent PNG) or draw a new one", true);
        sigBtn.DropMenu = BuildSignatureMenu();
        shapesBtn = Btn("Shapes", "\u25AD", () => { }, "Rectangle, ellipse, line, highlight, white-out, black box", true);
        shapesBtn.DropMenu = Menus.Make(
            ("Rectangle", () => SetTool(Tool.Rect)), ("Ellipse", () => SetTool(Tool.Ellipse)), ("Line", () => SetTool(Tool.Line)), ("-", null),
            ("Highlight", () => SetTool(Tool.Highlight)), ("White-out (hide existing content)", () => SetTool(Tool.Whiteout)), ("Black box (redact)", () => SetTool(Tool.Redact)));
        CreateLayoutButtons();
        flow.Controls.AddRange(new Control[] { undoBtn, redoBtn, Sep(), selectBtn, editTextBtn, addTextBtn, imageBtn, sigBtn, shapesBtn, Sep(), snapBtn, marginBtn });
        bar.Controls.Add(flow);

        // ── bottom bar ──
        var bottom = new Surface { Dock = DockStyle.Bottom, Height = Theme.S(54), Padding = new Padding(10, 8, 10, 8), BorderTop = true };
        bottom.UseRole(() => Theme.Surface);
        // one-row tables: a control anchored only Left is centred vertically, so nothing can sit higher or lower than its neighbours
        TableLayoutPanel CentredRow(DockStyle side, params Control[] items)
        {
            var t = new TableLayoutPanel
            {
                Dock = side, AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink, BackColor = Color.Transparent,
                ColumnCount = items.Length, RowCount = 1, Margin = Padding.Empty, Padding = Padding.Empty
            };
            t.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
            for (var i = 0; i < items.Length; i++)
            {
                t.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
                items[i].Dock = DockStyle.None; items[i].Anchor = AnchorStyles.Left;
                t.Controls.Add(items[i], i, 0);
            }
            return t;
        }
        FlatButton Small(string glyph, string text, Action a, string tip, bool isText = false)
        {
            var b = new FlatButton { Glyph = glyph, Text = text, GlyphIsText = isText, Kind = BtnKind.Ghost, Height = 34, Width = text.Length > 0 ? 60 : 38, Margin = new Padding(0, 0, 2, 0), AutoWidth = text.Length > 0, MinWidth = 38 };
            b.Click += (_, _) => a(); tips.SetToolTip(b, tip); return b;
        }
        prevBtn = Small("\uE76B", "", () => GoToPage(index - 1), "Previous page (Page Up)");
        nextBtn = Small("\uE76C", "", () => GoToPage(index + 1), "Next page (Page Down)");
        var zOut = Small("\u2212", "", () => SetZoom(zoom / 1.2f), "Zoom out (Ctrl + wheel)", true);
        var zIn = Small("+", "", () => SetZoom(zoom * 1.2f), "Zoom in (Ctrl + wheel)", true);
        var fit = Small("\uE740", "Fit", () => { FitZoom(); }, "Fit the page in the window");
        pageLabel.Margin = Padding.Empty; zoomLabel.Margin = Padding.Empty;
        var bottomSep = new Surface { Width = 1, Height = Theme.S(24), Margin = new Padding(8, 0, 8, 0) };
        bottomSep.UseRole(() => Theme.Border);
        var left = CentredRow(DockStyle.Left, prevBtn, pageLabel, nextBtn, bottomSep, zOut, zoomLabel, zIn, fit);
        var apply = new FlatButton { Text = "Save changes", Kind = BtnKind.Primary, Width = 150, Height = 36, Margin = new Padding(8, 0, 0, 0) };
        tips.SetToolTip(apply, "Keep all your edits on every page and close this window");
        apply.Click += (_, _) => { if (!ConfirmTextOverflow()) return; CommitInlineEdit(); DialogResult = DialogResult.OK; Close(); };
        var cancel = new FlatButton { Text = "Cancel", Kind = BtnKind.Secondary, Width = 96, Height = 36, Margin = Padding.Empty };
        cancel.Click += (_, _) => { DialogResult = DialogResult.Cancel; Close(); };
        tips.SetToolTip(cancel, "Close this window without keeping your edits");
        var right = CentredRow(DockStyle.Right, cancel, apply);
        bottom.Controls.Add(hint);
        bottom.Controls.Add(right);
        bottom.Controls.Add(left);
        hint.Padding = new Padding(14, 0, 0, 0);

        // ── properties panel ──
        BuildProps();

        // ── canvas ──
        scroller.BackColor = Theme.Canvas;
        scroller.Controls.Add(canvas);
        canvas.Paint += PaintCanvas;
        canvas.MouseDown += OnDown; canvas.MouseMove += OnMove; canvas.MouseUp += OnUp;
        canvas.MouseLeave += (_, _) => { if (hoverBlock != null) { hoverBlock = null; canvas.Invalidate(); } };
        canvas.MouseWheel += OnWheel; scroller.MouseWheel += OnWheel;

        // Order matters: controls added last are docked first. Result: toolbar, bottom bar, side panel, drag grip, then the page area.
        BuildPropsGrip();
        Controls.Add(scroller);
        Controls.Add(propsGrip);
        Controls.Add(props);
        Controls.Add(bottom);
        Controls.Add(bar);
        Theme.Apply(propsFlow);
        ApplyPropsWidth();
        textSwatch.BackColor = Color.Black; fillSwatch.BackColor = Color.White; strokeSwatch.BackColor = Color.Black;
    }

    private TableLayoutPanel Group(string title)
    {
        var t = new TableLayoutPanel { ColumnCount = 2, AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink, Width = Theme.S(250), Margin = new Padding(0, 0, 0, 10), BackColor = Color.Transparent };
        t.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, Theme.S(78)));
        t.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        var h = new Txt(title, 10f, FontStyle.Bold) { AutoSize = true, Margin = new Padding(0, 4, 0, 4) };
        t.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        t.Controls.Add(h, 0, 0); t.SetColumnSpan(h, 2);
        t.RowCount = 1;
        return t;
    }

    private Control[] Row(TableLayoutPanel t, string label, Control c)
    {
        var r = t.RowCount++;
        t.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        var l = new Txt(label, 9f, FontStyle.Regular, true) { AutoSize = true, Anchor = AnchorStyles.Left, Margin = new Padding(0, 6, 4, 6) };
        if (c is NumericUpDown or ComboBox) c.Dock = DockStyle.Fill;
        c.Margin = new Padding(0, 3, 0, 3);
        t.Controls.Add(l, 0, r); t.Controls.Add(c, 1, r);
        return new Control[] { l, c };
    }

    /// <summary>Adds a control across the whole width of a group (used for check boxes, so their text is never cut off).</summary>
    private void Span(TableLayoutPanel t, Control c)
    {
        var r = t.RowCount++;
        t.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        c.Margin = new Padding(0, 3, 0, 3);
        t.Controls.Add(c, 0, r); t.SetColumnSpan(c, 2);
    }

    private FlowLayoutPanel ColourRow(Panel swatch, Action<Color> picked, Func<Color> current)
    {
        var f = new FlowLayoutPanel { AutoSize = true, WrapContents = false, BackColor = Color.Transparent, Margin = new Padding(0) };
        var b = new FlatButton { Text = "Colour…", Kind = BtnKind.Secondary, Width = 90, Height = 28, Margin = new Padding(0, 1, 0, 1) };
        void Pick()
        {
            using var cd = new ColorDialog { Color = current(), FullOpen = true, AnyColor = true };
            if (cd.ShowDialog(this) == DialogResult.OK) { swatch.BackColor = cd.Color; picked(cd.Color); }
        }
        b.Click += (_, _) => Pick(); swatch.Click += (_, _) => Pick();
        f.Controls.Add(swatch); f.Controls.Add(b);
        return f;
    }

    private FlatButton StyleBtn(string text, FontStyle style, Action<bool> set)
    {
        var b = new FlatButton { Text = text, Kind = BtnKind.Ghost, Width = 40, Height = 30, Font = Theme.Ui(10.5f, style), Margin = new Padding(0, 0, 4, 0) };
        b.Click += (_, _) => { b.Active = !b.Active; b.Invalidate(); if (!updatingUi) set(b.Active); };
        return b;
    }

    private void BuildProps()
    {
        var savedW = Math.Clamp(AppSettings.GetInt("editPanelWidth", PropsWidthDefault), PropsWidthMin, PropsWidthMax);
        props = new Surface { Dock = DockStyle.Right, Width = Theme.S(savedW), Padding = new Padding(14, 10, 8, 8), BorderLeft = true };
        props.UseRole(() => Theme.Surface);
        propsFlow = new FlowLayoutPanel { Dock = DockStyle.Fill, FlowDirection = FlowDirection.TopDown, WrapContents = false, AutoScroll = true, BackColor = Color.Transparent };
        // never show a sideways scroll bar: everything inside is sized to the panel's width instead
        propsFlow.AutoScroll = false;
        propsFlow.HorizontalScroll.Enabled = false; propsFlow.HorizontalScroll.Visible = false; propsFlow.HorizontalScroll.Maximum = 0;
        propsFlow.AutoScroll = true;
        propsFlow.SizeChanged += (_, _) => ApplyPropsWidth();
        propsTitle = new Txt("Properties", 12f, FontStyle.Bold) { AutoSize = true, Margin = new Padding(0, 0, 0, 6) };
        propsFlow.Controls.Add(propsTitle);
        BuildLayoutGroups();
        propsFlow.Controls.Add(tipLabel);

        // text
        textGroup = Group("Text");
        foreach (var f in new InstalledFontCollection().Families.Select(f => f.Name).OrderBy(n => n, StringComparer.OrdinalIgnoreCase)) fontBox.Items.Add(f);
        fontBox.SelectedIndexChanged += (_, _) => { if (fontBox.SelectedItem is string n) ApplyText(o => o.FontName = n, "font"); };
        Row(textGroup, "Font", fontBox);
        sizeNum.ValueChanged += (_, _) => ApplyText(o => o.FontSize = (double)sizeNum.Value, "size");
        Row(textGroup, "Size (pt)", sizeNum);
        boldBtn = StyleBtn("B", FontStyle.Bold, v => ApplyText(o => o.Bold = v, "bold"));
        italicBtn = StyleBtn("I", FontStyle.Italic, v => ApplyText(o => o.Italic = v, "italic"));
        underBtn = StyleBtn("U", FontStyle.Underline, v => ApplyText(o => o.Underline = v, "underline"));
        var st = new FlowLayoutPanel { AutoSize = true, WrapContents = false, BackColor = Color.Transparent, Margin = new Padding(0) };
        st.Controls.AddRange(new Control[] { boldBtn, italicBtn, underBtn });
        Row(textGroup, "Style", st);
        Row(textGroup, "Colour", ColourRow(textSwatch, c => ApplyText(o => o.ColorHex = PageEditObject.Hex(c), "tcolor"), () => textSwatch.BackColor));
        propsFlow.Controls.Add(textGroup);

        // shapes
        shapeGroup = Group("Shape");
        fillRows = Row(shapeGroup, "", fillCheck).Concat(Row(shapeGroup, "", ColourRow(fillSwatch, c => ApplyShape(o => { o.FillHex = PageEditObject.Hex(c); }, "fillc"), () => fillSwatch.BackColor)))
                    .Concat(Row(shapeGroup, "Opacity %", opacityNum)).ToArray();
        fillCheck.CheckedChanged += (_, _) => ApplyShape(o => { if (fillCheck.Checked) { if (string.IsNullOrEmpty(o.FillHex)) o.FillHex = PageEditObject.Hex(fillSwatch.BackColor); } else o.FillHex = ""; }, "fill");
        opacityNum.ValueChanged += (_, _) => ApplyShape(o => o.FillAlpha = (int)Math.Round((double)opacityNum.Value * 255 / 100), "opacity");
        Row(shapeGroup, "", strokeCheck);
        Row(shapeGroup, "", ColourRow(strokeSwatch, c => ApplyShape(o => { o.StrokeHex = PageEditObject.Hex(c); }, "strokec"), () => strokeSwatch.BackColor));
        strokeCheck.CheckedChanged += (_, _) => ApplyShape(o => { if (strokeCheck.Checked) { if (string.IsNullOrEmpty(o.StrokeHex)) o.StrokeHex = PageEditObject.Hex(strokeSwatch.BackColor); if (o.StrokeWidth <= 0) o.StrokeWidth = 1.5; } else o.StrokeHex = ""; }, "stroke");
        strokeNum.ValueChanged += (_, _) => ApplyShape(o => o.StrokeWidth = (double)strokeNum.Value, "strokew");
        Row(shapeGroup, "Width (pt)", strokeNum);
        propsFlow.Controls.Add(shapeGroup);

        // position
        posGroup = Group("Position and size (pt)");
        xNum.ValueChanged += (_, _) => ApplyAny(o => o.X = (double)xNum.Value, "x");
        yNum.ValueChanged += (_, _) => ApplyAny(o => o.Y = (double)yNum.Value, "y");
        wNum.ValueChanged += (_, _) => ApplyAny(o =>
        {
            var nw = (double)wNum.Value;
            if (o.Kind == EditKind.Image && o.W > 0) o.H = o.H * nw / o.W;
            o.W = nw;
        }, "w", true);
        hNum.ValueChanged += (_, _) => ApplyAny(o =>
        {
            var nh = (double)hNum.Value;
            if (o.Kind == EditKind.Image && o.H > 0) o.W = o.W * nh / o.H;
            o.H = nh;
        }, "h", true);
        Row(posGroup, "X", xNum); Row(posGroup, "Y", yNum); Row(posGroup, "Width", wNum); Row(posGroup, "Height", hNum);
        propsFlow.Controls.Add(posGroup);
        propsFlow.Controls.Add(alignGroup);

        // actions
        actionGroup = Group("Object");
        var fp = new FlowLayoutPanel { AutoSize = true, Width = Theme.S(250), BackColor = Color.Transparent, Margin = new Padding(0) };
        propsFlows.Add(fp);
        FlatButton A(string t, Action a, bool danger = false)
        {
            var b = new FlatButton { Text = t, Kind = BtnKind.Secondary, Width = Theme.S(118), Height = 30, Margin = new Padding(0, 0, 6, 6), DangerStyle = danger };
            b.Click += (_, _) => a(); propsButtons.Add((b, 2)); return b;
        }
        fp.Controls.AddRange(new Control[] { A("Duplicate", DuplicateSel), A("Delete", DeleteSel, true), A("Bring to front", () => Reorder(true)), A("Send to back", () => Reorder(false)) });
        var rowA = actionGroup.RowCount++; actionGroup.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        actionGroup.Controls.Add(fp, 0, rowA); actionGroup.SetColumnSpan(fp, 2);
        propsFlow.Controls.Add(actionGroup);
        propsFlow.Controls.Add(marginGroup);

        var clear = new FlatButton { Text = "Clear all edits on this page", Kind = BtnKind.Secondary, Width = Theme.S(250), Height = 30, Margin = new Padding(0, 4, 0, 0) };
        propsButtons.Add((clear, 1));
        clear.Click += (_, _) =>
        {
            if (Objs.Count == 0) return;
            if (MessageBox.Show(this, "Remove every edit you made on this page?", "Edit PDF", MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return;
            CommitInlineEdit(); PushUndo(); Objs.Clear(); sel = null; SyncProps(); canvas.Invalidate();
        };
        propsFlow.Controls.Add(clear);
        props.Controls.Add(propsFlow);
    }

    // ═════════════════════════ tools ═════════════════════════

    private void SetTool(Tool t)
    {
        CommitInlineEdit();
        tool = t;
        if (t is not (Tool.Select or Tool.EditText)) sel = null;
        selectBtn.Active = t == Tool.Select; editTextBtn.Active = t == Tool.EditText; addTextBtn.Active = t == Tool.AddText;
        shapesBtn.Active = t is Tool.Rect or Tool.Ellipse or Tool.Line or Tool.Highlight or Tool.Whiteout or Tool.Redact;
        foreach (var b in new[] { selectBtn, editTextBtn, addTextBtn, shapesBtn }) b.Invalidate();
        hoverBlock = null;
        canvas.Cursor = t switch { Tool.AddText => Cursors.IBeam, Tool.Select or Tool.EditText => Cursors.Default, _ => Cursors.Cross };
        UpdateHint(); SyncProps(); canvas.Invalidate();
    }

    private void UpdateHint()
    {
        var noText = !pages[index].IsBlank && blockCache.TryGetValue(pages[index].Id, out var bl) && bl.Count == 0;
        hint.Text = tool switch
        {
            Tool.EditText when textReadError != null => "Existing text could not be read on this machine. You can still cover it with White-out and add text on top.",
            Tool.EditText when noText => "No selectable text on this page (it may be a scan). Use Shapes → White-out, then Add text.",
            Tool.EditText => "Click text to edit it, or press and drag it to move it. Things snap into place (hold Alt to move freely).",
            Tool.Select => "Click an object to select it, then drag to move it or drag a handle to resize. Press Delete to remove it.",
            Tool.AddText => "Click where the text should go, type it, then click Apply. Choose font, size and colour on the right.",
            Tool.Line => "Drag on the page to draw a line.",
            _ => "Drag on the page to draw the shape."
        };
    }

    private void AddImage()
    {
        using var d = new OpenFileDialog { Title = "Choose a picture", Filter = "Pictures (*.png;*.jpg;*.jpeg;*.bmp;*.gif;*.tif;*.tiff)|*.png;*.jpg;*.jpeg;*.bmp;*.gif;*.tif;*.tiff" };
        if (d.ShowDialog(this) != DialogResult.OK) return;
        InsertPicture(d.FileName, 180);
    }

    // ── signatures: saved library (survives restarts), quick-pick menu on the Signature button ──

    private const double SignatureWidthPt = 150;
    private const int SignatureMenuMax = 8;

    private ContextMenuStrip BuildSignatureMenu()
    {
        var m = new ContextMenuStrip
        {
            Renderer = new ModernRenderer(), ShowImageMargin = true, ShowCheckMargin = false, Font = Theme.Ui(10f),
            Padding = new Padding(5), BackColor = Theme.Surface
        };
        Menus.Round(m);
        m.Opening += (_, _) => FillSignatureMenu(m);
        return m;
    }

    private void FillSignatureMenu(ContextMenuStrip m)
    {
        foreach (ToolStripItem old in m.Items) old.Image?.Dispose();
        m.Items.Clear();
        m.BackColor = Theme.Surface;

        var sigs = SignatureStore.List();
        if (sigs.Count == 0)
            m.Items.Add(new ToolStripMenuItem("No saved signatures yet") { Enabled = false, Padding = new Padding(14, 7, 18, 7) });
        foreach (var s in sigs.Take(SignatureMenuMax))
        {
            var sig = s;
            var it = new ToolStripMenuItem(sig.Name)
            {
                Padding = new Padding(6, 4, 10, 4), ImageScaling = ToolStripItemImageScaling.None,
                Image = SignatureStore.Thumbnail(sig.Path, 132, 44), ToolTipText = "Insert " + sig.Name
            };
            it.Click += (_, _) => InsertSaved(sig);
            m.Items.Add(it);
        }
        if (sigs.Count > SignatureMenuMax) AddMenuCommand(m, $"Show all {sigs.Count} signatures…", ManageSignatures);

        m.Items.Add(new ToolStripSeparator());
        AddMenuCommand(m, "Add signature picture…", AddSignatureImage);
        AddMenuCommand(m, "Draw a new signature…", DrawSignature);
        if (sigs.Count > 0) AddMenuCommand(m, "Manage saved signatures…", ManageSignatures);
    }

    private static void AddMenuCommand(ContextMenuStrip m, string text, Action click)
    {
        var it = new ToolStripMenuItem(text) { Padding = new Padding(14, 7, 18, 7) };
        it.Click += (_, _) => click();
        m.Items.Add(it);
    }

    private void InsertSaved(SavedSignature sig)
    {
        if (!File.Exists(sig.Path))
        {
            MessageBox.Show(this, $"The file for “{sig.Name}” is missing. Open Manage saved signatures to remove or re-add it.", "Edit PDF", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return;
        }
        InsertPicture(sig.Path, SignatureWidthPt);
    }

    private void AddSignatureImage()
    {
        var sig = SignatureImportDialog.Pick(this);
        if (sig != null) InsertPicture(sig.Path, SignatureWidthPt);
    }

    private void DrawSignature()
    {
        using var dlg = new SignatureDialog();
        if (dlg.ShowDialog(this) != DialogResult.OK || dlg.PngPath == null) return;
        var path = dlg.PngPath;
        if (dlg.Remember)
        {
            try { path = SignatureStore.AddFromFile(dlg.PngPath, null).Path; }
            catch (Exception ex) { MessageBox.Show(this, "The signature was inserted but couldn't be saved for next time: " + ex.Message, "Edit PDF", MessageBoxButtons.OK, MessageBoxIcon.Information); }
        }
        InsertPicture(path, SignatureWidthPt);
    }

    private void ManageSignatures()
    {
        using var dlg = new SignatureLibraryDialog();
        if (dlg.ShowDialog(this) == DialogResult.OK && dlg.Chosen != null) InsertSaved(dlg.Chosen);
    }

    private void InsertPicture(string path, double widthPt)
    {
        try
        {
            CommitInlineEdit();
            var dir = Path.Combine(Path.GetTempPath(), "PdfStudio"); Directory.CreateDirectory(dir);
            var copy = Path.Combine(dir, $"img_{Guid.NewGuid():N}{Path.GetExtension(path)}");
            File.Copy(path, copy, true);
            double iw, ih;
            using (var img = Image.FromFile(copy)) { iw = img.Width; ih = img.Height; }
            if (iw <= 0 || ih <= 0) return;
            var (pw, ph) = PageSize;
            var w = Math.Min(widthPt, pw * 0.8); var h = w * ih / iw;
            if (h > ph * 0.8) { h = ph * 0.8; w = h * iw / ih; }
            var c = VisibleCenterPt();
            var o = new PageEditObject
            {
                Kind = EditKind.Image, ImagePath = copy, W = w, H = h,
                X = Math.Clamp(c.X - w / 2, 0, Math.Max(0, pw - w)), Y = Math.Clamp(c.Y - h / 2, 0, Math.Max(0, ph - h))
            };
            PushUndo(); Objs.Add(o);
            SetTool(Tool.EditText);
            sel = o; SyncProps(); canvas.Invalidate(); canvas.Focus();
        }
        catch (Exception ex) { MessageBox.Show(this, "That picture couldn't be used: " + ex.Message, "Edit PDF", MessageBoxButtons.OK, MessageBoxIcon.Warning); }
    }

    private PointF VisibleCenterPt()
    {
        var vx = -scroller.AutoScrollPosition.X + scroller.ClientSize.Width / 2 - canvas.Left;
        var vy = -scroller.AutoScrollPosition.Y + scroller.ClientSize.Height / 2 - canvas.Top;
        var (pw, ph) = PageSize;
        return new PointF((float)Math.Clamp((vx - Pad) / zoom, 0, pw), (float)Math.Clamp((vy - Pad) / zoom, 0, ph));
    }

    // ═════════════════════════ undo ═════════════════════════

    private List<PageEditObject> SnapOf(int page) => edits[pages[page].Id].Select(o => o.Clone()).ToList();

    private void PushUndo()
    {
        undo.Add((index, SnapOf(index)));
        if (undo.Count > 200) undo.RemoveAt(0);
        redo.Clear(); dirty = true; UpdateUndoButtons();
    }

    private void PushUndoCoalesced(string key)
    {
        var k = (sel?.Id.ToString() ?? "-") + key;
        if (k == lastUndoKey && Environment.TickCount64 - lastUndoTick < 1500) { lastUndoTick = Environment.TickCount64; dirty = true; return; }
        lastUndoKey = k; lastUndoTick = Environment.TickCount64; PushUndo();
    }

    private void UpdateUndoButtons() { undoBtn.Enabled = undo.Count > 0; redoBtn.Enabled = redo.Count > 0; }

    private void DoUndo()
    {
        CommitInlineEdit();
        if (undo.Count == 0) return;
        var (pg, snap) = undo[^1]; undo.RemoveAt(undo.Count - 1);
        redo.Add((pg, SnapOf(pg)));
        RestorePage(pg, snap);
    }

    private void DoRedo()
    {
        CommitInlineEdit();
        if (redo.Count == 0) return;
        var (pg, snap) = redo[^1]; redo.RemoveAt(redo.Count - 1);
        undo.Add((pg, SnapOf(pg)));
        RestorePage(pg, snap);
    }

    private void RestorePage(int pg, List<PageEditObject> snap)
    {
        var list = edits[pages[pg].Id]; list.Clear(); list.AddRange(snap);
        dirty = true; lastUndoKey = "";
        if (pg != index) GoToPage(pg); else { sel = null; SyncProps(); canvas.Invalidate(); }
        UpdateUndoButtons();
    }

    // ═════════════════════════ pages / zoom / rendering ═════════════════════════

    private void GoToPage(int i, bool force = false)
    {
        if (i < 0 || i >= pages.Count) return;
        if (i == index && !force) return;
        CommitInlineEdit();
        index = i; sel = null; hoverBlock = null;
        pageLabel.Text = $"Page {index + 1} of {pages.Count}";
        prevBtn.Enabled = index > 0; nextBtn.Enabled = index < pages.Count - 1;
        UpdateUndoButtons();
        var old = pageBmp; pageBmp = null; old?.Dispose();
        Relayout(); scroller.AutoScrollPosition = Point.Empty;
        ClearGuides(); SyncMargins();
        RenderPage(); LoadBlocks(); SyncProps(); UpdateHint(); canvas.Invalidate();
    }

    private void FitZoom()
    {
        var (pw, ph) = PageSize;
        var z = Math.Min((scroller.ClientSize.Width - Pad * 2 - 6) / pw, (scroller.ClientSize.Height - Pad * 2 - 6) / ph);
        SetZoom((float)(Math.Floor(z * 72.0) / 72.0));   // round down so the page still fits
    }

    private void SetZoom(float z)
    {
        z = Math.Clamp(z, 0.2f, 6f);
        z = (float)(Math.Round(z * 72.0) / 72.0);
        if (Math.Abs(z - zoom) < 0.0001f && canvas.Width > 0) return;
        zoom = z;
        zoomLabel.Text = $"{Math.Round(zoom * 100)}%";
        Relayout(); PositionEditBox();
        renderTimer.Stop(); renderTimer.Start();
    }

    private void Relayout()
    {
        if (inLayout || pages.Count == 0) return;
        inLayout = true;
        try
        {
            var (pw, ph) = PageSize;
            var cw = (int)Math.Ceiling(pw * zoom) + Pad * 2; var ch = (int)Math.Ceiling(ph * zoom) + Pad * 2;
            var keep = new Point(-scroller.AutoScrollPosition.X, -scroller.AutoScrollPosition.Y);
            scroller.AutoScrollPosition = Point.Empty;
            canvas.Size = new Size(cw, ch);
            canvas.Location = new Point(Math.Max(0, (scroller.ClientSize.Width - cw) / 2), Math.Max(0, (scroller.ClientSize.Height - ch) / 2));
            scroller.AutoScrollMinSize = new Size(cw, ch);
            if (keep != Point.Empty) scroller.AutoScrollPosition = keep;
            canvas.Invalidate();
        }
        finally { inLayout = false; }
    }

    private async void RenderPage()
    {
        if (pages.Count == 0) return;
        var ver = ++renderVer; var page = pages[index];
        // zoom is snapped so 72*zoom is a whole DPI: the page bitmap is then drawn 1:1 (no resampling, no blur)
        var dpi = (int)Math.Clamp(Math.Round(72.0 * zoom * DeviceDpiScale()), 48, 400);
        Bitmap? bmp = null;
        try
        {
            bmp = await Task.Run(() =>
            {
                if (!page.IsBlank) return renderer.RenderBitmapLossless(page.SourcePath, page.SourcePageIndex, dpi);
                var b = new Bitmap(Math.Max(1, (int)(page.WidthPt * dpi / 72)), Math.Max(1, (int)(page.HeightPt * dpi / 72)));
                using var g = Graphics.FromImage(b); g.Clear(Color.White);
                return b;
            });
        }
        catch { }
        if (ver != renderVer || IsDisposed) { bmp?.Dispose(); return; }
        var old = pageBmp; pageBmp = bmp; old?.Dispose();
        canvas.Invalidate();
    }

    private double DeviceDpiScale() => 1.0;

    private async void LoadBlocks()
    {
        var page = pages[index];
        if (page.IsBlank || blockCache.ContainsKey(page.Id)) return;
        List<PdfTextBlock>? list = null;
        try { list = await Task.Run(() => PdfiumText.GetBlocks(page.SourcePath, page.SourcePageIndex)); }
        catch (Exception ex) { textReadError = ex.Message; }
        blockCache[page.Id] = list ?? new List<PdfTextBlock>();
        if (IsDisposed) return;
        AutoMargins(page);
        UpdateHint(); canvas.Invalidate();
    }

    private void OnWheel(object? sender, MouseEventArgs e)
    {
        if ((ModifierKeys & Keys.Control) != 0)
        {
            SetZoom(zoom * (e.Delta > 0 ? 1.12f : 1 / 1.12f));
            if (e is HandledMouseEventArgs h) h.Handled = true;
        }
        else if (sender == canvas)
        {
            scroller.AutoScrollPosition = new Point(-scroller.AutoScrollPosition.X, -scroller.AutoScrollPosition.Y - e.Delta);
            if (e is HandledMouseEventArgs h) h.Handled = true;
        }
    }

    // ═════════════════════════ painting ═════════════════════════

    private PointF ToPt(Point s) => new((s.X - Pad) / zoom, (s.Y - Pad) / zoom);
    private PointF ToScr(double x, double y) => new((float)(x * zoom + Pad), (float)(y * zoom + Pad));
    private RectangleF ToScr(RectangleF r) => new(r.X * zoom + Pad, r.Y * zoom + Pad, r.Width * zoom, r.Height * zoom);

    private void PaintCanvas(object? sender, PaintEventArgs e)
    {
        var g = e.Graphics;
        g.Clear(Theme.Canvas);
        var (pw, ph) = PageSize;
        var pr = new Rectangle(Pad, Pad, (int)Math.Round(pw * zoom), (int)Math.Round(ph * zoom));
        using (var sb = new SolidBrush(Color.FromArgb(45, 0, 0, 0))) g.FillRectangle(sb, pr.X + 3, pr.Y + 4, pr.Width, pr.Height);
        g.FillRectangle(Brushes.White, pr);
        if (pageBmp != null)
        {
            g.PixelOffsetMode = PixelOffsetMode.Half;
            if (Math.Abs(pageBmp.Width - pr.Width) <= 1 && Math.Abs(pageBmp.Height - pr.Height) <= 1)
            {
                // exact 1:1 copy – the page keeps PDFium's own pixels, so edited text can match it exactly
                g.InterpolationMode = InterpolationMode.NearestNeighbor;
                g.DrawImage(pageBmp, new Rectangle(pr.X, pr.Y, pageBmp.Width, pageBmp.Height), 0, 0, pageBmp.Width, pageBmp.Height, GraphicsUnit.Pixel);
            }
            else
            {
                g.InterpolationMode = pageBmp.Width >= pr.Width * 0.9 ? InterpolationMode.HighQualityBicubic : InterpolationMode.Bilinear;
                g.DrawImage(pageBmp, pr);
            }
            g.PixelOffsetMode = PixelOffsetMode.Default;
        }

        var clip = g.Clip;
        g.SetClip(pr);
        var st = g.Save();
        g.TranslateTransform(Pad, Pad); g.ScaleTransform(zoom, zoom);
        EditPainter.Draw(g, Objs, editObj?.Id);
        g.Restore(st);
        g.Clip = clip;

        if (hoverBlock != null && drag == DragMode.None)
        {
            var r = ToScr(hoverBlock.Box); r.Inflate(2, 2);
            using var fill = new SolidBrush(Color.FromArgb(34, Theme.Accent));
            using var pen = new Pen(Theme.Accent, 1.4f) { DashStyle = DashStyle.Dash };
            g.FillRectangle(fill, r); g.DrawRectangle(pen, r.X, r.Y, r.Width, r.Height);
        }

        // while a text box is open its own frame (EditFrame) is the selection, so nothing is drawn underneath it
        if (sel != null && !(editBox != null && ReferenceEquals(sel, editObj))) DrawSelection(g, sel);
        DrawLayoutOverlays(g);
    }

    private const int HandleSize = 9;

    private List<(int Id, RectangleF Rect)> Handles(PageEditObject o)
    {
        var res = new List<(int, RectangleF)>();
        RectangleF H(float cx, float cy) => new(cx - HandleSize / 2f, cy - HandleSize / 2f, HandleSize, HandleSize);
        if (o.Kind == EditKind.Line)
        {
            var a = ToScr(o.X, o.Y); var b = ToScr(o.X + o.W, o.Y + o.H);
            res.Add((0, H(a.X, a.Y))); res.Add((1, H(b.X, b.Y)));
            return res;
        }
        var r = ToScr(EditPainter.Bounds(o));
        if (o.Kind == EditKind.Text)
        {
            res.Add((0, H(r.Left, r.Top))); res.Add((2, H(r.Right, r.Top))); res.Add((4, H(r.Right, r.Bottom))); res.Add((6, H(r.Left, r.Bottom)));
            return res;
        }
        float cx = r.Left + r.Width / 2, cy = r.Top + r.Height / 2;
        res.Add((0, H(r.Left, r.Top))); res.Add((1, H(cx, r.Top))); res.Add((2, H(r.Right, r.Top))); res.Add((3, H(r.Right, cy)));
        res.Add((4, H(r.Right, r.Bottom))); res.Add((5, H(cx, r.Bottom))); res.Add((6, H(r.Left, r.Bottom))); res.Add((7, H(r.Left, cy)));
        return res;
    }

    private void DrawSelection(Graphics g, PageEditObject o)
    {
        g.SmoothingMode = SmoothingMode.None;
        if (o.Kind != EditKind.Line)
        {
            var r = ToScr(EditPainter.Bounds(o)); r.Inflate(2, 2);
            using var pen = new Pen(Theme.Accent, 1.2f) { DashStyle = DashStyle.Dash };
            g.DrawRectangle(pen, r.X, r.Y, r.Width, r.Height);
        }
        using var hb = new SolidBrush(Color.White); using var hp = new Pen(Theme.Accent, 1.6f);
        foreach (var (_, rc) in Handles(o)) { g.FillRectangle(hb, rc); g.DrawRectangle(hp, rc.X, rc.Y, rc.Width, rc.Height); }
    }

    // ═════════════════════════ hit testing ═════════════════════════

    private static float DistToSegment(PointF p, PointF a, PointF b)
    {
        float dx = b.X - a.X, dy = b.Y - a.Y;
        var len2 = dx * dx + dy * dy;
        var t = len2 < 1e-6f ? 0 : Math.Clamp(((p.X - a.X) * dx + (p.Y - a.Y) * dy) / len2, 0, 1);
        float px = a.X + t * dx, py = a.Y + t * dy;
        return (float)Math.Sqrt((p.X - px) * (p.X - px) + (p.Y - py) * (p.Y - py));
    }

    private PageEditObject? HitObject(PointF p)
    {
        var tol = 4f / zoom;
        var list = Objs;
        for (var i = list.Count - 1; i >= 0; i--)
        {
            var o = list[i];
            var b = EditPainter.Bounds(o);
            switch (o.Kind)
            {
                case EditKind.Line:
                    if (DistToSegment(p, new PointF((float)o.X, (float)o.Y), new PointF((float)(o.X + o.W), (float)(o.Y + o.H))) <= Math.Max(tol, (float)o.StrokeWidth / 2 + 2f / zoom)) return o;
                    break;
                case EditKind.Rect:
                case EditKind.Ellipse:
                {
                    if (!RectangleF.Inflate(b, tol, tol).Contains(p)) break;
                    if (!string.IsNullOrEmpty(o.FillHex) && o.FillAlpha > 0) return o;
                    var k = tol * 2 + (float)o.StrokeWidth;
                    var inner = RectangleF.Inflate(b, -k, -k);
                    if (inner.Width <= 0 || inner.Height <= 0 || !inner.Contains(p)) return o;
                    break;
                }
                default:
                    if (RectangleF.Inflate(b, tol, tol).Contains(p)) return o;
                    break;
            }
        }
        return null;
    }

    private static string BlockTag(PdfTextBlock b) => $"blk:{(int)b.Box.X}:{(int)b.Box.Y}:{b.Text.Length}";

    private PdfTextBlock? HitBlock(PointF p)
    {
        if (!blockCache.TryGetValue(pages[index].Id, out var list)) return null;
        PdfTextBlock? best = null; var bestArea = float.MaxValue;
        foreach (var b in list)
        {
            var r = RectangleF.Inflate(b.Box, 1.5f, 1.5f);
            if (!r.Contains(p)) continue;
            if (Objs.Any(o => o.Tag == BlockTag(b))) continue;     // already edited
            var area = r.Width * r.Height;
            if (area < bestArea) { best = b; bestArea = area; }
        }
        return best;
    }

    private int HitHandle(Point s)
    {
        if (sel == null) return -1;
        foreach (var (id, r) in Handles(sel)) if (RectangleF.Inflate(r, 3, 3).Contains(s)) return id;
        return -1;
    }

    private static Cursor HandleCursor(int h, EditKind kind) => kind == EditKind.Line ? Cursors.Cross : h switch
    {
        0 or 4 => Cursors.SizeNWSE, 2 or 6 => Cursors.SizeNESW, 1 or 5 => Cursors.SizeNS, _ => Cursors.SizeWE
    };

    // ═════════════════════════ mouse ═════════════════════════

    private void OnDown(object? sender, MouseEventArgs e)
    {
        canvas.Focus();
        CommitInlineEdit();
        var p = ToPt(e.Location);

        if (e.Button == MouseButtons.Right)
        {
            if (tool is Tool.Select or Tool.EditText)
            {
                var hit = HitObject(p);
                if (hit != null) { sel = hit; SyncProps(); canvas.Invalidate(); ShowObjectMenu(e.Location); }
            }
            return;
        }
        if (e.Button != MouseButtons.Left) return;

        switch (tool)
        {
            case Tool.AddText:
                { var sp = SnapPoint(p, true, false, null); ClearGuides(); CreateText(sp); }
                return;
            case Tool.Rect: case Tool.Ellipse: case Tool.Line: case Tool.Highlight: case Tool.Whiteout: case Tool.Redact:
                BeginCreate(SnapPoint(p, true, true, null));
                return;
        }

        // select / edit-text
        var h = HitHandle(e.Location);
        if (h >= 0 && sel != null)
        {
            BeginDrag(DragMode.Resize, p); dragHandle = h; return;
        }
        var o = HitObject(p);
        if (o != null)
        {
            sel = o; SyncProps(); canvas.Invalidate();
            if (e.Clicks >= 2 && o.Kind == EditKind.Text) { BeginInlineEdit(o, false, false); return; }
            BeginDrag(DragMode.Move, p);
            return;
        }
        if (tool == Tool.EditText)
        {
            var blk = HitBlock(p);
            if (blk != null) { pendingBlock = blk; pendingDown = e.Location; canvas.Capture = true; return; }
        }
        var ms = HitMarginLine(e.Location);
        if (ms >= 0)
        {
            sel = null; SyncProps();
            marginSide = ms; drag = DragMode.Margin; canvas.Capture = true; canvas.Invalidate();
            return;
        }
        sel = null; SyncProps(); canvas.Invalidate();
    }

    private void BeginDrag(DragMode mode, PointF p)
    {
        drag = mode; dragStart = p; dragOrig = sel!.Clone(); dragBounds = EditPainter.Bounds(sel); dragUndoPushed = false;
        canvas.Capture = true;
    }

    private void BeginCreate(PointF p)
    {
        PushUndo();
        var o = new PageEditObject { Kind = tool == Tool.Ellipse ? EditKind.Ellipse : tool == Tool.Line ? EditKind.Line : EditKind.Rect, X = p.X, Y = p.Y };
        switch (tool)
        {
            case Tool.Highlight: o.FillHex = "#FFEB3B"; o.FillAlpha = 110; o.StrokeHex = ""; break;
            case Tool.Whiteout: o.FillHex = "#FFFFFF"; o.FillAlpha = 255; o.StrokeHex = ""; break;
            case Tool.Redact: o.FillHex = "#000000"; o.FillAlpha = 255; o.StrokeHex = ""; break;
            case Tool.Line: o.StrokeHex = "#000000"; o.StrokeWidth = 2; break;
            default: o.FillHex = ""; o.StrokeHex = "#E11D48"; o.StrokeWidth = 2; break;
        }
        Objs.Add(o); sel = o;
        drag = DragMode.Create; dragStart = p; dragUndoPushed = true; canvas.Capture = true;
        canvas.Invalidate();
    }

    private void OnMove(object? sender, MouseEventArgs e)
    {
        if (gripMoving) { GripMove(); return; }          // text box being dragged by its Move handle or frame
        if (pendingBlock != null)
        {
            // a text line is held down: a small movement turns it into a movable text box (no typing), a plain click edits it
            if (Math.Abs(e.X - pendingDown.X) + Math.Abs(e.Y - pendingDown.Y) < 5) return;
            var blk = pendingBlock; pendingBlock = null;
            ConvertBlock(blk, false);
            if (sel != null) { BeginDrag(DragMode.Move, ToPt(pendingDown)); dragUndoPushed = true; }
            else { canvas.Capture = false; return; }
        }
        var p = ToPt(e.Location);
        if (drag == DragMode.None)
        {
            UpdateHover(e.Location, p);
            return;
        }
        if (drag == DragMode.Margin) { DragMargin(p); return; }
        if (sel == null) return;
        var o = sel;
        switch (drag)
        {
            case DragMode.Create:
                p = SnapPoint(p, true, true, o);
                ShowSnapHint();
                if (o.Kind == EditKind.Line) { o.W = p.X - dragStart.X; o.H = p.Y - dragStart.Y; }
                else
                {
                    o.X = Math.Min(dragStart.X, p.X); o.Y = Math.Min(dragStart.Y, p.Y);
                    o.W = Math.Abs(p.X - dragStart.X); o.H = Math.Abs(p.Y - dragStart.Y);
                }
                ShowGapsFor(o);
                break;
            case DragMode.Move:
            {
                var dx = p.X - dragStart.X; var dy = p.Y - dragStart.Y;
                if (!dragUndoPushed)
                {
                    if (Math.Abs(dx) * zoom < 3 && Math.Abs(dy) * zoom < 3) return;
                    UndoBefore(); dragUndoPushed = true;
                }
                var (sdx, sdy) = SnapMoveDelta(o, dx, dy);
                o.X = dragOrig!.X + sdx; o.Y = dragOrig.Y + sdy;
                ShowSnapHint();
                break;
            }
            case DragMode.Resize:
                if (!dragUndoPushed) { UndoBefore(); dragUndoPushed = true; }
                ResizeTo(SnapForResize(p));
                ShowGapsFor(o);
                ShowSnapHint();
                break;
        }
        canvas.Invalidate();
    }

    /// <summary>Pushes the pre-drag state of the selected object onto the undo stack.</summary>
    private void UndoBefore()
    {
        var snap = SnapOf(index);
        var i = snap.FindIndex(x => x.Id == dragOrig!.Id);
        if (i >= 0) snap[i] = dragOrig!.Clone();
        undo.Add((index, snap)); redo.Clear(); dirty = true; UpdateUndoButtons();
    }

    private void ResizeTo(PointF m)
    {
        var o = sel!; var d = dragOrig!; var r = dragBounds;
        if (o.Kind == EditKind.Line)
        {
            if (dragHandle == 0) { var ex = d.X + d.W; var ey = d.Y + d.H; o.X = m.X; o.Y = m.Y; o.W = ex - m.X; o.H = ey - m.Y; }
            else { o.W = m.X - d.X; o.H = m.Y - d.Y; }
            return;
        }
        if (o.Kind == EditKind.Text)
        {
            var leftSide = dragHandle is 0 or 6; var topSide = dragHandle is 0 or 2;
            var ax = leftSide ? r.Right : r.Left; var ay = topSide ? r.Bottom : r.Top;
            var newW = Math.Max(4f, Math.Abs(m.X - ax));
            var size = Math.Clamp(d.FontSize * newW / Math.Max(1f, r.Width), 4, 400);
            var s = (float)(size / Math.Max(4, d.FontSize));
            o.FontSize = Math.Round(size, 1);
            // ResizeTo runs on every mouse-move; always scale from the snapshot at drag start, not from the previous
            // mouse event, or repeatedly moving the handle would compound the text-size change.
            for (var i = 0; i < Math.Min(o.TextStyles.Count, d.TextStyles.Count); i++)
                o.TextStyles[i].FontSize = Math.Clamp(d.TextStyles[i].FontSize * s, 4, 400);
            var nw = r.Width * s; var nh = r.Height * s;
            o.X = leftSide ? ax - nw : ax; o.Y = topSide ? ay - nh : ay;
            if (d.EditFitWidthPt > 0) o.EditFitWidthPt = d.EditFitWidthPt * s; // deliberate resize establishes a new target width
            if (o.EditBaselineOffsetPt is not null) o.EditBaselineOffsetPt = EditPainter.FirstLineAscent(o);
            return;
        }
        float l = r.Left, t = r.Top, rt = r.Right, b = r.Bottom;
        switch (dragHandle)
        {
            case 0: l = m.X; t = m.Y; break;
            case 1: t = m.Y; break;
            case 2: rt = m.X; t = m.Y; break;
            case 3: rt = m.X; break;
            case 4: rt = m.X; b = m.Y; break;
            case 5: b = m.Y; break;
            case 6: l = m.X; b = m.Y; break;
            case 7: l = m.X; break;
        }
        var corner = dragHandle % 2 == 0;
        var keepAspect = o.Kind == EditKind.Image && corner && (ModifierKeys & Keys.Shift) == 0 && r.Height > 0;
        if (keepAspect)
        {
            var ar = r.Width / r.Height;
            var nw = Math.Max(Math.Abs(rt - l), 4f); var nh = nw / ar;
            var fixedLeft = dragHandle is 2 or 4; var fixedTop = dragHandle is 4 or 6;
            if (fixedLeft) { l = r.Left; rt = l + nw; } else { rt = r.Right; l = rt - nw; }
            if (fixedTop) { t = r.Top; b = t + nh; } else { b = r.Bottom; t = b - nh; }
        }
        o.X = Math.Min(l, rt); o.Y = Math.Min(t, b);
        o.W = Math.Max(2, Math.Abs(rt - l)); o.H = Math.Max(2, Math.Abs(b - t));
    }

    private void OnUp(object? sender, MouseEventArgs e)
    {
        canvas.Capture = false;
        if (gripMoving) { GripUp(); return; }
        if (pendingBlock != null) { var pb = pendingBlock; pendingBlock = null; ConvertBlock(pb); return; }
        ClearGuides();
        if (drag == DragMode.Margin)
        {
            drag = DragMode.None; marginSide = -1; UpdateHint(); canvas.Invalidate();
            return;
        }
        if (drag == DragMode.Create && sel != null)
        {
            var o = sel;
            var tiny = o.Kind == EditKind.Line ? Math.Abs(o.W) + Math.Abs(o.H) < 3 : o.W < 3 || o.H < 3;
            if (tiny) { Objs.Remove(o); sel = null; if (undo.Count > 0) undo.RemoveAt(undo.Count - 1); UpdateUndoButtons(); }
            drag = DragMode.None;
            SetTool(Tool.EditText);        // back to selecting after each shape
            if (!tiny) { sel = o; SyncProps(); }
            canvas.Invalidate();
            return;
        }
        var wasDrag = drag != DragMode.None;
        var wasTextResize = drag == DragMode.Resize && sel?.Kind == EditKind.Text;
        drag = DragMode.None; dragHandle = -1; dragOrig = null;
        if (wasTextResize && sel != null)
        {
            if (sel.EditBaselineOffsetPt is not null) sel.EditBaselineOffsetPt = EditPainter.FirstLineAscent(sel);
            ExpandOriginalCover(sel);
        }
        if (wasDrag) { SyncProps(); UpdateHint(); canvas.Invalidate(); }
    }

    private void UpdateHover(Point s, PointF p)
    {
        if (tool is Tool.Select or Tool.EditText)
        {
            var h = HitHandle(s);
            if (h >= 0 && sel != null) { canvas.Cursor = HandleCursor(h, sel.Kind); SetHover(null); return; }
            var o = HitObject(p);
            if (o != null) { canvas.Cursor = Cursors.SizeAll; SetHover(null); return; }
            var blk = tool == Tool.EditText ? HitBlock(p) : null;
            if (blk == null)
            {
                var ms = HitMarginLine(s);
                if (ms >= 0) { canvas.Cursor = ms % 2 == 0 ? Cursors.SizeWE : Cursors.SizeNS; SetHover(null); return; }
            }
            canvas.Cursor = blk != null ? Cursors.IBeam : Cursors.Default;
            SetHover(blk);
        }
    }

    private void SetHover(PdfTextBlock? b)
    {
        if (ReferenceEquals(b, hoverBlock)) return;
        hoverBlock = b; canvas.Invalidate();
    }

    private void ShowObjectMenu(Point at)
    {
        var m = Menus.Make(("Duplicate", DuplicateSel), ("Delete", DeleteSel), ("-", null),
            ("Bring to front", () => Reorder(true)), ("Send to back", () => Reorder(false)));
        m.Show(canvas, at);
    }

    // ═════════════════════════ create / convert / inline edit ═════════════════════════

    private void CreateText(PointF p)
    {
        PushUndo();
        var o = new PageEditObject
        {
            Kind = EditKind.Text, Text = "", X = p.X, Y = p.Y - defaults.FontSize * 0.5,
            FontName = defaults.FontName, FontSize = defaults.FontSize, Bold = defaults.Bold, Italic = defaults.Italic,
            Underline = defaults.Underline, ColorHex = defaults.ColorHex
        };
        Objs.Add(o); sel = o;
        SyncProps();
        BeginInlineEdit(o, true, false);
    }

    /// <summary>
    /// Returns the editable horizontal space after an existing PDF text block. The next block on the same baseline
    /// is treated as the neighboring field boundary; otherwise the right page margin is the limit. Unlike the old
    /// original-glyph-width limit, this lets text grow at its real font size until it reaches available space.
    /// </summary>
    private double AvailableEditWidth(PdfTextBlock block)
    {
        var (pageWidth, _) = PageSize;
        var startX = Math.Max(0, block.OriginX);
        var originalRight = Math.Max(block.Box.Right, block.OriginX + Math.Max(0, block.Advance));
        var boundary = pageWidth - 4;

        if (blockCache.TryGetValue(pages[index].Id, out var blocks))
        {
            var baselineTolerance = Math.Max(2.5, block.FontSize * 0.38);
            foreach (var other in blocks)
            {
                if (ReferenceEquals(block, other)) continue;
                if (Math.Abs(other.Baseline - block.Baseline) > baselineTolerance) continue;
                var otherLeft = Math.Max(other.Box.Left, other.OriginX);
                // Only a block to the right can constrain this line. Keep a small safety gap to prevent collision.
                if (otherLeft > originalRight + 0.5)
                    boundary = Math.Min(boundary, otherLeft - Math.Max(2.0, block.FontSize * 0.22));
            }
        }

        // Never give the field less room than the original visible text; that would make an untouched line change size.
        var originalWidth = Math.Max(4, EditPainter.MeasureText(new PageEditObject
        {
            Kind = EditKind.Text, Text = block.Text, X = block.OriginX,
            Y = block.Baseline - TextMetrics.Ascent(block.FontName, block.FontSize, block.Bold, block.Italic),
            FontName = block.FontName, FontSize = block.FontSize, Bold = block.Bold, Italic = block.Italic,
            Underline = block.TextStyles.Count == 1 && block.TextStyles[0].Start == 0 && block.TextStyles[0].Length >= block.Text.Length,
            TextStyles = block.TextStyles.Select(r => r.Clone()).ToList()
        }).Width);
        var available = Math.Max(0, boundary - startX);
        var pageAvailable = Math.Max(0, pageWidth - startX - 2);
        // Do not make an imported line smaller to fit a narrow estimate: its untouched text must retain its exact
        // source width. Only use the larger of this estimate and the original glyph width as the edit surface cap.
        return Math.Max(originalWidth + 1.5, Math.Min(Math.Max(available, originalWidth + 1.5), Math.Max(pageAvailable, originalWidth + 1.5)));
    }

    private void ConvertBlock(PdfTextBlock b, bool edit = true)
    {
        var before = SnapOf(index);
        PushUndo();
        var tag = BlockTag(b);

        // Anchor the replacement to PDFium's original pen origin and baseline, including mixed-format text runs.
        // The previous code used only the block's primary font ascent; a larger/bold/underlined run could therefore
        // move the line vertically the first time TextChanged recalculated its metrics.
        var size = b.FontSize;
        var desc = TextMetrics.Descent(b.FontName, size, b.Bold, b.Italic);

        // Cover the original glyphs before drawing the editable replacement. Keep this width at its source until a
        // committed edit actually needs more space; ExpandOriginalCover extends it later without covering the next field.
        var cTop = Math.Min(b.Box.Top, (float)(b.Baseline - size * 0.8)) - 0.6;
        var hasUnderlinedRuns = b.TextStyles.Any(r => r.Underline && r.Length > 0);
        var bottomOffset = Math.Max(desc, hasUnderlinedRuns ? size * 0.30 : 0);
        var cBottom = Math.Max(b.Box.Bottom, (float)(b.Baseline + bottomOffset)) + 0.6;
        var cover = new PageEditObject
        {
            Kind = EditKind.Rect, Tag = tag, X = b.Box.X - 1, Y = cTop, W = b.Box.Width + 2, H = cBottom - cTop,
            FillHex = SampleBackground(new RectangleF(b.Box.X, (float)cTop, b.Box.Width, (float)(cBottom - cTop))), FillAlpha = 255, StrokeHex = ""
        };
        var text = new PageEditObject
        {
            Kind = EditKind.Text, Tag = tag, Text = b.Text, X = b.OriginX,
            Y = b.Baseline - TextMetrics.Ascent(b.FontName, size, b.Bold, b.Italic), FontName = b.FontName, FontSize = size,
            Bold = b.Bold, Italic = b.Italic, ColorHex = PageEditObject.Hex(b.Color), HScale = 1.0,
            Underline = b.TextStyles.Count == 1 && b.TextStyles[0].Start == 0 && b.TextStyles[0].Length >= b.Text.Length,
            TextStyles = b.TextStyles.Select(r => r.Clone()).ToList()
        };
        var firstAscent = EditPainter.FirstLineAscent(text);
        text.Y = b.Baseline - firstAscent;
        text.EditBaselineOffsetPt = firstAscent;
        // Calibrate once to the source glyph box so existing text doesn't jump horizontally because a substitute font
        // has slightly different metrics. Keep this scale fixed while typing: new characters are never auto-squeezed.
        var naturalWidth = Math.Max(1.0, EditPainter.MeasureText(text).Width);
        var sourceWidth = Math.Max(1.0, b.Box.Width);
        // Embedded/subset PDF fonts can differ substantially from the installed replacement font. Calibrate across
        // the full range supported by RichEdit and the PDF painter; a tighter clamp made some originals jump in width.
        var sourceScale = Math.Clamp(sourceWidth / naturalWidth, 0.21, 4.99);
        text.HScale = sourceScale;
        text.EditFitMaxScale = sourceScale;
        text.EditFitWidthPt = AvailableEditWidth(b);
        Objs.Add(cover); Objs.Add(text);
        sel = text; hoverBlock = null;
        SyncProps();
        if (!edit) { pendingConv = null; convDirty = false; canvas.Invalidate(); return; }   // dragged: just a movable text box
        pendingConv = (b.Text, before); convDirty = false;
        BeginInlineEdit(text, false, true);
    }

    /// <summary>The paper colour around a text line, so the cover blends in (white on most pages).</summary>
    private string SampleBackground(RectangleF box)
    {
        var bmp = pageBmp;
        if (bmp == null) return "#FFFFFF";
        var (pw, _) = PageSize;
        var s = bmp.Width / pw;
        var samples = new List<Color>();
        void Add(double x, double y, int weight)
        {
            int px = (int)(x * s), py = (int)(y * s);
            if (px < 0 || py < 0 || px >= bmp.Width || py >= bmp.Height) return;
            var c = bmp.GetPixel(px, py);
            for (var k = 0; k < weight; k++) samples.Add(c);
        }
        // inside the line: ink is a minority of the pixels, so the most common colour is the paper
        var stepX = Math.Max(1.0 / s, box.Width / 70.0); var stepY = Math.Max(1.0 / s, box.Height / 10.0);
        for (double y = box.Top; y <= box.Bottom; y += stepY)
            for (double x = box.Left; x <= box.Right; x += stepX) Add(x, y, 1);
        // just outside the line (left/right/top/bottom) counts double
        var st = Math.Max(2f, box.Width / 14f);
        for (var x = box.Left; x <= box.Right; x += st) { Add(x, box.Top - 1.2, 2); Add(x, box.Bottom + 1.2, 2); }
        for (var y = box.Top; y <= box.Bottom; y += Math.Max(1.5f, box.Height / 4f)) { Add(box.Left - 1.8, y, 2); Add(box.Right + 1.8, y, 2); }
        if (samples.Count == 0) return "#FFFFFF";
        var best = samples.GroupBy(c => (c.R >> 3, c.G >> 3, c.B >> 3)).OrderByDescending(x => x.Count()).First().ToList();
        return PageEditObject.Hex(Color.FromArgb((int)Math.Round(best.Average(c => c.R)), (int)Math.Round(best.Average(c => c.G)), (int)Math.Round(best.Average(c => c.B))));
    }

    private void BeginInlineEdit(PageEditObject o, bool isNew, bool fromConversion)
    {
        CommitInlineEdit();
        // Capture object state plus undo/redo history at the start of the inline session. Cancel must discard
        // every mutation made while editing (typing, formatting, or dragging), without leaving ghost undo entries
        // or losing the redo history that existed before the session.
        editUndoSnapshot = undo.ToList();
        editRedoSnapshot = redo.ToList();
        editObj = o; editIsNew = isNew; sel = o;
        editBeforeSnapshot = !isNew && !fromConversion ? Objs.Select(item => item.Clone()).ToList() : null;
        if (!fromConversion) { pendingConv = null; }
        var box = new RichTextBox
        {
            Multiline = true, AcceptsTab = false, WordWrap = false, ScrollBars = RichTextBoxScrollBars.None,
            BorderStyle = BorderStyle.None, DetectUrls = false, HideSelection = false,
            BackColor = EditBoxBack(o), ForeColor = EditPainter.Parse(o.ColorHex, Color.Black),
            Text = (o.Text ?? "").Replace("\n", "\r\n")
        };
        editBox = box;
        var frame = new EditFrame();
        frame.MouseDown += (_, e) => { if (e.Button == MouseButtons.Left) GripDown(); };
        frame.MouseMove += (_, _) => GripMove();
        frame.MouseUp += (_, _) => GripUp();
        tips.SetToolTip(frame, "Press and drag the frame to move this text box (hold Alt to move freely)");
        editFrame = frame;
        canvas.Controls.Add(frame);
        canvas.Controls.Add(box);
        ZeroMargins(box);
        LoadRichTextStyles(box, o);
        ApplyHorizontalScaleToEditBox(box, o.HScale);
        ShowEditBar();
        hint.Text = TypingHint;
        StyleEditBox();
        UpdateEditOverflowHint();
        box.TextChanged += (_, _) =>
        {
            if (editBox != box || editObj == null) return;
            editObj.Text = box.Text.Replace("\r\n", "\n").Replace("\r", "");
            MaintainOriginalBaseline(editObj);
            RestoreSourceHorizontalScale(editObj);
            // RichEdit may reset CHARFORMAT2.wScale for characters inserted at the caret. Reapply the same fixed
            // source scale after every keystroke so the live text width matches the canvas and saved PDF instead of
            // jumping horizontally when inline editing is committed.
            ApplyHorizontalScaleToEditBox(box, editObj.HScale);
            dirty = true;
            UpdateEditOverflowHint();
            PositionEditBox(); canvas.Invalidate();
        };
        box.SelectionChanged += (_, _) =>
        {
            if (editBox != box || editObj == null || updatingUi) return;
            SyncProps();
        };
        box.KeyDown += (_, e) =>
        {
            if (e.KeyCode == Keys.Escape) { e.SuppressKeyPress = true; e.Handled = true; CancelInlineEdit(); }
            else if (e.Control && e.KeyCode == Keys.Enter) { e.SuppressKeyPress = true; e.Handled = true; if (ConfirmTextOverflow()) CommitInlineEdit(); }
        };
        box.LostFocus += (_, _) => BeginInvoke(new Action(() =>
        {
            if (editBox == box && !box.Focused && !props.ContainsFocus && !BarHasFocusOrMouse()) CommitInlineEdit();
        }));
        box.Focus();
        if (isNew || fromConversion) box.SelectAll(); else box.Select(box.TextLength, 0);
        SyncProps();
        canvas.Invalidate();
    }

    /// <summary>
    /// Size of a font read back from the RichTextBox, in pixels. The control reports fonts in points even though
    /// they were assigned in pixels, so reading <c>Font.Size</c> directly shrank text by 72/96 on every style change.
    /// </summary>
    private float RichPx(Font f)
    {
        if (f.Unit == GraphicsUnit.Pixel) return f.Size;
        var dpi = editBox?.DeviceDpi ?? DeviceDpi;
        return f.SizeInPoints * dpi / 72f;
    }

    private static Font RichFont(string name, double sizePx, bool bold, bool italic, bool underline)
    {
        var fam = TextMetrics.Family(name);
        var style = TextMetrics.StyleFor(fam, bold, italic) | (underline ? FontStyle.Underline : 0);
        try { return new Font(fam, (float)Math.Max(4, sizePx), style, GraphicsUnit.Pixel); }
        catch { return new Font("Arial", (float)Math.Max(4, sizePx), FontStyle.Regular, GraphicsUnit.Pixel); }
    }

    private static int ModelIndexToRichIndex(RichTextBox box, int modelIndex)
    {
        modelIndex = Math.Max(0, modelIndex);
        var count = 0;
        var text = box.Text;
        for (var i = 0; i < text.Length; i++)
        {
            if (count >= modelIndex) return i;
            if (text[i] == '\r' && i + 1 < text.Length && text[i + 1] == '\n') { i++; count++; }
            else count++;
        }
        return text.Length;
    }

    private void LoadRichTextStyles(RichTextBox box, PageEditObject o)
    {
        if (box.TextLength == 0)
        {
            box.Font = RichFont(o.FontName, o.FontSize * zoom, o.Bold, o.Italic, o.Underline);
            box.ForeColor = EditPainter.Parse(o.ColorHex, Color.Black);
            return;
        }
        var oldStart = box.SelectionStart; var oldLen = box.SelectionLength;
        box.SelectAll();
        using (var f = RichFont(o.FontName, o.FontSize * zoom, o.Bold, o.Italic, o.Underline)) box.SelectionFont = f;
        box.SelectionColor = EditPainter.Parse(o.ColorHex, Color.Black);
        foreach (var r in o.TextStyles.OrderBy(x => x.Start))
        {
            var modelStart = Math.Clamp(r.Start, 0, (box.Text ?? "").Replace("\r\n", "\n").Replace("\r", "\n").Length);
            var modelEnd = Math.Clamp(r.Start + r.Length, modelStart, (box.Text ?? "").Replace("\r\n", "\n").Replace("\r", "\n").Length);
            var a = ModelIndexToRichIndex(box, modelStart);
            var b = ModelIndexToRichIndex(box, modelEnd);
            var len = Math.Max(0, b - a);
            if (len <= 0) continue;
            box.Select(a, len);
            using var f = RichFont(r.FontName, r.FontSize * zoom, r.Bold, r.Italic, r.Underline);
            box.SelectionFont = f;
            box.SelectionColor = EditPainter.Parse(r.ColorHex, Color.Black);
        }
        box.Select(Math.Clamp(oldStart, 0, box.TextLength), Math.Min(oldLen, Math.Max(0, box.TextLength - oldStart)));
    }

    private void CaptureRichTextStyles()
    {
        if (editBox == null || editObj == null) return;
        var box = editBox; var o = editObj;
        var normalized = box.Text.Replace("\r\n", "\n").Replace("\r", "\n");
        o.Text = normalized;
        o.TextStyles.Clear();
        if (normalized.Length == 0) return;

        var savedStart = box.SelectionStart; var savedLen = box.SelectionLength;
        var modelIndex = 0;
        for (var i = 0; i < box.TextLength && modelIndex < normalized.Length; i++)
        {
            var ch = box.Text[i];
            if (ch == '\r' && i + 1 < box.TextLength && box.Text[i + 1] == '\n') continue;
            box.Select(i, 1);
            var f = box.SelectionFont;
            var c = box.SelectionColor;
            var fontName = f?.Name ?? o.FontName;
            var size = f?.Size is > 0 ? RichPx(f!) / Math.Max(0.01f, zoom) : o.FontSize;
            var bold = f?.Bold ?? o.Bold; var italic = f?.Italic ?? o.Italic; var underline = f?.Underline ?? o.Underline;
            var hex = PageEditObject.Hex(c);
            var run = new TextStyleRun { Start = modelIndex, Length = 1, FontName = fontName, FontSize = Math.Round(size, 2), Bold = bold, Italic = italic, Underline = underline, ColorHex = hex };
            if (o.TextStyles.Count > 0)
            {
                var prev = o.TextStyles[^1];
                if (prev.Start + prev.Length == run.Start && prev.SameStyle(run)) { prev.Length++; modelIndex++; continue; }
            }
            o.TextStyles.Add(run);
            modelIndex++;
        }
        box.Select(Math.Clamp(savedStart, 0, box.TextLength), Math.Min(savedLen, Math.Max(0, box.TextLength - savedStart)));
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct CharFormat2
    {
        public uint cbSize;
        public uint dwMask;
        public uint dwEffects;
        public int yHeight;
        public int yOffset;
        public int crTextColor;
        public byte bCharSet;
        public byte bPitchAndFamily;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string szFaceName;
        public ushort wWeight;
        public short sSpacing;
        public int crBackColor;
        public uint lcid;
        public uint dwReserved;
        public short sStyle;
        public ushort wKerning;
        public byte bUnderlineType;
        public byte bAnimation;
        public byte bRevAuthor;
        public byte bReserved1;
        public ushort wScale;
    }

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern IntPtr SendMessage(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam);

    [System.Runtime.InteropServices.DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr SendMessage(IntPtr hWnd, int msg, IntPtr wParam, ref CharFormat2 lParam);

    /// <summary>Applies the calibrated PDF glyph width (20–500%) to the live RichEdit control, so typed text does not jump when editing ends.</summary>
    private static void ApplyHorizontalScaleToEditBox(RichTextBox box, double scale)
    {
        if (scale is < 0.20 or > 5.00 || box.TextLength == 0) return;
        const int EM_SETCHARFORMAT = 0x0444;
        const int SCF_SELECTION = 0x0001;
        const uint CFM_SCALE = 0x40000000;
        var start = box.SelectionStart;
        var length = box.SelectionLength;
        box.SelectAll();
        var format = new CharFormat2
        {
            cbSize = (uint)Marshal.SizeOf<CharFormat2>(),
            dwMask = CFM_SCALE,
            wScale = (ushort)Math.Clamp((int)Math.Round(scale * 100.0), 20, 500),
            szFaceName = string.Empty
        };
        SendMessage(box.Handle, EM_SETCHARFORMAT, (IntPtr)SCF_SELECTION, ref format);
        box.Select(Math.Clamp(start, 0, box.TextLength), Math.Clamp(length, 0, Math.Max(0, box.TextLength - start)));
    }

    /// <summary>Removes the edit control's built-in left/right padding so typed text starts exactly where the PDF text does.</summary>
    private static void ZeroMargins(RichTextBox t)
    {
        const int EM_SETMARGINS = 0xD3, EC_LEFTMARGIN = 1, EC_RIGHTMARGIN = 2;
        try { SendMessage(t.Handle, EM_SETMARGINS, (IntPtr)(EC_LEFTMARGIN | EC_RIGHTMARGIN), IntPtr.Zero); } catch { }
    }

    /// <summary>The edit box takes the colour of the cover under the text (paper colour), so it blends into the page.</summary>
    private Color EditBoxBack(PageEditObject o)
    {
        if (o.Tag.Length > 0)
        {
            var cover = Objs.FirstOrDefault(c => c.Kind == EditKind.Rect && c.Tag == o.Tag);
            if (cover != null) return EditPainter.Parse(cover.FillHex, Color.White);
        }
        return Color.White;
    }

    private void StyleEditBox()
    {
        if (editBox == null || editObj == null) return;
        var o = editObj;
        // RichTextBox owns the live selection formatting; keep the fallback object style in sync for newly typed text.
        PositionEditBox();
    }

    private void ApplySelectionFont(string? fontName = null, double? sizePt = null, bool? bold = null, bool? italic = null, bool? underline = null, Color? color = null)
    {
        if (editBox == null || editObj == null) return;
        var box = editBox; var o = editObj;
        var start = box.SelectionStart; var length = box.SelectionLength;
        if (length <= 0)
        {
            var current = box.SelectionFont;
            var name = fontName ?? current?.Name ?? o.FontName;
            var size = sizePt ?? (current?.Size > 0 ? RichPx(current) / Math.Max(0.01f, zoom) : o.FontSize);
            var b = bold ?? current?.Bold ?? o.Bold; var it = italic ?? current?.Italic ?? o.Italic; var u = underline ?? current?.Underline ?? o.Underline;
            var col = color ?? box.SelectionColor;
            using var f0 = RichFont(name, size * zoom, b, it, u);
            box.SelectionFont = f0; box.SelectionColor = col;
            o.FontName = name; o.FontSize = size; o.Bold = b; o.Italic = it; o.Underline = u; o.ColorHex = PageEditObject.Hex(col);
        }
        else
        {
            // Apply only the requested attribute to every selected character. This preserves mixed bold/italic/size/colour
            // inside a selection instead of flattening it to the style of the first character.
            for (var i = start; i < start + length; i++)
            {
                box.Select(i, 1);
                var current = box.SelectionFont;
                var name = fontName ?? current?.Name ?? o.FontName;
                var size = sizePt ?? (current?.Size > 0 ? RichPx(current) / Math.Max(0.01f, zoom) : o.FontSize);
                var b = bold ?? current?.Bold ?? o.Bold; var it = italic ?? current?.Italic ?? o.Italic; var u = underline ?? current?.Underline ?? o.Underline;
                var col = color ?? box.SelectionColor;
                using var f = RichFont(name, size * zoom, b, it, u);
                box.SelectionFont = f; box.SelectionColor = col;
            }
            box.Select(start, length);
            // Object-level values remain the style used for newly typed text; captured runs preserve the selected range.
            if (fontName != null) o.FontName = fontName;
            if (sizePt != null) o.FontSize = sizePt.Value;
            if (bold != null) o.Bold = bold.Value;
            if (italic != null) o.Italic = italic.Value;
            if (underline != null) o.Underline = underline.Value;
            if (color != null) o.ColorHex = PageEditObject.Hex(color.Value);
        }
        MaintainOriginalBaseline(o);
        RestoreSourceHorizontalScale(o);
        ApplyHorizontalScaleToEditBox(box, o.HScale);
        CaptureRichTextStyles();
        MaintainOriginalBaseline(o);
        RestoreSourceHorizontalScale(o);
        ExpandOriginalCover(o);
        dirty = true; UpdateEditOverflowHint(); PositionEditBox(); canvas.Invalidate();
    }

    private void PositionEditBox()
    {
        if (editBox == null || editObj == null) return;
        var p = ToScr(editObj.X, editObj.Y);
        editBox.Location = new Point((int)Math.Round(p.X), (int)Math.Round(p.Y));
        ResizeEditBox();
    }

    private void UpdateEditOverflowHint()
    {
        if (editObj == null || editBox == null || editObj.Kind != EditKind.Text || editObj.EditFitWidthPt <= 0)
            return;
        var visibleWidth = EditPainter.MeasureText(editObj).Width;
        var overflow = visibleWidth - editObj.EditFitWidthPt;
        hint.Text = overflow > 1.5
            ? $"Possible overlap: this replacement is {overflow:0.#} pt wider than the available gap. Its font and baseline are preserved. Reduce font size or move/resize it before applying."
            : TypingHint;
    }

    private void ResizeEditBox()
    {
        if (editBox == null || editObj == null) return;
        // Measure with the same fixed source scale applied to RichEdit (CHARFORMAT2.wScale) and final PDF drawing.
        var m = EditPainter.MeasureText(editObj);
        var desiredWidth = (int)Math.Ceiling(m.Width * zoom) + Theme.S(12);
        // Keep every typed character visible while editing. The frame may temporarily extend across a neighbor, but its
        // width is capped at the page edge; the status hint calls out when the committed text would exceed its field.
        var pageRight = (int)Math.Round(PageSize.W * zoom + Pad);
        var remainingPageWidth = Math.Max(Theme.S(70), pageRight - editBox.Left - Theme.S(6));
        var needsHorizontalScroll = desiredWidth > remainingPageWidth;
        desiredWidth = Math.Min(desiredWidth, remainingPageWidth);
        var wantedScroll = needsHorizontalScroll ? RichTextBoxScrollBars.Horizontal : RichTextBoxScrollBars.None;
        if (editBox.ScrollBars != wantedScroll) editBox.ScrollBars = wantedScroll;
        editBox.Size = new Size(Math.Max(Theme.S(70), desiredWidth), Math.Max(Theme.S(22), (int)(m.Height * zoom) + Theme.S(4)));
        PositionEditFrame();
        PositionEditBar();
    }

    /// <summary>Keeps an existing text line's baseline fixed when its font metrics change.</summary>
    private static void MaintainOriginalBaseline(PageEditObject o)
    {
        if (o.Kind != EditKind.Text || o.EditBaselineOffsetPt is not double oldOffset || oldOffset <= 0) return;
        // Y is the top of the line box. Keep the current baseline fixed (including any previous vertical move) when
        // a font/size or per-character style changes the ascent; then store the new offset for future moves/edits.
        var baseline = o.Y + oldOffset;
        var newOffset = EditPainter.FirstLineAscent(o);
        if (double.IsNaN(newOffset) || double.IsInfinity(newOffset) || newOffset <= 0) return;
        o.Y = baseline - newOffset;
        o.EditBaselineOffsetPt = newOffset;
    }

    private void ExpandOriginalCover(PageEditObject o)
    {
        if (o.Kind != EditKind.Text || string.IsNullOrEmpty(o.Tag)) return;
        var cover = Objs.FirstOrDefault(c => c.Kind == EditKind.Rect && c.Tag == o.Tag);
        if (cover == null) return;
        var top = o.Y - 0.6;
        var baseline = o.Y + EditPainter.FirstLineAscent(o);
        var bottom = baseline + EditPainter.FirstLineDescent(o) + 0.6;
        var oldBottom = cover.Y + cover.H;
        if (top < cover.Y) { cover.H = oldBottom - top; cover.Y = top; }
        oldBottom = cover.Y + cover.H;
        if (bottom > oldBottom) cover.H = bottom - cover.Y;

        // If a replacement is longer, extend the paper-coloured cover behind it so the original glyphs do not show
        // through the new text. Stop at the available field boundary; never white-out the neighbouring field.
        var currentRight = cover.X + cover.W;
        var textRight = o.X + EditPainter.MeasureText(o).Width + 1.2;
        var fieldRight = o.EditFitWidthPt > 0 ? o.X + o.EditFitWidthPt + 0.6 : double.PositiveInfinity;
        var wantedRight = Math.Min(textRight, fieldRight);
        if (wantedRight > currentRight) cover.W = wantedRight - cover.X;
    }

    private static void UpdateTextStylesForObjectProperty(PageEditObject o, string key)
    {
        if (o.TextStyles.Count == 0) return;
        foreach (var run in o.TextStyles)
        {
            switch (key)
            {
                case "font": run.FontName = o.FontName; break;
                case "size": run.FontSize = o.FontSize; break;
                case "bold": run.Bold = o.Bold; break;
                case "italic": run.Italic = o.Italic; break;
                case "underline": run.Underline = o.Underline; break;
                case "tcolor": run.ColorHex = o.ColorHex; break;
            }
        }
    }

    /// <summary>
    /// Preserve the one-time scale calibrated to the source text bounds. The scale is not recalculated as the user
    /// types, so existing text stays aligned while new characters keep the same glyph proportions instead of being squeezed.
    /// </summary>
    private static void RestoreSourceHorizontalScale(PageEditObject o)
    {
        if (o.Kind != EditKind.Text || o.EditFitWidthPt <= 0) return;
        if (o.EditFitMaxScale is > 0.2 and < 5) o.HScale = o.EditFitMaxScale;
    }

    /// <summary>Keeps the visible frame exactly around the text box (the frame is a ring, so the box shows through its middle).</summary>
    private void PositionEditFrame()
    {
        if (editFrame == null || editBox == null) return;
        var b = EditFrame.Band;
        editFrame.Bounds = new Rectangle(editBox.Left - b, editBox.Top - b, editBox.Width + 2 * b, editBox.Height + 2 * b);
    }

    private bool ConfirmTextOverflow()
    {
        if (editObj == null || editBox == null || editObj.Kind != EditKind.Text || editObj.EditFitWidthPt <= 0)
            return true;
        var visibleWidth = EditPainter.MeasureText(editObj).Width;
        var overflow = visibleWidth - editObj.EditFitWidthPt;
        if (overflow <= 2.0) return true;
        var message = $"This text is about {overflow:0.#} pt wider than the available gap and may overlap the next field. PDF Studio will preserve its font size and baseline instead of squeezing it.\n\nChoose No to keep editing and reduce the font size or reposition the text. Choose Yes to keep the edit anyway.";
        return MessageBox.Show(this, message, "Text may overlap another field", MessageBoxButtons.YesNo,
            MessageBoxIcon.Warning, MessageBoxDefaultButton.Button2) == DialogResult.Yes;
    }

    private void CancelInlineEdit()
    {
        if (editBox == null || editObj == null) return;
        var box = editBox;
        var obj = editObj;
        // Cancelling a converted PDF text block restores the original page objects; other edits restore their exact snapshot.
        if (pendingConv is { } pending)
        {
            Objs.Clear(); Objs.AddRange(pending.Before.Select(item => item.Clone()));
            sel = null;
        }
        else if (editIsNew)
        {
            Objs.RemoveAll(item => item.Id == obj.Id);
            sel = null;
        }
        else if (editBeforeSnapshot != null)
        {
            Objs.Clear(); Objs.AddRange(editBeforeSnapshot.Select(item => item.Clone()));
            sel = Objs.FirstOrDefault(item => item.Id == obj.Id);
        }

        // Restore history exactly as it stood on entering the editor. A newly-added text object or a converted
        // PDF text block has one pre-existing creation/conversion undo record which must also be discarded.
        var undoBefore = editUndoSnapshot?.ToList() ?? undo.ToList();
        var redoBefore = editRedoSnapshot?.ToList() ?? redo.ToList();
        if ((pendingConv != null || editIsNew) && undoBefore.Count > 0)
            undoBefore.RemoveAt(undoBefore.Count - 1);
        undo.Clear(); undo.AddRange(undoBefore);
        redo.Clear(); redo.AddRange(redoBefore);
        UpdateUndoButtons();

        editBox = null; editObj = null; editBeforeSnapshot = null;
        editUndoSnapshot = null; editRedoSnapshot = null; pendingConv = null; convDirty = false;
        canvas.Controls.Remove(box); box.Dispose();
        if (editFrame != null) { var frame = editFrame; editFrame = null; canvas.Controls.Remove(frame); frame.Dispose(); }
        HideEditBar(); SyncProps(); UpdateHint(); canvas.Invalidate(); canvas.Focus();
    }

    private void CommitInlineEdit()
    {
        if (editBox == null || editObj == null) return;
        CaptureRichTextStyles();
        var box = editBox; var o = editObj; var isNew = editIsNew;
        MaintainOriginalBaseline(o);
        RestoreSourceHorizontalScale(o); // preserve the source horizontal scale after capturing the final per-character styles
        ExpandOriginalCover(o);
        editBox = null; editObj = null; editBeforeSnapshot = null;
        editUndoSnapshot = null; editRedoSnapshot = null;
        canvas.Controls.Remove(box); box.Dispose();
        if (editFrame != null) { var fr = editFrame; editFrame = null; canvas.Controls.Remove(fr); fr.Dispose(); }
        HideEditBar();

        if (string.IsNullOrWhiteSpace(o.Text))
        {
            Objs.Remove(o); sel = null;
            if (isNew && undo.Count > 0) { undo.RemoveAt(undo.Count - 1); UpdateUndoButtons(); }
        }
        else if (pendingConv is { } pc && o.Text == pc.OrigText && !convDirty)
        {
            var list = Objs; list.Clear(); list.AddRange(pc.Before);
            if (undo.Count > 0) undo.RemoveAt(undo.Count - 1);
            UpdateUndoButtons(); sel = null;
        }
        pendingConv = null; convDirty = false;
        if (sel != null && sel.Kind == EditKind.Text) { CopyTextDefaults(sel); }
        SyncProps(); UpdateHint(); canvas.Invalidate(); canvas.Focus();
    }

    private void CopyTextDefaults(PageEditObject o)
    {
        defaults.FontName = o.FontName; defaults.FontSize = o.FontSize; defaults.Bold = o.Bold; defaults.Italic = o.Italic;
        defaults.Underline = o.Underline; defaults.ColorHex = o.ColorHex;
    }

    // ═════════════════════════ properties ═════════════════════════

    private PageEditObject? TextTarget => sel is { Kind: EditKind.Text } ? sel : (sel == null && tool == Tool.AddText ? defaults : null);

    private void ApplyText(Action<PageEditObject> change, string key)
    {
        if (updatingUi) return;
        var t = TextTarget; if (t == null) return;
        if (t != defaults) { PushUndoCoalesced(key); convDirty = true; }
        change(t);
        if (t == editObj && editBox != null && (key is "font" or "size" or "bold" or "italic" or "underline" or "tcolor"))
        {
            ApplySelectionFont(
                fontName: key == "font" ? t.FontName : null,
                sizePt: key == "size" ? t.FontSize : null,
                bold: key == "bold" ? t.Bold : null,
                italic: key == "italic" ? t.Italic : null,
                underline: key == "underline" ? t.Underline : null,
                color: key == "tcolor" ? EditPainter.Parse(t.ColorHex, Color.Black) : null);
        }
        else if (t == editObj)
        {
            CaptureRichTextStyles();
            MaintainOriginalBaseline(t);
            RestoreSourceHorizontalScale(t);
            ExpandOriginalCover(t);
            if (editBox != null) PositionEditBox();
        }
        else if (t != defaults)
        {
            UpdateTextStylesForObjectProperty(t, key);
            MaintainOriginalBaseline(t);
            RestoreSourceHorizontalScale(t);
            ExpandOriginalCover(t);
        }
        if (t != defaults) CopyTextDefaults(t);
        if (t != defaults) SyncPosOnly();
        UpdateEditOverflowHint();
        canvas.Invalidate();
    }

    private void ApplyShape(Action<PageEditObject> change, string key)
    {
        if (updatingUi || sel == null || sel.Kind is EditKind.Text or EditKind.Image) return;
        PushUndoCoalesced(key); change(sel); canvas.Invalidate();
        if (key is "fillc" or "strokec") SyncProps();
    }

    private void ApplyAny(Action<PageEditObject> change, string key, bool sizeChange = false)
    {
        if (updatingUi || sel == null) return;
        if (sizeChange && sel.Kind == EditKind.Text) return;
        PushUndoCoalesced(key); change(sel);
        if (editObj == sel) PositionEditBox();
        canvas.Invalidate();
        if (sizeChange) SyncPosOnly();
    }

    private static void SetNum(NumericUpDown n, double v) => n.Value = (decimal)Math.Clamp(v, (double)n.Minimum, (double)n.Maximum);

    private void SyncPosOnly()
    {
        if (sel == null) return;
        updatingUi = true;
        try
        {
            var b = EditPainter.Bounds(sel);
            if (sel.Kind == EditKind.Line) { SetNum(xNum, sel.X); SetNum(yNum, sel.Y); SetNum(wNum, sel.W); SetNum(hNum, sel.H); }
            else { SetNum(xNum, b.X); SetNum(yNum, b.Y); SetNum(wNum, b.Width); SetNum(hNum, b.Height); }
        }
        finally { updatingUi = false; }
    }

    private void SyncProps()
    {
        if (fontBox.Items.Count == 0 && pages.Count == 0) return;
        updatingUi = true;
        try
        {
            var o = sel;
            var tt = TextTarget;
            textGroup.Visible = tt != null;
            shapeGroup.Visible = o is { Kind: EditKind.Rect or EditKind.Ellipse or EditKind.Line };
            posGroup.Visible = actionGroup.Visible = alignGroup.Visible = o != null;
            tipLabel.Visible = o == null && tt == null;
            propsTitle.Text = o == null ? (tt != null ? "New text style" : "Properties") : o.Kind switch
            {
                EditKind.Text => "Text", EditKind.Image => "Picture", EditKind.Rect => "Rectangle", EditKind.Ellipse => "Ellipse", _ => "Line"
            };
            if (tt != null)
            {
                var fontName = tt.FontName; var fontSize = tt.FontSize; var bold = tt.Bold; var italic = tt.Italic; var underline = tt.Underline; var color = EditPainter.Parse(tt.ColorHex, Color.Black);
                if (tt == editObj && editBox != null)
                {
                    var savedStart = editBox.SelectionStart; var savedLen = editBox.SelectionLength;
                    if (savedLen > 0 && savedStart < editBox.TextLength)
                    {
                        editBox.Select(savedStart, 1);
                        var f = editBox.SelectionFont;
                        if (f != null) { fontName = f.Name; fontSize = RichPx(f) / Math.Max(0.01f, zoom); bold = f.Bold; italic = f.Italic; underline = f.Underline; }
                        color = editBox.SelectionColor;
                        editBox.Select(savedStart, Math.Min(savedLen, editBox.TextLength - savedStart));
                    }
                    else if (savedLen == 0 && savedStart < editBox.TextLength)
                    {
                        editBox.Select(savedStart, 1);
                        var f = editBox.SelectionFont;
                        if (f != null) { fontName = f.Name; fontSize = RichPx(f) / Math.Max(0.01f, zoom); bold = f.Bold; italic = f.Italic; underline = f.Underline; }
                        color = editBox.SelectionColor;
                        editBox.Select(savedStart, 0);
                    }
                }
                var i = fontBox.Items.IndexOf(fontName);
                if (i < 0) { fontBox.Items.Insert(0, fontName); i = 0; }
                fontBox.SelectedIndex = i;
                SetNum(sizeNum, fontSize);
                boldBtn.Active = bold; italicBtn.Active = italic; underBtn.Active = underline;
                boldBtn.Invalidate(); italicBtn.Invalidate(); underBtn.Invalidate();
                textSwatch.BackColor = color;
            }
            if (shapeGroup.Visible && o != null)
            {
                var isLine = o.Kind == EditKind.Line;
                foreach (var c in fillRows) c.Visible = !isLine;
                fillCheck.Checked = !string.IsNullOrEmpty(o.FillHex);
                if (!string.IsNullOrEmpty(o.FillHex)) fillSwatch.BackColor = EditPainter.Parse(o.FillHex, Color.White);
                SetNum(opacityNum, o.FillAlpha * 100.0 / 255);
                strokeCheck.Checked = !string.IsNullOrEmpty(o.StrokeHex);
                if (!string.IsNullOrEmpty(o.StrokeHex)) strokeSwatch.BackColor = EditPainter.Parse(o.StrokeHex, Color.Black);
                SetNum(strokeNum, o.StrokeWidth);
            }
            if (o != null)
            {
                wNum.Enabled = hNum.Enabled = o.Kind != EditKind.Text;
                var b = EditPainter.Bounds(o);
                if (o.Kind == EditKind.Line) { SetNum(xNum, o.X); SetNum(yNum, o.Y); SetNum(wNum, o.W); SetNum(hNum, o.H); }
                else { SetNum(xNum, b.X); SetNum(yNum, b.Y); SetNum(wNum, b.Width); SetNum(hNum, b.Height); }
            }
        }
        finally { updatingUi = false; }
    }

    // ═════════════════════════ object commands ═════════════════════════

    private void DeleteSel()
    {
        if (sel == null) return;
        CommitInlineEdit();
        if (sel == null) return;
        PushUndo(); Objs.Remove(sel); sel = null; SyncProps(); canvas.Invalidate();
    }

    private void DuplicateSel()
    {
        if (sel == null) return;
        CommitInlineEdit();
        if (sel == null) return;
        PushUndo();
        var c = sel.Clone(); c.Id = Guid.NewGuid(); c.Tag = ""; c.X += 12; c.Y += 12;
        Objs.Add(c); sel = c; SyncProps(); canvas.Invalidate();
    }

    private void Reorder(bool front)
    {
        if (sel == null) return;
        PushUndo();
        var l = Objs; l.Remove(sel);
        if (front) l.Add(sel); else l.Insert(0, sel);
        canvas.Invalidate();
    }

    private void Nudge(double dx, double dy)
    {
        if (sel == null) return;
        PushUndoCoalesced("nudge");
        sel.X += dx; sel.Y += dy; SyncPosOnly(); canvas.Invalidate();
    }

    // ═════════════════════════ keyboard / closing ═════════════════════════

    protected override bool ProcessCmdKey(ref Message msg, Keys keyData)
    {
        var typing = ActiveControl is TextBoxBase or ComboBox or NumericUpDown;
        if (!typing)
        {
            switch (keyData)
            {
                case Keys.Control | Keys.Z: DoUndo(); return true;
                case Keys.Control | Keys.Y:
                case Keys.Control | Keys.Shift | Keys.Z: DoRedo(); return true;
                case Keys.Control | Keys.D: DuplicateSel(); return true;
                case Keys.Delete: DeleteSel(); return true;
                case Keys.Left: Nudge(-1, 0); return sel != null;
                case Keys.Right: Nudge(1, 0); return sel != null;
                case Keys.Up: Nudge(0, -1); return sel != null;
                case Keys.Down: Nudge(0, 1); return sel != null;
                case Keys.Shift | Keys.Left: Nudge(-10, 0); return sel != null;
                case Keys.Shift | Keys.Right: Nudge(10, 0); return sel != null;
                case Keys.Shift | Keys.Up: Nudge(0, -10); return sel != null;
                case Keys.Shift | Keys.Down: Nudge(0, 10); return sel != null;
                case Keys.PageUp: GoToPage(index - 1); return true;
                case Keys.PageDown: GoToPage(index + 1); return true;
                case Keys.Control | Keys.Oemplus: case Keys.Control | Keys.Add: SetZoom(zoom * 1.2f); return true;
                case Keys.Control | Keys.OemMinus: case Keys.Control | Keys.Subtract: SetZoom(zoom / 1.2f); return true;
                case Keys.Control | Keys.D0: FitZoom(); return true;
                case Keys.Escape:
                    if (tool != Tool.EditText && tool != Tool.Select) SetTool(Tool.EditText);
                    else if (sel != null) { sel = null; SyncProps(); canvas.Invalidate(); }
                    return true;
            }
        }
        return base.ProcessCmdKey(ref msg, keyData);
    }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        base.OnFormClosing(e);
        if (DialogResult == DialogResult.OK) return;
        CommitInlineEdit();
        if (dirty && MessageBox.Show(this, "Discard the edits you made in this window?", "Edit PDF", MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes)
        {
            e.Cancel = true; DialogResult = DialogResult.None;
        }
    }
}
