# Build verification — PDF Studio 2.8.13

## Patch for reported compiler errors
- Resolved `CS0104` ambiguity in `Services/PdfToWordService.cs` by introducing `DrawingImageFormat = System.Drawing.Imaging.ImageFormat` and updating every GDI+ PNG/JPEG encoder call to use that alias.
- Confirmed `TesseractOCR.Enums.ImageFormat` remains available for any Tesseract API uses; the alias only disambiguates `System.Drawing.Image.Save` and `ImageCodecInfo` operations.
- Release metadata aligned at `2.8.13` / `2.8.13.0`.

## Environment limitation
- Source/reference checks and ZIP integrity are verified in this environment.
- A Windows `dotnet publish` is still required to verify compiler success and produce the release executable.

---

# Build and verification notes (current source: 2.8.12)

Static verification for the 2.8.12 source checks project XML and release metadata, exact duplicate declarations in the editor partial classes, C# delimiter balance, PDF-to-Word run-writer call sites, invisible OCR-layer extraction/deduplication, OCR-first raster-panel handling, editor baseline/source-scale behavior, cancellation state restoration, and standard-paragraph output. The Windows compilation and live behavior still require a local build/test as listed below.

**Compilation and live Windows UI tests have not been run in this environment** because the .NET SDK is not installed here. On Windows, run `build_publish.bat`, confirm CS0111 is resolved and no new compiler errors or warnings are introduced by the current patch, then complete the 2.8.12, 2.8.11 and 2.8.10 regression checklists near the end of this file before releasing the executable.

## 2.8.12 duplicate-member and cancellation regression checks
1. Publish with `build_publish.bat`; confirm `EditorForm.cs` and `EditorForm.Layout.cs` expose exactly one `CancelInlineEdit` declaration and CS0111 is gone.
2. Start editing existing text, change its content and formatting, then press Escape; confirm original text, geometry, formatting, undo stack, and redo stack are restored.
3. Move an existing text box with the inline edit frame, press Cancel, then use Undo/Redo; confirm no cancelled movement remains in history.
4. Add a new text object and cancel; confirm the object and its creation undo record disappear. Convert an existing PDF text block and cancel; confirm original page objects return and no stray cover/text object remains.

## First-run checklist
1. Add 2–3 PDFs → pages appear; drag one between two others → marker shows, order changes; Ctrl+Z restores.
2. Select several pages, drag them as a group; drag near the bottom edge → grid auto-scrolls.
3. Export PDF with page numbers + watermark; check a rotated page shows them upright.
4. Add text on a landscape and a rotated page; export and check position.
5. Images → PDF with WebP, GIF, TIFF and a phone JPEG (EXIF rotation); try A4 + Auto orientation + Fill.
6. PDF → Images at 150 dpi in each format.
7. Convert → PDF → Word (built in, nothing to install): the dialog opens and the .docx is produced. Text is ordinary editable Word paragraphs/runs (not floating text boxes); page graphics remain behind the text. Exact line breaks may differ due to font substitution and flowing layout. Confirm there is no "Word → PDF" entry in the Convert menu or on the welcome card.
7b. Start-up: loader appears, spins, then closes by itself and the main window is fully drawn and focused.
8. Toggle dark theme; restart (it should be remembered).

## 2.1 additions to test
9. Thumbnails: add a multi-page PDF; tiles show previews that fade in while scrolling.
10. Add a password-protected PDF: prompt appears, pages load after the correct password.
11. Add image / text overlays, check the preview and the exported PDF.
12. Shrink the window below ~1000 px: preview hides, header goes compact, ribbon wraps.
13. F1 opens the Help guide; the (i) button opens About; footer shows the developer.

## 2.2 Edit PDF — first-run checklist (not compiled by the author)
14. Select a page, press Ctrl+E: the editor opens maximised with the page rendered.
15. Hover text → it highlights; click → type a change → click elsewhere. Export and confirm the new text replaces the old one.
16. Add text, change font / size / bold / colour in the right panel; drag it; drag a corner handle to resize.
17. Insert a picture and draw a signature; move + resize both. Try a rotated page and "Page size" resizing, then export.
18. Undo / redo, Apply changes → the main preview and exported PDF show the edits; Cancel discards.
If hover never highlights text, `PdfiumText` could not bind to pdfium (DllImport "pdfium"); the editor then says so in its hint bar and everything else still works.

