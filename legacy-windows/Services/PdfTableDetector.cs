using System.Runtime.InteropServices;

namespace PdfStudio.Services;

/// <summary>A horizontal or vertical ruling line found on a PDF page (points, origin top-left).</summary>
internal sealed class RuleLine
{
    public bool Horizontal;
    /// <summary>y of a horizontal line, x of a vertical one.</summary>
    public double Pos;
    public double From, To;
    public double Width;
    public int Rgb;
    public IntPtr Obj;
    public IntPtr Container;
    public bool InPage;
    /// <summary>The PDF object is a filled + stroked rectangle: only its outline is switched off, the fill stays in the picture.</summary>
    public bool KeepFill;
    public int FillMode;
    public double Length => To - From;
}

/// <summary>Reads the table borders (thin lines and rectangle outlines) of a page through PDFium.</summary>
internal static class PdfRules
{
    private const string Lib = "pdfium";
    private const int ObjPath = 2, ObjForm = 5;

    [StructLayout(LayoutKind.Sequential)] private struct FsMatrix { public float A, B, C, D, E, F; }

    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] private static extern int FPDF_PageToDevice(IntPtr page, int startX, int startY, int sizeX, int sizeY, int rotate, double pageX, double pageY, out int deviceX, out int deviceY);
    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] private static extern int FPDFPage_CountObjects(IntPtr page);
    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] private static extern IntPtr FPDFPage_GetObject(IntPtr page, int index);
    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] private static extern int FPDFPageObj_GetType(IntPtr pageObj);
    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] private static extern int FPDFFormObj_CountObjects(IntPtr formObj);
    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] private static extern IntPtr FPDFFormObj_GetObject(IntPtr formObj, uint index);
    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] private static extern int FPDFPageObj_GetBounds(IntPtr pageObj, out float left, out float bottom, out float right, out float top);
    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] private static extern int FPDFPageObj_GetMatrix(IntPtr pageObj, out FsMatrix matrix);
    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] private static extern int FPDFPath_CountSegments(IntPtr path);
    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] private static extern int FPDFPath_GetDrawMode(IntPtr path, out int fillMode, out int stroke);
    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] private static extern int FPDFPath_SetDrawMode(IntPtr path, int fillMode, int stroke);
    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] private static extern int FPDFPageObj_GetStrokeWidth(IntPtr pageObj, out float width);
    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] private static extern int FPDFPageObj_GetStrokeColor(IntPtr pageObj, out uint r, out uint g, out uint b, out uint a);
    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] private static extern int FPDFPageObj_GetFillColor(IntPtr pageObj, out uint r, out uint g, out uint b, out uint a);
    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] private static extern int FPDFPageObj_GetDashCount(IntPtr pageObj);

    private const double Thin = 3.5;   // a line is at most this thick (points)

    public static List<RuleLine> Read(IntPtr page, float pw, float ph)
    {
        var list = new List<RuleLine>();
        try { Walk(page, true, page, new List<FsMatrix>(), (int)Math.Round(pw * 10), (int)Math.Round(ph * 10), list, 0); }
        catch (EntryPointNotFoundException) { list.Clear(); }   // an old PDFium without the path API: no tables, text boxes as before
        return list;
    }

    /// <summary>Switches a table's border objects off in PDFium's in-memory page so they are not drawn into the background picture.</summary>
    public static void Strip(IEnumerable<RuleLine> rules)
    {
        foreach (var r in rules.GroupBy(x => x.Obj).Select(g => g.First()))
        {
            try
            {
                if (r.KeepFill) FPDFPath_SetDrawMode(r.Obj, r.FillMode, 0);
                else FPDFPath_SetDrawMode(r.Obj, 0, 0);   // neither filled nor stroked = invisible; the object itself stays valid
            }
            catch (EntryPointNotFoundException) { }
        }
    }

    private static void Walk(IntPtr container, bool isPage, IntPtr page, List<FsMatrix> chain, int sx, int sy, List<RuleLine> outList, int depth)
    {
        if (depth > 6 || outList.Count > 20000) return;
        var n = isPage ? FPDFPage_CountObjects(container) : FPDFFormObj_CountObjects(container);
        for (var i = 0; i < n; i++)
        {
            var obj = isPage ? FPDFPage_GetObject(container, i) : FPDFFormObj_GetObject(container, (uint)i);
            if (obj == IntPtr.Zero) continue;
            var type = FPDFPageObj_GetType(obj);
            if (type == ObjForm)
            {
                var fm = new FsMatrix { A = 1, D = 1 };
                try { if (FPDFPageObj_GetMatrix(obj, out var m) != 0) fm = m; } catch (EntryPointNotFoundException) { }
                var next = new List<FsMatrix>(chain.Count + 1) { fm };
                next.AddRange(chain);
                Walk(obj, false, page, next, sx, sy, outList, depth + 1);
            }
            else if (type == ObjPath) Classify(obj, container, isPage, chain, page, sx, sy, outList);
        }
    }

    private static double Scale(FsMatrix m)
    {
        var k = Math.Sqrt(Math.Abs((double)m.A * m.D - (double)m.B * m.C));
        return k > 0.001 && k < 1000 ? k : 1;
    }

    private static void Classify(IntPtr obj, IntPtr container, bool inPage, List<FsMatrix> chain, IntPtr page, int sx, int sy, List<RuleLine> outList)
    {
        if (FPDFPageObj_GetBounds(obj, out var l, out var b, out var r, out var t) == 0) return;
        if (FPDFPath_GetDrawMode(obj, out var fillMode, out var stroke) == 0) return;
        var filled = fillMode != 0; var stroked = stroke != 0;
        if (!filled && !stroked) return;
        try { if (FPDFPageObj_GetDashCount(obj) > 0) return; } catch (EntryPointNotFoundException) { }   // dotted / dashed rules are decoration, not table borders

        // bounds are in the coordinates of the form they live in: carry them out to the page
        double x0 = l, y0 = b, x1 = r, y1 = t, scale = 1;
        foreach (var m in chain)
        {
            double ax = m.A * x0 + m.C * y0 + m.E, ay = m.B * x0 + m.D * y0 + m.F;
            double bx = m.A * x1 + m.C * y0 + m.E, by = m.B * x1 + m.D * y0 + m.F;
            double cx = m.A * x0 + m.C * y1 + m.E, cy = m.B * x0 + m.D * y1 + m.F;
            double dx = m.A * x1 + m.C * y1 + m.E, dy = m.B * x1 + m.D * y1 + m.F;
            x0 = Math.Min(Math.Min(ax, bx), Math.Min(cx, dx)); x1 = Math.Max(Math.Max(ax, bx), Math.Max(cx, dx));
            y0 = Math.Min(Math.Min(ay, by), Math.Min(cy, dy)); y1 = Math.Max(Math.Max(ay, by), Math.Max(cy, dy));
            scale *= Scale(m);
        }
        try { if (FPDFPageObj_GetMatrix(obj, out var om) != 0) scale *= Scale(om); } catch (EntryPointNotFoundException) { }

        FPDF_PageToDevice(page, 0, 0, sx, sy, 0, x0, y1, out var pax, out var pay);
        FPDF_PageToDevice(page, 0, 0, sx, sy, 0, x1, y0, out var pbx, out var pby);
        double X0 = Math.Min(pax, pbx) / 10.0, X1 = Math.Max(pax, pbx) / 10.0, Y0 = Math.Min(pay, pby) / 10.0, Y1 = Math.Max(pay, pby) / 10.0;
        double w = X1 - X0, h = Y1 - Y0;

        double sw = 0;
        if (stroked && FPDFPageObj_GetStrokeWidth(obj, out var swf) != 0) sw = swf * scale;
        uint cr = 0, cg = 0, cb = 0, ca = 255;
        var gotColor = stroked ? FPDFPageObj_GetStrokeColor(obj, out cr, out cg, out cb, out ca) != 0
                               : FPDFPageObj_GetFillColor(obj, out cr, out cg, out cb, out ca) != 0;
        if (gotColor && ca < 40) return;   // invisible
        var rgb = gotColor ? ((int)Math.Min(cr, 255u) << 16) | ((int)Math.Min(cg, 255u) << 8) | (int)Math.Min(cb, 255u) : 0;

        RuleLine Make(bool horiz, double pos, double from, double to, double width) => new()
        {
            Horizontal = horiz, Pos = pos, From = from, To = to, Width = Math.Clamp(width, 0.25, 6), Rgb = rgb,
            Obj = obj, Container = container, InPage = inPage, KeepFill = filled && stroked && !(h <= Thin || w <= Thin), FillMode = fillMode
        };

        if (h <= Thin && w >= 4 && w >= 2 * h)
            outList.Add(Make(true, (Y0 + Y1) / 2, X0, X1, stroked ? sw : h));
        else if (w <= Thin && h >= 4 && h >= 2 * w)
            outList.Add(Make(false, (X0 + X1) / 2, Y0, Y1, stroked ? sw : w));
        else if (stroked && w > Thin && h > Thin)
        {
            // an outlined rectangle (4 or 5 path segments) = four borders; its fill, if any, stays in the picture
            var segs = FPDFPath_CountSegments(obj);
            if (segs != 4 && segs != 5) return;
            var half = sw / 2;
            double lx = X0 + half, rx = X1 - half, ty = Y0 + half, by2 = Y1 - half;
            if (rx - lx < 2 || by2 - ty < 2) return;
            outList.Add(Make(true, ty, lx, rx, sw));
            outList.Add(Make(true, by2, lx, rx, sw));
            outList.Add(Make(false, lx, ty, by2, sw));
            outList.Add(Make(false, rx, ty, by2, sw));
        }
    }
}

