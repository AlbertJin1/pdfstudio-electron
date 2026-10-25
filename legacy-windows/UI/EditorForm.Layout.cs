using PdfStudio.Models;
using PdfStudio.Services;
using System.Drawing.Drawing2D;

namespace PdfStudio.UI;

/// <summary>
/// Edit PDF window – layout helpers: smart snapping (margins, page centre, other objects, the page's own text) with
/// guide lines and suggestions, per-page margin guides (draggable + numeric), alignment buttons, and the
/// Apply / Cancel bar that floats above the text being edited.
/// </summary>
public sealed partial class EditorForm
{
    // ═════════════════════════ state ═════════════════════════

    private sealed record SnapLine(double Pos, string Label);
    private readonly record struct SnapGuide(bool Vertical, double Pos, bool Suggest, string Label);

    private const double SnapPx = 7;       // closer than this (screen pixels): the object clicks into place
    private const double SuggestPx = 26;   // closer than this: a dashed suggestion is shown
    private const double SmartMaxPt = 60;  // "Snap to best spot" looks this far (points)

    private readonly Dictionary<Guid, PageMargins> margins = new();
    private readonly List<SnapGuide> guides = new();
    private bool snapOn = true, showMargins = true;
    private int marginSide = -1;           // 0 left, 1 top, 2 right, 3 bottom while a margin line is dragged

    private FlatButton snapBtn = null!, marginBtn = null!;
    private Control tipLabel = null!;
    private TableLayoutPanel alignGroup = null!, marginGroup = null!;
    private readonly CheckBox snapCheck = new() { Text = "Snap to margins and objects", AutoSize = true, Checked = true };
    private readonly CheckBox marginCheck = new() { Text = "Show margin guides", AutoSize = true, Checked = true };
    private readonly ComboBox unitBox = new ModernCombo();
    private readonly NumericUpDown mTop = MarginNum(), mBottom = MarginNum(), mLeft = MarginNum(), mRight = MarginNum();

    private FlowLayoutPanel? editBar;

    public Dictionary<Guid, PageMargins> MarginsResult => margins.ToDictionary(k => k.Key, v => v.Value.Clone());

    private PageMargins CurMargins => margins[pages[index].Id];
    private bool SnapActive => snapOn && (ModifierKeys & Keys.Alt) == 0;
    private static NumericUpDown MarginNum() => new() { Minimum = 0, Maximum = 1000, DecimalPlaces = 2, Increment = 0.05m };

    private double UnitPt => unitBox.SelectedIndex switch { 1 => 72.0 / 2.54, 2 => 1.0, _ => 72.0 };
    private string UnitName => unitBox.SelectedIndex switch { 1 => "cm", 2 => "pt", _ => "in" };

    // ═════════════════════════ toolbar buttons + side panel ═════════════════════════

    private void CreateLayoutButtons()
    {
        snapBtn = Btn("Snap", "\u229E", () => SetSnap(!snapOn),
            "Snap ON: objects click into place on the margins, the page centre, other objects and the page's own text. Hold Alt while dragging to move freely.", true);
        snapBtn.Active = true;
        marginBtn = Btn("Margins", "\u25A3", () => { }, "Show, hide or reset the margin guides of this page. You can also drag a margin line on the page.", true);
        marginBtn.Active = true;
        marginBtn.DropMenu = Menus.Make(
            ("Show / hide margin guides", ToggleMargins),
            ("Fit margins to this page's text", FitMarginsToContent),
            ("Reset margins on this page (0.5 in)", ResetMargins),
            ("Use this page's margins on every page", MarginsToAll));
    }

    private void BuildLayoutGroups()
    {
        tipLabel = new Txt("Tip: click any text to change it. Drag things to move them \u2013 they snap to the margins and to each other.", 9f, FontStyle.Regular, true)
        { AutoSize = true, MaximumSize = new Size(Theme.S(250), 0), Margin = new Padding(0, 0, 0, 12) };

        // ── align (selected object) ──
        alignGroup = Group("Align on page");
        FlatButton AB(string text, int mode, string tip)
        {
            var b = new FlatButton { Text = text, Kind = BtnKind.Secondary, Width = Theme.S(76), Height = 30, Margin = new Padding(0, 0, 4, 6) };
            b.Click += (_, _) => AlignSel(mode); tips.SetToolTip(b, tip); propsButtons.Add((b, 3)); return b;
        }
        var fp = new FlowLayoutPanel { AutoSize = true, Width = Theme.S(250), BackColor = Color.Transparent, Margin = new Padding(0) };
        propsFlows.Add(fp);
        fp.Controls.AddRange(new Control[]
        {
            AB("Left", 0, "Line up with the left margin"), AB("Centre", 1, "Centre between the left and right margins"), AB("Right", 2, "Line up with the right margin"),
            AB("Top", 3, "Line up with the top margin"), AB("Middle", 4, "Centre between the top and bottom margins"), AB("Bottom", 5, "Line up with the bottom margin")
        });
        var best = new FlatButton { Text = "Snap to best spot", Kind = BtnKind.Primary, Width = Theme.S(246), Height = 32, Margin = new Padding(0, 0, 0, 4) };
        propsButtons.Add((best, 1));
        best.Click += (_, _) => SmartSnapSel();
        tips.SetToolTip(best, "Moves the selected object to the nearest good position: a margin, the page centre, or in line with other objects and text");
        fp.Controls.Add(best);
        var ra = alignGroup.RowCount++; alignGroup.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        alignGroup.Controls.Add(fp, 0, ra); alignGroup.SetColumnSpan(fp, 2);
        alignGroup.Visible = false;

        // ── page margins + snapping (always visible) ──
        marginGroup = Group("Page margins");
        Span(marginGroup, marginCheck);
        Span(marginGroup, snapCheck);
        unitBox.Items.AddRange(new object[] { "inches", "centimetres", "points" });
        unitBox.SelectedIndex = 0;
        Row(marginGroup, "Units", unitBox);
        Row(marginGroup, "Top", mTop); Row(marginGroup, "Bottom", mBottom); Row(marginGroup, "Left", mLeft); Row(marginGroup, "Right", mRight);
        var mfFit = new FlowLayoutPanel { AutoSize = true, Width = Theme.S(250), BackColor = Color.Transparent, Margin = new Padding(0) };
        var mf = new FlowLayoutPanel { AutoSize = true, Width = Theme.S(250), BackColor = Color.Transparent, Margin = new Padding(0) };
        propsFlows.Add(mfFit); propsFlows.Add(mf);
        FlatButton MB(string t, Action a, string tip, int perRow)
        {
            var b = new FlatButton { Text = t, Kind = BtnKind.Secondary, Width = Theme.S(100), Height = 30, Margin = new Padding(0, 4, 6, 2) };
            b.Click += (_, _) => a(); tips.SetToolTip(b, tip); propsButtons.Add((b, perRow)); return b;
        }
        mfFit.Controls.Add(MB("Fit to page text", FitMarginsToContent, "Put the margin guides where the text on this page really starts and ends", 1));
        mf.Controls.Add(MB("Reset", ResetMargins, "Back to 0.5 inch on every side", 2));
        mf.Controls.Add(MB("Use on all pages", MarginsToAll, "Copy these margins to every page of the document", 2));
        var rf = marginGroup.RowCount++; marginGroup.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        marginGroup.Controls.Add(mfFit, 0, rf); marginGroup.SetColumnSpan(mfFit, 2);
        var rm = marginGroup.RowCount++; marginGroup.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        marginGroup.Controls.Add(mf, 0, rm); marginGroup.SetColumnSpan(mf, 2);

        marginCheck.CheckedChanged += (_, _) => { if (!updatingUi) SetShowMargins(marginCheck.Checked); };
        snapCheck.CheckedChanged += (_, _) => { if (!updatingUi) SetSnap(snapCheck.Checked); };
        unitBox.SelectedIndexChanged += (_, _) => SyncMargins();
        mLeft.ValueChanged += (_, _) => MarginTyped(0, mLeft);
        mTop.ValueChanged += (_, _) => MarginTyped(1, mTop);
        mRight.ValueChanged += (_, _) => MarginTyped(2, mRight);
        mBottom.ValueChanged += (_, _) => MarginTyped(3, mBottom);
        tips.SetToolTip(mLeft, "Left margin"); tips.SetToolTip(mRight, "Right margin"); tips.SetToolTip(mTop, "Top margin"); tips.SetToolTip(mBottom, "Bottom margin");
    }