## Version history - manual test
1. About (i button): the footer reads "Version 2.8.12  ·  October 15, 2026"; the banner pill reads "Version 2.8.12".
2. About > **What's new** closes About and opens Help on **Version history**; the newest release is first and marked "(current)", sub-headings read ADDED / CHANGED / FIXED / REMOVED.
3. With Help already open on another topic (or with text typed in its search box), About > What's new brings it to Version history.
4. Help search: typing "signature" lists Version history among the matching topics; check light and dark theme.
5. Build check: temporarily set `<Version>` to 9.9.9 and build; it must fail with "CHANGELOG.md has no entry for version 9.9.9". Restore it.

## Saved signatures - manual test
1. Edit PDF > Signature: menu shows "No saved signatures yet" on a fresh profile.
2. Add signature picture with (a) a transparent PNG, (b) a JPG photo of a signature on white paper. (b): tick Remove the paper background, move Cleanup; checkerboard should show only ink.
3. Save, click Signature again: the thumbnail is listed; click it, the signature lands on the page with no white box. Export and open the PDF: still transparent.
4. Close and restart PDF Studio: the signature is still in the Signature menu (no file browsing).
5. Draw a signature with "Keep it in My signatures" ticked; check it appears in the menu next time.
6. Manage saved signatures: rename (F2), delete; a signature already placed on a page still exports after its library entry is deleted.
7. Main window > Add image: "Saved signature" list fills the picture path.

## 2.5.1 - manual test
1. Edit PDF > Edit text: press on a line of text and drag: it moves (snaps, Alt = free) and the original text is covered. A plain click still opens the editor.
2. Click a text line, then drag the **Move** handle in the "Editing text" bar: the box and bar follow the pointer. Apply keeps the new place; Cancel puts it back.
3. Open any drop-down (Margins, Shapes, Pages, Arrange...): rounded corners, icons, muted shortcuts, the button stays highlighted while open; clicking it again closes the menu. Check light and dark theme.
4. Edit PDF: drag a text line or picture between two other lines: pink gap lines with values appear (above/below/left/right, or to the page edge). Centre it between the two neighbours: it clicks in and both labels turn indigo and equal. Move a little short of that: a dashed suggestion shows. Hold Alt: indicators disappear. Resize a box: gaps follow the edges.

## 2.6.0 - manual test

1. Start the app with no files: the window shows only the "Drop your files here" card (no Preview pane on the right). The Preview button in the status bar is disabled.
2. Add a PDF or image: the Preview pane slides in and shows the selected page. Click Preview: it hides; click again: it shows. New / delete all pages: it hides again.
3. Header > Review: hover and click the stars (the face and header colour change; Left/Right and 1–5 also work), tap a few chips, optional name and text, "Send review" (or Ctrl+Enter). With the server running the window shows the thank-you screen, closes by itself (or with Done) and the status bar says "Thank you! Your review was sent."; with no server the window stays open and shows a clear error at the bottom left. Pressing Send with no stars wiggles the stars and asks for a rating. There is no usage-statistics checkbox.
4. Open the app, keep it open for 2+ minutes, close it: on the dashboard one new session shows with the right "Open for" time and status "Closed". While it is open the dashboard shows "Open now".
5. Turn off ngrok, open and close the app, turn ngrok on, open the app again: the earlier session appears on the dashboard (queued in %LOCALAPPDATA%\PdfStudio\usage-queue.jsonl and re-sent).
6. For testing only: set `usage_stats=0` in `%LOCALAPPDATA%\PdfStudio\settings.txt`, restart: no new session is recorded.

## 2.8.2 background-update manual test
1. Publish a newer version to the PDF Studio Monitor, launch this build with `auto_update=1`, and verify the main app stays usable while the update downloads automatically.
2. Close the progress window with **X** while bytes are still downloading. Reopen the update progress from **About → Check for updates**; progress should continue rather than restart.
3. Wait for verification. Confirm the separate **Update now / Update later** prompt appears, with release notes, and the app does not restart by itself.
4. Choose **Update later**, close PDF Studio normally, and launch it again. The verified staged update should be offered without downloading it a second time.
5. Choose **Update now** with no unsaved edits; verify the executable is replaced and the new version starts. Repeat with unsaved page changes and confirm the app asks before discarding them.
6. Simulate a failed network/download and verify the progress window explains the problem and **Retry download** works. Corrupt or remove the staged file and confirm it is rejected instead of being applied.
7. Set the legacy `update_skip=<latest-version>` entry if present; current builds should no longer suppress automatic background downloads because of this obsolete preference.


