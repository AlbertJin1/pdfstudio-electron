# PDF Studio — C# / .NET 8 (Windows)

Merge, reorder, edit, split and convert PDFs. See `FEATURES.md` for the full list and `CHANGELOG.md` for the version history (current version: **2.8.13**).

## Build
Install the .NET 8 SDK on the build machine, then run `build_publish.bat`.
Output: `publish\PdfStudio.exe` (self-contained, single file, win-x64 — no runtime needed on target PCs).

**Code signing:** the build signs `PdfStudio.exe` automatically when a certificate is configured (`signing\signing.config.bat`, see `signing\README.md`). Without one it warns and produces an unsigned exe; set `SIGN_REQUIRED=1` to make that an error.

## Runtime requirements
The application is self-contained and the core PDF features work offline. The bundled English OCR feature for PDF → Word also needs the Microsoft Visual C++ 2015–2022 x64 runtime on the target PC; without it, vector and existing hidden-OCR text can still be converted, while unreadable raster-only text regions may be omitted with a warning.

## Libraries
PDFsharp 6.2.4 (page assembly, MIT) · PDFtoImage 5.4.0 (PDFium rendering, MIT) · TesseractOCR 5.5.2 (English raster OCR, Apache-2.0; OCR requires the Microsoft Visual C++ 2015–2022 x64 runtime)

## Version history & releasing