/// <summary>
/// Turns the ruling lines of a page into real table structures: lines that touch form one table, the distinct line
/// positions give the rows and columns, a missing line between two cells merges them (row / column spans).
/// </summary>
internal static class TableBuilder
{
    private const double Tol = 2.0;

    private sealed class Group
    {
        public List<RuleLine> Lines = new();
        public double X0 = double.MaxValue, Y0 = double.MaxValue, X1 = double.MinValue, Y1 = double.MinValue;
        public void Measure()
        {
            X0 = Y0 = double.MaxValue; X1 = Y1 = double.MinValue;
            foreach (var l in Lines)
            {
                if (l.Horizontal) { X0 = Math.Min(X0, l.From); X1 = Math.Max(X1, l.To); Y0 = Math.Min(Y0, l.Pos); Y1 = Math.Max(Y1, l.Pos); }
                else { Y0 = Math.Min(Y0, l.From); Y1 = Math.Max(Y1, l.To); X0 = Math.Min(X0, l.Pos); X1 = Math.Max(X1, l.Pos); }
            }
        }
    }

    private static int Find(int[] p, int i) { while (p[i] != i) { p[i] = p[p[i]]; i = p[i]; } return i; }
    private static void Union(int[] p, int a, int b) { a = Find(p, a); b = Find(p, b); if (a != b) p[b] = a; }

