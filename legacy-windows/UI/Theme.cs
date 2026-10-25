using System.Drawing.Drawing2D;

namespace PdfStudio.UI;

public static class Theme
{
    public static bool Dark { get; private set; }
    public static float Scale { get; private set; } = 1f;
    public static event Action? Changed;

    public static void Init()
    {
        using var g = Graphics.FromHwnd(IntPtr.Zero);
        Scale = g.DpiX / 96f;
    }

    public static void SetDark(bool dark)
    {
        if (Dark == dark) return;
        Dark = dark;
        Changed?.Invoke();
    }

    /// <summary>Scales a design-time pixel value for painting on the current display.</summary>
    public static int S(int v) => (int)Math.Round(v * Scale);
    public static float S(float v) => v * Scale;

    private static Color C(int r, int g, int b) => Color.FromArgb(r, g, b);

    public static Color Window => Dark ? C(17, 19, 23) : C(243, 244, 247);
    public static Color Surface => Dark ? C(27, 30, 36) : Color.White;
    public static Color SurfaceAlt => Dark ? C(39, 43, 51) : C(237, 239, 244);
    public static Color Input => Dark ? C(36, 40, 48) : C(247, 248, 250);
    public static Color Canvas => Dark ? C(21, 23, 28) : C(232, 235, 241);
    public static Color Border => Dark ? C(55, 60, 70) : C(221, 225, 232);
    public static Color Text => Dark ? C(236, 238, 242) : C(24, 28, 36);
    public static Color Muted => Dark ? C(146, 154, 168) : C(102, 111, 128);
    public static Color Accent => C(79, 70, 229);
    public static Color AccentHover => C(99, 91, 240);
    public static Color AccentPressed => C(62, 54, 190);
    public static Color AccentSoft => Dark ? C(43, 41, 94) : C(231, 230, 253);
    public static Color Danger => C(220, 38, 38);
    public static Color Success => C(22, 163, 74);

    private static readonly Dictionary<string, Font> Fonts = new();
    private static Font Cached(string family, float size, FontStyle style)
    {
        var key = $"{family}|{size}|{(int)style}";
        if (!Fonts.TryGetValue(key, out var f)) Fonts[key] = f = new Font(family, size, style, GraphicsUnit.Point);
        return f;
    }
    public static Font Ui(float size = 9.5f, FontStyle style = FontStyle.Regular) => Cached("Segoe UI", size, style);
    public static Font Icons(float size = 12f) => Cached("Segoe MDL2 Assets", size, FontStyle.Regular);

    /// <summary>Applies theme colours to standard (native) controls, recursively. Self-themed controls are skipped.</summary>
    public static void Apply(Control root)
    {
        if (root is ISelfThemed) return;   // paints (and themes) itself and its inner controls
        switch (root)
        {
            case FlatButton or global::PdfStudio.UI.Surface or Txt or PageGridView: break;
            case TextBox tb: tb.BackColor = Input; tb.ForeColor = Text; tb.BorderStyle = BorderStyle.FixedSingle; break;
            case ComboBox cb: cb.BackColor = Input; cb.ForeColor = Text; cb.FlatStyle = FlatStyle.Flat; break;
            case NumericUpDown n: n.BackColor = Input; n.ForeColor = Text; n.BorderStyle = BorderStyle.FixedSingle; break;
            case ListBox lb: lb.BackColor = Input; lb.ForeColor = Text; lb.BorderStyle = BorderStyle.FixedSingle; break;
            case CheckBox or RadioButton: root.ForeColor = Text; root.BackColor = Color.Transparent; break;
            case Label l: l.ForeColor = Text; l.BackColor = Color.Transparent; break;
            case TableLayoutPanel or FlowLayoutPanel or Panel: root.BackColor = Color.Transparent; root.ForeColor = Text; break;
        }
        foreach (Control c in root.Controls) Apply(c);
    }
}

public static class Gfx
{
    /// <summary>Linear blend of two colours (alpha included), t in 0..1.</summary>
    public static Color Mix(Color a, Color b, float t)
    {
        t = Math.Clamp(t, 0f, 1f);
        int L(int x, int y) => (int)Math.Round(x + (y - x) * t);
        return Color.FromArgb(L(a.A, b.A), L(a.R, b.R), L(a.G, b.G), L(a.B, b.B));
    }

    public static GraphicsPath Round(RectangleF r, float radius)
    {
        var path = new GraphicsPath();
        var d = Math.Max(0.1f, Math.Min(radius * 2, Math.Min(r.Width, r.Height)));
        path.AddArc(r.X, r.Y, d, d, 180, 90);
        path.AddArc(r.Right - d, r.Y, d, d, 270, 90);
        path.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
        path.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
        path.CloseFigure();
        return path;
    }

    public static void FillRound(Graphics g, Color c, RectangleF r, float radius)
    {
        using var p = Round(r, radius); using var b = new SolidBrush(c); g.FillPath(b, p);
    }

    public static void DrawRound(Graphics g, Color c, RectangleF r, float radius, float width = 1f)
    {
        using var p = Round(r, radius); using var pen = new Pen(c, width); g.DrawPath(pen, p);
    }
}
