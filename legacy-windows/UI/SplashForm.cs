using System.Drawing.Drawing2D;

namespace PdfStudio.UI;

/// <summary>
/// Start-up loader. It runs on its OWN thread with its own message loop, so the spinner keeps turning
/// while the main window is being built on the main thread.
/// NOTE: it deliberately avoids Theme.Ui()/Theme.Icons() (their font cache is not thread-safe) and creates its own fonts.
/// </summary>
public sealed class SplashForm : Form
{
    private readonly System.Windows.Forms.Timer spin = new() { Interval = 16 };
    private readonly Font titleFont = new("Segoe UI", 21f, FontStyle.Bold, GraphicsUnit.Point);
    private readonly Font tagFont = new("Segoe UI", 9.5f, FontStyle.Regular, GraphicsUnit.Point);
    private readonly Font statusFont = new("Segoe UI", 9f, FontStyle.Regular, GraphicsUnit.Point);
    private readonly Font smallFont = new("Segoe UI", 8.5f, FontStyle.Regular, GraphicsUnit.Point);
    private readonly Font iconFont = new("Segoe MDL2 Assets", 26f, FontStyle.Regular, GraphicsUnit.Point);
    private float angle;
    private string status = "Starting…";

    private SplashForm()
    {
        AutoScaleMode = AutoScaleMode.None;
        FormBorderStyle = FormBorderStyle.None;
        StartPosition = FormStartPosition.CenterScreen;
        ShowInTaskbar = false;
        TopMost = true;
        DoubleBuffered = true;
        SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
        ClientSize = new Size(Theme.S(460), Theme.S(300));
        BackColor = Theme.Surface;
        Text = "PDF Studio";
        spin.Tick += (_, _) => { angle = (angle + 7f) % 360f; Invalidate(); };
        spin.Start();
    }

    protected override CreateParams CreateParams
    {
        get { var cp = base.CreateParams; cp.ClassStyle |= 0x20000; return cp; } // CS_DROPSHADOW
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        using var path = Gfx.Round(new RectangleF(0, 0, Width, Height), Theme.S(16));
        Region = new Region(path);
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing) { spin.Dispose(); titleFont.Dispose(); tagFont.Dispose(); statusFont.Dispose(); smallFont.Dispose(); iconFont.Dispose(); }
        base.Dispose(disposing);
    }

    /// <summary>Opens the splash on a background STA thread and returns once it is on screen (or after 3 s at most).</summary>
    public static SplashForm? Start()
    {
        SplashForm? form = null;
        using var ready = new ManualResetEventSlim(false);
        var t = new Thread(() =>
        {
            try
            {
                form = new SplashForm();
                form.Shown += (_, _) => ready.Set();
                form.HandleCreated += (_, _) => ready.Set();
                Application.Run(form);
            }
            catch { }
            finally { ready.Set(); }
        }) { IsBackground = true, Name = "PdfStudio.Splash" };
        t.SetApartmentState(ApartmentState.STA);
        t.Start();
        ready.Wait(3000);
        return form;
    }

    public void SetStatus(string text)
    {
        try { if (IsHandleCreated && !IsDisposed) BeginInvoke(() => { status = text; Invalidate(); }); } catch { }
    }

    private volatile bool closing;

    /// <summary>Closes the loader and ends its message loop. Safe to call from any thread, any number of times.</summary>
    public void CloseSplash()
    {
        if (closing) return;
        closing = true;
        try
        {
            if (IsDisposed) return;
            if (IsHandleCreated)
                BeginInvoke(() =>
                {
                    try { spin.Stop(); TopMost = false; Hide(); Close(); } catch { }
                    try { Application.ExitThread(); } catch { }   // guarantees the splash thread's message loop ends
                });
            else
                Shown += (_, _) => { try { Close(); Application.ExitThread(); } catch { } };
        }
        catch { }
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.Clear(Theme.Surface);
        Gfx.DrawRound(g, Theme.Border, new RectangleF(0.5f, 0.5f, Width - 2, Height - 2), Theme.S(16));

        var flags = TextFormatFlags.NoPadding | TextFormatFlags.NoPrefix | TextFormatFlags.SingleLine | TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis;
        int S(int v) => Theme.S(v);

        // logo tile
        var tile = S(68);
        var tileRect = new RectangleF((Width - tile) / 2f, S(34), tile, tile);
        Gfx.FillRound(g, Theme.Accent, tileRect, S(18));
        TextRenderer.DrawText(g, "\uE8A5", iconFont, Rectangle.Round(tileRect), Color.White, flags);

        // name + tagline
        TextRenderer.DrawText(g, "PDF Studio", titleFont, new Rectangle(S(20), S(116), Width - S(40), S(36)), Theme.Text, flags);
        TextRenderer.DrawText(g, "Merge · Reorder · Edit · Convert", tagFont, new Rectangle(S(20), S(152), Width - S(40), S(22)), Theme.Muted, flags);

        // spinner: faint ring + rotating accent arc
        var d = S(30);
        var ring = new RectangleF((Width - d) / 2f, S(192), d, d);
        using (var back = new Pen(Theme.Border, S(3))) g.DrawEllipse(back, ring);
        using (var arc = new Pen(Theme.Accent, S(3)) { StartCap = LineCap.Round, EndCap = LineCap.Round }) g.DrawArc(arc, ring, angle, 100f);

        // status + version
        TextRenderer.DrawText(g, status, statusFont, new Rectangle(S(20), S(232), Width - S(40), S(22)), Theme.Muted, flags);
        TextRenderer.DrawText(g, $"Version {AppInfo.Version}", smallFont, new Rectangle(S(20), S(262), Width - S(40), S(20)), Theme.Muted, flags);
    }
}