    private static bool Touch(RuleLine a, RuleLine b)
    {
        if (a.Horizontal == b.Horizontal)
            return Math.Abs(a.Pos - b.Pos) <= Tol && a.From <= b.To + Tol && b.From <= a.To + Tol;
        var h = a.Horizontal ? a : b; var v = a.Horizontal ? b : a;
        return v.Pos >= h.From - Tol && v.Pos <= h.To + Tol && h.Pos >= v.From - Tol && h.Pos <= v.To + Tol;
    }

    private static List<double> Cluster(List<double> values)
    {
        var res = new List<double>();
        if (values.Count == 0) return res;
        values.Sort();
        double sum = values[0]; var cnt = 1; var last = values[0];
        for (var i = 1; i < values.Count; i++)
        {
            if (values[i] - last <= Tol) { sum += values[i]; cnt++; }
            else { res.Add(sum / cnt); sum = values[i]; cnt = 1; }
            last = values[i];
        }
        res.Add(sum / cnt);
        return res;
    }

    /// <summary>How the line segments of one orientation cover [a,b] at position pos; null if they do not draw a border there.</summary>
    private static DocxBorder? Edge(List<RuleLine> ls, bool horiz, double pos, double a, double b)
    {
        if (b - a < 0.5) return null;
        var segs = new List<(double F, double T)>();
        double w = 0; var rgb = 0;
        foreach (var l in ls)
        {
            if (l.Horizontal != horiz || Math.Abs(l.Pos - pos) > Tol + 0.5) continue;
            var f = Math.Max(l.From, a); var t = Math.Min(l.To, b);
            if (t <= f) continue;
            segs.Add((f, t));
            if (l.Width > w) { w = l.Width; rgb = l.Rgb; }
        }
        if (segs.Count == 0) return null;
        segs.Sort((p, q) => p.F.CompareTo(q.F));
        double covered = 0, curF = segs[0].F, curT = segs[0].T;
        for (var i = 1; i < segs.Count; i++)
        {
            if (segs[i].F <= curT + Tol) curT = Math.Max(curT, segs[i].T);
            else { covered += curT - curF; curF = segs[i].F; curT = segs[i].T; }
        }
        covered += curT - curF;
        return covered >= 0.75 * (b - a) - 0.01 ? new DocxBorder { Width = w, Rgb = rgb } : null;
    }

