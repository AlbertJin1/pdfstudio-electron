namespace PdfStudio.UI;

public sealed record Choice<T>(string Label, T Value)
{
    public override string ToString() => Label;
}

/// <summary>Base for all dialogs: themed header, two-column form grid, footer with OK / Cancel.</summary>
public abstract class ModernDialog : Form
{
    protected readonly Surface Root = new() { Dock = DockStyle.Fill, Padding = new Padding(24, 4, 24, 8) };
    protected readonly TableLayoutPanel Grid = new()
    {
        Dock = DockStyle.Top, AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink, ColumnCount = 2, BackColor = Color.Transparent
    };
    protected readonly FlatButton OkBtn = new() { Kind = BtnKind.Primary, Width = 120, Height = 36, Margin = Padding.Empty };
    // both buttons: identical height and zero vertical margin so they sit on one line; the gap between them is Cancel's right margin
    protected readonly FlatButton CancelBtn = new() { Text = "Cancel", Kind = BtnKind.Secondary, Width = 96, Height = 36, DialogResult = DialogResult.Cancel, Margin = new Padding(0, 0, 10, 0) };
    private readonly Surface header;
    private readonly Surface footer;

    /// <summary>When set, the dialog body uses this height instead of measuring the form grid.</summary>
    protected int? FixedBodyHeight { get; set; }

    /// <summary>A fixed-height block that should grow with the dialog when the user enlarges it.</summary>
    protected Control? StretchTarget { get; set; }
    private int stretchBase, stretchOthers;
    private bool sized;

