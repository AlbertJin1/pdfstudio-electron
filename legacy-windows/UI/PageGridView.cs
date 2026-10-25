using PdfStudio.Models;
using PdfStudio.Services;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;

namespace PdfStudio.UI;

/// <summary>
/// Owner-drawn page grid. One control draws every tile (no per-page child controls), so it stays fast with hundreds of
/// pages, and drag-to-reorder is handled with plain mouse events: insertion marker, auto-scroll, multi-page drag,
/// rubber-band selection, Ctrl/Shift selection, hover quick-actions, keyboard navigation and file drops.
/// </summary>
public sealed class PageGridView : Control
{
    private enum Mode { None, Pressed, Dragging, Band }

    private readonly VScrollBar vbar = new() { Dock = DockStyle.Right, Visible = false };
    private readonly System.Windows.Forms.Timer autoScroll = new() { Interval = 30 };
    private readonly System.Windows.Forms.Timer smooth = new() { Interval = 15 };
    private readonly System.Windows.Forms.Timer fadeTimer = new() { Interval = 16 };
    private readonly System.Windows.Forms.Timer toastTimer = new() { Interval = 16 };
    private readonly ThumbnailCache thumbs;
    private int scrollTarget;
    private bool anyFading;
    private string? toastText; private bool toastGood = true; private long toastStart;
    private const int ToastMs = 3000;

    public List<PageItem> Pages { get; }
    public HashSet<Guid> Selection { get; } = new();
    public Guid? ActiveId { get; private set; }
    public bool IsDragging => mode == Mode.Dragging;

    // layout (device pixels)
    private int tileW = 170; // logical width of the thumbnail box
    private int cols = 1, cellW, cellH, boxW, boxH, gridLeft, gap, pad, capH, cellPad, contentH;

    // interaction state
    private Mode mode;
    private int hoverIdx = -1, anchorIdx = -1, pressIdx = -1, collapseIdx = -1, dropIdx = -1, fileDropIdx = -1;
    private Point pressPt, lastMouse;
    private List<PageItem> dragItems = new();
    private Point bandStart;
    private Rectangle bandRect;
    private HashSet<Guid> bandBase = new();

    /// <summary>Selection or active page changed through user interaction.</summary>
    public event EventHandler? StateChanged;
    /// <summary>The user dropped dragged pages. Args: pages in document order, insertion index in the ORIGINAL list.</summary>
    public event Action<IReadOnlyList<PageItem>, int>? ReorderRequested;
    public event Action<PageItem>? PageOpened;
    public event Action<string[], int>? FilesDropped;
    public event Action<PageItem>? QuickRotate;
    public event Action<PageItem>? QuickDelete;
    public event Action<int>? ZoomWheel;
    public event Action<Point>? ContextRequested;
    /// <summary>The "Add PDF / image" placeholder tile at the end of the grid was clicked.</summary>
    public event Action? AddFilesRequested;

    private bool addHover, addPressed;
    /// <summary>Number of grid slots: every page plus the trailing add-files placeholder.</summary>
    private int Slots => Pages.Count == 0 ? 0 : Pages.Count + 1;

    public int TileWidth
    {
        get => tileW;
        set { tileW = Math.Clamp(value, 100, 340); Relayout(); }
    }

    private bool autoFit = true;
    /// <summary>When on, tiles stretch a little so every row fills the full width (no empty strip on the right).</summary>
    public bool AutoFit
    {
        get => autoFit;
        set { autoFit = value; Relayout(); }
    }

