using PdfStudio.Models;
using PdfStudio.Services;
using System.Diagnostics;

namespace PdfStudio.UI;

public sealed partial class MainForm
{
    private int tempCounter;

    // ───────────────────────── infrastructure ─────────────────────────

    private async void Fire(Task task)
    {
        try { await task; }
        catch (Exception ex) { ShowError(ex); }
    }

    private void SetStatus(string text) => statusText.Text = text;

    /// <summary>Status-bar message plus a small toast over the page grid.</summary>
    private void Notify(string text, bool good = true)
    {
        SetStatus(text);
        if (grid.Visible) grid.ShowToast(text, good);
    }

    private void ShowError(Exception ex) =>
        MessageBox.Show(this, Friendly(ex), "PDF Studio", MessageBoxButtons.OK, MessageBoxIcon.Error);

    private static string Friendly(Exception ex) =>
        ex.Message.Contains("password", StringComparison.OrdinalIgnoreCase)
            ? "This PDF is password-protected. Add it again and enter its password when asked."
            : ex.Message;

    private async Task<bool> RunBusy(string message, Action work)
    {
        busy = true; busyBar.Visible = true; SetStatus(message);
        header.Enabled = false; ribbon.Enabled = false; UseWaitCursor = true;
        try { await Task.Run(work); SetStatus("Done."); return true; }
        catch (Exception ex) { ShowError(ex); SetStatus("Operation failed."); return false; }
        finally
        {
            busy = false; busyBar.Visible = false; UseWaitCursor = false;
            header.Enabled = true; ribbon.Enabled = true; UpdateUi();
            if (pendingReadyUpdatePrompt is { } pending)
            {
                pendingReadyUpdatePrompt = null;
                if (pending.Update is { } ready && pending.DownloadedPath is { } path)
                    ShowUpdateReadyPrompt(ready, path, false);
            }
        }
    }

    private PageSnapshot Snapshot() => new() { Pages = pages.ToList(), Selected = grid.Selection.ToList() };

    /// <summary>Every page-list change goes through here so undo/redo, selection and preview stay consistent.</summary>
    private void Edit(Action change)
    {
        if (busy || accessDenied || AccessControlService.State == AccessControlService.AccessState.Denied) return;
        history.Push(Snapshot());
        change();
        dirty = true;
        AfterChange();
    }

    private void AfterChange()
    {
        grid.NotifyPagesChanged();
        lastPreviewSig = "";
        UpdateUi();
        ShowPreview(true);
    }

    private PageItem? ActivePage() { var i = grid.ActiveIndex; return i >= 0 && i < pages.Count ? pages[i] : null; }

    private List<PageItem> Targets()
    {
        var sel = grid.SelectedPages();
        if (sel.Count > 0) return sel;
        return ActivePage() is { } a ? new List<PageItem> { a } : new List<PageItem>();
    }

    private void UpdateUi()
    {
        if (undoBtn is null) return;
        var has = pages.Count > 0;
        var target = has && (grid.Selection.Count > 0 || grid.ActiveIndex >= 0);
        var pdfAccess = !accessDenied && AccessControlService.State != AccessControlService.AccessState.Denied;

        undoBtn.Enabled = pdfAccess && history.CanUndo;
        redoBtn.Enabled = pdfAccess && history.CanRedo;
        rotLBtn.Enabled = rotRBtn.Enabled = delBtn.Enabled = pdfAccess && target;
        arrangeBtn.Enabled = annotateBtn.Enabled = pdfAccess && target;
        selectBtn.Enabled = pdfAccess;
        pagesBtn.Enabled = pdfAccess;
        extractMenuBtn.Enabled = moreBtn.Enabled = pdfAccess && has;
        newBtn.Enabled = pdfAccess && has;
        editBtn.Enabled = pdfAccess && has;
        exportBtn.Enabled = pdfAccess && has;
        pageSizeBtn.Enabled = pdfAccess && has;
        convertBtn.Enabled = addBtn.Enabled = pdfAccess;
        emptyAddPdfBtn.Enabled = emptyAddImageBtn.Enabled = pdfAccess;

        zoomOutBtn.Enabled = zoomInBtn.Enabled = fitToggle.Enabled = previewToggle.Enabled = pdfAccess;
        sizeBar.Enabled = pdfAccess;
        preview.SetFeatureAccess(pdfAccess);
        grid.Enabled = pdfAccess;

        emptyState.Visible = !has; grid.Visible = has;
        countText.Text = has ? $"{pages.Count} page(s)  •  {grid.Selection.Count} selected" : "";
        Text = has ? $"PDF Studio — {pages.Count} page(s)" : "PDF Studio";
        if (!has && !busy && !accessDenied) SetStatus("Add PDFs or images to begin.");

        // show / hide the preview pane when the document goes from empty to non-empty (and back)
        if (has != hadPages)
        {
            hadPages = has;
            if (IsHandleCreated && split.Width > 0) ApplyPreviewVisibility();
        }
    }

    /// <summary>Ribbon "Page size": pick one page size (and fit mode) for the whole exported PDF.</summary>
    private void ChoosePageSize()
    {
        if (busy) return;
        using var dlg = new PageSizeDialog(exportOptions.Layout, pages.ToList());
        if (dlg.ShowDialog(this) != DialogResult.OK) return;
        exportOptions.Layout = dlg.Result;
        RefreshPageSizeButton();
        Notify(exportOptions.Layout.IsOriginal
            ? "Pages keep their own sizes."
            : $"All pages will be exported as {PageSizing.Name(exportOptions.Layout)}.");
    }

    private void RefreshPageSizeButton()
    {
        pageSizeBtn.Active = !exportOptions.Layout.IsOriginal;
        pageSizeBtn.Invalidate();
    }

    private void ShowPreview(bool force)
    {
        var p = ActivePage();
        var sig = p is null ? "" : $"{p.Id}|{p.Rotation}|{p.TextAnnotations.Count}|{p.ImageAnnotations.Count}|{p.Edits.Count}";
        if (!force && sig == lastPreviewSig) return;
        lastPreviewSig = sig;
        preview.ShowPage(p);
    }

    private static string Ext(string path) => Path.GetExtension(path).ToLowerInvariant();

