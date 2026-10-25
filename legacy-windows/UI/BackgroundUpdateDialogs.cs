using PdfStudio.Services;

namespace PdfStudio.UI;

/// <summary>A modeless progress window. Closing it hides the window; it never cancels the background transfer.</summary>
public sealed class UpdateDownloadDialog : Form
{
    private readonly ProgressBar progress = new() { Style = ProgressBarStyle.Continuous, Minimum = 0, Maximum = 1000, Dock = DockStyle.Fill };
    private readonly Txt stateText = new("Preparing update…", 10f, FontStyle.Bold) { Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleLeft, AutoEllipsis = true };
    private readonly Txt detailText = new("The download continues if this window is hidden.", 9f, FontStyle.Regular, true) { Dock = DockStyle.Fill, TextAlign = ContentAlignment.TopLeft, AutoEllipsis = true };
    private readonly FlatButton retry = new() { Text = "Retry download", Kind = BtnKind.Secondary, Height = 38, AutoWidth = true, MinWidth = 130, Visible = false };
    private readonly FlatButton hide = new() { Text = "Hide window", Kind = BtnKind.Primary, Height = 38, AutoWidth = true, MinWidth = 124 };
    private bool allowClose;

    public event Action<UpdateInfo>? RetryRequested;

    private static int S(int v) => Theme.S(v);

    public UpdateDownloadDialog(UpdateInfo update)
    {
        AutoScaleMode = AutoScaleMode.None;
        Text = "PDF Studio — Background update";
        Font = Theme.Ui();
        FormBorderStyle = FormBorderStyle.FixedDialog;
        StartPosition = FormStartPosition.CenterParent;
        MaximizeBox = false; MinimizeBox = true; ShowInTaskbar = false;
        BackColor = Theme.Surface; Opacity = 0;
        ClientSize = new Size(S(570), S(250));

        var footer = new Surface { Dock = DockStyle.Bottom, Height = S(66), Padding = new Padding(S(22), S(10), S(22), S(10)), BorderTop = true };
        footer.UseRole(() => Theme.Surface);
        var actions = new FlowLayoutPanel { Dock = DockStyle.Fill, FlowDirection = FlowDirection.RightToLeft, WrapContents = false, BackColor = Color.Transparent, Margin = new Padding(0) };
        retry.Margin = new Padding(S(6), 0, 0, 0);
        hide.Margin = new Padding(S(6), 0, 0, 0);
        retry.Click += (_, _) => { if (BackgroundUpdateService.Current.Update is { } latest) RetryRequested?.Invoke(latest); };
        hide.Click += (_, _) => Hide();
        actions.Controls.Add(hide); actions.Controls.Add(retry); footer.Controls.Add(actions);

        var body = new Surface { Dock = DockStyle.Fill, Padding = new Padding(S(24), S(18), S(24), S(12)) };
        body.UseRole(() => Theme.Surface);
        var layout = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 4, BackColor = Color.Transparent, Margin = new Padding(0) };
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, S(72)));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, S(34)));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, S(30)));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        var subtitle = UpdateService.IsPlatformMigration(update)
            ? $"Portable PDF Studio {update.Version} · {UpdateService.FormatSize(update.Size)} download"
            : update.DeltaSupported
                ? "A compact update is being prepared and downloaded securely."
                : $"PDF Studio {update.Version} · {UpdateService.FormatSize(update.DownloadSize)} download";
        layout.Controls.Add(new UpdateHero("Downloading update in the background", subtitle, UpdateService.CurrentVersion, update.Version) { Dock = DockStyle.Fill }, 0, 0);
        stateText.Margin = new Padding(0, S(4), 0, 0);
        detailText.Margin = new Padding(0, S(2), 0, 0);
        progress.Margin = new Padding(0, S(8), 0, 0);
        layout.Controls.Add(stateText, 0, 1);
        layout.Controls.Add(detailText, 0, 2);
        layout.Controls.Add(progress, 0, 3);
        body.Controls.Add(layout);
        Controls.Add(body); Controls.Add(footer);
        Theme.Apply(body);

        BackgroundUpdateService.StateChanged += OnStateChanged;
        ApplySnapshot(BackgroundUpdateService.Current);
        Shown += (_, _) => { FlatButton.FitTree(this); ModernDialog.FadeIn(this); };
        FormClosed += (_, _) => BackgroundUpdateService.StateChanged -= OnStateChanged;
    }

    public void ShowProgressAgain(IWin32Window owner)
    {
        if (IsDisposed) return;
        ApplySnapshot(BackgroundUpdateService.Current);
        if (!Visible) Show(owner);
        if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
        Activate();
    }

    public void ClosePermanently()
    {
        if (IsDisposed) return;
        allowClose = true;
        Close();
    }

    private void OnStateChanged(BackgroundUpdateSnapshot snapshot)
    {
        if (IsDisposed || !IsHandleCreated) return;
        if (InvokeRequired)
        {
            try { BeginInvoke(new Action(() => ApplySnapshot(snapshot))); } catch { }
        }
        else ApplySnapshot(snapshot);
    }

    private void ApplySnapshot(BackgroundUpdateSnapshot snapshot)
    {
        if (IsDisposed) return;
        if (snapshot.Update is { } update && !string.Equals(Text, $"PDF Studio — Background update {update.Version}", StringComparison.Ordinal))
            Text = $"PDF Studio — Background update {update.Version}";

        progress.Value = Math.Clamp((int)(snapshot.Progress.Fraction * 1000), 0, 1000);
        retry.Visible = snapshot.Status == BackgroundUpdateStatus.Failed;
        hide.Text = snapshot.Status == BackgroundUpdateStatus.Failed ? "Close" : "Hide window";
        switch (snapshot.Status)
        {
            case BackgroundUpdateStatus.Downloading:
                stateText.Text = "Downloading and verifying update…";
                var p = snapshot.Progress;
                var percent = Math.Clamp((int)Math.Round(p.Fraction * 100), 0, 100);
                var received = p.Total > 0
                    ? $"{UpdateService.FormatSize(p.Done)} of {UpdateService.FormatSize(p.Total)} · {percent}%"
                    : $"{percent}% complete";
                detailText.Text = string.IsNullOrWhiteSpace(p.Message) ? received : $"{p.Message}  ·  {received}";
                break;
            case BackgroundUpdateStatus.Failed:
                stateText.Text = "The update could not be downloaded";
                detailText.Text = string.IsNullOrWhiteSpace(snapshot.Error)
                    ? "Check your internet connection and retry."
                    : snapshot.Error + "  You can keep using PDF Studio and retry later.";
                break;
            case BackgroundUpdateStatus.Ready:
                stateText.Text = "Update downloaded and verified";
                detailText.Text = snapshot.Update is { } readyUpdate && UpdateService.IsPlatformMigration(readyUpdate)
                    ? "The portable app is ready. PDF Studio will launch it only after you confirm."
                    : "The update is ready. PDF Studio will not restart until you choose Update now.";
                progress.Value = progress.Maximum;
                break;
        }
    }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        if (!allowClose && e.CloseReason == CloseReason.UserClosing)
        {
            e.Cancel = true;
            Hide(); // critically, do not cancel or dispose the background operation
            return;
        }
        base.OnFormClosing(e);
    }
}