## 2.8.3 PDF/image import manual test
1. Start with no pages and click **Add PDF / image**. Select two PDFs and two pictures in alternating order; confirm each PDF contributes all its pages and the pictures appear in the same chosen order.
2. Confirm the first page added is selected and displayed in the Preview pane instead of showing “Select a page to preview it.”
3. With an existing document open, use **Add files → Add PDF or image…** to append more PDFs and pictures. Confirm the new pages appear at the end and the first new page is previewed.
4. Click the trailing **Add PDF / image** tile and confirm it opens the combined picker. Drop PDFs and pictures onto the workspace and verify the files are added and page order is preserved.
5. Use **Add PDFs only…** and **Add images (as pages)…** to verify the specialist pickers still restrict the chosen file types appropriately.
6. Import JPG, PNG, WebP and a multi-frame TIFF/GIF where available. Confirm each supported picture can be previewed and exported. Try a damaged file and verify the app reports it while still adding other valid files.
7. Drop one supported file alongside an unsupported file; confirm the valid file imports and the unsupported file is reported as skipped.
8. Press Ctrl+O; confirm it opens the combined PDF/image picker. Export the result and open the output PDF in a separate viewer.


## 2.8.4 text-edit and PDF-to-Word manual test
1. Open a form PDF with adjacent label/value fields. Click an existing value in **Edit PDF → Edit text**, append characters, and apply. Confirm the replacement stays on the same baseline and preserves its original horizontal scale; PDF Studio must not silently squeeze the text. If it exceeds the detected field gap, the hint should warn the user to reduce font size or reposition the edit.
2. Change the font family and size of existing text while editing and from the Properties panel after committing. Confirm the baseline stays put, the requested format visibly applies to all relevant runs, and mixed bold/italic styles are preserved when only one attribute changes.
3. Delete the appended characters and restore the original text. Confirm the shorter text is no longer over-compressed and Cancel/Undo restores the untouched PDF text.
4. Deliberately resize existing text using a corner handle. Confirm all styled runs scale, the target line width changes with the resize, and subsequent text edits do not unexpectedly snap it back to the old width.
5. Add a new text object with a long sentence. Confirm new text is not subject to the original-line width constraint and can be positioned/resized normally.
5. Convert a single-column PDF containing headings, wrapped sentences, bullets and numbered/list-like lines to Word. In Word, click into each sentence and confirm there is no text-box frame/anchor, no `wps` text-box object, and the text can be selected, searched, edited, and naturally reflowed.
6. Confirm wrapped source lines join with spaces into the same paragraph, bullet/list paragraphs stay separate, and their hanging indents remain reasonable.
7. Convert a PDF with ruled tables, multiple columns and a graphic/logo. Confirm detected tables remain editable Word tables, the background artwork remains visible, and multi-column documents are reviewed for any reading-order/layout compromises inherent in flowing paragraphs.
8. Open the `.docx` as a ZIP and inspect `word/document.xml`: it should contain normal `<w:p>` / `<w:r>` text and no `<wps:txbx>` elements.


## 2.8.5 build-fix verification
1. Run `build_publish.bat` on Windows. Confirm `DocxWriter.cs` no longer reports CS0103 for `AppendRuns` and `GuideView.cs` no longer reports CS0108 for `GuideView.Layout`.
2. Convert a PDF containing a table with multiple text runs. Confirm table cell text remains editable and retains font/bold/italic/color formatting.
3. Convert a PDF with free-flow paragraphs and mixed lists. Confirm ordinary text remains paragraphs/runs rather than text boxes.


## Underline conversion regression checks (2.8.6)

1. Convert a PDF containing underlined words/phrases to DOCX. In Word, click inside the phrase and confirm the characters themselves have **Home → Underline** enabled; the underline must follow text edits and wrapping.
2. Inspect `word/document.xml`: underlined runs should contain `<w:u w:val="single"/>` inside `<w:rPr>`.
3. Confirm matched underline paths do not remain as black lines in the page artwork after paragraph reflow.
4. Convert a PDF with table borders and underlined text inside/outside tables. Borders must remain real table borders; only recognized text underlines should become `w:u` runs.
5. In Edit PDF, click an existing underlined phrase, change its text, save/export, and confirm the old underline is covered and the replacement underline follows the editable text.
6. Confirm ordinary horizontal separators that do not sit immediately beneath glyph baselines remain graphics and are not turned into underlined text.

Static checks only were performed in this environment. Compilation and end-to-end Windows conversion need verification with the .NET SDK and the PDFium runtime.


## 2.8.10 nested-form OCR, Word picture suppression, and live-edit scale regression checks

