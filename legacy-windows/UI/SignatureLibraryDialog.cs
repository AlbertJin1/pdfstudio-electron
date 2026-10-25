using PdfStudio.Services;

namespace PdfStudio.UI;

/// <summary>Your saved signatures: pick one to insert, add a picture, draw a new one, rename or delete.</summary>
public sealed class SignatureLibraryDialog : ModernDialog
{
    private const int ThumbW = 168, ThumbH = 64;

    private readonly ListView list = new()
    {
        View = View.LargeIcon, MultiSelect = false, HideSelection = false, LabelEdit = true,
        BorderStyle = BorderStyle.FixedSingle, Dock = DockStyle.Fill
    };
    private readonly ImageList images = new() { ImageSize = new Size(ThumbW, ThumbH), ColorDepth = ColorDepth.Depth32Bit };
    private readonly Txt empty = new("No saved signatures yet.\nUse “Add picture…” to import your signature, or “Draw…” to sign with the mouse or a pen.", 10f, FontStyle.Regular, true)
    {
        Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleCenter
    };
    private readonly FlatButton renameBtn = new() { Text = "Rename", Width = 90, Height = 32 };
    private readonly FlatButton deleteBtn = new() { Text = "Delete", Width = 90, Height = 32, DangerStyle = true };

    /// <summary>The signature selected when the dialog returned OK.</summary>
    public SavedSignature? Chosen { get; private set; }

    public SignatureLibraryDialog()
        : base("My signatures", "Saved on this computer. They are here every time you open PDF Studio.", 620, "Insert")
    {
        var addImg = new FlatButton { Text = "Add picture…", Width = 130, Height = 32 };
        var draw = new FlatButton { Text = "Draw…", Width = 90, Height = 32 };
        addImg.Click += (_, _) => AddPicture();
        draw.Click += (_, _) => DrawNew();
        renameBtn.Click += (_, _) => { if (list.SelectedItems.Count > 0) list.SelectedItems[0].BeginEdit(); };
        deleteBtn.Click += (_, _) => DeleteSelected();

        var tools = new FlowLayoutPanel { Dock = DockStyle.Fill, Height = 44, BackColor = Color.Transparent, WrapContents = false };
        tools.Controls.AddRange(new Control[] { addImg, draw, renameBtn, deleteBtn });

        list.LargeImageList = images;
        list.BackColor = Theme.Input; list.ForeColor = Theme.Text;
        list.SelectedIndexChanged += (_, _) => UpdateButtons();
        list.DoubleClick += (_, _) => { if (list.SelectedItems.Count > 0) OkBtn.PerformClick(); };
        list.AfterLabelEdit += OnAfterLabelEdit;
        list.KeyDown += (_, e) =>
        {
            if (e.KeyCode == Keys.Delete && !e.Handled) { DeleteSelected(); e.Handled = true; }
            else if (e.KeyCode == Keys.F2 && list.SelectedItems.Count > 0) { list.SelectedItems[0].BeginEdit(); e.Handled = true; }
        };

        var body = new Panel { Dock = DockStyle.Fill, BackColor = Color.Transparent };
        body.Controls.Add(empty);
        body.Controls.Add(list);

        var layout = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 2, BackColor = Color.Transparent };
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        layout.Controls.Add(tools, 0, 0);
        layout.Controls.Add(body, 0, 1);

        FixedBodyHeight = 360;
        Root.Controls.Add(layout);
        layout.BringToFront();
        Reload(null);
    }

    private void Reload(string? selectId)
    {
        list.BeginUpdate();
        try
        {
            list.Items.Clear();
            images.Images.Clear();
            foreach (var sig in SignatureStore.List())
            {
                using var thumb = SignatureStore.Thumbnail(sig.Path, ThumbW, ThumbH);
                images.Images.Add(thumb);
                var item = new ListViewItem(sig.Name, images.Images.Count - 1) { Tag = sig, ToolTipText = sig.Name };
                list.Items.Add(item);
                if (sig.Id == selectId) item.Selected = true;
            }
        }
        finally { list.EndUpdate(); }
        if (selectId == null && list.Items.Count > 0) list.Items[0].Selected = true;
        empty.Visible = list.Items.Count == 0;
        list.Visible = list.Items.Count > 0;
        UpdateButtons();
    }

    private void UpdateButtons()
    {
        var has = list.SelectedItems.Count > 0;
        renameBtn.Enabled = has; deleteBtn.Enabled = has;
    }

    private void AddPicture()
    {
        var sig = SignatureImportDialog.Pick(this);
        if (sig != null) Reload(sig.Id);
    }

    private void DrawNew()
    {
        using var dlg = new SignatureDialog(offerRemember: false);
        if (dlg.ShowDialog(this) != DialogResult.OK || dlg.PngPath == null) return;
        try { Reload(SignatureStore.AddFromFile(dlg.PngPath, null).Id); }
        catch (Exception ex) { MessageBox.Show(this, "The signature couldn't be saved: " + ex.Message, Text, MessageBoxButtons.OK, MessageBoxIcon.Warning); }
    }

    private void DeleteSelected()
    {
        if (list.SelectedItems.Count == 0 || list.SelectedItems[0].Tag is not SavedSignature sig) return;
        var ask = MessageBox.Show(this, $"Delete “{sig.Name}” from your saved signatures?\n\nSignatures already placed on a page are not affected.",
            Text, MessageBoxButtons.YesNo, MessageBoxIcon.Question);
        if (ask != DialogResult.Yes) return;
        SignatureStore.Delete(sig.Id);
        Reload(null);
    }

    private void OnAfterLabelEdit(object? sender, LabelEditEventArgs e)
    {
        var item = list.Items[e.Item];
        e.CancelEdit = true;                       // we set the (cleaned) text ourselves
        if (item.Tag is not SavedSignature sig || string.IsNullOrWhiteSpace(e.Label)) return;
        var renamed = SignatureStore.Rename(sig.Id, e.Label);
        if (renamed == null) return;
        item.Tag = renamed; item.Text = renamed.Name; item.ToolTipText = renamed.Name;
    }

    protected override bool ValidateInput(out string error)
    {
        error = "";
        if (list.SelectedItems.Count == 0 || list.SelectedItems[0].Tag is not SavedSignature sig)
        {
            error = list.Items.Count == 0 ? "Add or draw a signature first." : "Select a signature to insert.";
            return false;
        }
        if (!File.Exists(sig.Path)) { error = "That signature file is missing. Delete it and add it again."; return false; }
        Chosen = sig;
        return true;
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing) images.Dispose();
        base.Dispose(disposing);
    }
}