/// <summary>Shown only when a full update is downloaded and verified; it never applies an update by itself.</summary>
public sealed class UpdateReadyDialog : Form
{
    private readonly FlatButton later, updateNow;

    private static int S(int v) => Theme.S(v);

    public UpdateReadyDialog(UpdateInfo update)
    {
        AutoScaleMode = AutoScaleMode.None;
        var migration = UpdateService.IsPlatformMigration(update);
        Text = migration ? "Upgrade to PDF Studio 3" : "PDF Studio update ready";
        Font = Theme.Ui();
        FormBorderStyle = FormBorderStyle.FixedDialog;
        StartPosition = FormStartPosition.CenterParent;
        MaximizeBox = false; MinimizeBox = false; ShowInTaskbar = false; KeyPreview = true;
        BackColor = Theme.Surface; Opacity = 0;
        ClientSize = new Size(S(650), S(520));

        var footer = new Surface { Dock = DockStyle.Bottom, Height = S(72), Padding = new Padding(S(26), S(12), S(26), S(12)), BorderTop = true };
        footer.UseRole(() => Theme.Surface);
        var actions = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 3, RowCount = 1, BackColor = Color.Transparent, Margin = new Padding(0) };
        actions.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        actions.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        actions.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        actions.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        later = new FlatButton { Text = "Update later", Kind = BtnKind.Secondary, Height = S(42), AutoWidth = true, MinWidth = 122, Margin = new Padding(S(6), 0, 0, 0) };
        updateNow = new FlatButton { Text = migration ? "Open portable app" : "Update now", Glyph = "\uE896", Kind = BtnKind.Primary, Height = S(42), AutoWidth = true, MinWidth = migration ? 156 : 144, Margin = new Padding(S(8), 0, 0, 0) };
        later.Click += (_, _) => { DialogResult = DialogResult.Cancel; Close(); };
        updateNow.Click += (_, _) => { DialogResult = DialogResult.OK; Close(); };
        actions.Controls.Add(later, 1, 0); actions.Controls.Add(updateNow, 2, 0);
        footer.Controls.Add(actions);
        AcceptButton = updateNow; CancelButton = later;

        var body = new Surface { Dock = DockStyle.Fill, Padding = new Padding(S(26), S(20), S(26), S(10)) };
        body.UseRole(() => Theme.Surface);
        var layout = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 4, BackColor = Color.Transparent, Margin = new Padding(0) };
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, S(78)));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, S(44)));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, S(26)));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        layout.Controls.Add(new UpdateHero(migration ? "Your desktop upgrade is ready" : "Your update is ready", migration ? $"PDF Studio {update.Version} has been downloaded and verified." : $"PDF Studio {update.Version} has been downloaded and verified.", UpdateService.CurrentVersion, update.Version) { Dock = DockStyle.Fill }, 0, 0);
        var intro = new Txt(migration ? "This launches the verified portable Version 3 app. No setup program or administrator permission is required. If the legacy folder is protected, a user-local portable copy is used." : "Choose when to restart. Nothing will change until you select Update now.", 9.5f, FontStyle.Regular, true)
        { Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleLeft };
        layout.Controls.Add(intro, 0, 1);
        layout.Controls.Add(new Txt("WHAT'S NEW", 9f, FontStyle.Bold, true) { Dock = DockStyle.Fill, TextAlign = ContentAlignment.BottomLeft }, 0, 2);
        var notes = new ReleaseNotesView { Dock = DockStyle.Fill, Margin = new Padding(0, S(5), 0, 0) };
        notes.SetNotes(UpdateNotes.Parse(update.Notes));
        var frame = new Surface { Dock = DockStyle.Fill, Padding = new Padding(1), Margin = new Padding(0) };
        frame.UseRole(() => Theme.Border);
        frame.Controls.Add(notes);
        layout.Controls.Add(frame, 0, 3);
        body.Controls.Add(layout);
        Controls.Add(body); Controls.Add(footer);
        Theme.Apply(body);
        Shown += (_, _) => { FlatButton.FitTree(this); ModernDialog.FadeIn(this); };
    }

    public bool ShouldUpdateNow => DialogResult == DialogResult.OK;
}
