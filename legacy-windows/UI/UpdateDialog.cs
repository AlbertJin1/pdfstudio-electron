using PdfStudio.Services;

namespace PdfStudio.UI;

/// <summary>
/// "Update available" window: shows the release notes, downloads the new version with a progress bar and reports back.
/// It only downloads; the caller (MainForm) swaps the files and restarts, after checking for unsaved work.
/// </summary>
public sealed class UpdateDialog : Form
{
    private readonly UpdateInfo update;
    private readonly ReleaseNotesView notes = new() { Dock = DockStyle.Fill };
    private readonly ProgressBar bar = new() { Style = ProgressBarStyle.Continuous, Minimum = 0, Maximum = 1000, Dock = DockStyle.Fill, Visible = false };
    private readonly Txt status = new("", 8.5f, FontStyle.Regular, true) { Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleLeft, AutoEllipsis = true };
    private readonly Txt detail = new("", 9f, FontStyle.Regular, true) { Dock = DockStyle.Fill, TextAlign = ContentAlignment.BottomLeft, AutoEllipsis = true, Visible = false };
    private readonly FlatButton skip, later, install;
    private CancellationTokenSource? cts;
    private bool busy;

    /// <summary>True once the new exe was downloaded and verified (DownloadedPath is then set).</summary>
    public bool Downloaded { get; private set; }
    public string? DownloadedPath { get; private set; }
    /// <summary>The user chose "Skip this version".</summary>
    public bool SkipRequested { get; private set; }

    private static int S(int v) => Theme.S(v);

    public UpdateDialog(UpdateInfo update)
    {
        this.update = update;
        AutoScaleMode = AutoScaleMode.None;          // sizes are scaled once with Theme.S
        var migration = UpdateService.IsPlatformMigration(update);
        Text = migration ? "Upgrade to PDF Studio 3" : "PDF Studio update";
        Font = Theme.Ui();
        FormBorderStyle = FormBorderStyle.FixedDialog; StartPosition = FormStartPosition.CenterParent;
        MaximizeBox = false; MinimizeBox = false; ShowInTaskbar = false; KeyPreview = true;
        BackColor = Theme.Surface; Opacity = 0;
        ClientSize = new Size(S(640), S(580));

        // footer: status on the left, buttons on the right
        var footer = new Surface { Dock = DockStyle.Bottom, Height = S(72), Padding = new Padding(S(28), 0, S(28), 0), BorderTop = true };
        footer.UseRole(() => Theme.Surface);
        status.Margin = new Padding(0, 0, S(12), 0);
        skip = new FlatButton { Text = "Skip this version", Kind = BtnKind.Secondary, Height = S(40), AutoWidth = true, MinWidth = 140, Margin = new Padding(S(4), 0, 0, 0), Anchor = AnchorStyles.None };
        later = new FlatButton { Text = "Later", Kind = BtnKind.Secondary, Height = S(40), AutoWidth = true, MinWidth = 96, Margin = new Padding(S(4), 0, 0, 0), Anchor = AnchorStyles.None };
        install = new FlatButton { Text = migration ? "Get portable app" : "Update now", Glyph = "\uE896", Kind = BtnKind.Primary, Height = S(40), AutoWidth = true, MinWidth = migration ? 156 : 150, Margin = new Padding(S(8), 0, 0, 0), Anchor = AnchorStyles.None };
        skip.FitNow(); later.FitNow(); install.FitNow();
        skip.Click += (_, _) => { SkipRequested = true; Close(); };
        later.Click += (_, _) => { if (busy) cts?.Cancel(); else Close(); };      // while downloading, "Later" becomes "Cancel"
        install.Click += async (_, _) => await InstallAsync();
        var row = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 4, RowCount = 1, BackColor = Color.Transparent, Margin = new Padding(0) };
        row.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        row.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        row.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        row.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        row.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        row.Controls.Add(status, 0, 0); row.Controls.Add(skip, 1, 0); row.Controls.Add(later, 2, 0); row.Controls.Add(install, 3, 0);
        footer.Controls.Add(row);
        AcceptButton = install; CancelButton = later;
        status.Text = DownloadSizeText();

