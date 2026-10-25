using PdfStudio.Services;
using System.Drawing.Drawing2D;

namespace PdfStudio.UI;

/// <summary>
/// Add a signature from a picture file (PNG, JPG, BMP, GIF, TIFF). A picture that already has a transparent background is
/// kept as is; a photo or scan on white paper can have the paper removed. The result is saved to the signature library.
/// </summary>
public sealed class SignatureImportDialog : ModernDialog
{
    /// <summary>Panel that shows a picture over a checkerboard, so transparency is visible.</summary>
    private sealed class CheckerPanel : Panel
    {
        private Bitmap? image;
        public CheckerPanel() { DoubleBuffered = true; ResizeRedraw = true; BorderStyle = BorderStyle.FixedSingle; }
        public void SetImage(Bitmap? bmp) { image = bmp; Invalidate(); }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            var cell = Math.Max(6, (int)(8 * DeviceDpi / 96f));
            using (var a = new SolidBrush(Color.FromArgb(255, 255, 255)))
            using (var b = new SolidBrush(Color.FromArgb(226, 229, 235)))
            {
                g.FillRectangle(a, ClientRectangle);
                for (var y = 0; y * cell < Height; y++)
                    for (var x = 0; x * cell < Width; x++)
                        if ((x + y) % 2 == 1) g.FillRectangle(b, x * cell, y * cell, cell, cell);
            }
            var img = image;
            if (img == null) return;
            const int pad = 10;
            var k = Math.Min((Width - pad * 2) / (double)img.Width, (Height - pad * 2) / (double)img.Height);
            if (k <= 0) return;
            var dw = Math.Max(1, (int)(img.Width * k)); var dh = Math.Max(1, (int)(img.Height * k));
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
            g.DrawImage(img, (Width - dw) / 2, (Height - dh) / 2, dw, dh);
        }
    }

    private readonly TextBox pathBox = new() { ReadOnly = true };
    private readonly TextBox nameBox = new() { MaxLength = 40 };
    private readonly CheckBox removeBg = new() { Text = "Remove the paper background (for a photo or scan)", AutoSize = true };
    private readonly TrackBar strength = new() { Minimum = 0, Maximum = 100, Value = 50, TickFrequency = 25, AutoSize = false, Height = 34 };
    private readonly CheckerPanel preview = new() { Height = 150 };
    private readonly Txt info = new("", 9f, FontStyle.Regular, true) { Height = 22 };
    private Bitmap? source;
    private Bitmap? result;

    /// <summary>The signature that was saved when the dialog returned OK.</summary>
    public SavedSignature? Saved { get; private set; }

    public SignatureImportDialog(string file)
        : base("Add signature picture", "Your signature is saved on this computer and is ready to use every time you open PDF Studio.", 580, "Save signature")
    {
        var host = new TableLayoutPanel { ColumnCount = 2, RowCount = 1, AutoSize = true, BackColor = Color.Transparent };
        host.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        host.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        pathBox.Dock = DockStyle.Fill; pathBox.Margin = new Padding(0, 0, 8, 0);
        var change = new FlatButton { Text = "Change…", Width = 92, Height = 30, Margin = new Padding(0) };
        change.Click += (_, _) =>
        {
            var f = PickFile(this);
            if (f != null) TryLoad(f, showError: true);
        };
        host.Controls.Add(pathBox, 0, 0); host.Controls.Add(change, 1, 0);

        AddRow("Picture", host);
        AddRow("Name", nameBox);
        AddWide(removeBg, 8);
        AddRow("Cleanup", strength);
        AddWide(preview, 6);
        AddWide(info, 2);

        nameBox.Text = SignatureStore.NextName();
        removeBg.CheckedChanged += OnBgToggle;
        strength.ValueChanged += (_, _) => Rebuild();
        TryLoad(file, showError: false);
        if (source == null) throw new InvalidOperationException("That file is not a picture PDF Studio can read.");
    }

    /// <summary>Asks for a picture, then shows this dialog. Returns the saved signature, or null if cancelled.</summary>
    public static SavedSignature? Pick(IWin32Window owner)
    {
        var file = PickFile(owner);
        if (file == null) return null;
        SignatureImportDialog dlg;
        try { dlg = new SignatureImportDialog(file); }
        catch (Exception ex)
        {
            MessageBox.Show(owner, "That picture couldn't be used: " + ex.Message, "Add signature", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return null;
        }
        using (dlg) return dlg.ShowDialog(owner) == DialogResult.OK ? dlg.Saved : null;
    }

    private static string? PickFile(IWin32Window owner)
    {
        using var d = new OpenFileDialog
        {
            Title = "Choose your signature picture",
            Filter = "Pictures (*.png;*.jpg;*.jpeg;*.bmp;*.gif;*.tif;*.tiff)|*.png;*.jpg;*.jpeg;*.bmp;*.gif;*.tif;*.tiff|All files|*.*"
        };
        return d.ShowDialog(owner) == DialogResult.OK ? d.FileName : null;
    }

    private void TryLoad(string file, bool showError)
    {
        Bitmap bmp;
        try { bmp = SignatureStore.LoadSource(file); }
        catch (Exception ex)
        {
            if (showError) MessageBox.Show(this, "That picture couldn't be used: " + ex.Message, Text, MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return;
        }
        preview.SetImage(null);
        result?.Dispose(); result = null;
        source?.Dispose();
        source = bmp;
        pathBox.Text = file;

        var transparent = SignatureStore.HasTransparency(source);
        removeBg.CheckedChanged -= OnBgToggle;
        removeBg.Checked = !transparent;
        removeBg.CheckedChanged += OnBgToggle;
        Rebuild(transparent ? "This picture already has a transparent background, so it is kept as it is." : null);
    }

    private void OnBgToggle(object? sender, EventArgs e) => Rebuild();

    private void Rebuild(string? message = null)
    {
        if (source == null) return;
        strength.Enabled = removeBg.Checked;
        Bitmap? fresh = null;
        try { fresh = SignatureStore.Process(source, removeBg.Checked, strength.Value); }
        catch { }
        var old = result;
        result = fresh;
        preview.SetImage(result);
        old?.Dispose();

        if (result == null) info.Text = "Nothing visible was found. Try changing the background setting or the cleanup slider.";
        else if (message != null) info.Text = message;
        else info.Text = removeBg.Checked
            ? "The checkerboard shows what is transparent. Raise Cleanup if shadows or paper texture remain."
            : "The picture is used exactly as it is.";
    }

    protected override bool ValidateInput(out string error)
    {
        error = "";
        if (source == null || result == null)
        {
            error = "There is no visible signature in this picture yet. Change the background setting or choose another picture.";
            return false;
        }
        try { Saved = SignatureStore.Add(result, nameBox.Text); }
        catch (Exception ex) { error = "The signature couldn't be saved: " + ex.Message; return false; }
        return true;
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing) { preview.SetImage(null); result?.Dispose(); source?.Dispose(); result = null; source = null; }
        base.Dispose(disposing);
    }
}