    private void Reveal(string path)
    {
        try
        {
            if (File.Exists(path)) Process.Start(new ProcessStartInfo("explorer.exe", $"/select,\"{path}\"") { UseShellExecute = false });
            else if (Directory.Exists(path)) Process.Start(new ProcessStartInfo("explorer.exe", $"\"{path}\"") { UseShellExecute = false });
        }
        catch { }
    }

    private static string FormatSize(string path)
    {
        try
        {
            var b = new FileInfo(path).Length;
            return b >= 1 << 20 ? $"{b / 1048576.0:0.0} MB" : $"{Math.Max(1, b / 1024)} KB";
        }
        catch { return ""; }
    }

    private static string DocumentsFolder => Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments);

    // ───────────────────────── new / fresh start ─────────────────────────

    /// <summary>Ribbon "New": removes every page and the undo history so work starts from a clean slate.</summary>
    private void NewDocument()
    {
        if (busy || pages.Count == 0) return;
        if (dirty && MessageBox.Show(this, "Remove all pages and start a new document?\n\nChanges that haven't been exported will be lost.",
                "PDF Studio", MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return;
        pages.Clear();
        history.Clear();
        grid.ClearSelection();
        dirty = false;
        AfterChange();
        SetStatus("New document. Add PDFs or images to begin.");
    }

    // ───────────────────────── undo / redo ─────────────────────────

    private void Undo() { if (busy) return; if (history.Undo(Snapshot()) is { } s) Restore(s); }
    private void Redo() { if (busy) return; if (history.Redo(Snapshot()) is { } s) Restore(s); }

    private void Restore(PageSnapshot s)
    {
        pages.Clear(); pages.AddRange(s.Pages);
        grid.NotifyPagesChanged();
        grid.SetSelection(s.Selected);
        dirty = true; lastPreviewSig = "";
        UpdateUi(); ShowPreview(true);
    }

    // ───────────────────────── page operations ─────────────────────────

    private void Rotate(int degrees)
    {
        var t = Targets(); if (t.Count == 0) return;
        Edit(() => { foreach (var p in t) p.Rotation = PdfService.Norm(p.Rotation + degrees); });
    }

    private void RotateAll(int degrees)
    {
        if (pages.Count == 0) return;
        Edit(() => { foreach (var p in pages) p.Rotation = PdfService.Norm(p.Rotation + degrees); });
    }

    private void ResetRotation()
    {
        var t = Targets().Where(p => p.Rotation != 0).ToList();
        if (t.Count == 0) { Notify("The selected pages are not rotated."); return; }
        Edit(() => { foreach (var p in t) p.Rotation = 0; });
    }

    private void DeleteByRange()
    {
        if (pages.Count == 0) return;
        var text = InputDialog.Show(this, "Delete pages", $"Pages to delete (1–{pages.Count}), e.g. 2-4, 9  or  odd / even:");
        if (text is null) return;
        List<int> idx;
        try { idx = PageRange.Parse(text, pages.Count).Distinct().ToList(); }
        catch (FormatException ex) { MessageBox.Show(this, ex.Message, "PDF Studio", MessageBoxButtons.OK, MessageBoxIcon.Warning); return; }
        if (idx.Count == 0) return;
        if (idx.Count == pages.Count &&
            MessageBox.Show(this, "That removes every page. Continue?", "PDF Studio", MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return;
        var ids = idx.Select(i => pages[i].Id).ToHashSet();
        Edit(() => pages.RemoveAll(p => ids.Contains(p.Id)));
        Notify($"Deleted {ids.Count} page(s). Ctrl+Z to undo.");
    }

    private void SelectSameSource()
    {
        var t = Targets(); if (t.Count == 0) return;
        var sources = t.Where(p => !p.IsBlank).Select(p => p.SourcePath).ToHashSet(StringComparer.OrdinalIgnoreCase);
        if (sources.Count == 0) return;
        grid.SelectIndices(Enumerable.Range(0, pages.Count).Where(i => !pages[i].IsBlank && sources.Contains(pages[i].SourcePath)));
    }

    private async Task SelectBlankPagesAsync()
    {
        if (pages.Count == 0) return;
        var snapshot = pages.ToList();
        var blanks = new List<int>();
        var ok = await RunBusy("Looking for blank pages…", () =>
        {
            for (var i = 0; i < snapshot.Count; i++)
            {
                var p = snapshot[i];
                try { if (p.IsBlank || images.LooksBlank(p.SourcePath, p.SourcePageIndex)) blanks.Add(i); } catch { }
            }
        });
        if (!ok) return;
        if (blanks.Count == 0) { Notify("No blank pages found."); return; }
        grid.SelectIndices(blanks);
        Notify($"Selected {blanks.Count} blank page(s). Press Delete to remove them.");
    }

    private void DeleteSelected()
    {
        var t = Targets(); if (t.Count == 0) return;
        var first = pages.IndexOf(t[0]);
        var ids = t.Select(p => p.Id).ToHashSet();
        Edit(() => pages.RemoveAll(p => ids.Contains(p.Id)));
        if (pages.Count > 0) grid.SelectOnly(Math.Min(first, pages.Count - 1)); else grid.ClearSelection();
    }

    private void DuplicateSelected()
    {
        var t = Targets(); if (t.Count == 0) return;
        var copies = new List<PageItem>();
        Edit(() =>
        {
            foreach (var p in t)
            {
                var c = p.CloneNewId();
                pages.Insert(pages.IndexOf(p) + 1, c);
                copies.Add(c);
            }
        });
        grid.SetSelection(copies.Select(c => c.Id));
    }

    private void ReversePages()
    {
        var sel = grid.SelectedPages();
        if (sel.Count >= 2)
        {
            var idx = sel.Select(p => pages.IndexOf(p)).OrderBy(i => i).ToList();
            Edit(() =>
            {
                var items = idx.Select(i => pages[i]).Reverse().ToList();
                for (var k = 0; k < idx.Count; k++) pages[idx[k]] = items[k];
            });
        }
        else if (pages.Count >= 2) Edit(() => pages.Reverse());
    }

    private void MoveSelected(int direction)
    {
        var t = Targets(); if (t.Count == 0) return;
        var ids = t.Select(p => p.Id).ToHashSet();
        var idx = pages.Select((p, i) => (p, i)).Where(x => ids.Contains(x.p.Id)).Select(x => x.i).ToList();
        if (direction < 0 && idx[0] == 0) return;
        if (direction > 0 && idx[^1] == pages.Count - 1) return;
        Edit(() =>
        {
            if (direction < 0)
            {
                for (var i = 1; i < pages.Count; i++)
                    if (ids.Contains(pages[i].Id) && !ids.Contains(pages[i - 1].Id)) (pages[i - 1], pages[i]) = (pages[i], pages[i - 1]);
            }
            else
            {
                for (var i = pages.Count - 2; i >= 0; i--)
                    if (ids.Contains(pages[i].Id) && !ids.Contains(pages[i + 1].Id)) (pages[i], pages[i + 1]) = (pages[i + 1], pages[i]);
            }
        });
        grid.EnsureVisible(pages.IndexOf(t[0]));
    }

    private void MoveToEdge(bool toStart)
    {
        var t = Targets(); if (t.Count == 0) return;
        var ids = t.Select(p => p.Id).ToHashSet();
        var moving = pages.Where(p => ids.Contains(p.Id)).ToList();
        var rest = pages.Where(p => !ids.Contains(p.Id)).ToList();
        var result = toStart ? moving.Concat(rest).ToList() : rest.Concat(moving).ToList();
        if (result.Select(p => p.Id).SequenceEqual(pages.Select(p => p.Id))) return;
        Edit(() => { pages.Clear(); pages.AddRange(result); });
        grid.EnsureVisible(pages.IndexOf(moving[0]));
    }

    private void MoveToPosition()
    {
        var t = Targets(); if (t.Count == 0) return;
        var text = InputDialog.Show(this, "Move to page number", $"The first selected page will become this page number (1–{pages.Count}):", (pages.IndexOf(t[0]) + 1).ToString());
        if (text is null) return;
        if (!int.TryParse(text, out var n) || n < 1 || n > pages.Count) { MessageBox.Show(this, $"Enter a number from 1 to {pages.Count}.", "PDF Studio"); return; }
        var ids = t.Select(p => p.Id).ToHashSet();
        var moving = pages.Where(p => ids.Contains(p.Id)).ToList();
        var rest = pages.Where(p => !ids.Contains(p.Id)).ToList();
        var at = Math.Clamp(n - 1, 0, rest.Count);
        rest.InsertRange(at, moving);
        if (rest.Select(p => p.Id).SequenceEqual(pages.Select(p => p.Id))) return;
        Edit(() => { pages.Clear(); pages.AddRange(rest); });
        grid.EnsureVisible(pages.IndexOf(moving[0]));
    }

    /// <summary>Drag-and-drop commit: <paramref name="insertAt"/> is an index into the list as it was before the move.</summary>
    private void OnReorder(IReadOnlyList<PageItem> moving, int insertAt)
    {
        if (busy) return;
        var ids = moving.Select(m => m.Id).ToHashSet();
        var removedBefore = pages.Take(Math.Min(insertAt, pages.Count)).Count(p => ids.Contains(p.Id));
        var result = pages.Where(p => !ids.Contains(p.Id)).ToList();
        result.InsertRange(Math.Clamp(insertAt - removedBefore, 0, result.Count), moving);
        if (result.Select(p => p.Id).SequenceEqual(pages.Select(p => p.Id))) return; // dropped back where it was
        Edit(() => { pages.Clear(); pages.AddRange(result); });
        grid.EnsureVisible(pages.IndexOf(moving[0]));
        Notify($"Moved {moving.Count} page(s). Ctrl+Z to undo.");
    }

    private void SelectByRange()
    {
        if (pages.Count == 0) return;
        var text = InputDialog.Show(this, "Select pages", $"Pages to select (1–{pages.Count}), e.g. 1-3, 5, 8-  or  odd / even:");
        if (text is null) return;
        try { grid.SelectIndices(PageRange.Parse(text, pages.Count).Distinct()); }
        catch (FormatException ex) { MessageBox.Show(this, ex.Message, "PDF Studio", MessageBoxButtons.OK, MessageBoxIcon.Warning); }
    }

    private void InsertBlank()
    {
        using var dlg = new BlankPageDialog();
        if (dlg.ShowDialog(this) != DialogResult.OK) return;
        var active = ActivePage();
        double w, h;
        if (dlg.PageSizeChoice == BlankSize.MatchPage && active is not null) (w, h) = active.DisplaySizePt(true);
        else
        {
            var (mw, mh) = dlg.PageSizeChoice switch
            {
                BlankSize.A3 => ImagePdfService.PageSizeMm(ImagePdfPageSize.A3), BlankSize.A5 => ImagePdfService.PageSizeMm(ImagePdfPageSize.A5),
                BlankSize.Letter => ImagePdfService.PageSizeMm(ImagePdfPageSize.Letter), BlankSize.Legal => ImagePdfService.PageSizeMm(ImagePdfPageSize.Legal),
                _ => ImagePdfService.PageSizeMm(ImagePdfPageSize.A4)
            };
            w = mw * 72 / 25.4; h = mh * 72 / 25.4;
            if (dlg.Landscape != w > h) (w, h) = (h, w);
        }
        var items = Enumerable.Range(0, dlg.Count).Select(_ => PdfService.CreateBlank(w, h)).ToList();
        var at = dlg.Position switch
        {
            BlankPosition.AtStart => 0,
            BlankPosition.AtEnd => pages.Count,
            _ => Targets().Count > 0 ? pages.IndexOf(Targets()[^1]) + 1 : pages.Count
        };
        Edit(() => pages.InsertRange(Math.Clamp(at, 0, pages.Count), items));
        grid.SetSelection(items.Select(i => i.Id));
        grid.EnsureVisible(pages.IndexOf(items[0]));
    }

    private List<PageItem> ScopeTargets(OverlayScope scope) => scope switch
    {
        OverlayScope.AllPages => pages.ToList(),
        OverlayScope.SelectedPages => Targets(),
        _ => ActivePage() is { } a ? new List<PageItem> { a } : new List<PageItem>()
    };

    /// <summary>Opens the Edit PDF window on the active page; the result is stored on the pages (undoable) and written on export.</summary>
    private void EditPdf()
    {
        if (pages.Count == 0 || busy) return;
        var start = Math.Max(0, grid.ActiveIndex);
        using var dlg = new EditorForm(pages, start);
        if (dlg.ShowDialog(this) != DialogResult.OK || !dlg.Changed) return;
        var result = dlg.Result;
        var marginResult = dlg.MarginsResult;
        Edit(() =>
        {
            foreach (var p in pages)
            {
                if (result.TryGetValue(p.Id, out var list)) p.Edits = list.Select(o => o.Clone()).ToList();
                if (marginResult.TryGetValue(p.Id, out var mg)) p.Margins = mg.Clone();
            }
        });
        Notify("Edits saved. They are written into the PDF when you export.");
    }

    private void AddText()
    {
        if (pages.Count == 0) return;
        using var dlg = new TextOverlayDialog(grid.Selection.Count);
        if (dlg.ShowDialog(this) != DialogResult.OK) return;
        var targets = ScopeTargets(dlg.Scope);
        if (targets.Count == 0) { MessageBox.Show(this, "Select a page first.", "PDF Studio"); return; }
        var ann = dlg.Annotation;
        Edit(() => { foreach (var p in targets) p.TextAnnotations.Add(ann.Clone()); });
        Notify($"Text added to {targets.Count} page(s). It is written into the PDF when you export.");
    }

    private void AddImageOverlay()
    {
        if (pages.Count == 0) return;
        using var dlg = new ImageOverlayDialog(grid.Selection.Count);
        if (dlg.ShowDialog(this) != DialogResult.OK) return;
        var targets = ScopeTargets(dlg.Scope);
        if (targets.Count == 0) { MessageBox.Show(this, "Select a page first.", "PDF Studio"); return; }
        var ann = dlg.Annotation;
        Edit(() => { foreach (var p in targets) p.ImageAnnotations.Add(ann.Clone()); });
        Notify($"Image added to {targets.Count} page(s). It is written into the PDF when you export.");
    }

    private void ClearOverlays()
    {
        var t = Targets().Where(p => p.HasOverlays).ToList();
        if (t.Count == 0) { SetStatus("The selected pages have no text or images added."); return; }
        Edit(() => { foreach (var p in t) { p.TextAnnotations.Clear(); p.ImageAnnotations.Clear(); p.Edits.Clear(); } });
        Notify($"Removed added text and images from {t.Count} page(s).");
    }

    // ───────────────────────── importing ─────────────────────────

    /// <summary>Open one picker that accepts PDFs and supported image formats in the same selection.</summary>
    private async Task AddFilesFlow()
    {
        if (busy) return;
        var imagePattern = string.Join(";", ImagePdfService.ImageExtensions.Select(ext => "*" + ext));
        var combinedPattern = "*.pdf;" + imagePattern;
        using var d = new OpenFileDialog
        {
            Filter = $"PDFs and images ({combinedPattern})|{combinedPattern}|PDF files (*.pdf)|*.pdf|Images ({imagePattern})|{imagePattern}",
            FilterIndex = 1,
            Multiselect = true,
            CheckFileExists = true,
            RestoreDirectory = true,
            Title = "Add PDFs and images"
        };
        if (d.ShowDialog(this) == DialogResult.OK) await AddFilesAsync(d.FileNames, -1);
    }

    private async Task AddPdfsFlow()
    {
        if (busy || accessDenied || AccessControlService.State == AccessControlService.AccessState.Denied) return;
        using var d = new OpenFileDialog { Filter = "PDF files (*.pdf)|*.pdf", Multiselect = true, Title = "Add PDF files" };
        if (d.ShowDialog(this) == DialogResult.OK) await AddFilesAsync(d.FileNames, -1);
    }

    /// <summary>"Add images": the pictures become pages in the workspace. No dialog and no PDF file is made here.</summary>
    private async Task PickImagesFlow()
    {
        if (busy) return;
        var imagePattern = string.Join(";", ImagePdfService.ImageExtensions.Select(ext => "*" + ext));
        using var d = new OpenFileDialog
        {
            Filter = $"Image files ({imagePattern})|{imagePattern}",
            Multiselect = true,
            CheckFileExists = true,
            RestoreDirectory = true,
            Title = "Add images as pages"
        };
        if (d.ShowDialog(this) == DialogResult.OK) await AddFilesAsync(d.FileNames, -1);
    }

    /// <summary>Convert › Images → PDF: the explicit converter. Pick pictures, choose the layout, save a PDF file.</summary>
    private async Task ImagesToPdfFlow()
    {
        if (busy) return;
        using var d = new OpenFileDialog { Filter = ImagePdfService.ImageFilter, Multiselect = true, Title = "Choose images to convert" };
        if (d.ShowDialog(this) != DialogResult.OK) return;
        var picked = d.FileNames.Where(f => File.Exists(f) && ImagePdfService.IsImage(f)).ToList();
        if (picked.Count == 0) { SetStatus("Nothing to convert — choose picture files."); return; }
        using var dlg = new ImageToPdfDialog(picked);
        if (dlg.ShowDialog(this) != DialogResult.OK) return;
        await SaveImagesAsPdf(dlg.Images, dlg.Options);
    }

    private async Task InsertPdfAfterSelection()
    {
        if (busy || accessDenied || AccessControlService.State == AccessControlService.AccessState.Denied) return;
        using var d = new OpenFileDialog { Filter = "PDF files (*.pdf)|*.pdf", Multiselect = true, Title = "Insert PDF pages" };
        if (d.ShowDialog(this) != DialogResult.OK) return;
        var t = Targets();
        await AddFilesAsync(d.FileNames, t.Count > 0 ? pages.IndexOf(t[^1]) + 1 : -1);
    }

    /// <summary>Add PDFs and image files to the workspace, preserving their chosen order.</summary>
    private async Task AddFilesAsync(IEnumerable<string> files, int insertAt)
    {
        if (busy || accessDenied || AccessControlService.State == AccessControlService.AccessState.Denied) return;

        var existing = files
            .Where(path => !string.IsNullOrWhiteSpace(path) && File.Exists(path))
            .ToList();
        var unsupported = existing
            .Where(path => Ext(path) != ".pdf" && !ImagePdfService.IsImage(path))
            .ToList();
        var inputs = existing
            .Where(path => Ext(path) == ".pdf" || ImagePdfService.IsImage(path))
            .Select((path, index) => (Index: index, Path: path))
            .ToList();

        if (inputs.Count == 0)
        {
            SetStatus("Nothing to add — choose PDF or image files.");
            if (unsupported.Count > 0)
                MessageBox.Show(this, "These files are not supported and were skipped:\n\n" +
                    string.Join("\n", unsupported.Select(path => Path.GetFileName(path))), "PDF Studio",
                    MessageBoxButtons.OK, MessageBoxIcon.Information);
            return;
        }

        // Each input fills a result slot; PDF pages and image pages are assembled from these slots afterwards so
        // a mixed selection such as PDF → photo → PDF retains the user's intended document order.
        var pageSlots = new List<PageItem>?[inputs.Count];
        var errors = new List<string>();
        var locked = new List<(int Index, string Path)>();
        var pdfInputs = inputs.Where(item => Ext(item.Path) == ".pdf").ToList();
        var imageInputs = inputs.Where(item => ImagePdfService.IsImage(item.Path)).ToList();

        if (pdfInputs.Count > 0)
        {
            var pdfRead = await RunBusy("Reading PDFs…", () =>
            {
                foreach (var item in pdfInputs)
                {
                    try { pageSlots[item.Index] = pdf.LoadPages(item.Path); }
                    catch (Exception ex)
                    {
                        if (PdfPasswords.IsPasswordProblem(ex)) locked.Add(item);
                        else errors.Add($"{Path.GetFileName(item.Path)} — {Friendly(ex)}");
                    }
                }
            });
            if (!pdfRead) return;
        }

        // Password-protected PDFs are prompted on the UI thread, with up to three attempts per file.
        foreach (var item in locked)
        {
            var name = Path.GetFileName(item.Path);
            var unlocked = false;
            for (var attempt = 0; attempt < 3 && !unlocked; attempt++)
            {
                var pw = InputDialog.Show(this, "Password required",
                    $"“{name}” is password-protected. Enter its password" +
                    (attempt > 0 ? " (that one was not accepted)" : "") + ":", "", true);
                if (pw is null) break;
                PdfPasswords.Set(item.Path, pw);
                try
                {
                    pageSlots[item.Index] = pdf.LoadPages(item.Path);
                    unlocked = true;
                    thumbs.RetryFailed();
                }
                catch (Exception ex) when (PdfPasswords.IsPasswordProblem(ex)) { }
                catch (Exception ex)
                {
                    errors.Add($"{name} — {Friendly(ex)}");
                    unlocked = true;
                }
            }
            if (!unlocked) errors.Add($"{name} — skipped (password not provided or not accepted).");
        }

        // An image becomes a page in the workspace; no output PDF is saved until the user chooses Export PDF.
        // Process pictures one at a time to avoid retaining a whole batch of full-resolution images in memory.
        if (imageInputs.Count > 0)
        {
            var opts = new ImagePdfOptions
            {
                PageSize = ImagePdfPageSize.A4,
                Orientation = ImagePdfOrientation.Auto,
                Fit = ImagePdfFit.Contain,
                MarginMm = 10
            };
            var imageErrors = new string?[imageInputs.Count];
            var imageRead = await RunBusy("Adding images…", () =>
            {
                for (var i = 0; i < imageInputs.Count; i++)
                {
                    var item = imageInputs[i];
                    var tmp = Path.Combine(sessionDir, $"Image {Interlocked.Increment(ref tempCounter)}.pdf");
                    try
                    {
                        images.ImagesToPdf(tmp, new[] { item.Path }, opts);
                        ImagePdfService.ImagePageSources[tmp] = new ImagePageSource(item.Path, opts);
                        pageSlots[item.Index] = pdf.LoadPages(tmp, Path.GetFileName(item.Path));
                    }
                    catch (Exception ex)
                    {
                        ImagePdfService.ImagePageSources.TryRemove(tmp, out _);
                        try { if (File.Exists(tmp)) File.Delete(tmp); } catch { }
                        imageErrors[i] = $"{Path.GetFileName(item.Path)} — {Friendly(ex)}";
                    }
                    var done = i + 1;
                    try
                    {
                        if (!IsDisposed && IsHandleCreated)
                            BeginInvoke(() => SetStatus($"Adding images… {done} of {imageInputs.Count}"));
                    }
                    catch { }
                }
            });
            if (!imageRead) return;
            errors.AddRange(imageErrors.Where(error => error is not null).Select(error => error!));
        }

        var added = pageSlots.Where(slot => slot is not null).SelectMany(slot => slot!).ToList();
        errors.AddRange(unsupported.Select(path => $"{Path.GetFileName(path)} — unsupported file type (skipped)."));

        if (added.Count > 0)
        {
            var at = insertAt < 0 || insertAt > pages.Count ? pages.Count : insertAt;
            Edit(() => pages.InsertRange(at, added));

            // Show immediate evidence that import succeeded: select the first newly added page and preview it.
            var firstAddedIndex = pages.IndexOf(added[0]);
            grid.SelectOnly(firstAddedIndex);
            grid.EnsureVisible(firstAddedIndex);
            Notify(imageInputs.Count > 0 && pdfInputs.Count == 0
                ? $"Added {added.Count} image page(s). Nothing is saved until you export."
                : $"Added {added.Count} page(s).");
        }
        else if (errors.Count == 0)
        {
            SetStatus("No pages were added. Check the selected files and try again.");
        }

        if (errors.Count > 0)
            MessageBox.Show(this, "Some files could not be added:\n\n" + string.Join("\n", errors),
                "PDF Studio", MessageBoxButtons.OK, MessageBoxIcon.Warning);
    }

    private async Task SaveImagesAsPdf(IReadOnlyList<string> list, ImagePdfOptions opts)
    {
        using var save = new SaveFileDialog { Filter = "PDF file (*.pdf)|*.pdf", FileName = "Images.pdf" };
        if (save.ShowDialog(this) != DialogResult.OK) return;
        var path = save.FileName;
        if (await RunBusy("Creating PDF…", () => images.ImagesToPdf(path, list, opts)))
        {
            Notify($"Saved {Path.GetFileName(path)} ({FormatSize(path)}).");
            Reveal(path);
        }
    }

    // ───────────────────────── exporting ─────────────────────────

    private static string DefaultName(IReadOnlyList<PageItem> src)
    {
        var names = src.Where(p => !p.IsBlank).Select(p => p.SourcePath).Distinct().ToList();
        return names.Count == 1 ? Path.GetFileNameWithoutExtension(names[0]) + " (edited).pdf" : "Merged document.pdf";
    }

    private async Task ExportAsync(bool selectedOnly)
    {
        var src = selectedOnly ? grid.SelectedPages() : pages.ToList();
        if (src.Count == 0) { MessageBox.Show(this, "Select at least one page first.", "PDF Studio", MessageBoxButtons.OK, MessageBoxIcon.Information); return; }

        using var dlg = new ExportDialog(exportOptions, src.Count, selectedOnly ? "Export selected" : "Export PDF", src);
        if (dlg.ShowDialog(this) != DialogResult.OK) return;
        var opts = dlg.Result;
        using var save = new SaveFileDialog { Filter = "PDF file (*.pdf)|*.pdf", FileName = DefaultName(src) };
        if (save.ShowDialog(this) != DialogResult.OK) return;
        var path = save.FileName;

        var ok = await RunBusy("Building PDF…", () => pdf.Export(path, src, opts));
        opts.UserPassword = ""; opts.OwnerPassword = ""; exportOptions = opts; // never keep passwords around
        RefreshPageSizeButton();
        if (!ok) return;
        if (!selectedOnly) dirty = false;
        var cmp = pdf.LastCompression;
        Notify($"Saved {Path.GetFileName(path)} — {src.Count} page(s), {FormatSize(path)}." + (cmp is { Summary.Length: > 0 } ? " " + cmp.Summary : ""), cmp is not { Reached: false });
        if (cmp is { Reached: false }) MessageBox.Show(this, cmp.Summary, "PDF Studio — compression", MessageBoxButtons.OK, MessageBoxIcon.Information);
        Reveal(path);
    }

    private async Task ExtractSelectedAsync()
    {
        var src = grid.SelectedPages();
        if (src.Count == 0 && ActivePage() is { } a) src = new List<PageItem> { a };
        if (src.Count == 0) { MessageBox.Show(this, "Select the pages to extract first.", "PDF Studio"); return; }
        using var save = new SaveFileDialog { Filter = "PDF file (*.pdf)|*.pdf", FileName = $"Extracted {src.Count} page(s).pdf" };
        if (save.ShowDialog(this) != DialogResult.OK) return;
        var path = save.FileName;
        if (await RunBusy("Extracting pages…", () => pdf.Export(path, src)))
        {
            Notify($"Extracted {src.Count} page(s) to {Path.GetFileName(path)}.");
            Reveal(path);
        }
    }

    private async Task SplitAsync()
    {
        if (pages.Count < 2) return;
        var firstSource = pages.FirstOrDefault(p => !p.IsBlank)?.SourcePath;
        var defFolder = Path.Combine(firstSource is null ? DocumentsFolder : Path.GetDirectoryName(firstSource) ?? DocumentsFolder, "PDF Studio Split");
        using var dlg = new SplitDialog(pages.Count, grid.ActiveIndex, defFolder);
        if (dlg.ShowDialog(this) != DialogResult.OK) return;

        var groups = new List<List<PageItem>>();
        switch (dlg.Mode)
        {
            case SplitMode.EachPage: groups.AddRange(pages.Select(p => new List<PageItem> { p })); break;
            case SplitMode.AtActive:
                var cut = grid.ActiveIndex;
                groups.Add(pages.Take(cut + 1).ToList()); groups.Add(pages.Skip(cut + 1).ToList()); break;
            case SplitMode.Ranges:
                foreach (var g in PageRange.ParseGroups(dlg.Ranges, pages.Count)) groups.Add(g.Select(i => pages[i]).ToList());
                break;
            default:
                var n = Math.Max(1, dlg.EveryN);
                for (var i = 0; i < pages.Count; i += n) groups.Add(pages.Skip(i).Take(n).ToList());
                break;
        }
        var folder = dlg.Folder; var baseName = dlg.BaseName;
        var digits = Math.Max(2, groups.Count.ToString().Length);
        var ok = await RunBusy("Splitting…", () =>
        {
            Directory.CreateDirectory(folder);
            for (var i = 0; i < groups.Count; i++)
                pdf.Export(Path.Combine(folder, $"{baseName}_{(i + 1).ToString().PadLeft(digits, '0')}.pdf"), groups[i]);
        });
        if (ok) { Notify($"Created {groups.Count} file(s) in {folder}."); Reveal(folder); }
    }

    private async Task OpenInViewerAsync()
    {
        if (pages.Count == 0) return;
        var src = grid.Selection.Count > 0 ? grid.SelectedPages() : pages.ToList();
        var o = exportOptions;
        var quick = new ExportOptions
        {
            Title = o.Title, Author = o.Author, Subject = o.Subject, Keywords = o.Keywords,
            PageNumbers = o.PageNumbers, NumberPosition = o.NumberPosition, NumberFormat = o.NumberFormat, StartNumber = o.StartNumber,
            NumberFontSize = o.NumberFontSize, SkipFirstPage = o.SkipFirstPage,
            Watermark = o.Watermark, WatermarkText = o.WatermarkText, WatermarkOpacityPercent = o.WatermarkOpacityPercent,
            WatermarkFontSize = o.WatermarkFontSize, WatermarkAngle = o.WatermarkAngle,
            Layout = o.Layout.Clone()
        };
        var tmp = Path.Combine(sessionDir, $"Preview {++tempCounter}.pdf");
        if (!await RunBusy("Preparing a copy to open…", () => pdf.Export(tmp, src, quick))) return;
        try { Process.Start(new ProcessStartInfo(tmp) { UseShellExecute = true }); Notify($"Opened {src.Count} page(s) in your PDF viewer."); }
        catch (Exception ex) { ShowError(ex); }
    }

    // ───────────────────────── conversions ─────────────────────────

    /// <summary>Resolves the PDF a converter should read: an external file, or the workspace exported to a temp PDF.</summary>
    private async Task<(string? Path, string BaseName)> ResolveSourcePdf(PdfSource source, string externalPath)
    {
        if (source == PdfSource.File) return (externalPath, System.IO.Path.GetFileNameWithoutExtension(externalPath));
        var pgs = source == PdfSource.WorkspaceSelected ? grid.SelectedPages() : pages.ToList();
        var tmp = System.IO.Path.Combine(sessionDir, $"Workspace {++tempCounter}.pdf");
        var ok = await RunBusy("Preparing pages…", () => pdf.Export(tmp, pgs));
        return (ok ? tmp : null, "PDF Studio export");
    }

    private async Task PdfToWordFlow()
    {
        using var dlg = new PdfToWordDialog(pages.Count, grid.Selection.Count);
        if (dlg.ShowDialog(this) != DialogResult.OK) return;
        if (dlg.IncludeFullPageArtwork)
        {
            var choice = MessageBox.Show(this,
                "Full-page artwork adds one large picture behind the Word text. That picture can be selected or dragged in Word and makes the document less editable.\n\nFor normal editable paragraphs, choose No and leave this option off.\n\nContinue with the page-sized picture anyway?",
                "PDF → Word — full-page picture", MessageBoxButtons.YesNo, MessageBoxIcon.Warning, MessageBoxDefaultButton.Button2);
            if (choice != DialogResult.Yes) return;
        }
        var (src, baseName) = await ResolveSourcePdf(dlg.Source, dlg.ExternalPath);
        if (src is null) return;

        using var save = new SaveFileDialog { Filter = "Word document (*.docx)|*.docx", FileName = baseName + ".docx" };
        if (save.ShowDialog(this) != DialogResult.OK) return;
        var target = save.FileName;
        var options = new PdfToWordOptions { GraphicsDpi = dlg.GraphicsDpi, IncludeFullPageArtwork = dlg.IncludeFullPageArtwork, EnableRasterOcr = dlg.EnableRasterOcr };
        PdfToWordResult? result = null;
        if (await RunBusy("Converting PDF → Word…", () =>
        {
            result = toWord.Convert(src, target, options, (done, total) =>
            {
                if (IsHandleCreated && !IsDisposed)
                    try { BeginInvoke(() => SetStatus($"Converting PDF → Word… page {Math.Min(done + 1, total)} of {total}")); } catch { }
            });
        }))
        {
            var note = result is { Warnings.Count: > 0 } ? $" ({result.Warnings.Count} warning(s): {result.Warnings[0]})" : "";
            Notify($"Saved {Path.GetFileName(target)} — {result?.Pages} page(s), {result?.TextLines} editable text line(s), {result?.Tables} table(s).{note}");
            Reveal(target);
        }
    }

    private async Task PdfToImagesFlow()
    {
        using var dlg = new PdfToImagesDialog(pages.Count, grid.Selection.Count,
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyPictures), "PDF Studio"));
        if (dlg.ShowDialog(this) != DialogResult.OK) return;

        List<int>? pageIdx = null;
        if (dlg.Source == PdfSource.File)
        {
            try { pageIdx = PageRange.Parse(dlg.PageRangeText, ImagePdfService.GetPageCount(dlg.ExternalPath)); }
            catch (Exception ex) { MessageBox.Show(this, Friendly(ex), "PDF Studio", MessageBoxButtons.OK, MessageBoxIcon.Warning); return; }
        }
        var (src, baseName) = await ResolveSourcePdf(dlg.Source, dlg.ExternalPath);
        if (src is null) return;

        var opts = new PdfToImageOptions
        {
            Format = dlg.Format, Dpi = dlg.Dpi, Quality = dlg.Quality, Pages = pageIdx,
            Prefix = dlg.Prefix.Length > 0 ? dlg.Prefix : baseName.Replace(' ', '_')
        };
        var folder = dlg.OutputFolder;
        var written = new List<string>();
        if (await RunBusy("Rendering pages to images…", () => written.AddRange(images.PdfToImages(src, folder, opts))))
        {
            Notify($"Saved {written.Count} image(s) to {folder}.");
            if (dlg.OpenWhenDone) Reveal(written.Count > 0 ? written[0] : folder);
        }
    }

    // ───────────────────────── about & help ─────────────────────────

    private void ShowReview()
    {
        using var dlg = new ReviewDialog();
        dlg.ShowDialog(this);
        if (dlg.Sent) Notify(dlg.Pending ? "Thank you! Your review is saved and will be sent when the internet connection returns." : "Thank you! Your review was sent.");
    }

    private void ShowAbout()
    {
        using var dlg = new AboutDialog();
        dlg.ShowDialog(this);
        if (dlg.OpenChangelogRequested) ShowHelp("Version history");
        else if (dlg.OpenHelpRequested) ShowHelp();
        else if (dlg.CheckUpdatesRequested) Fire(CheckForUpdatesAsync(true));
    }

    // ───────────────────────── updates ─────────────────────────

    private bool updateBusy;

    /// <summary>Looks for a newer release. Finding one automatically begins a background download.</summary>
    private async Task CheckForUpdatesAsync(bool manual)
    {
        if (updateBusy) return;
        updateBusy = true;
        try
        {
            var result = await UpdateService.CheckAsync();
            if (IsDisposed) return;
            if (result.Error is not null)
            {
                if (manual) MessageBox.Show(this, result.Error, "Check for updates", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }

            if (result.Update is not { } update)
            {
                if (manual)
                {
                    var message = UpdateService.IsPlatformMigrationInstalled
                        ? "The portable PDF Studio 3 app is already available. Open it from your existing PDF Studio shortcut; this legacy launcher redirects to the portable copy."
                        : $"You are running the latest version ({UpdateService.CurrentVersion}).";
                    MessageBox.Show(this, message, "Check for updates", MessageBoxButtons.OK, MessageBoxIcon.Information);
                }
                return;
            }


            var background = BackgroundUpdateService.Current;
            if (background.Status == BackgroundUpdateStatus.Ready && background.Update is { } ready &&
                string.Equals(ready.Version, update.Version, StringComparison.OrdinalIgnoreCase))
            {
                if (manual) ShowUpdateReadyPrompt(ready, background.DownloadedPath, true);
                return;
            }
            if (background.Status == BackgroundUpdateStatus.Downloading && background.Update is { } downloading &&
                string.Equals(downloading.Version, update.Version, StringComparison.OrdinalIgnoreCase))
            {
                if (manual) ShowUpdateProgressWindow();
                return;
            }

            // No modal dialog and no manual click required. The progress window is modeless and can be closed
            // without cancelling this download.
            BackgroundUpdateService.Start(update);
        }
        catch (Exception ex) { if (manual) ShowError(ex); }
        finally { updateBusy = false; }
    }

    private void OnBackgroundUpdateChanged(BackgroundUpdateSnapshot snapshot)
    {
        if (IsDisposed || !IsHandleCreated) return;
        if (InvokeRequired)
        {
            try { BeginInvoke(new Action(() => HandleBackgroundUpdateState(snapshot))); } catch { }
            return;
        }
        HandleBackgroundUpdateState(snapshot);
    }

    private void HandleBackgroundUpdateState(BackgroundUpdateSnapshot snapshot)
    {
        if (IsDisposed) return;
        var previous = lastBackgroundUpdateStatus;
        lastBackgroundUpdateStatus = snapshot.Status;

        switch (snapshot.Status)
        {
            case BackgroundUpdateStatus.Idle:
                break;

            case BackgroundUpdateStatus.Downloading:
                if (previous != BackgroundUpdateStatus.Downloading)
                {
                    SetStatus($"Downloading PDF Studio {snapshot.Update?.Version ?? "update"} in the background. You can keep working.");
                    ShowUpdateProgressWindow();
                }
                break;

            case BackgroundUpdateStatus.Ready:
                if (snapshot.Update is not { } update || string.IsNullOrWhiteSpace(snapshot.DownloadedPath)) return;
                CloseUpdateProgressWindow();
                if (!File.Exists(snapshot.DownloadedPath))
                {
                    BackgroundUpdateService.Start(update);
                    return;
                }
                SetStatus($"PDF Studio {update.Version} is downloaded and ready. Choose when to update.");
                if (busy) pendingReadyUpdatePrompt = snapshot;
                else ShowUpdateReadyPrompt(update, snapshot.DownloadedPath, false);
                break;

            case BackgroundUpdateStatus.Failed:
                SetStatus($"Could not download PDF Studio {snapshot.Update?.Version ?? "update"}. You can retry from Check for updates.");
                break;
        }
    }

    private void ShowUpdateProgressWindow()
    {
        var state = BackgroundUpdateService.Current;
        if (state.Update is not { } update || state.Status != BackgroundUpdateStatus.Downloading) return;
        if (updateDownloadWindow is null || updateDownloadWindow.IsDisposed)
        {
            updateDownloadWindow = new UpdateDownloadDialog(update);
            updateDownloadWindow.RetryRequested += latest => BackgroundUpdateService.Start(latest);
            updateDownloadWindow.FormClosed += (_, _) => updateDownloadWindow = null;
            updateDownloadWindow.Show(this);
            return;
        }
        updateDownloadWindow.ShowProgressAgain(this);
    }

    private void CloseUpdateProgressWindow()
    {
        if (updateDownloadWindow is not { IsDisposed: false }) { updateDownloadWindow = null; return; }
        updateDownloadWindow.ClosePermanently();
        updateDownloadWindow = null;
    }

    private void ShowUpdateReadyPrompt(UpdateInfo update, string? downloadedPath, bool force)
    {
        if (IsDisposed || string.IsNullOrWhiteSpace(downloadedPath) || !File.Exists(downloadedPath)) return;
        if (!force && !promptedUpdateVersions.Add(update.Version)) return;
        promptedUpdateVersions.Add(update.Version);

        using var dlg = new UpdateReadyDialog(update);
        if (dlg.ShowDialog(this) != DialogResult.OK || !dlg.ShouldUpdateNow)
        {
            SetStatus($"PDF Studio {update.Version} is ready. The verified download was kept for later.");
            return;
        }

        if (!UpdateService.IsPlatformMigration(update))
        {
            if (!UpdateService.CanSelfUpdate(out var reason))
            {
                MessageBox.Show(this, reason, "PDF Studio update", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return; // keep the downloaded update so it can still be applied manually
            }
        }

        if (dirty && pages.Count > 0)
        {
            var migration = UpdateService.IsPlatformMigration(update);
            var message = migration
                ? "PDF Studio will launch the portable Version 3 app and close this legacy window. You have page changes that have not been exported. Continue and lose those unsaved changes?"
                : "PDF Studio needs to restart to finish the update. You have page changes that have not been exported. Restart and lose those unsaved changes?";
            if (MessageBox.Show(this, message, migration ? "Upgrade PDF Studio" : "Update PDF Studio",
                    MessageBoxButtons.YesNo, MessageBoxIcon.Warning) != DialogResult.Yes)
            {
                SetStatus($"Update postponed. PDF Studio {update.Version} remains downloaded and ready.");
                return; // Update later must not discard the downloaded payload.
            }
        }

        try
        {
            UpdateService.ApplyAndRestart(downloadedPath, update);
            dirty = false; // the restart was explicitly confirmed above
            Close();
        }
        catch (Exception ex)
        {
            ShowError(ex);
            SetStatus(BackgroundUpdateService.Current.Status == BackgroundUpdateStatus.Idle
                ? "The staged update was invalid or missing. Use Check for updates to download it again."
                : "The update is still downloaded. You can try again later.");
        }
    }

    /// <summary>The help guide is a normal (non-modal) window so you can read it while you work.</summary>
    private void ShowHelp(string? topic = null)
    {
        if (helpWindow is { IsDisposed: false })
        {
            if (topic is not null) helpWindow.OpenTopic(topic);
            helpWindow.Activate();
            return;
        }
        helpWindow = new HelpDialog(topic);
        helpWindow.FormClosed += (_, _) => helpWindow = null;
        helpWindow.Show(this);
    }
}