    public static List<DocxTable> Build(List<RuleLine> rules, double pageW, double pageH, Func<double, double, double, double, bool> textIn)
    {
        var result = new List<DocxTable>();
        var lines = rules.Where(r => r.Length >= 4).ToList();
        if (lines.Count < 4 || lines.Count > 4000) return result;

        // 1. lines that touch belong to one table
        var parent = Enumerable.Range(0, lines.Count).ToArray();
        for (var i = 0; i < lines.Count; i++)
            for (var j = i + 1; j < lines.Count; j++)
                if (Touch(lines[i], lines[j])) Union(parent, i, j);
        var groups = new Dictionary<int, Group>();
        for (var i = 0; i < lines.Count; i++)
        {
            var root = Find(parent, i);
            if (!groups.TryGetValue(root, out var g)) groups[root] = g = new Group();
            g.Lines.Add(lines[i]);
        }
        var comps = groups.Values.ToList();
        foreach (var c in comps) c.Measure();

        // 2. boxes standing side by side on the same band with text between them (e.g. "NET AMOUNT" between two framed cells) are one table
        var cp = Enumerable.Range(0, comps.Count).ToArray();
        for (var i = 0; i < comps.Count; i++)
            for (var j = 0; j < comps.Count; j++)
            {
                if (i == j) continue;
                Group a = comps[i], b = comps[j];
                var gap = b.X0 - a.X1;
                if (gap <= 0 || gap > 150) continue;
                if (Math.Abs(a.Y0 - b.Y0) > 3 || Math.Abs(a.Y1 - b.Y1) > 3) continue;
                if (textIn(a.X1 + 1, Math.Min(a.Y0, b.Y0) + 1, b.X0 - 1, Math.Max(a.Y1, b.Y1) - 1)) Union(cp, i, j);
            }
        var merged = new Dictionary<int, Group>();
        for (var i = 0; i < comps.Count; i++)
        {
            var root = Find(cp, i);
            if (!merged.TryGetValue(root, out var g)) merged[root] = g = new Group();
            g.Lines.AddRange(comps[i].Lines);
        }

        // 3. each group becomes a grid
        foreach (var g in merged.Values)
        {
            g.Measure();
            var t = BuildOne(g.Lines);
            if (t is not null) result.Add(t);
        }

        // 4. a page frame or a lone empty box is decoration: leave it in the picture
        var pageArea = pageW * pageH;
        result.RemoveAll(t =>
        {
            if (t.Cells.Count != 1) return false;
            double x0 = t.X, y0 = t.Y, x1 = t.X + t.Width, y1 = t.Y + t.Height;
            if (t.Width * t.Height >= 0.6 * pageArea) return true;
            if (!textIn(x0 + 0.5, y0 + 0.5, x1 - 0.5, y1 - 0.5)) return true;
            return false;
        });
        for (var i = result.Count - 1; i >= 0; i--)
        {
            var t = result[i];
            if (t.Cells.Count != 1) continue;
            foreach (var u in result)
            {
                if (ReferenceEquals(u, t)) continue;
                if (u.X >= t.X - 1 && u.Y >= t.Y - 1 && u.X + u.Width <= t.X + t.Width + 1 && u.Y + u.Height <= t.Y + t.Height + 1) { result.RemoveAt(i); break; }
            }
        }
        result.Sort((p, q) => p.Y != q.Y ? p.Y.CompareTo(q.Y) : p.X.CompareTo(q.X));
        return result;
    }