**Current source version: 2.8.13.** PDF → Word runs a page-level OCR fallback for text hidden in image-bearing Form XObjects and upscales raster panels before recognition. Text-shaped regions are never exported as draggable pictures, even if OCR cannot confidently recover them; only small, bounded photo/logo candidates may remain pictures in editable-first mode. Edit PDF reapplies the calibrated horizontal scale (20–500%) to newly typed characters and after formatting changes so the live text width matches the saved overlay. The Add PDF / image menu keeps Ctrl+O as a shortcut without drawing the colliding hint beside its caption. Version 2.8.12 removes a duplicate inline-edit cancellation method and makes Cancel restore the original object and undo/redo state. Version 2.8.13 resolves ambiguous GDI+/Tesseract ImageFormat references in PDF-to-Word raster encoding.
Every release is documented twice, from the same wording: `CHANGELOG.md` (Keep a Changelog format, ISO dates) and `Services/ChangeLog.cs`, which feeds the in-app
**Help (F1) › Version history** topic and the release date in the About window (About › **What's new** opens it).
To release: (1) add the entry at the top of both files, (2) set `<Version>` and `<FileVersion>` in `PdfStudioCS.csproj` to the same number.
The build fails with a clear message if the version has no entry in either file (`CheckChangelog` target). List only user-visible changes, under Added / Changed / Fixed / Removed.

## Architecture
- `Services/PdfService` — loads page info, assembles the final PDF (vector pages, overlays, stamps, compression, security)
- `Services/ImagePdfService` — PDF → images, image → PDF layout/embedding (one `ComputeLayout` shared with the dialog preview)
- `Services/ThumbnailCache` — lazy, serialised, LRU thumbnails (PDFium is not re-entrant)
- `UI/PageGridView` — owner-drawn virtualised page grid; all drag/drop, selection and keyboard logic
- `UI/MainForm*.cs` — window layout and every command; all page-list edits go through `Edit()` so undo/redo is uniform


---
Developed by **Jessie Albert Regualos** — IT Specialist - Mindanao

## Edit PDF (new)
`UI/EditorForm` is the separate PDF editor (ribbon **Edit PDF**, Ctrl+E). Existing text is read with `Services/PdfiumText` (PDFium text API, same native library PDFtoImage ships);
added objects are `Models/PageEditObject` stored on `PageItem.Edits` and drawn by `PdfService.DrawEdit` (export) and `UI/EditPainter` (editor + preview).

## Edit PDF – text fidelity (v2.2.1)
Edited PDF text is anchored on the original **baseline and pen origin** (`PdfiumText` → `PdfTextBlock.Baseline/OriginX`), never on the top of PDFium's char box.
Canvas, preview and export share one rule (`Services/TextMetrics`): line-box top = baseline − font ascent, and the export draws on the baseline. Imported text retains a baseline anchor as font metrics change, and property-panel formatting updates existing mixed-style runs.
Text is filled from unhinted glyph outlines (`EditPainter.DrawText`) so it has the same weight as PDFium's own rendering. The editor renders pages losslessly
(`ImagePdfService.RenderBitmapLossless`) at an integer DPI and draws them 1:1. `PageEditObject.HScale` is calibrated once from the source glyph bounds and applied both to the live RichEdit control and the saved overlay. Converted lines remember the source horizontal scale and available neighboring-field width. While editing, the scale and baseline stay fixed: PDF Studio does not silently refit the replacement based on its new length. Users can deliberately change font size or move/resize text if the new content no longer fits the field. The original-text cover expands when larger glyphs need it. Newly added text remains free-sized.

## Saved signatures (v2.3)
`Services/SignatureStore` keeps the user's signatures as trimmed 32-bit transparent PNGs in `%LOCALAPPDATA%\PdfStudio\signatures` (`index.tsv` holds names; a lost index is rebuilt from the PNGs).
It also turns photos/scans on white paper into transparent signatures (`Process`: paper level = 90th brightness percentile, smooth alpha ramp, ink colour un-mixed from the paper, trim, size cap).
UI: `SignatureImportDialog` (add picture, live checkerboard preview), `SignatureLibraryDialog` (manage), quick-pick menu on the Edit PDF **Signature** button (`EditorForm.BuildSignatureMenu`).
Placed signatures are copied to a temp file first (`EditorForm.InsertPicture`), so deleting a library entry never breaks pages already edited.


## PDF → Word (v2.4, built in; real tables since v2.4.2)
`Services/PdfToWordService` + `Services/DocxWriter` replace the old LibreOffice call; no external program is used.
Per page: PDFium text API → lines/runs (font, size, colour, baseline), including usable invisible OCR text unless it duplicates visible glyphs → the emitted text objects are deleted from PDFium's in-memory page
(`FPDFPage_RemoveObject`, also inside form XObjects). Remaining graphics are rendered for image-panel detection and bounded photo/logo crops; a whole-page background image is opt-in only. `DocxWriter` writes a hand-built .docx (System.IO.Compression only): one zero-margin section per page at the PDF's exact size, with genuine bounded images anchored behind ordinary Word paragraphs/runs. Extracted text outside tables is no longer placed in floating text boxes; adjacent source lines are grouped into flowing paragraphs, preserving basic font/style runs and common hanging indents so sentences can be selected, searched, rewritten, and reflowed in Word. As a trade-off for true flowing text, font substitutions or edits can change exact line breaks compared with the PDF.
Tables (`Services/PdfTableDetector`): the page's ruling lines (thin strokes, thin filled rectangles, rectangle outlines) are grouped into grids; a missing line between two cells merges them; each grid is written as a floating `w:tbl` pinned to its page position and the text inside a cell becomes ordinary paragraphs. Their lines are switched off before the background picture is rendered.
Rotated/slanted text is not reconstructed as flowing text. Usable invisible OCR layers are imported and deduplicated against visible text. Rasterized English text panels are OCRed into normal Word paragraphs/runs with bundled Tesseract data. If OCR cannot read an ambiguous text-like panel, it is omitted rather than left as a draggable picture; genuine bounded photos/logos may remain independent images.

## Edit PDF – layout (v2.5.0)
`UI/EditorForm.Layout.cs` (partial class) holds snapping (`BuildTargets` → `SnapAxis`, guides drawn by `DrawLayoutOverlays`), per-page margins (`Models/PageMargins`, stored on `PageItem.Margins`, edited in the Page margins panel or by dragging the guide lines),
the Align buttons / "Snap to best spot", and the Apply / Cancel bar shown above the inline text box.

## Usage monitoring and reviews (2.6.0)

PDF Studio reports usage (opens and open time, plus the PC's name and LAN IP so one PC keeps one install id; always on - the Review window has no checkbox for it) and optional user reviews to the **PDF Studio Monitor** PHP web app (`pdfstudio-monitor/`), reached through ngrok. See `pdfstudio-monitor/README.md` for the server setup. Client settings live in `%LOCALAPPDATA%\PdfStudio\settings.txt` (`usage_stats`, `monitor_url`, `monitor_key`); the defaults are in `Services/UsageTracker.cs`.

## Updates
The app checks the PDF Studio Monitor server and automatically downloads newer releases in the background. Closing the progress window does not cancel the download; after verification the user explicitly chooses **Update now** or **Update later**. See `UPDATES.md`.