    protected ModernDialog(string title, string subtitle, int clientWidth, string okText = "OK")
    {
        AutoScaleDimensions = new SizeF(96f, 96f);
        AutoScaleMode = AutoScaleMode.Dpi;
        Text = title; Font = Theme.Ui();
        FormBorderStyle = FormBorderStyle.Sizable; SizeGripStyle = SizeGripStyle.Show; StartPosition = FormStartPosition.CenterParent;
        MaximizeBox = true; MinimizeBox = false; ShowInTaskbar = false; KeyPreview = true;
        ClientSize = new Size(clientWidth, 420);
        BackColor = Theme.Surface;
        Opacity = 0; // faded in from OnShown

        Grid.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 36));
        Grid.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 64));
        Root.UseRole(() => Theme.Surface);
        Root.Controls.Add(Grid);

        header = new Surface { Dock = DockStyle.Top, Height = string.IsNullOrEmpty(subtitle) ? 56 : 80, Padding = new Padding(24, 18, 24, 4) };
        header.UseRole(() => Theme.Surface);
        var sub = new Txt(subtitle, 9.5f, FontStyle.Regular, true) { Dock = DockStyle.Top, Height = 24 };
        var head = new Txt(title, 15f, FontStyle.Bold) { Dock = DockStyle.Top, Height = 34 };
        if (!string.IsNullOrEmpty(subtitle)) header.Controls.Add(sub);
        header.Controls.Add(head);

        footer = new Surface { Dock = DockStyle.Bottom, Height = 66, Padding = new Padding(24, 15, 24, 15), BorderTop = true };
        footer.UseRole(() => Theme.Surface);
        var flow = new FlowLayoutPanel { Dock = DockStyle.Fill, FlowDirection = FlowDirection.RightToLeft, WrapContents = false, BackColor = Color.Transparent, Padding = Padding.Empty, Margin = Padding.Empty };
        OkBtn.Text = okText;
        OkBtn.Click += (_, _) =>
        {
            if (!ValidateInput(out var error)) { MessageBox.Show(this, error, Text, MessageBoxButtons.OK, MessageBoxIcon.Warning); return; }
            DialogResult = DialogResult.OK; Close();
        };
        flow.Controls.Add(OkBtn); flow.Controls.Add(CancelBtn);
        CancelBtn.TabIndex = 0; OkBtn.TabIndex = 1;      // keyboard order follows the screen: Cancel, then the primary action
        footer.Controls.Add(flow);

        AcceptButton = OkBtn; CancelButton = CancelBtn;
        Controls.Add(Root); Controls.Add(footer); Controls.Add(header);
    }

    protected virtual bool ValidateInput(out string error) { error = ""; return true; }

    /// <summary>Puts a control (usually a short summary label) at the left end of the footer, opposite the buttons.</summary>
    protected void AddFooterNote(Control note) { note.Dock = DockStyle.Left; footer.Controls.Add(note); }

    protected override void OnLoad(EventArgs e)
    {
        base.OnLoad(e);
        Theme.Apply(Root);
    }

    protected override void OnShown(EventArgs e)
    {
        base.OnShown(e);
        // Sized after DPI auto-scaling has been applied, so pixel values are final.
        var k = DeviceDpi / 96f;
        var bodyW = Math.Max(100, Root.ClientSize.Width - Root.Padding.Horizontal);
        var bodyH = FixedBodyHeight is { } f ? (int)(f * k) : Grid.GetPreferredSize(new Size(bodyW, 0)).Height;
        var total = header.Height + footer.Height + Root.Padding.Vertical + bodyH + 10;
        var wa = Screen.FromControl(this).WorkingArea;
        var maxH = wa.Height - 40;
        var maxW = wa.Width - 40;
        if (total > maxH) Root.AutoScrollMinSize = new Size(0, bodyH + Root.Padding.Vertical);   // small screens: scroll instead of clipping
        ClientSize = new Size(Math.Min(ClientSize.Width, maxW), Math.Min(total, maxH));
        MinimumSize = new Size(Math.Min(Width, wa.Width), Math.Min(Height, wa.Height));
        if (StretchTarget is not null)
        {
            stretchBase = StretchTarget.Height;
            stretchOthers = Grid.GetPreferredSize(new Size(bodyW, 0)).Height - stretchBase;
        }
        sized = true;
        try { CenterToParent(); } catch { }
        FadeIn(this);
    }

    protected override void OnResize(EventArgs e)
    {
        base.OnResize(e);
        if (!sized || StretchTarget is null) return;
        var free = Root.ClientSize.Height - Root.Padding.Vertical - stretchOthers - 6;
        var h = Math.Max(stretchBase, free);
        if (StretchTarget.Height != h) StretchTarget.Height = h;
    }

    /// <summary>Quick fade-in used by every dialog (the form starts fully transparent).</summary>
    internal static void FadeIn(Form form)
    {
        var timer = new System.Windows.Forms.Timer { Interval = 15 };
        timer.Tick += (_, _) =>
        {
            if (form.IsDisposed) { timer.Stop(); timer.Dispose(); return; }
            form.Opacity = Math.Min(1.0, form.Opacity + 0.16);
            if (form.Opacity >= 1.0) { timer.Stop(); timer.Dispose(); }
        };
        timer.Start();
    }

    // ───────── form helpers ─────────

    protected int NextRow()
    {
        Grid.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        return Grid.RowCount++;
    }

    protected void AddRow(string label, Control control)
    {
        var r = NextRow();
        var l = new Txt(label) { AutoSize = true, Anchor = AnchorStyles.Left, Margin = new Padding(0, 6, 8, 6), Muted = true };
        l.ForeColor = Theme.Muted;
        control.Margin = new Padding(0, 4, 0, 4);
        if (control is not CheckBox) control.Dock = DockStyle.Fill;
        Grid.Controls.Add(l, 0, r); Grid.Controls.Add(control, 1, r);
    }

    protected void AddWide(Control control, int topMargin = 4)
    {
        var r = NextRow();
        control.Margin = new Padding(0, topMargin, 0, 4);
        if (control.Dock == DockStyle.None && control is not CheckBox && control is not RadioButton) control.Dock = DockStyle.Fill;
        Grid.Controls.Add(control, 0, r); Grid.SetColumnSpan(control, 2);
    }

    protected void AddHeading(string text)
    {
        var t = new Txt(text, 10f, FontStyle.Bold) { AutoSize = true, Margin = new Padding(0, 12, 0, 2) };
        AddWide(t, 10);
    }

    protected void AddNote(string text, int lines = 2)
    {
        var t = new Txt(text, 8.5f, FontStyle.Regular, true) { Height = 16 * lines + 4 };
        AddWide(t, 0);
    }

    protected static ComboBox MakeCombo<T>(params (string Label, T Value)[] items)
    {
        var c = new ModernCombo();
        foreach (var (label, value) in items) c.Items.Add(new Choice<T>(label, value));
        c.SelectedIndex = 0;
        return c;
    }

    protected static void SelectValue<T>(ComboBox c, T value)
    {
        for (var i = 0; i < c.Items.Count; i++)
            if (c.Items[i] is Choice<T> ch && EqualityComparer<T>.Default.Equals(ch.Value, value)) { c.SelectedIndex = i; return; }
    }

    protected static T ValueOf<T>(ComboBox c) => ((Choice<T>)c.SelectedItem!).Value;

    protected static NumericUpDown Num(decimal min, decimal max, decimal value, int decimals = 0, decimal increment = 1m) =>
        new() { Minimum = min, Maximum = max, Value = Math.Clamp(value, min, max), DecimalPlaces = decimals, Increment = increment };

    /// <summary>Text box + Browse… button on one row, for folder paths.</summary>
    protected static (Control Host, TextBox Box) FolderPicker(string initial, string description)
    {
        var host = new TableLayoutPanel { ColumnCount = 2, RowCount = 1, AutoSize = true, BackColor = Color.Transparent };
        host.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        host.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        var box = new TextBox { Text = initial, Dock = DockStyle.Fill, Margin = new Padding(0, 0, 8, 0) };
        var btn = new FlatButton { Text = "Browse…", Width = 92, Height = 30, Margin = new Padding(0) };
        btn.Click += (_, _) =>
        {
            using var d = new FolderBrowserDialog { Description = description, SelectedPath = Directory.Exists(box.Text) ? box.Text : "" };
            if (d.ShowDialog(host.FindForm()) == DialogResult.OK) box.Text = d.SelectedPath;
        };
        host.Controls.Add(box, 0, 0); host.Controls.Add(btn, 1, 0);
        return (host, box);
    }
}