        // body
        var body = new Surface { Dock = DockStyle.Fill, Padding = new Padding(S(28), S(22), S(28), S(8)) };
        body.UseRole(() => Theme.Surface);
        var layout = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 5, BackColor = Color.Transparent };
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, S(76)));    // hero: icon, title, version chips
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, S(30)));    // "What's new" + number of changes
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));       // release notes
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, S(22)));    // "12.3 of 28.9 MB · 42% · 2.1 MB/s · 8 s left"
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, S(26)));    // progress bar

        layout.Controls.Add(new UpdateHero(migration ? "Move to PDF Studio 3" : "A new version is available", DownloadSubtitle(), UpdateService.CurrentVersion, update.Version) { Dock = DockStyle.Fill }, 0, 0);

        var parsed = UpdateNotes.Parse(update.Notes);
        var whatsNew = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2, RowCount = 1, BackColor = Color.Transparent, Margin = new Padding(0) };
        whatsNew.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        whatsNew.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        whatsNew.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        whatsNew.Controls.Add(new Txt("What's new", 10.5f, FontStyle.Bold) { Dock = DockStyle.Fill, TextAlign = ContentAlignment.BottomLeft }, 0, 0);
        if (parsed.Count > 0)
            whatsNew.Controls.Add(new Txt(parsed.Count == 1 ? "1 change" : $"{parsed.Count} changes", 9f, FontStyle.Regular, true) { AutoSize = true, Anchor = AnchorStyles.Bottom | AnchorStyles.Right, Margin = new Padding(0, 0, 0, S(2)) }, 1, 0);
        layout.Controls.Add(whatsNew, 0, 1);

        notes.SetNotes(parsed);
        var frame = new Surface { Dock = DockStyle.Fill, Padding = new Padding(1), Margin = new Padding(0, S(6), 0, S(6)) };
        frame.UseRole(() => Theme.Border);
        frame.Controls.Add(notes);
        layout.Controls.Add(frame, 0, 2);
        bar.Margin = new Padding(0, S(8), 0, S(4));
        layout.Controls.Add(detail, 0, 3);
        layout.Controls.Add(bar, 0, 4);
        body.Controls.Add(layout);

        Controls.Add(body); Controls.Add(footer);
        Theme.Apply(body);
        Shown += (_, _) => { FlatButton.FitTree(this); ModernDialog.FadeIn(this); };
    }

    private async Task InstallAsync()
    {
        if (busy) return;
        // Version 3 is a portable Electron EXE. It is staged under LocalAppData first, so protected folders
        // can use the safe fallback without needing an installer or writing beside the legacy executable.
        if (!UpdateService.IsPlatformMigration(update))
        {
            if (!UpdateService.CanSelfUpdate(out var why))
            {
                MessageBox.Show(this, why, "PDF Studio update", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }
        }
        SetBusy(true);
        cts = new CancellationTokenSource();
        var clock = System.Diagnostics.Stopwatch.StartNew();
        long lastDone = 0;
        var progress = new Progress<UpdateProgress>(p =>
        {
            if (IsDisposed) return;
            bar.Value = Math.Clamp((int)(p.Fraction * 1000), 0, 1000);
            switch (p.Phase)
            {
                case UpdatePhase.Fallback:
                    clock.Restart(); lastDone = 0;
                    detail.Text = p.Message ?? "Switching to the full update…";
                    break;
                case UpdatePhase.PreparingDelta:
                    detail.Text = p.Message ?? "Comparing the installed app with the new version…";
                    break;
                case UpdatePhase.ApplyingDelta:
                    detail.Text = p.Message ?? "Rebuilding PDF Studio from changed parts…";
                    break;
                case UpdatePhase.Verifying:
                    detail.Text = p.Message ?? "Checking the download…";
                    break;
                case UpdatePhase.Unpacking:
                    detail.Text = p.Message ?? "Unpacking the update…";
                    break;
                default:
                    if (p.Done < lastDone) clock.Restart();
                    lastDone = p.Done;
                    var prefix = string.IsNullOrWhiteSpace(p.Message) ? "Downloading" : p.Message.TrimEnd('…', '.', ' ');
                    var text = p.Total > 0
                        ? $"{prefix}  {UpdateService.FormatSize(p.Done)} of {UpdateService.FormatSize(p.Total)}  \u00B7  {(100.0 * p.Done / p.Total):0}%"
                        : $"{prefix}  {UpdateService.FormatSize(p.Done)} received";
                    var secs = clock.Elapsed.TotalSeconds;
                    if (secs >= 1.5 && p.Done > 0)
                    {
                        var rate = p.Done / secs;
                        text += $"  \u00B7  {UpdateService.FormatSize((long)rate)}/s";
                        if (p.Total > p.Done && rate > 0)
                        {
                            var left = (p.Total - p.Done) / rate;
                            if (left >= 1) text += left < 90 ? $"  \u00B7  {Math.Ceiling(left):0} s left" : $"  \u00B7  {Math.Ceiling(left / 60):0} min left";
                        }
                    }
                    detail.Text = text;
                    break;
            }
        });
        try
        {
            DownloadedPath = await UpdateService.DownloadAsync(update, progress, cts.Token);
            Downloaded = true; busy = false;
            if (!IsDisposed) { DialogResult = DialogResult.OK; Close(); }
        }
        catch (OperationCanceledException)
        {
            if (!IsDisposed) { SetBusy(false); status.Text = "Download cancelled.  " + DownloadSizeText(); }
        }
        catch (Exception ex)
        {
            if (!IsDisposed) { SetBusy(false); status.Text = "Could not download the update."; MessageBox.Show(this, ex.Message, "PDF Studio update", MessageBoxButtons.OK, MessageBoxIcon.Warning); }
        }
    }

    private void SetBusy(bool on)
    {
        busy = on;
        bar.Visible = on; bar.Value = 0;
        install.Enabled = !on; skip.Enabled = !on;
        later.Text = on ? "Cancel" : "Later";
        later.FitNow();
        detail.Visible = on;
        if (on) detail.Text = "Starting download…";
    }

    private string DownloadSubtitle()
    {
        if (UpdateService.IsPlatformMigration(update)) return $"PDF Studio 3 portable app  ·  {UpdateService.FormatSize(update.Size)} download";
        if (update.DeltaSupported) return $"PDF Studio {update.Version} is ready to update  ·  smart update reuses unchanged parts";
        return $"PDF Studio {update.Version} is ready to update  ·  {UpdateService.FormatSize(update.DownloadSize)} download";
    }

    private string DownloadSizeText()
    {
        if (UpdateService.IsPlatformMigration(update)) return "Verified portable EXE · " + UpdateService.FormatSize(update.Size) + " · no installation is required.";
        if (update.DeltaSupported) return "Smart update: unchanged parts are reused; only changed parts are downloaded.";
        if (update.DownloadSize <= 0) return "";
        var text = "Download size: " + UpdateService.FormatSize(update.DownloadSize);
        if (update.Compressed && update.Size > update.ZipSize) text += $"  (compressed; the app is {UpdateService.FormatSize(update.Size)})";
        return text;
    }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        if (busy) cts?.Cancel();                      // closing the window mid-download cancels it
        base.OnFormClosing(e);
    }

    protected override void Dispose(bool disposing) { if (disposing) cts?.Dispose(); base.Dispose(disposing); }
}