1. Convert a searchable/scanned PDF that contains a hidden OCR text layer. Confirm the hidden OCR text becomes ordinary Word paragraphs/runs and is not duplicated when visible text overlaps it.
2. Convert a PDF where a paragraph/mission statement is an image object. Confirm the paragraph is not inserted as a draggable picture when its pixels resemble a text panel; confirm that bundled English OCR converts the paragraph into ordinary editable Word text. Verify the paragraph cannot be selected/moved as a picture. Also test a genuine photo with a sign so OCR does not replace the photo unless it contains a dense, multi-line text panel.
3. Convert a normal PDF with a small logo/photo. Confirm genuine bounded images remain separate pictures, no page-sized picture is inserted by default, and the **Keep a full-page background picture** option is unchecked by default.
4. Convert a PDF with a full-page scanned image. In editable-first mode, confirm the bundled English OCR recovers readable text as Word paragraphs and no page-sized draggable picture is inserted by default. If OCR cannot start, confirm the conversion warning explains the missing Visual C++ x64 runtime. Then opt in to full-page artwork and confirm the appearance-first choice intentionally restores the page image.
5. Inspect `word/document.xml`: extracted text is in `<w:p>` / `<w:r>` elements; there must be no `<wps:txbx>` text boxes and, with default settings, no page-sized drawing/anchor. Pictures should correspond only to bounded preserved photo/logo regions.
6. In Edit PDF, click an existing field value (for example Store Name), append several characters, and confirm font size, horizontal scale and baseline remain unchanged instead of compressing. The input surface should expand toward the page edge to keep typed text visible, and the status hint should show a possible-overlap warning when the text exceeds its available field width.
7. Change font family, size, bold, italic and underline on existing text; confirm the baseline stays fixed, formatting runs update, and the source horizontal scale is not reset unexpectedly.
8. Undo, redo, cancel, and save. Confirm the text only moves/resizes when the user deliberately applies those actions and the exported PDF matches the edited preview.

**Environment limitation:** the .NET SDK is not installed in this sandbox, so compilation, PDFium runtime behavior, and Microsoft Word opening/rendering still must be verified on Windows.


## 2.8.10 additional regression checks

1. Convert a PDF where a paragraph is stored as an image inside a Form XObject. Confirm PDF Studio recovers it as ordinary Word paragraphs when English OCR is confident; select and drag near the paragraph and confirm there is no picture boundary around the whole text panel.
2. Convert a PDF with both regular vector text and an embedded photo. Confirm the vector text is not duplicated by page-level OCR and the photo remains separate only if it is a small, bounded photo/logo candidate.
3. Disable or make OCR unavailable in a test environment. Confirm ambiguous paragraph-like image regions are omitted with a warning rather than inserted as draggable pictures; full-page artwork appears only when the explicit opt-in is checked.
4. In Edit PDF, append text, type into the middle, change font size/bold/underline, undo, and cancel. Confirm the baseline and source horizontal scale remain stable between live editing and the saved PDF; confirm a long replacement triggers the overlap warning.
5. Check the Add PDF / image drop-down with Ctrl+O: the caption and shortcut must have a visible gap and remain readable at 100% and high DPI scaling.

## 2.8.11 raster-text, edit-scale, and menu regression checks

1. Convert the sample document that contains the Mission statement as an image/text-panel object. In Word, click the recovered sentences and confirm the caret appears in regular text; there must be no image handles or draggable picture boundary around the paragraph.
2. Inspect the generated `word/document.xml`: the Mission statement must occur inside normal `<w:p>` / `<w:r>` runs. There must be no picture anchor positioned over that paragraph. Genuine small logo/photo objects may be pictures.
3. Use a low-resolution embedded paragraph panel. Confirm OCR upscaling recovers multiple lines as editable text and that underlined words, where detected, use `<w:u w:val="single"/>` on their text runs.
4. If OCR is unavailable or cannot read a clearly text-shaped panel, confirm the converter warns that content may have been omitted and does not silently substitute a draggable picture for the text.
5. In Edit PDF, click an existing field (for example Store Name), type additional characters, and compare the text before typing, during editing, and after Save changes. Baseline and the existing font width must remain consistent; text must not jump wider/narrower on commit. A replacement that exceeds its field should display the overlap warning rather than silently shrink.
6. In Edit PDF, change font family and size, then type again. Confirm live RichEdit scaling remains applied to all characters and the exported PDF uses the same calibrated scale.
7. Open **Add files** at 100%, 125%, and 150% Windows display scaling. The **Add PDF / image…** caption must not overlap a shortcut label; press Ctrl+O and confirm the combined picker still opens.