    public PageGridView(List<PageItem> pages, ThumbnailCache cache)
    {
        Pages = pages; thumbs = cache;
        SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw | ControlStyles.Selectable, true);
        TabStop = true; AllowDrop = true; BackColor = Theme.Canvas;
        Controls.Add(vbar);
        vbar.ValueChanged += (_, _) => { if (!smooth.Enabled) scrollTarget = vbar.Value; Invalidate(); };
        autoScroll.Tick += AutoScrollTick;
        smooth.Tick += SmoothTick;
        fadeTimer.Tick += (_, _) => { Invalidate(); if (!anyFading) fadeTimer.Stop(); };
        toastTimer.Tick += (_, _) =>
        {
            if (Environment.TickCount64 - toastStart > ToastMs) { toastTimer.Stop(); toastText = null; }
            Invalidate();
        };
        thumbs.Updated += OnThumbUpdated;
        Theme.Changed += OnTheme;
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing) { thumbs.Updated -= OnThumbUpdated; Theme.Changed -= OnTheme; autoScroll.Dispose(); smooth.Dispose(); fadeTimer.Dispose(); toastTimer.Dispose(); }
        base.Dispose(disposing);
    }

    private void OnThumbUpdated() { if (!IsDisposed) Invalidate(); }
    private void OnTheme() { if (IsDisposed) return; BackColor = Theme.Canvas; Invalidate(); }

    // ───────────────────────── layout ─────────────────────────

    private int ScrollY => vbar.Visible ? vbar.Value : 0;

    protected override void OnResize(EventArgs e) { base.OnResize(e); Relayout(); }

    public void Relayout()
    {
        pad = Theme.S(18); gap = Theme.S(14); cellPad = Theme.S(8); capH = Theme.S(42);
        var targetBox = Theme.S(tileW);
        var n = Slots;
        var needBar = false;
        for (var pass = 0; pass < 3; pass++)
        {
            var avail = Math.Max(Theme.S(120), Width - (needBar ? SystemInformation.VerticalScrollBarWidth : 0) - pad * 2);
            cols = Math.Max(1, (avail + gap) / (targetBox + cellPad * 2 + gap));
            boxW = autoFit
                ? Math.Max(Theme.S(60), (avail - gap * (cols - 1)) / cols - cellPad * 2)
                : targetBox;
            boxH = (int)(boxW * 1.32);
            cellW = boxW + cellPad * 2; cellH = boxH + capH + cellPad * 2;
            var rows = n == 0 ? 0 : (n + cols - 1) / cols;
            contentH = pad * 2 + rows * cellH + Math.Max(0, rows - 1) * gap;
            var need = contentH > Height;
            if (need == needBar) break;
            needBar = need;
        }
        // Few pages: let the tiles grow to use the free room instead of leaving the canvas mostly empty.
        if (autoFit && n > 0 && !needBar)
        {
            var availW = Math.Max(Theme.S(120), Width - pad * 2);
            var cap = (int)(targetBox * 2.4);
            var bestC = cols; var bestBox = boxW;
            for (var c = 1; c <= Math.Min(cols, n); c++)
            {
                var bw = Math.Min((availW - gap * (c - 1)) / c - cellPad * 2, cap);
                if (bw <= bestBox) continue;
                var bh = (int)(bw * 1.32);
                var r2 = (n + c - 1) / c;
                var total = pad * 2 + r2 * (bh + capH + cellPad * 2) + (r2 - 1) * gap;
                if (total <= Height) { bestC = c; bestBox = bw; }
            }
            if (bestBox > boxW)
            {
                cols = bestC; boxW = bestBox; boxH = (int)(boxW * 1.32);
                cellW = boxW + cellPad * 2; cellH = boxH + capH + cellPad * 2;
                var rows2 = (n + cols - 1) / cols;
                contentH = pad * 2 + rows2 * cellH + Math.Max(0, rows2 - 1) * gap;
            }
        }
        var usable = Width - (needBar ? SystemInformation.VerticalScrollBarWidth : 0) - pad * 2;
        var used = cols * cellW + (cols - 1) * gap;
        gridLeft = pad + Math.Max(0, (usable - used) / 2);

        vbar.Visible = needBar;
        if (needBar)
        {
            vbar.SmallChange = Math.Max(1, cellH / 3);
            vbar.LargeChange = Math.Max(1, Height);
            vbar.Maximum = Math.Max(0, contentH - 1);
            vbar.Value = Math.Clamp(vbar.Value, 0, Math.Max(0, vbar.Maximum - vbar.LargeChange + 1));
            scrollTarget = Math.Clamp(scrollTarget, 0, Math.Max(0, vbar.Maximum - vbar.LargeChange + 1));
        }
        else scrollTarget = 0;
        Invalidate();
    }

    private int MaxScroll => Math.Max(0, vbar.Maximum - vbar.LargeChange + 1);

    /// <summary>Scrolls to an absolute position, easing there when <paramref name="animate"/> is set.</summary>
    private void ScrollTo(int value, bool animate)
    {
        if (!vbar.Visible) return;
        value = Math.Clamp(value, 0, MaxScroll);
        scrollTarget = value;
        if (!animate) { smooth.Stop(); vbar.Value = value; return; }
        if (!smooth.Enabled) smooth.Start();
    }

    private void SmoothTick(object? s, EventArgs e)
    {
        if (!vbar.Visible) { smooth.Stop(); return; }
        var d = scrollTarget - vbar.Value;
        if (Math.Abs(d) <= 1) { smooth.Stop(); vbar.Value = Math.Clamp(scrollTarget, 0, MaxScroll); return; }
        var step = (int)Math.Round(d * 0.26);
        if (step == 0) step = Math.Sign(d);
        vbar.Value = Math.Clamp(vbar.Value + step, 0, MaxScroll);
    }

    /// <summary>Shows a short message that slides up over the grid, then fades away.</summary>
    public void ShowToast(string text, bool good = true)
    {
        toastText = text; toastGood = good; toastStart = Environment.TickCount64;
        toastTimer.Start(); Invalidate();
    }

    /// <summary>Call after the page list changed (add/remove/reorder/undo). Drops stale selection and relayouts.</summary>
    public void NotifyPagesChanged()
    {
        var ids = Pages.Select(p => p.Id).ToHashSet();
        Selection.RemoveWhere(id => !ids.Contains(id));
        if (ActiveId is { } a && !ids.Contains(a)) ActiveId = null;
        hoverIdx = -1; anchorIdx = Math.Min(anchorIdx, Pages.Count - 1);
        Relayout();
    }

    private Rectangle CellContent(int i)
    {
        var r = i / cols; var c = i % cols;
        return new Rectangle(gridLeft + c * (cellW + gap), pad + r * (cellH + gap), cellW, cellH);
    }

    private Rectangle CellRect(int i) { var r = CellContent(i); r.Y -= ScrollY; return r; }

    private int HitIndex(Point p)
    {
        if (Pages.Count == 0) return -1;
        var c = (p.X - gridLeft) / (cellW + gap);
        var r = (p.Y + ScrollY - pad) / (cellH + gap);
        if (p.X < gridLeft || p.Y + ScrollY < pad || c < 0 || c >= cols) return -1;
        var i = r * cols + c;
        return i >= 0 && i < Pages.Count && CellRect(i).Contains(p) ? i : -1;
    }

    private int InsertIndexAt(Point p)
    {
        var n = Pages.Count;
        if (n == 0) return 0;
        var rows = (n + cols - 1) / cols;
        var row = Math.Clamp((int)Math.Floor((p.Y + ScrollY - pad) / (double)(cellH + gap)), 0, rows - 1);
        var col = Math.Clamp((int)Math.Floor((p.X - gridLeft + gap / 2.0) / (cellW + gap)), 0, cols - 1);
        var idx = row * cols + col;
        if (idx >= n) return n;
        var r = CellRect(idx);
        return idx + (p.X > r.Left + r.Width / 2 ? 1 : 0);
    }

    private Rectangle CheckRect(Rectangle cell) => new(cell.X + cellPad + Theme.S(6), cell.Y + cellPad + Theme.S(6), Theme.S(22), Theme.S(22));
    private Rectangle DeleteRect(Rectangle cell) => new(cell.Right - cellPad - Theme.S(6) - Theme.S(22), cell.Y + cellPad + Theme.S(6), Theme.S(22), Theme.S(22));
    private Rectangle RotateRect(Rectangle cell) { var d = DeleteRect(cell); return new Rectangle(d.X - Theme.S(26), d.Y, d.Width, d.Height); }

    public int ActiveIndex => ActiveId is { } id ? Pages.FindIndex(p => p.Id == id) : -1;

    public List<PageItem> SelectedPages() => Pages.Where(p => Selection.Contains(p.Id)).ToList();

    public void EnsureVisible(int idx)
    {
        if (idx < 0 || idx >= Pages.Count || !vbar.Visible) return;
        var r = CellContent(idx);
        if (r.Top - pad < vbar.Value) ScrollTo(r.Top - pad, true);
        else if (r.Bottom + pad > vbar.Value + Height) ScrollTo(r.Bottom + pad - Height, true);
    }

    // ───────────────────────── selection API ─────────────────────────

    private void Raise() { Invalidate(); StateChanged?.Invoke(this, EventArgs.Empty); }

    public void SelectOnly(int idx)
    {
        Selection.Clear();
        if (idx >= 0 && idx < Pages.Count) { Selection.Add(Pages[idx].Id); ActiveId = Pages[idx].Id; anchorIdx = idx; }
        Raise();
    }

    public void SelectAll() { Selection.Clear(); foreach (var p in Pages) Selection.Add(p.Id); if (ActiveId is null && Pages.Count > 0) ActiveId = Pages[0].Id; Raise(); }
    public void ClearSelection() { Selection.Clear(); Raise(); }

    public void InvertSelection()
    {
        foreach (var p in Pages) if (!Selection.Remove(p.Id)) Selection.Add(p.Id);
        Raise();
    }

    public void SelectIndices(IEnumerable<int> indexes)
    {
        Selection.Clear();
        var first = -1;
        foreach (var i in indexes) if (i >= 0 && i < Pages.Count) { Selection.Add(Pages[i].Id); if (first < 0) first = i; }
        if (first >= 0) { ActiveId = Pages[first].Id; anchorIdx = first; EnsureVisible(first); }
        Raise();
    }

    public void SetSelection(IEnumerable<Guid> ids, Guid? active = null)
    {
        var valid = Pages.Select(p => p.Id).ToHashSet();
        Selection.Clear();
        foreach (var id in ids) if (valid.Contains(id)) Selection.Add(id);
        ActiveId = active is { } a && valid.Contains(a) ? a : Pages.FirstOrDefault(p => Selection.Contains(p.Id))?.Id;
        anchorIdx = ActiveIndex;
        Raise();
    }

    public void SetActive(Guid? id) { ActiveId = id; Raise(); }

    private void Toggle(int idx)
    {
        var id = Pages[idx].Id;
        if (!Selection.Remove(id)) Selection.Add(id);
        ActiveId = id; anchorIdx = idx;
        Raise();
    }

    private void SelectRange(int a, int b)
    {
        Selection.Clear();
        for (var i = Math.Min(a, b); i <= Math.Max(a, b); i++) Selection.Add(Pages[i].Id);
        ActiveId = Pages[b].Id;
        Raise();
    }

    // ───────────────────────── painting ─────────────────────────

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        g.Clear(Theme.Canvas);
        var n = Pages.Count;
        if (n == 0) return;
        var slots = Slots;

        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.InterpolationMode = InterpolationMode.HighQualityBilinear;
        g.PixelOffsetMode = PixelOffsetMode.Half;

        anyFading = false;
        var rowH = cellH + gap;
        var firstRow = Math.Max(0, (ScrollY - pad) / rowH);
        var lastRow = Math.Min((slots - 1) / cols, (ScrollY + Height - pad) / rowH);

        // tell the thumbnail worker what is on screen (plus one row of look-ahead each way)
        var wanted = new HashSet<string>();
        for (var r = Math.Max(0, firstRow - 1); r <= Math.Min((n - 1) / cols, lastRow + 1); r++)
            for (var c = 0; c < cols; c++)
            {
                var i = r * cols + c;
                if (i < n && !Pages[i].IsBlank) wanted.Add(Pages[i].ThumbKey);
            }
        thumbs.SetWanted(wanted);

        for (var r = firstRow; r <= lastRow; r++)
            for (var c = 0; c < cols; c++)
            {
                var i = r * cols + c;
                if (i >= slots) break;
                var cell = CellRect(i);
                if (!cell.IntersectsWith(ClientRectangle)) continue;
                if (i == n) DrawAddTile(g, cell); else DrawCell(g, i, cell);
            }

        if (mode == Mode.Dragging && dropIdx >= 0) DrawInsertMarker(g, dropIdx);
        if (fileDropIdx >= 0) DrawInsertMarker(g, fileDropIdx);
        if (mode == Mode.Dragging) DrawGhost(g);
        if (mode == Mode.Band)
        {
            var br = new Rectangle(bandRect.X, bandRect.Y - ScrollY, bandRect.Width, bandRect.Height);
            using var fill = new SolidBrush(Color.FromArgb(40, Theme.Accent));
            using var pen = new Pen(Theme.Accent);
            g.FillRectangle(fill, br); g.DrawRectangle(pen, br);
        }
        if (anyFading && !fadeTimer.Enabled) fadeTimer.Start();
        DrawToast(g);
    }

    private void DrawToast(Graphics g)
    {
        if (toastText is null) return;
        var e = Environment.TickCount64 - toastStart;
        float inT = Math.Min(1f, e / 220f), outT = e > ToastMs - 450 ? Math.Max(0f, (ToastMs - e) / 450f) : 1f;
        var alpha = Math.Clamp(inT * outT, 0f, 1f);
        if (alpha <= 0.01f) return;
        var ease = 1f - (1f - inT) * (1f - inT);
        g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.ClearTypeGridFit;
        using var font = new Font("Segoe UI", 9.75f, FontStyle.Bold, GraphicsUnit.Point);
        var size = g.MeasureString(toastText, font);
        var h = Theme.S(42);
        var w = Math.Min(Width - Theme.S(40), (int)size.Width + Theme.S(64));
        var x = (Width - w) / 2;
        var y = Height - h - Theme.S(26) + (int)((1f - ease) * Theme.S(16));
        var rect = new RectangleF(x, y, w, h);
        Gfx.FillRound(g, Color.FromArgb((int)(236 * alpha), 24, 27, 35), rect, h / 2f);
        var dot = toastGood ? Theme.Success : Theme.Danger;
        using (var db = new SolidBrush(Color.FromArgb((int)(255 * alpha), dot)))
            g.FillEllipse(db, x + Theme.S(16), y + h / 2f - Theme.S(5), Theme.S(10), Theme.S(10));
        using var tb = new SolidBrush(Color.FromArgb((int)(255 * alpha), 245, 246, 250));
        var sf = new StringFormat { LineAlignment = StringAlignment.Center, Trimming = StringTrimming.EllipsisCharacter, FormatFlags = StringFormatFlags.NoWrap };
        g.DrawString(toastText, font, tb, new RectangleF(x + Theme.S(34), y, w - Theme.S(46), h), sf);
    }

    private Rectangle AddTileRect() => CellRect(Pages.Count);

    private bool HitAddTile(Point p) => Pages.Count > 0 && AddTileRect().Contains(p);

    /// <summary>Dashed page placeholder at the end of the list that opens the PDF/image picker.</summary>
    private void DrawAddTile(Graphics g, Rectangle cell)
    {
        var hot = addHover && mode == Mode.None;
        var rf = new RectangleF(cell.X + 0.5f, cell.Y + 0.5f, cell.Width - 1, cell.Height - 1);
        Gfx.FillRound(g, hot ? Theme.AccentSoft : Gfx.Mix(Theme.Canvas, Theme.Surface, 0.45f), rf, 10);
        using (var path = Gfx.Round(rf, 10))
        using (var pen = new Pen(hot ? Theme.Accent : Theme.Border, hot ? 2f : 1.5f) { DashStyle = DashStyle.Dash, DashPattern = new[] { 4f, 3f } })
            g.DrawPath(pen, path);

        // placeholder "page" with a plus badge, same footprint as a page thumbnail
        var box = new Rectangle(cell.X + cellPad, cell.Y + cellPad, boxW, boxH);
        var pw = (int)(Math.Min(boxW, boxH / 1.32) * 0.82); var ph = (int)(pw * 1.32);
        var pr = new Rectangle(box.X + (box.Width - pw) / 2, box.Y + (box.Height - ph) / 2, pw, ph);
        Gfx.FillRound(g, Color.FromArgb(hot ? 90 : 55, Theme.Surface), pr, 6);
        using (var path = Gfx.Round(pr, 6))
        using (var pen = new Pen(Gfx.Mix(Theme.Border, hot ? Theme.Accent : Theme.Muted, 0.5f), 1f) { DashStyle = DashStyle.Dot })
            g.DrawPath(pen, path);

        var d = Math.Clamp(Math.Min(pw, ph) / 3, Theme.S(34), Theme.S(60));
        var badge = new Rectangle(pr.X + (pr.Width - d) / 2, pr.Y + (pr.Height - d) / 2, d, d);
        using (var b = new SolidBrush(hot ? Theme.Accent : Gfx.Mix(Theme.Muted, Theme.Surface, 0.55f))) g.FillEllipse(b, badge);
        using (var pen = new Pen(Color.White, Math.Max(2f, d / 12f)) { StartCap = LineCap.Round, EndCap = LineCap.Round })
        {
            var cx = badge.X + d / 2f; var cy = badge.Y + d / 2f; var arm = d * 0.24f;
            g.DrawLine(pen, cx - arm, cy, cx + arm, cy); g.DrawLine(pen, cx, cy - arm, cx, cy + arm);
        }

        var capTop = box.Bottom + Theme.S(4);
        TextRenderer.DrawText(g, "Add PDF / image", Theme.Ui(10f, FontStyle.Bold),
            new Rectangle(cell.X + cellPad, capTop, boxW, Theme.S(18)), hot ? Theme.Accent : Theme.Text,
            TextFormatFlags.HorizontalCenter | TextFormatFlags.NoPadding | TextFormatFlags.SingleLine);
        TextRenderer.DrawText(g, "Click or drop PDFs & images", Theme.Ui(8f),
            new Rectangle(cell.X + cellPad, capTop + Theme.S(18), boxW, Theme.S(16)), Theme.Muted,
            TextFormatFlags.HorizontalCenter | TextFormatFlags.NoPadding | TextFormatFlags.SingleLine | TextFormatFlags.EndEllipsis);
    }

    private void DrawCell(Graphics g, int i, Rectangle cell)
    {
        var page = Pages[i];
        var sel = Selection.Contains(page.Id);
        var hov = i == hoverIdx && mode != Mode.Dragging && mode != Mode.Band;
        var isDragSource = mode == Mode.Dragging && dragItems.Any(d => d.Id == page.Id);

        var rf = new RectangleF(cell.X + 0.5f, cell.Y + 0.5f, cell.Width - 1, cell.Height - 1);
        Gfx.FillRound(g, sel ? Theme.AccentSoft : Theme.Surface, rf, 10);
        Gfx.DrawRound(g, sel ? Theme.Accent : hov ? Theme.Muted : Theme.Border, rf, 10, sel ? 2f : 1f);

        // page preview
        var box = new Rectangle(cell.X + cellPad, cell.Y + cellPad, boxW, boxH);
        var (dw, dh) = page.DisplaySizePt(true);
        var inset = Theme.S(4);
        var scale = Math.Min((box.Width - inset * 2) / dw, (box.Height - inset * 2) / dh);
        var pw = Math.Max(4, (int)(dw * scale)); var ph = Math.Max(4, (int)(dh * scale));
        var pr = new Rectangle(box.X + (box.Width - pw) / 2, box.Y + (box.Height - ph) / 2, pw, ph);

        for (var k = 3; k >= 1; k--)
        {
            using var sh = new SolidBrush(Color.FromArgb(Theme.Dark ? 38 : 16, 0, 0, 0));
            g.FillRectangle(sh, pr.X - k + 1, pr.Y + k, pr.Width + (k - 1) * 2, pr.Height);
        }
        g.FillRectangle(Brushes.White, pr);

        var bmp = thumbs.TryGet(page);
        if (bmp is null && !page.IsBlank && !thumbs.HasFailed(page)) thumbs.Request(page);
        var flags = TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding | TextFormatFlags.SingleLine;
        if (page.IsBlank)
            TextRenderer.DrawText(g, "Blank", Theme.Ui(9f), pr, Color.FromArgb(170, 175, 185), flags);
        else if (bmp is not null)
        {
            var rot = ((page.Rotation % 360) + 360) % 360;
            var st = g.Save();
            g.SetClip(pr, CombineMode.Intersect);
            g.TranslateTransform(pr.X + pr.Width / 2f, pr.Y + pr.Height / 2f);
            g.RotateTransform(rot);
            var w = rot % 180 == 0 ? pr.Width : pr.Height;
            var h = rot % 180 == 0 ? pr.Height : pr.Width;
            var fade = thumbs.Fade(page);
            if (fade < 1f)
            {
                anyFading = true;
                using var ia = new ImageAttributes();
                ia.SetColorMatrix(new ColorMatrix { Matrix33 = fade });
                g.DrawImage(bmp, new Rectangle(-w / 2, -h / 2, w, h), 0, 0, bmp.Width, bmp.Height, GraphicsUnit.Pixel, ia);
            }
            else g.DrawImage(bmp, new RectangleF(-w / 2f, -h / 2f, w, h));
            g.Restore(st);
        }
        else
            TextRenderer.DrawText(g, thumbs.HasFailed(page) ? "Preview\nunavailable" : "Loading…", Theme.Ui(9f), pr, Color.FromArgb(150, 155, 165),
                thumbs.HasFailed(page) ? TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter : flags);
        using (var pen = new Pen(Color.FromArgb(Theme.Dark ? 80 : 40, 0, 0, 0))) g.DrawRectangle(pen, pr.X, pr.Y, pr.Width - 1, pr.Height - 1);

        // caption
        var capTop = box.Bottom + Theme.S(4);
        TextRenderer.DrawText(g, (i + 1).ToString(), Theme.Ui(10f, FontStyle.Bold),
            new Rectangle(cell.X + cellPad, capTop, boxW, Theme.S(18)), Theme.Text,
            TextFormatFlags.HorizontalCenter | TextFormatFlags.NoPadding | TextFormatFlags.SingleLine);
        var parts = new List<string>();
        parts.Add(page.IsBlank ? "Blank page" : page.SourceName);
        if (page.Rotation != 0) parts.Add($"↻{page.Rotation}°");
        if (page.TextAnnotations.Count > 0) parts.Add("✎");
        if (page.ImageAnnotations.Count > 0) parts.Add("▣");
        if (page.Edits.Count > 0) parts.Add("✐");
        TextRenderer.DrawText(g, string.Join("  ", parts), Theme.Ui(8f),
            new Rectangle(cell.X + cellPad, capTop + Theme.S(18), boxW, Theme.S(16)), Theme.Muted,
            TextFormatFlags.HorizontalCenter | TextFormatFlags.NoPadding | TextFormatFlags.SingleLine | TextFormatFlags.EndEllipsis);

        // selection check + hover quick actions
        if (sel || hov) DrawCheck(g, CheckRect(cell), sel);
        if (hov)
        {
            DrawRoundButton(g, RotateRect(cell), "\uE7AD", Theme.Text);
            DrawRoundButton(g, DeleteRect(cell), "\uE74D", Theme.Danger);
        }

        if (isDragSource)
        {
            Gfx.FillRound(g, Color.FromArgb(150, Theme.Canvas), rf, 10);
        }
    }

    private static void DrawCheck(Graphics g, Rectangle r, bool on)
    {
        var f = new RectangleF(r.X, r.Y, r.Width, r.Height);
        using var b = new SolidBrush(on ? Theme.Accent : Color.FromArgb(230, Theme.Surface));
        using var pen = new Pen(on ? Theme.Accent : Theme.Muted, 1.5f);
        g.FillEllipse(b, f); g.DrawEllipse(pen, f);
        if (!on) return;
        using var tick = new Pen(Color.White, 2f) { StartCap = LineCap.Round, EndCap = LineCap.Round, LineJoin = LineJoin.Round };
        g.DrawLines(tick, new[]
        {
            new PointF(r.X + r.Width * 0.27f, r.Y + r.Height * 0.52f),
            new PointF(r.X + r.Width * 0.44f, r.Y + r.Height * 0.69f),
            new PointF(r.X + r.Width * 0.74f, r.Y + r.Height * 0.32f)
        });
    }

    private static void DrawRoundButton(Graphics g, Rectangle r, string glyph, Color fg)
    {
        var f = new RectangleF(r.X, r.Y, r.Width, r.Height);
        using var b = new SolidBrush(Color.FromArgb(235, Theme.Surface));
        using var pen = new Pen(Theme.Border);
        g.FillEllipse(b, f); g.DrawEllipse(pen, f);
        TextRenderer.DrawText(g, glyph, Theme.Icons(9f), r, fg,
            TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
    }

    private void DrawInsertMarker(Graphics g, int idx)
    {
        var n = Pages.Count;
        if (n == 0) return;
        Rectangle cell; int x;
        if (idx >= n) { cell = CellRect(n - 1); x = cell.Right + gap / 2; }
        else { cell = CellRect(idx); x = cell.Left - gap / 2; }
        var w = Theme.S(4);
        Gfx.FillRound(g, Theme.Accent, new RectangleF(x - w / 2f, cell.Top, w, cell.Height), w / 2f);
        // little end caps make the marker easy to spot
        using var b = new SolidBrush(Theme.Accent);
        g.FillEllipse(b, x - w, cell.Top - w, w * 2, w * 2);
        g.FillEllipse(b, x - w, cell.Bottom - w, w * 2, w * 2);
    }

    private void DrawGhost(Graphics g)
    {
        if (dragItems.Count == 0) return;
        var first = dragItems[0];
        var gw = Theme.S(96);
        var (dw, dh) = first.DisplaySizePt(true);
        var gh = (int)(gw * dh / dw);
        var shown = Math.Min(3, dragItems.Count);
        for (var k = shown - 1; k >= 0; k--)
        {
            var r = new Rectangle(lastMouse.X - gw / 2 + k * Theme.S(6), lastMouse.Y - gh / 2 + k * Theme.S(6), gw, gh);
            using var fill = new SolidBrush(Color.FromArgb(235, 255, 255, 255));
            g.FillRectangle(fill, r);
            if (k == 0 && thumbs.TryGet(first) is { } bmp)
            {
                var rot = ((first.Rotation % 360) + 360) % 360;
                var st = g.Save();
                g.SetClip(r, CombineMode.Intersect);
                g.TranslateTransform(r.X + r.Width / 2f, r.Y + r.Height / 2f);
                g.RotateTransform(rot);
                var w = rot % 180 == 0 ? r.Width : r.Height; var h = rot % 180 == 0 ? r.Height : r.Width;
                using var ia = new ImageAttributes();
                ia.SetColorMatrix(new ColorMatrix { Matrix33 = 0.85f });
                g.DrawImage(bmp, new Rectangle(-w / 2, -h / 2, w, h), 0, 0, bmp.Width, bmp.Height, GraphicsUnit.Pixel, ia);
                g.Restore(st);
            }
            using var pen = new Pen(Theme.Accent, 2f);
            g.DrawRectangle(pen, r);
        }
        if (dragItems.Count > 1)
        {
            var bd = Theme.S(24);
            var br = new Rectangle(lastMouse.X + gw / 2 - bd / 2, lastMouse.Y - gh / 2 - bd / 2, bd, bd);
            using var b = new SolidBrush(Theme.Accent);
            g.FillEllipse(b, br);
            TextRenderer.DrawText(g, dragItems.Count.ToString(), Theme.Ui(8.5f, FontStyle.Bold), br, Color.White,
                TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
        }
    }

    // ───────────────────────── mouse ─────────────────────────

    protected override void OnMouseDown(MouseEventArgs e)
    {
        base.OnMouseDown(e);
        Focus();
        var idx = HitIndex(e.Location);

        if (e.Button == MouseButtons.Left && idx < 0 && HitAddTile(e.Location)) { addPressed = true; return; }

        if (e.Button == MouseButtons.Right)
        {
            if (idx >= 0 && !Selection.Contains(Pages[idx].Id)) SelectOnly(idx);
            ContextRequested?.Invoke(e.Location);
            return;
        }
        if (e.Button != MouseButtons.Left) return;

        if (idx < 0)
        {
            // empty space: start rubber-band selection
            if ((ModifierKeys & Keys.Control) == 0 && Selection.Count > 0) { Selection.Clear(); Raise(); }
            bandBase = new HashSet<Guid>(Selection);
            bandStart = new Point(e.X, e.Y + ScrollY);
            bandRect = new Rectangle(bandStart, Size.Empty);
            mode = Mode.Band; autoScroll.Start();
            return;
        }

        var cell = CellRect(idx);
        var page = Pages[idx];
        if (CheckRect(cell).Contains(e.Location)) { Toggle(idx); return; }
        if (RotateRect(cell).Contains(e.Location)) { QuickRotate?.Invoke(page); return; }
        if (DeleteRect(cell).Contains(e.Location)) { QuickDelete?.Invoke(page); return; }

        collapseIdx = -1;
        if ((ModifierKeys & Keys.Shift) != 0 && anchorIdx >= 0) SelectRange(anchorIdx, idx);
        else if ((ModifierKeys & Keys.Control) != 0) { Toggle(idx); return; }
        else if (!Selection.Contains(page.Id)) SelectOnly(idx);
        else { collapseIdx = idx; ActiveId = page.Id; anchorIdx = idx; Raise(); }

        pressIdx = idx; pressPt = e.Location; lastMouse = e.Location; mode = Mode.Pressed;
    }

    protected override void OnMouseMove(MouseEventArgs e)
    {
        base.OnMouseMove(e);
        lastMouse = e.Location;
        switch (mode)
        {
            case Mode.Pressed:
                if (Math.Abs(e.X - pressPt.X) > SystemInformation.DragSize.Width / 2 || Math.Abs(e.Y - pressPt.Y) > SystemInformation.DragSize.Height / 2)
                {
                    dragItems = SelectedPages();
                    if (dragItems.Count == 0 && pressIdx >= 0) dragItems = new List<PageItem> { Pages[pressIdx] };
                    collapseIdx = -1; mode = Mode.Dragging; Cursor = Cursors.SizeAll; autoScroll.Start();
                    dropIdx = InsertIndexAt(e.Location); Invalidate();
                }
                break;
            case Mode.Dragging:
                dropIdx = InsertIndexAt(e.Location); Invalidate();
                break;
            case Mode.Band:
                UpdateBand(e.Location);
                break;
            default:
                var h = HitIndex(e.Location);
                var ah = h < 0 && HitAddTile(e.Location);
                if (h != hoverIdx || ah != addHover) { hoverIdx = h; addHover = ah; Cursor = ah ? Cursors.Hand : Cursors.Default; Invalidate(); }
                break;
        }
    }

    protected override void OnMouseLeave(EventArgs e)
    {
        base.OnMouseLeave(e);
        if (mode == Mode.None && (hoverIdx != -1 || addHover)) { hoverIdx = -1; addHover = false; Cursor = Cursors.Default; Invalidate(); }
    }

    protected override void OnMouseUp(MouseEventArgs e)
    {
        base.OnMouseUp(e);
        if (e.Button != MouseButtons.Left) return;
        if (addPressed)
        {
            addPressed = false;
            if (HitAddTile(e.Location)) AddFilesRequested?.Invoke();
            return;
        }
        var was = mode;
        mode = Mode.None; Cursor = Cursors.Default; autoScroll.Stop();
        if (was == Mode.Dragging)
        {
            var target = InsertIndexAt(e.Location);
            var items = dragItems; dragItems = new List<PageItem>(); dropIdx = -1;
            Invalidate();
            if (items.Count > 0 && ClientRectangle.Contains(e.Location)) ReorderRequested?.Invoke(items, target);
        }
        else if (was == Mode.Pressed && collapseIdx >= 0) SelectOnly(collapseIdx);
        else if (was == Mode.Band) Invalidate();
        collapseIdx = -1; pressIdx = -1;
        hoverIdx = HitIndex(e.Location);
    }

    protected override void OnMouseDoubleClick(MouseEventArgs e)
    {
        base.OnMouseDoubleClick(e);
        var idx = HitIndex(e.Location);
        if (idx >= 0 && e.Button == MouseButtons.Left) PageOpened?.Invoke(Pages[idx]);
    }

    protected override void OnMouseWheel(MouseEventArgs e)
    {
        base.OnMouseWheel(e);
        if ((ModifierKeys & Keys.Control) != 0) { ZoomWheel?.Invoke(Math.Sign(e.Delta)); return; }
        if (!vbar.Visible) return;
        var basis = smooth.Enabled ? scrollTarget : vbar.Value;
        ScrollTo(basis - (int)Math.Round(e.Delta / 120.0 * Math.Max(60, cellH * 0.55)), true);
    }

    private void UpdateBand(Point p)
    {
        var cur = new Point(p.X, p.Y + ScrollY);
        bandRect = Rectangle.FromLTRB(Math.Min(bandStart.X, cur.X), Math.Min(bandStart.Y, cur.Y), Math.Max(bandStart.X, cur.X), Math.Max(bandStart.Y, cur.Y));
        Selection.Clear(); Selection.UnionWith(bandBase);
        for (var i = 0; i < Pages.Count; i++)
            if (CellContent(i).IntersectsWith(bandRect)) Selection.Add(Pages[i].Id);
        if (Selection.Count > 0 && ActiveId is null) ActiveId = Pages.First(pg => Selection.Contains(pg.Id)).Id;
        Raise();
    }

    private void AutoScrollTick(object? s, EventArgs e)
    {
        var dragging = mode is Mode.Dragging or Mode.Band || fileDropIdx >= 0;
        if (!dragging) { autoScroll.Stop(); return; }
        var p = PointToClient(Cursor.Position);
        var edge = Theme.S(56);
        var dy = p.Y < edge ? -((edge - p.Y) / 3 + 3) : p.Y > Height - edge ? (p.Y - (Height - edge)) / 3 + 3 : 0;
        if (dy == 0 || !vbar.Visible) return;
        var max = Math.Max(0, vbar.Maximum - vbar.LargeChange + 1);
        var nv = Math.Clamp(vbar.Value + dy, 0, max);
        if (nv == vbar.Value) return;
        vbar.Value = nv;
        lastMouse = p;
        if (mode == Mode.Dragging) dropIdx = InsertIndexAt(p);
        else if (mode == Mode.Band) UpdateBand(p);
        else if (fileDropIdx >= 0) fileDropIdx = InsertIndexAt(p);
        Invalidate();
    }

    // ───────────────────────── keyboard ─────────────────────────

    protected override bool IsInputKey(Keys keyData) =>
        (keyData & Keys.KeyCode) is Keys.Left or Keys.Right or Keys.Up or Keys.Down or Keys.Home or Keys.End or Keys.PageUp or Keys.PageDown
        || base.IsInputKey(keyData);

    protected override void OnKeyDown(KeyEventArgs e)
    {
        base.OnKeyDown(e);
        if (e.KeyCode == Keys.Escape && mode == Mode.Dragging)
        {
            mode = Mode.None; dragItems = new(); dropIdx = -1; Cursor = Cursors.Default; Capture = false; autoScroll.Stop(); Invalidate();
            return;
        }
        var n = Pages.Count;
        if (n == 0 || e.Control || e.Alt) return;
        var cur = ActiveIndex < 0 ? 0 : ActiveIndex;
        var rowsVisible = Math.Max(1, Height / (cellH + gap));
        int target = e.KeyCode switch
        {
            Keys.Left => cur - 1, Keys.Right => cur + 1, Keys.Up => cur - cols, Keys.Down => cur + cols,
            Keys.Home => 0, Keys.End => n - 1, Keys.PageUp => cur - cols * rowsVisible, Keys.PageDown => cur + cols * rowsVisible,
            _ => -1
        };
        if (e.KeyCode == Keys.Space && ActiveIndex >= 0) { Toggle(ActiveIndex); e.Handled = true; return; }
        if (!(e.KeyCode is Keys.Left or Keys.Right or Keys.Up or Keys.Down or Keys.Home or Keys.End or Keys.PageUp or Keys.PageDown)) return;
        target = Math.Clamp(target, 0, n - 1);
        if (e.Shift && anchorIdx >= 0) SelectRange(anchorIdx, target); else SelectOnly(target);
        EnsureVisible(target);
        e.Handled = true;
    }

    // ───────────────────────── file drops from Explorer ─────────────────────────

    protected override void OnDragEnter(DragEventArgs e)
    {
        base.OnDragEnter(e);
        e.Effect = e.Data?.GetDataPresent(DataFormats.FileDrop) == true ? DragDropEffects.Copy : DragDropEffects.None;
        if (e.Effect != DragDropEffects.None) autoScroll.Start();
    }

    protected override void OnDragOver(DragEventArgs e)
    {
        base.OnDragOver(e);
        if (e.Data?.GetDataPresent(DataFormats.FileDrop) != true) { e.Effect = DragDropEffects.None; return; }
        e.Effect = DragDropEffects.Copy;
        var idx = InsertIndexAt(PointToClient(new Point(e.X, e.Y)));
        if (idx != fileDropIdx) { fileDropIdx = idx; Invalidate(); }
    }

    protected override void OnDragLeave(EventArgs e)
    {
        base.OnDragLeave(e);
        fileDropIdx = -1; autoScroll.Stop(); Invalidate();
    }

    protected override void OnDragDrop(DragEventArgs e)
    {
        base.OnDragDrop(e);
        var at = fileDropIdx < 0 ? Pages.Count : fileDropIdx;
        fileDropIdx = -1; autoScroll.Stop(); Invalidate();
        if (e.Data?.GetData(DataFormats.FileDrop) is string[] files && files.Length > 0) FilesDropped?.Invoke(files, at);
    }
}