    // ═════════════════════════ margins ═════════════════════════

    private static double ClampMargin(double v, double dim) => Math.Clamp(v, 0, Math.Max(0, dim / 2 - 5));

    private void SetMargin(int side, double pt)
    {
        var (pw, ph) = PageSize; var m = CurMargins;
        switch (side)
        {
            case 0: m.Left = ClampMargin(pt, pw); break;
            case 1: m.Top = ClampMargin(pt, ph); break;
            case 2: m.Right = ClampMargin(pt, pw); break;
            default: m.Bottom = ClampMargin(pt, ph); break;
        }
        m.Custom = true;
        dirty = true;
    }

    private void MarginTyped(int side, NumericUpDown n)
    {
        if (updatingUi) return;
        SetMargin(side, (double)n.Value * UnitPt);
        SyncMargins(); canvas.Invalidate();
    }

    private void SyncMargins()
    {
        if (pages.Count == 0 || !margins.ContainsKey(pages[index].Id)) return;
        var m = CurMargins; var u = UnitPt;
        var was = updatingUi; updatingUi = true;
        try
        {
            var pt = unitBox.SelectedIndex == 2;
            foreach (var n in new[] { mTop, mBottom, mLeft, mRight })
            {
                n.DecimalPlaces = pt ? 1 : 2;
                n.Increment = pt ? 1m : unitBox.SelectedIndex == 1 ? 0.1m : 0.05m;
            }
            SetNum(mTop, m.Top / u); SetNum(mBottom, m.Bottom / u); SetNum(mLeft, m.Left / u); SetNum(mRight, m.Right / u);
        }
        finally { updatingUi = was; }
    }

    private void SetShowMargins(bool v)
    {
        showMargins = v; marginBtn.Active = v; marginBtn.Invalidate();
        var was = updatingUi; updatingUi = true; marginCheck.Checked = v; updatingUi = was;
        canvas.Invalidate();
    }

    private void ToggleMargins() => SetShowMargins(!showMargins);

    private void SetSnap(bool v)
    {
        snapOn = v; snapBtn.Active = v; snapBtn.Invalidate();
        var was = updatingUi; updatingUi = true; snapCheck.Checked = v; updatingUi = was;
        hint.Text = v ? "Snapping is ON. Objects click into place; hold Alt while dragging to move freely." : "Snapping is OFF. Objects move freely.";
    }

    private void ResetMargins()
    {
        margins[pages[index].Id] = new PageMargins { Custom = true };
        dirty = true; SyncMargins(); canvas.Invalidate();
    }

    /// <summary>
    /// The page's real content box: the left-most, top-most, right-most and bottom-most text on the page.
    /// Returns null when the page has no text (a scan or a picture), so the default margins stay.
    /// </summary>
    private static PageMargins? DetectMargins(List<PdfTextBlock> blocks, (double W, double H) size)
    {
        double l = double.MaxValue, t = double.MaxValue, r = double.MinValue, b = double.MinValue;
        foreach (var bl in blocks)
        {
            var x = bl.Box;
            if (x.Width <= 0 || x.Height <= 0 || string.IsNullOrWhiteSpace(bl.Text)) continue;
            l = Math.Min(l, x.Left); t = Math.Min(t, x.Top); r = Math.Max(r, x.Right); b = Math.Max(b, x.Bottom);
        }
        if (l == double.MaxValue) return null;
        double Fit(double v, double dim) => ClampMargin(Math.Round(Math.Max(0, v) * 2) / 2, dim);   // nearest half point
        return new PageMargins { Left = Fit(l, size.W), Top = Fit(t, size.H), Right = Fit(size.W - r, size.W), Bottom = Fit(size.H - b, size.H) };
    }

    /// <summary>Margins the user has not touched follow the page's own text, so the guides sit where the page content really is.</summary>
    private void AutoMargins(PageItem page)
    {
        if (!margins.TryGetValue(page.Id, out var m) || m.Custom) return;
        if (!blockCache.TryGetValue(page.Id, out var blocks)) return;
        var d = DetectMargins(blocks, page.DisplaySizePt(false));
        if (d == null) return;
        m.Left = d.Left; m.Top = d.Top; m.Right = d.Right; m.Bottom = d.Bottom;
        if (pages[index].Id == page.Id) SyncMargins();
    }

    private void FitMarginsToContent()
    {
        var page = pages[index];
        if (!blockCache.TryGetValue(page.Id, out var blocks)) { hint.Text = "The text of this page is still loading. Try again in a moment."; return; }
        var d = DetectMargins(blocks, PageSize);
        if (d == null) { hint.Text = "This page has no text to measure (it may be a scan or a picture), so the margins were left as they are."; return; }
        var m = CurMargins;
        m.Left = d.Left; m.Top = d.Top; m.Right = d.Right; m.Bottom = d.Bottom; m.Custom = true;
        dirty = true; SyncMargins(); canvas.Invalidate();
        hint.Text = "The margin guides now sit where the text on this page starts and ends.";
    }

