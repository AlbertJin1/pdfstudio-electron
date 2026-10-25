using System.Drawing.Drawing2D;

namespace PdfStudio.UI;

/// <summary>Draw a signature with the mouse/pen; saved as a transparent PNG.</summary>
public sealed class SignatureDialog : ModernDialog
{
    private readonly Panel pad = new() { Height = 200, Dock = DockStyle.Top, BackColor = Color.White, BorderStyle = BorderStyle.FixedSingle, Cursor = Cursors.Cross };
    private readonly List<List<PointF>> strokes = new();
    private List<PointF>? current;
    private Color ink = Color.FromArgb(20, 30, 90);
    private readonly CheckBox remember = new() { Text = "Keep it in My signatures", Checked = true, AutoSize = true, Margin = new Padding(14, 7, 0, 0) };
    public string? PngPath { get; private set; }

    /// <summary>True when the user wants this signature saved to the library for next time.</summary>
    public bool Remember => remember.Visible && remember.Checked;

    public SignatureDialog(bool offerRemember = true) : base("Draw signature", "Sign inside the box. It is saved with a transparent background.", 560, "Use signature")
    {
        typeof(Panel).GetProperty("DoubleBuffered", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic)?.SetValue(pad, true);
        pad.Paint += (_, e) =>
        {
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            using var pen = new Pen(ink, 2.6f) { StartCap = LineCap.Round, EndCap = LineCap.Round, LineJoin = LineJoin.Round };
            foreach (var s in strokes)
            {
                if (s.Count == 1) e.Graphics.FillEllipse(new SolidBrush(ink), s[0].X - 1.3f, s[0].Y - 1.3f, 2.6f, 2.6f);
                else if (s.Count > 1) e.Graphics.DrawLines(pen, s.ToArray());
            }
        };
        pad.MouseDown += (_, e) => { if (e.Button == MouseButtons.Left) { current = new List<PointF> { e.Location }; strokes.Add(current); pad.Invalidate(); } };
        pad.MouseMove += (_, e) => { if (current != null) { current.Add(e.Location); pad.Invalidate(); } };
        pad.MouseUp += (_, _) => current = null;

        var tools = new FlowLayoutPanel { Dock = DockStyle.Top, Height = 44, BackColor = Color.Transparent };
        var clear = new FlatButton { Text = "Clear", Width = 90, Height = 32 };
        clear.Click += (_, _) => { strokes.Clear(); pad.Invalidate(); };
        var colour = new FlatButton { Text = "Ink colour…", Width = 120, Height = 32 };
        colour.Click += (_, _) => { using var cd = new ColorDialog { Color = ink }; if (cd.ShowDialog(this) == DialogResult.OK) { ink = cd.Color; pad.Invalidate(); } };
        tools.Controls.AddRange(new Control[] { clear, colour });
        remember.Visible = offerRemember;
        if (offerRemember) tools.Controls.Add(remember);
        FixedBodyHeight = 270;
        Root.Controls.Add(tools);
        Root.Controls.Add(pad);
        pad.BringToFront(); tools.BringToFront();
    }

    protected override bool ValidateInput(out string error)
    {
        error = "";
        if (strokes.Count == 0) { error = "Draw your signature first."; return false; }
        var pts = strokes.SelectMany(s => s).ToList();
        var pad2 = 6f;
        var x0 = Math.Max(0, pts.Min(p => p.X) - pad2); var y0 = Math.Max(0, pts.Min(p => p.Y) - pad2);
        var x1 = pts.Max(p => p.X) + pad2; var y1 = pts.Max(p => p.Y) + pad2;
        var w = Math.Max(10, (int)(x1 - x0)); var h = Math.Max(10, (int)(y1 - y0));
        const int k = 3; // supersample for a crisp result
        using var bmp = new Bitmap(w * k, h * k);
        using (var g = Graphics.FromImage(bmp))
        {
            g.SmoothingMode = SmoothingMode.AntiAlias; g.Clear(Color.Transparent);
            g.ScaleTransform(k, k); g.TranslateTransform(-x0, -y0);
            using var pen = new Pen(ink, 2.6f) { StartCap = LineCap.Round, EndCap = LineCap.Round, LineJoin = LineJoin.Round };
            foreach (var s in strokes)
            {
                if (s.Count == 1) g.FillEllipse(new SolidBrush(ink), s[0].X - 1.3f, s[0].Y - 1.3f, 2.6f, 2.6f);
                else if (s.Count > 1) g.DrawLines(pen, s.ToArray());
            }
        }
        var dir = Path.Combine(Path.GetTempPath(), "PdfStudio"); Directory.CreateDirectory(dir);
        PngPath = Path.Combine(dir, $"signature_{Guid.NewGuid():N}.png");
        bmp.Save(PngPath, System.Drawing.Imaging.ImageFormat.Png);
        return true;
    }
}