    private static DocxTable? BuildOne(List<RuleLine> ls)
    {
        // grid lines: where perpendicular lines sit, plus line ends that do not line up with any of them
        var xr = ls.Where(l => !l.Horizontal).Select(l => l.Pos).ToList();
        var yr = ls.Where(l => l.Horizontal).Select(l => l.Pos).ToList();
        var xs = Cluster(new List<double>(xr));
        var ys = Cluster(new List<double>(yr));
        foreach (var l in ls)
        {
            if (l.Horizontal)
            {
                if (!xs.Any(x => Math.Abs(x - l.From) <= 4)) xr.Add(l.From);
                if (!xs.Any(x => Math.Abs(x - l.To) <= 4)) xr.Add(l.To);
            }
            else
            {
                if (!ys.Any(y => Math.Abs(y - l.From) <= 4)) yr.Add(l.From);
                if (!ys.Any(y => Math.Abs(y - l.To) <= 4)) yr.Add(l.To);
            }
        }
        xs = Cluster(xr); ys = Cluster(yr);
        int C = xs.Count - 1, R = ys.Count - 1;
        if (C < 1 || R < 1 || R * C > 4000) return null;

        var hb = new DocxBorder?[R + 1, C];
        var vb = new DocxBorder?[R, C + 1];
        for (var i = 0; i <= R; i++) for (var j = 0; j < C; j++) hb[i, j] = Edge(ls, true, ys[i], xs[j], xs[j + 1]);
        for (var i = 0; i < R; i++) for (var j = 0; j <= C; j++) vb[i, j] = Edge(ls, false, xs[j], ys[i], ys[i + 1]);

        int Edges(int i, int j) => (hb[i, j] != null ? 1 : 0) + (hb[i + 1, j] != null ? 1 : 0) + (vb[i, j] != null ? 1 : 0) + (vb[i, j + 1] != null ? 1 : 0);
        var strong = new bool[R, C];
        for (var i = 0; i < R; i++) for (var j = 0; j < C; j++) strong[i, j] = Edges(i, j) >= 2;

        // a missing line between two framed cells = one merged cell
        var cp = Enumerable.Range(0, R * C).ToArray();
        for (var i = 0; i < R; i++)
            for (var j = 0; j < C; j++)
            {
                if (!strong[i, j]) continue;
                if (j + 1 < C && strong[i, j + 1] && vb[i, j + 1] == null) Union(cp, i * C + j, i * C + j + 1);
                if (i + 1 < R && strong[i + 1, j] && hb[i + 1, j] == null) Union(cp, i * C + j, (i + 1) * C + j);
            }

        // regions must be rectangles; otherwise fall back to single cells
        var regions = new Dictionary<int, List<int>>();
        for (var k = 0; k < R * C; k++)
        {
            var root = Find(cp, k);
            if (!regions.TryGetValue(root, out var list)) regions[root] = list = new List<int>();
            list.Add(k);
        }
        var owner = new int[R * C];   // cell index -> id of the region that owns it
        var rects = new List<(int R0, int C0, int R1, int C1)>();
        foreach (var list in regions.Values)
        {
            int r0 = int.MaxValue, c0 = int.MaxValue, r1 = -1, c1 = -1;
            foreach (var k in list) { var i = k / C; var j = k % C; r0 = Math.Min(r0, i); c0 = Math.Min(c0, j); r1 = Math.Max(r1, i); c1 = Math.Max(c1, j); }
            if (list.Count == (r1 - r0 + 1) * (c1 - c0 + 1))
            {
                foreach (var k in list) owner[k] = rects.Count;
                rects.Add((r0, c0, r1, c1));
            }
            else
                foreach (var k in list) { owner[k] = rects.Count; rects.Add((k / C, k % C, k / C, k % C)); }
        }

        var table = new DocxTable { X = xs[0], Y = ys[0], ColW = new double[C], RowH = new double[R] };
        for (var j = 0; j < C; j++) table.ColW[j] = xs[j + 1] - xs[j];
        for (var i = 0; i < R; i++) table.RowH[i] = ys[i + 1] - ys[i];
        table.Rules.AddRange(ls);

        // cells in row-major order of their top-left corner
        foreach (var rc in rects.OrderBy(q => q.R0).ThenBy(q => q.C0))
        {
            var rows = rc.R1 - rc.R0 + 1; var cols = rc.C1 - rc.C0 + 1;
            double x0 = xs[rc.C0], x1 = xs[rc.C1 + 1], y0 = ys[rc.R0], y1 = ys[rc.R1 + 1];
            var cell = new DocxCell
            {
                Row = rc.R0, Col = rc.C0, RowSpan = rows, ColSpan = cols, X0 = x0, X1 = x1, Y0 = y0, Y1 = y1,
                Top = Edge(ls, true, y0, x0, x1), Bottom = Edge(ls, true, y1, x0, x1),
                Left = Enumerable.Range(rc.R0, rows).Select(i => vb[i, rc.C0]).ToArray(),
                Right = Enumerable.Range(rc.R0, rows).Select(i => vb[i, rc.C1 + 1]).ToArray()
            };
            table.Cells.Add(cell);
        }
        return table;
    }
}