    private void MarginsToAll()
    {
        if (pages.Count > 1 && MessageBox.Show(this, "Use this page's margins on every page?", "Edit PDF", MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return;
        var m = CurMargins;
        foreach (var p in pages) { var c = m.Clone(); c.Custom = true; margins[p.Id] = c; }
        dirty = true; canvas.Invalidate();
        hint.Text = "These margins are now used on every page.";
    }

    /// <summary>Which margin line (0 left, 1 top, 2 right, 3 bottom) is under the pointer, or -1.</summary>
    private int HitMarginLine(Point s)
    {
        if (!showMargins || pages.Count == 0) return -1;
        var m = CurMargins; var (pw, ph) = PageSize;
        const float tol = 5;
        if (s.X < Pad - tol || s.Y < Pad - tol || s.X > Pad + pw * zoom + tol || s.Y > Pad + ph * zoom + tol) return -1;
        if (Math.Abs(s.X - ToScr(m.Left, 0).X) <= tol) return 0;
        if (Math.Abs(s.X - ToScr(pw - m.Right, 0).X) <= tol) return 2;
        if (Math.Abs(s.Y - ToScr(0, m.Top).Y) <= tol) return 1;
        if (Math.Abs(s.Y - ToScr(0, ph - m.Bottom).Y) <= tol) return 3;
        return -1;
    }

    private void DragMargin(PointF p)
    {
        var (pw, ph) = PageSize;
        double Q(double v) => (ModifierKeys & Keys.Alt) != 0 ? v : Math.Round(v / 4.5) * 4.5;   // steps of 1/16 inch
        switch (marginSide)
        {
            case 0: SetMargin(0, Q(p.X)); break;
            case 1: SetMargin(1, Q(p.Y)); break;
            case 2: SetMargin(2, Q(pw - p.X)); break;
            case 3: SetMargin(3, Q(ph - p.Y)); break;
        }
        SyncMargins();
        var m = CurMargins;
        var v = marginSide switch { 0 => m.Left, 1 => m.Top, 2 => m.Right, _ => m.Bottom };
        hint.Text = $"Margin: {v / UnitPt:0.##} {UnitName}. Release to set it.";
        canvas.Invalidate();
    }

    // ═════════════════════════ snapping ═════════════════════════

    private (List<SnapLine> X, List<SnapLine> Y) BuildTargets(PageEditObject? exclude)
    {
        var (pw, ph) = PageSize; var m = CurMargins;
        var xs = new List<SnapLine> { new(m.Left, "Left margin"), new(pw - m.Right, "Right margin"), new(pw / 2, "Centre of the page") };
        var ys = new List<SnapLine> { new(m.Top, "Top margin"), new(ph - m.Bottom, "Bottom margin"), new(ph / 2, "Middle of the page") };
        var cx = (m.Left + pw - m.Right) / 2; var cy = (m.Top + ph - m.Bottom) / 2;
        if (Math.Abs(cx - pw / 2) > 0.5) xs.Add(new(cx, "Centre between the margins"));
        if (Math.Abs(cy - ph / 2) > 0.5) ys.Add(new(cy, "Middle between the margins"));

        foreach (var o in Objs)
        {
            if (exclude != null && o.Id == exclude.Id) continue;
            if (o.Kind == EditKind.Rect && o.Tag.Length > 0) continue;          // the cover behind an edited line
            var b = EditPainter.Bounds(o);
            xs.Add(new(b.Left, "Lined up with another object")); xs.Add(new(b.Right, "Lined up with another object"));
            xs.Add(new(b.Left + b.Width / 2, "Centred on another object"));
            ys.Add(new(b.Top, "Lined up with another object")); ys.Add(new(b.Bottom, "Lined up with another object"));
            ys.Add(new(b.Top + b.Height / 2, "Centred on another object"));
            if (o.Kind == EditKind.Text)
                ys.Add(new(o.Y + TextMetrics.Ascent(o.FontName, Math.Max(4, o.FontSize), o.Bold, o.Italic), "On the same line as other text"));
        }
        if (blockCache.TryGetValue(pages[index].Id, out var blocks))
            foreach (var bl in blocks)
            {
                if (Objs.Any(o => o.Tag == BlockTag(bl))) continue;
                xs.Add(new(bl.OriginX, "Lined up with the text on the page"));
                xs.Add(new(bl.Box.Right, "Lined up with the end of a text line"));
                ys.Add(new(bl.Baseline, "On the same line as the page text"));
            }
        return (Dedupe(xs), Dedupe(ys));
    }

    private static List<SnapLine> Dedupe(List<SnapLine> l)
    {
        var r = new List<SnapLine>();
        foreach (var s in l) if (!r.Any(x => Math.Abs(x.Pos - s.Pos) < 0.3)) r.Add(s);
        return r;
    }

    private static bool Nearest(IEnumerable<double> feats, List<SnapLine> targets, out double delta, out SnapLine? line)
    {
        delta = 0; line = null; var best = double.MaxValue;
        foreach (var f in feats)
            foreach (var t in targets)
            {
                var d = t.Pos - f;
                if (Math.Abs(d) < best) { best = Math.Abs(d); delta = d; line = t; }
            }
        return line != null;
    }

    /// <summary>Returns the shift that makes the nearest feature hit a target (0 if none is close enough) and records guides.</summary>
    private double SnapAxis(double[] feats, List<SnapLine> targets, bool vertical)
    {
        if (!Nearest(feats, targets, out var d, out var line) || line == null) return 0;
        var px = Math.Abs(d) * zoom;
        if (px <= SnapPx)
        {
            var shown = 0;
            foreach (var t in targets)
            {
                if (shown >= 3) break;
                foreach (var f in feats)
                    if (Math.Abs(t.Pos - (f + d)) < 0.4) { guides.Add(new SnapGuide(vertical, t.Pos, false, t.Label)); shown++; break; }
            }
            return d;
        }
        if (px <= SuggestPx) guides.Add(new SnapGuide(vertical, line.Pos, true, line.Label));
        return 0;
    }

    private double[] YFeatures(PageEditObject o, RectangleF r, double shift, double baseTop)
    {
        var l = new List<double> { r.Top + shift, r.Top + r.Height / 2 + shift, r.Bottom + shift };
        if (o.Kind == EditKind.Text) l.Add(baseTop + shift + TextMetrics.Ascent(o.FontName, Math.Max(4, o.FontSize), o.Bold, o.Italic));
        return l.ToArray();
    }

    private (double dx, double dy) SnapMoveDelta(PageEditObject o, double dx, double dy)
    {
        ClearGuides();
        if (!SnapActive || dragOrig == null) return (dx, dy);
        var (xt, yt) = BuildTargets(o);
        var r = dragBounds;
        var sx = SnapAxis(new[] { r.Left + dx, r.Left + r.Width / 2 + dx, r.Right + dx }, xt, true);
        var sy = SnapAxis(YFeatures(o, r, dy, dragOrig.Y), yt, false);
        var fx = dx + sx; var fy = dy + sy;

        // spacing between neighbouring boxes (only on an axis that did not already click onto a guide line)
        var ns = Neighbours(o);
        var cur = new RectangleF(r.X + (float)fx, r.Y + (float)fy, r.Width, r.Height);
        var xFree = !guides.Any(g => g.Vertical && !g.Suggest);
        var yFree = !guides.Any(g => !g.Vertical && !g.Suggest);
        var (ex, ey) = SnapSpacing(cur, ns, xFree, yFree);
        fx += ex; fy += ey;
        cur = new RectangleF(r.X + (float)fx, r.Y + (float)fy, r.Width, r.Height);
        AddGapMarks(cur, ns, false, null);
        return (fx, fy);
    }

    private PointF SnapPoint(PointF p, bool sx, bool sy, PageEditObject? exclude)
    {
        ClearGuides();
        if (!SnapActive || (!sx && !sy)) return p;
        var (xt, yt) = BuildTargets(exclude);
        var x = p.X; var y = p.Y;
        if (sx) x += (float)SnapAxis(new[] { (double)p.X }, xt, true);
        if (sy) y += (float)SnapAxis(new[] { (double)p.Y }, yt, false);
        return new PointF(x, y);
    }

    private PointF SnapForResize(PointF p)
    {
        var o = sel!; var h = dragHandle;
        bool sx, sy;
        if (o.Kind == EditKind.Line) { sx = sy = true; }
        else if (o.Kind == EditKind.Text) { sx = true; sy = false; }
        else
        {
            sx = h is 0 or 2 or 3 or 4 or 6 or 7;
            sy = h is 0 or 1 or 2 or 4 or 5 or 6;
            if (o.Kind == EditKind.Image && h % 2 == 0 && (ModifierKeys & Keys.Shift) == 0) sy = false;   // aspect ratio is kept
        }
        return SnapPoint(p, sx, sy, o);
    }

    private void ShowSnapHint()
    {
        var snapped = guides.FirstOrDefault(g => !g.Suggest);
        if (snapped.Label != null) { hint.Text = "Snapped: " + snapped.Label + "."; return; }
        if (spacingLabel != null && !spacingSuggest) { hint.Text = "Snapped: " + spacingLabel + "."; return; }
        var sug = guides.FirstOrDefault();
        if (sug.Label != null) { hint.Text = "Suggestion: move a little closer to snap to \u201C" + sug.Label + "\u201D."; return; }
        hint.Text = spacingLabel != null ? "Suggestion: move a little closer for " + spacingLabel + "." : "Drag to move. Hold Alt to move freely.";
    }

    // ═════════════════════════ align / smart snap ═════════════════════════

    private void AlignSel(int mode)
    {
        if (sel == null) return;
        CommitInlineEdit(); if (sel == null) return;
        var b = EditPainter.Bounds(sel); var (pw, ph) = PageSize; var m = CurMargins;
        double dx = 0, dy = 0;
        switch (mode)
        {
            case 0: dx = m.Left - b.Left; break;
            case 1: dx = (m.Left + (pw - m.Right)) / 2 - (b.Left + b.Width / 2); break;
            case 2: dx = (pw - m.Right) - b.Right; break;
            case 3: dy = m.Top - b.Top; break;
            case 4: dy = (m.Top + (ph - m.Bottom)) / 2 - (b.Top + b.Height / 2); break;
            default: dy = (ph - m.Bottom) - b.Bottom; break;
        }
        if (Math.Abs(dx) < 0.05 && Math.Abs(dy) < 0.05) { hint.Text = "Already there."; return; }
        PushUndo(); sel.X += dx; sel.Y += dy;
        SyncPosOnly(); canvas.Invalidate();
    }

    private void SmartSnapSel()
    {
        if (sel == null) return;
        CommitInlineEdit(); if (sel == null) return;
        var o = sel; var b = EditPainter.Bounds(o);
        var (xt, yt) = BuildTargets(o);
        Nearest(new[] { (double)b.Left, b.Left + b.Width / 2.0, b.Right }, xt, out var dx, out var lx);
        Nearest(YFeatures(o, b, 0, o.Y), yt, out var dy, out var ly);
        var useX = lx != null && Math.Abs(dx) <= SmartMaxPt;
        var useY = ly != null && Math.Abs(dy) <= SmartMaxPt;
        if (!useX && !useY) { hint.Text = "Nothing close enough to snap to. Try moving the object nearer to a margin or to other text."; return; }
        if ((!useX || Math.Abs(dx) < 0.05) && (!useY || Math.Abs(dy) < 0.05)) { hint.Text = "Already in a good position: " + (useX ? lx!.Label : ly!.Label).ToLowerInvariant() + "."; return; }
        PushUndo();
        if (useX) o.X += dx;
        if (useY) o.Y += dy;
        SyncPosOnly(); canvas.Invalidate();
        hint.Text = "Moved to: " + string.Join(" and ", new[] { useX ? lx!.Label : null, useY ? ly!.Label : null }.Where(s => s != null)).ToLowerInvariant() + ".";
    }

    // ═════════════════════════ distance indicators + equal spacing (like Canva) ═════════════════════════

    /// <summary>A measured gap: a horizontal (or vertical) segment between two boxes / a box and the page edge.</summary>
    private readonly record struct GapMark(bool Horizontal, double From, double To, double Cross, bool Suggest, bool Equal);

    private readonly List<GapMark> gapMarks = new();
    private string? spacingLabel;
    private bool spacingSuggest;

    private void ClearGuides() { guides.Clear(); gapMarks.Clear(); spacingLabel = null; spacingSuggest = false; }

    private string FormatGap(double pt) => $"{pt / UnitPt:0.##} {UnitName}";

    /// <summary>Boxes the moving object is measured against: other objects and the page's own (unedited) text lines.</summary>
    private List<RectangleF> Neighbours(PageEditObject? exclude)
    {
        var l = new List<RectangleF>();
        foreach (var o in Objs)
        {
            if (exclude != null && o.Id == exclude.Id) continue;
            if (o.Kind == EditKind.Rect && o.Tag.Length > 0) continue;     // the cover behind an edited line
            var b = EditPainter.Bounds(o);
            if (b.Width > 0.5f || b.Height > 0.5f) l.Add(b);
        }
        if (blockCache.TryGetValue(pages[index].Id, out var blocks))
            foreach (var bl in blocks)
            {
                if (Objs.Any(o => o.Tag == BlockTag(bl))) continue;
                l.Add(bl.Box);
            }
        return l;
    }

    private static bool OverlapY(RectangleF a, RectangleF b) => Math.Min(a.Bottom, b.Bottom) - Math.Max(a.Top, b.Top) > 0.5f;
    private static bool OverlapX(RectangleF a, RectangleF b) => Math.Min(a.Right, b.Right) - Math.Max(a.Left, b.Left) > 0.5f;

    /// <summary>The closest box on each side of <paramref name="r"/> that overlaps it on the other axis.</summary>
    private static (RectangleF? L, RectangleF? R, RectangleF? T, RectangleF? B) NearestSides(RectangleF r, List<RectangleF> ns)
    {
        RectangleF? L = null, R = null, T = null, B = null;
        foreach (var n in ns)
        {
            if (OverlapY(r, n))
            {
                if (n.Right <= r.Left + 0.01f) { if (L == null || n.Right > L.Value.Right) L = n; }
                else if (n.Left >= r.Right - 0.01f) { if (R == null || n.Left < R.Value.Left) R = n; }
            }
            if (OverlapX(r, n))
            {
                if (n.Bottom <= r.Top + 0.01f) { if (T == null || n.Bottom > T.Value.Bottom) T = n; }
                else if (n.Top >= r.Bottom - 0.01f) { if (B == null || n.Top < B.Value.Top) B = n; }
            }
        }
        return (L, R, T, B);
    }

    /// <summary>Adds the distance marks of <paramref name="r"/> to its neighbours (or to the page edge when nothing is on that side).</summary>
    private void AddGapMarks(RectangleF r, List<RectangleF> ns, bool suggest, bool? horizontalOnly)
    {
        var (pw, ph) = PageSize;
        var (L, R, T, B) = NearestSides(r, ns);
        const double maxGap = 500;
        static double Mid(float a1, float a2, float b1, float b2) => (Math.Max(a1, b1) + Math.Min(a2, b2)) / 2;
        double cy = r.Top + r.Height / 2.0, cx = r.Left + r.Width / 2.0;
        var list = new List<GapMark>();

        double? gl = null, gr = null, gt = null, gb = null;
        if (L is { } l) { var g = r.Left - l.Right; if (g > 0.4 && g <= maxGap) { gl = g; list.Add(new(true, l.Right, r.Left, Mid(r.Top, r.Bottom, l.Top, l.Bottom), suggest, false)); } }
        else if (r.Left > 0.4) list.Add(new(true, 0, r.Left, cy, suggest, false));
        if (R is { } rr) { var g = rr.Left - r.Right; if (g > 0.4 && g <= maxGap) { gr = g; list.Add(new(true, r.Right, rr.Left, Mid(r.Top, r.Bottom, rr.Top, rr.Bottom), suggest, false)); } }
        else if (pw - r.Right > 0.4) list.Add(new(true, r.Right, pw, cy, suggest, false));
        if (T is { } t) { var g = r.Top - t.Bottom; if (g > 0.4 && g <= maxGap) { gt = g; list.Add(new(false, t.Bottom, r.Top, Mid(r.Left, r.Right, t.Left, t.Right), suggest, false)); } }
        else if (r.Top > 0.4) list.Add(new(false, 0, r.Top, cx, suggest, false));
        if (B is { } b) { var g = b.Top - r.Bottom; if (g > 0.4 && g <= maxGap) { gb = g; list.Add(new(false, r.Bottom, b.Top, Mid(r.Left, r.Right, b.Left, b.Right), suggest, false)); } }
        else if (ph - r.Bottom > 0.4) list.Add(new(false, r.Bottom, ph, cx, suggest, false));

        var eqH = gl != null && gr != null && Math.Abs(gl.Value - gr.Value) < 0.6;
        var eqV = gt != null && gb != null && Math.Abs(gt.Value - gb.Value) < 0.6;
        foreach (var mk in list)
        {
            if (horizontalOnly != null && mk.Horizontal != horizontalOnly.Value) continue;
            var eq = !suggest && ((mk.Horizontal && eqH && (mk.To - mk.From) > 0.4 && IsNeighbourGap(mk, r, true)) || (!mk.Horizontal && eqV && IsNeighbourGap(mk, r, false)));
            gapMarks.Add(mk with { Equal = eq });
        }
    }

    /// <summary>True when the mark runs to another box (not to the page edge).</summary>
    private bool IsNeighbourGap(GapMark mk, RectangleF r, bool horizontal)
    {
        var (pw, ph) = PageSize;
        if (horizontal) return mk.From > 0.01 && mk.To < pw - 0.01;
        return mk.From > 0.01 && mk.To < ph - 0.01;
    }

    private (double dx, double dy) SnapSpacing(RectangleF cur, List<RectangleF> ns, bool xFree, bool yFree)
    {
        double ax = 0, ay = 0;
        if (xFree) ax = SpacingAxis(cur, ns, true);
        var cur2 = new RectangleF(cur.X + (float)ax, cur.Y, cur.Width, cur.Height);
        if (yFree) ay = SpacingAxis(cur2, ns, false);
        return (ax, ay);
    }

    private static List<double> KnownGaps(List<RectangleF> ns, bool horizontal)
    {
        var set = new List<double>();
        for (var i = 0; i < ns.Count; i++)
            for (var j = 0; j < ns.Count; j++)
            {
                if (i == j) continue;
                var a = ns[i]; var b = ns[j];
                double g;
                if (horizontal) { if (!OverlapY(a, b)) continue; g = b.Left - a.Right; }
                else { if (!OverlapX(a, b)) continue; g = b.Top - a.Bottom; }
                if (g > 0.9 && g < 300 && !set.Any(x => Math.Abs(x - g) < 0.5)) set.Add(g);
            }
        set.Sort();
        return set.Take(24).ToList();
    }

    /// <summary>Equal space on both sides, or the same space as another pair of boxes on the page. Returns the shift on this axis.</summary>
    private double SpacingAxis(RectangleF cur, List<RectangleF> ns, bool horizontal)
    {
        var (L, R, T, B) = NearestSides(cur, ns);
        var before = horizontal ? L : T; var after = horizontal ? R : B;
        if (before == null && after == null) return 0;
        double size = horizontal ? cur.Width : cur.Height;
        double start = horizontal ? cur.Left : cur.Top;
        double? b0 = before == null ? null : horizontal ? before.Value.Right : before.Value.Bottom;
        double? a0 = after == null ? null : horizontal ? after.Value.Left : after.Value.Top;

        var cands = new List<(double Delta, string Label)>();
        if (b0 != null && a0 != null)
        {
            var space = a0.Value - b0.Value - size;
            if (space >= 0) cands.Add((b0.Value + space / 2 - start, "equal spacing on both sides"));
        }
        if (ns.Count <= 160)
            foreach (var g in KnownGaps(ns, horizontal))
            {
                if (b0 != null) cands.Add((b0.Value + g - start, "the same spacing as elsewhere on the page"));
                if (a0 != null) cands.Add((a0.Value - g - size - start, "the same spacing as elsewhere on the page"));
            }
        if (cands.Count == 0) return 0;

        var best = cands.OrderBy(c => Math.Abs(c.Delta)).First();
        var px = Math.Abs(best.Delta) * zoom;
        if (px <= SnapPx) { spacingLabel = best.Label; spacingSuggest = false; return best.Delta; }
        if (px <= SuggestPx && spacingLabel == null)
        {
            spacingLabel = best.Label; spacingSuggest = true;
            var ghost = horizontal ? new RectangleF(cur.X + (float)best.Delta, cur.Y, cur.Width, cur.Height)
                                   : new RectangleF(cur.X, cur.Y + (float)best.Delta, cur.Width, cur.Height);
            AddGapMarks(ghost, ns, true, horizontal);
        }
        return 0;
    }

    /// <summary>Distance marks for the object being resized or drawn.</summary>
    private void ShowGapsFor(PageEditObject o)
    {
        if (!SnapActive || o.Kind == EditKind.Line) return;
        gapMarks.Clear();
        AddGapMarks(EditPainter.Bounds(o), Neighbours(o), false, null);
    }

    private void DrawGapMarks(Graphics g)
    {
        if (gapMarks.Count == 0) return;
        g.SmoothingMode = SmoothingMode.None;
        var f = Theme.Ui(8.5f);
        const float cap = 4;
        foreach (var mk in gapMarks)
        {
            var col = mk.Suggest ? Color.FromArgb(210, Theme.Accent) : mk.Equal ? Theme.Accent : Color.FromArgb(236, 72, 153);
            using var pen = new Pen(col, 1.3f) { DashStyle = mk.Suggest ? DashStyle.Dash : DashStyle.Solid };
            PointF a, b;
            if (mk.Horizontal) { a = ToScr(mk.From, mk.Cross); b = ToScr(mk.To, mk.Cross); }
            else { a = ToScr(mk.Cross, mk.From); b = ToScr(mk.Cross, mk.To); }
            g.DrawLine(pen, a, b);
            using var solid = new Pen(col, 1.3f);
            if (mk.Horizontal) { g.DrawLine(solid, a.X, a.Y - cap, a.X, a.Y + cap); g.DrawLine(solid, b.X, b.Y - cap, b.X, b.Y + cap); }
            else { g.DrawLine(solid, a.X - cap, a.Y, a.X + cap, a.Y); g.DrawLine(solid, b.X - cap, b.Y, b.X + cap, b.Y); }

            var text = FormatGap(mk.To - mk.From);
            var sz = g.MeasureString(text, f);
            var w = sz.Width + 8; var h = sz.Height + 2;
            // label beside the line so it never hides the boxes being measured
            var chip = mk.Horizontal
                ? new RectangleF((a.X + b.X) / 2 - w / 2, a.Y - h - 3, w, h)
                : new RectangleF(a.X + 6, (a.Y + b.Y) / 2 - h / 2, w, h);
            using var bg = new SolidBrush(col);
            g.FillRectangle(bg, chip);
            g.DrawString(text, f, Brushes.White, chip.X + 4, chip.Y + 1);
        }
    }

    // ═════════════════════════ overlay painting ═════════════════════════

    private void DrawLayoutOverlays(Graphics g)
    {
        if (pages.Count == 0) return;
        var (pw, ph) = PageSize; var m = CurMargins;
        var pr = new RectangleF(Pad, Pad, (float)(pw * zoom), (float)(ph * zoom));
        g.SmoothingMode = SmoothingMode.None;

        if (showMargins)
        {
            using var pen = new Pen(Color.FromArgb(170, 14, 165, 233), 1f) { DashStyle = DashStyle.Dash };
            var x0 = ToScr(m.Left, 0).X; var x1 = ToScr(pw - m.Right, 0).X;
            var y0 = ToScr(0, m.Top).Y; var y1 = ToScr(0, ph - m.Bottom).Y;
            g.DrawLine(pen, x0, pr.Top, x0, pr.Bottom); g.DrawLine(pen, x1, pr.Top, x1, pr.Bottom);
            g.DrawLine(pen, pr.Left, y0, pr.Right, y0); g.DrawLine(pen, pr.Left, y1, pr.Right, y1);
        }

        var vi = 0; var hi = 0;
        foreach (var gd in guides)
        {
            var col = gd.Suggest ? Color.FromArgb(200, Theme.Accent) : Color.FromArgb(236, 72, 153);
            using var pen = new Pen(col, gd.Suggest ? 1.2f : 1.4f) { DashStyle = gd.Suggest ? DashStyle.Dash : DashStyle.Solid };
            var text = gd.Suggest ? "Suggestion: " + gd.Label : gd.Label;
            var f = Theme.Ui(8.5f);
            var sz = g.MeasureString(text, f);
            RectangleF chip;
            if (gd.Vertical)
            {
                var x = ToScr(gd.Pos, 0).X;
                g.DrawLine(pen, x, pr.Top, x, pr.Bottom);
                chip = new RectangleF(Math.Min(x + 5, pr.Right - sz.Width - 10), pr.Top + 6 + vi++ * 22, sz.Width + 8, sz.Height + 2);
            }
            else
            {
                var y = ToScr(0, gd.Pos).Y;
                g.DrawLine(pen, pr.Left, y, pr.Right, y);
                chip = new RectangleF(pr.Left + 6, Math.Max(pr.Top + 2, y - sz.Height - 5 - hi++ * 22), sz.Width + 8, sz.Height + 2);
            }
            using var bg = new SolidBrush(col);
            g.FillRectangle(bg, chip);
            g.DrawString(text, f, Brushes.White, chip.X + 4, chip.Y + 1);
        }
        DrawGapMarks(g);
    }

    // ═════════════════════════ Apply / Cancel bar above the text box ═════════════════════════

    private void ShowEditBar()
    {
        HideEditBar();
        var bar = new FlowLayoutPanel
        {
            AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink, WrapContents = false, BorderStyle = BorderStyle.FixedSingle,
            BackColor = Theme.Surface, Padding = new Padding(4, 3, 4, 3), Margin = Padding.Empty
        };
        // paint the bar off-screen first, so moving it never leaves stray copies behind
        typeof(Control).GetProperty("DoubleBuffered", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic)?.SetValue(bar, true);
        var grip = new MoveGrip();
        grip.MouseDown += (_, e) => { if (e.Button == MouseButtons.Left) GripDown(); };
        grip.MouseMove += (_, _) => GripMove();
        grip.MouseUp += (_, _) => GripUp();
        tips.SetToolTip(grip, "Press and drag to move this text box (hold Alt to move freely)");
        var label = new Txt("Editing text", 9f, FontStyle.Bold) { Height = 30, TextAlign = ContentAlignment.MiddleLeft, Margin = new Padding(2, 0, 12, 0) };
        label.Width = TextRenderer.MeasureText("Editing text", label.Font, new Size(1000, 100), TextFormatFlags.NoPadding | TextFormatFlags.SingleLine).Width + Theme.S(6);
        var ok = new FlatButton { Text = "Apply", Glyph = "\uE73E", Kind = BtnKind.Primary, Height = 30, AutoWidth = true, MinWidth = 90, Margin = new Padding(0, 0, 4, 0) };
        var no = new FlatButton { Text = "Cancel", Kind = BtnKind.Secondary, Height = 30, AutoWidth = true, MinWidth = 76, Margin = Padding.Empty };
        ok.Click += (_, _) => BeginInvoke(new Action(CommitInlineEdit));
        no.Click += (_, _) => BeginInvoke(new Action(CancelInlineEdit));
        tips.SetToolTip(ok, "Keep this text (Ctrl+Enter)");
        tips.SetToolTip(no, "Throw away what you typed and put the text back as it was");
        bar.Controls.AddRange(new Control[] { grip, label, ok, no });
        canvas.Controls.Add(bar);
        editBar = bar;
        FlatButton.FitTree(bar);
        bar.BringToFront();
    }

    private void HideEditBar()
    {
        if (editBar == null) return;
        var b = editBar; editBar = null;
        canvas.Controls.Remove(b); b.Dispose();
    }

    private void PositionEditBar()
    {
        if (editBar == null || editBox == null) return;
        var anchor = editFrame?.Bounds ?? editBox.Bounds;      // sit above the frame, not on top of it
        var sz = editBar.GetPreferredSize(Size.Empty);
        var x = Math.Clamp(anchor.Left, 2, Math.Max(2, canvas.Width - sz.Width - 2));
        var y = anchor.Top - sz.Height - 4;
        if (y < 2) y = anchor.Bottom + 4;
        editBar.Location = new Point(x, y);
        editBar.BringToFront();
    }

    /// <summary>True while the pointer is over the Apply / Cancel bar or it has focus, so clicking it doesn't end the edit by itself.</summary>
    private bool BarHasFocusOrMouse()
    {
        if (editBar == null) return false;
        if (editBar.ContainsFocus) return true;
        return editBar.Bounds.Contains(canvas.PointToClient(Cursor.Position));
    }

    // ═════════════════════════ visible frame around the text being edited ═════════════════════════

    /// <summary>
    /// The outline of the text box while it is being edited: a solid line, a soft band and four corner blocks.
    /// It is a ring (the middle is cut out), so the text box shows through and nothing is hidden behind it.
    /// Dragging the ring moves the text box, like the Move handle.
    /// </summary>
    private sealed class EditFrame : Control
    {
        public static int Band => Math.Max(7, Theme.S(7));

        public EditFrame()
        {
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
            SetStyle(ControlStyles.Selectable, false);
            TabStop = false; Cursor = Cursors.SizeAll;
        }

        protected override void OnSizeChanged(EventArgs e)
        {
            base.OnSizeChanged(e);
            var b = Band;
            if (Width <= b * 2 || Height <= b * 2) return;
            var ring = new Region(new Rectangle(0, 0, Width, Height));
            ring.Exclude(new Rectangle(b, b, Width - 2 * b, Height - 2 * b));
            var old = Region; Region = ring; old?.Dispose();
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics; var b = Band;
            g.SmoothingMode = SmoothingMode.None;
            g.Clear(Gfx.Mix(Theme.AccentSoft, Theme.Accent, 0.30f));
            using (var pen = new Pen(Theme.Accent, 2f)) g.DrawRectangle(pen, 1, 1, Width - 3, Height - 3);
            using var solid = new SolidBrush(Theme.Accent);
            g.FillRectangle(solid, 0, 0, b, b); g.FillRectangle(solid, Width - b, 0, b, b);
            g.FillRectangle(solid, 0, Height - b, b, b); g.FillRectangle(solid, Width - b, Height - b, b, b);
        }
    }

    // ═════════════════════════ adjustable width of the side panel ═════════════════════════

    /// <summary>The thin bar between the page and the side panel: drag it to change the panel's width, double-click to reset.</summary>
    private sealed class PropsGrip : Control
    {
        private bool hot;
        public bool Dragging { get; set; }

        public PropsGrip()
        {
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
            SetStyle(ControlStyles.Selectable, false);
            TabStop = false; Cursor = Cursors.SizeWE; Dock = DockStyle.Right; Width = Math.Max(8, Theme.S(8));
        }

        protected override void OnMouseEnter(EventArgs e) { hot = true; base.OnMouseEnter(e); Invalidate(); }
        protected override void OnMouseLeave(EventArgs e) { hot = false; base.OnMouseLeave(e); Invalidate(); }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics; var on = hot || Dragging;
            g.Clear(on ? Theme.AccentSoft : Theme.Canvas);
            g.SmoothingMode = SmoothingMode.AntiAlias;
            using var dot = new SolidBrush(on ? Theme.Accent : Theme.Muted);
            float cx = Width / 2f, cy = Height / 2f;
            for (var i = -2; i <= 2; i++) g.FillEllipse(dot, cx - 1.5f, cy + i * 8 - 1.5f, 3f, 3f);
        }
    }

    private void BuildPropsGrip()
    {
        propsGrip = new PropsGrip();
        tips.SetToolTip(propsGrip, "Drag to make the side panel wider or narrower. Double-click to put it back.");
        propsGrip.MouseDown += (_, e) =>
        {
            if (e.Button != MouseButtons.Left) return;
            propsGripStartX = Cursor.Position.X; propsGripStartW = props.Width;
            propsGrip.Dragging = true; propsGrip.Invalidate();
        };
        propsGrip.MouseMove += (_, _) =>
        {
            if (!propsGrip.Dragging) return;
            SetPropsWidth(propsGripStartW - (Cursor.Position.X - propsGripStartX));   // the panel is on the right, so dragging left widens it
        };
        propsGrip.MouseUp += (_, _) =>
        {
            if (!propsGrip.Dragging) return;
            propsGrip.Dragging = false; propsGrip.Invalidate(); SavePropsWidth();
        };
        propsGrip.DoubleClick += (_, _) => { SetPropsWidth(Theme.S(PropsWidthDefault)); SavePropsWidth(); };
    }

    private void SetPropsWidth(int w)
    {
        var min = Theme.S(PropsWidthMin);
        var max = Math.Max(min, Math.Min(Theme.S(PropsWidthMax), (int)(ClientSize.Width * 0.6)));   // always leave room for the page
        w = Math.Clamp(w, min, max);
        if (w == props.Width) return;
        props.Width = w;
    }

    private void SavePropsWidth()
    {
        var logical = (int)Math.Round(props.Width * 100.0 / Math.Max(1, Theme.S(100)));
        AppSettings.SetInt("editPanelWidth", Math.Clamp(logical, PropsWidthMin, PropsWidthMax));
    }

    /// <summary>Stretches every block of the side panel to its current width, so nothing is cut off and no sideways scroll bar appears.</summary>
    private void ApplyPropsWidth()
    {
        if (propsFlow == null || applyingPropsWidth) return;
        var w = propsFlow.ClientSize.Width - SystemInformation.VerticalScrollBarWidth - 2;   // room for the vertical scroll bar is always kept
        if (w < Theme.S(180)) return;
        applyingPropsWidth = true;
        try
        {
            propsFlow.SuspendLayout();
            foreach (Control c in propsFlow.Controls)
                if (c is TableLayoutPanel t) { t.MinimumSize = new Size(w, 0); t.MaximumSize = new Size(w, 0); t.Width = w; }
            foreach (var f in propsFlows) { f.MinimumSize = new Size(w, 0); f.MaximumSize = new Size(w, 0); f.Width = w; }
            foreach (var (b, perRow) in propsButtons)
                b.Width = Math.Max(Theme.S(60), (w - perRow * b.Margin.Horizontal) / perRow - 1);
            tipLabel.MaximumSize = new Size(w, 0);
            propsFlow.ResumeLayout(true);
        }
        finally { applyingPropsWidth = false; }
    }

    // ═════════════════════════ Move handle on the edit bar ═════════════════════════

    /// <summary>Handle in the edit bar: press and drag it to reposition the text box while it is being edited.</summary>
    private sealed class MoveGrip : Control
    {
        private bool hot;
        public MoveGrip()
        {
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer, true);
            SetStyle(ControlStyles.Selectable, false);
            TabStop = false; Cursor = Cursors.SizeAll; Size = new Size(Theme.S(78), 30); Margin = new Padding(0, 0, 8, 0);
        }
        protected override void OnMouseEnter(EventArgs e) { hot = true; base.OnMouseEnter(e); Invalidate(); }
        protected override void OnMouseLeave(EventArgs e) { hot = false; base.OnMouseLeave(e); Invalidate(); }
        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics; g.SmoothingMode = SmoothingMode.AntiAlias;
            g.Clear(Theme.Surface);
            Gfx.FillRound(g, hot ? Theme.AccentSoft : Theme.SurfaceAlt, new RectangleF(0.5f, 0.5f, Width - 1.5f, Height - 1.5f), 8);
            using var dot = new SolidBrush(hot ? Theme.Accent : Theme.Muted);
            for (var c = 0; c < 2; c++) for (var r = 0; r < 3; r++)
                g.FillEllipse(dot, 10 + c * 6, Height / 2f - 9 + r * 6, 3.2f, 3.2f);
            TextRenderer.DrawText(g, "Move", Theme.Ui(9f, FontStyle.Bold), new Rectangle(26, 0, Width - 28, Height), hot ? Theme.Accent : Theme.Text,
                TextFormatFlags.VerticalCenter | TextFormatFlags.Left | TextFormatFlags.NoPrefix | TextFormatFlags.NoPadding);
        }
    }

    private void GripDown()
    {
        if (editObj == null) return;
        sel = editObj; dragOrig = editObj.Clone(); dragBounds = EditPainter.Bounds(editObj);
        gripAnchor = Cursor.Position; gripMoving = true; gripUndoPushed = false;
        // The Apply/Cancel bar is hidden while the box is dragged (it comes back on release) and the canvas takes over the
        // mouse: moving a control that is itself being pressed is what smeared copies of the bar across the page.
        if (editBar != null) editBar.Visible = false;
        canvas.Capture = true;
        canvas.Invalidate(true);
    }

    private void GripMove()
    {
        if (!gripMoving || editObj == null || dragOrig == null || zoom <= 0) return;
        var c = Cursor.Position;
        var dx = (c.X - gripAnchor.X) / (double)zoom; var dy = (c.Y - gripAnchor.Y) / (double)zoom;
        if (!gripUndoPushed)
        {
            if (Math.Abs(dx) * zoom < 3 && Math.Abs(dy) * zoom < 3) return;
            gripUndoPushed = true;
            // a new / converted text already has an undo step covering the whole edit; an existing text gets its own
            if (!editIsNew && pendingConv == null) UndoBefore();
            convDirty = true; dirty = true;
        }
        var (sdx, sdy) = SnapMoveDelta(editObj, dx, dy);
        editObj.X = dragOrig.X + sdx; editObj.Y = dragOrig.Y + sdy;
        PositionEditBox(); ShowSnapHint(); SyncPosOnly();
        canvas.Invalidate(true); canvas.Update();       // repaint the page and the moved children right now, no leftovers
    }

    private void GripUp()
    {
        if (!gripMoving) return;
        gripMoving = false; ClearGuides(); dragOrig = null;
        canvas.Capture = false;
        if (editBar != null) { PositionEditBar(); editBar.Visible = true; editBar.BringToFront(); }
        if (editBox != null) { hint.Text = TypingHint; editBox.Focus(); }
        canvas.Invalidate(true); canvas.Update();
    }
}
