using System.Globalization;
using System.Text;

namespace PdfStudio.Services;

public enum ChangeKind { Added, Changed, Fixed, Removed }

/// <summary>One category of changes (Added / Changed / Fixed / Removed) inside a release.</summary>
public sealed record ChangeGroup(ChangeKind Kind, string[] Items);

/// <summary>The notes of one released version.</summary>
public sealed record ReleaseNotes(string Version, DateOnly Date, string Summary, ChangeGroup[] Groups);

/// <summary>
/// Version history shown in the app (Help &gt; Version history, About). It mirrors CHANGELOG.md.
/// To release: add a new entry at the TOP of <see cref="Releases"/>, add the same entry to CHANGELOG.md, and set
/// &lt;Version&gt; / &lt;FileVersion&gt; in PdfStudioCS.csproj to the same number (the build fails if CHANGELOG.md has no entry for it).
/// </summary>
public static class ChangeLog
{
    /// <summary>Newest first.</summary>
    public static IReadOnlyList<ReleaseNotes> Releases { get; } = new ReleaseNotes[]
    {
        new("2.8.15", new DateOnly(2026, 10, 25), "Prepare a safe migration from the legacy C# app to the portable PDF Studio 3 app.", new ChangeGroup[]
        {
            new ChangeGroup(ChangeKind.Fixed, new[]
            {
                "Major-version migrations download and verify the standalone PDF Studio 3 portable EXE; it replaces PdfStudio.exe when writable or launches a user-local fallback without an installer.",
                "Protected legacy folders use a user-local portable fallback without administrator rights.",
                "The download dialog explains portable migration and no-install behavior."
            })
        }),
        new("2.8.14", new DateOnly(2026, 10, 15), "Rebuilt the Export PDF window with segmented tabs, one alignment grid, themed fields and toggle switches.", new ChangeGroup[]
        {
            new ChangeGroup(ChangeKind.Changed, new[]
            {
                "Export PDF window rebuilt: one segmented tab strip (keyboard operable, with a dot on tabs that have settings switched on) and one alignment grid so every label, field and button lines up.",
                "Text, password and number boxes share one themed field; numbers show their unit and have stepper arrows, hold-to-repeat, mouse wheel and Up/Down keys; password boxes can be revealed.",
                "Check boxes became toggle switches; dependent settings dim until switched on, and the Compress tab shows only the field for the chosen method, with quick-pick buttons.",
                "The footer summarises everything that will be applied. Ctrl+Tab / Ctrl+Shift+Tab and Ctrl+PageDown / Ctrl+PageUp switch tabs; Tab follows the screen order."
            }),
            new ChangeGroup(ChangeKind.Fixed, new[]
            {
                "Cancel and Export buttons in every dialog now sit on the same line with an even gap (their margins differed).",
                "A missing watermark text now jumps to the Watermark tab and focuses the field."
            })
        }),
        new("2.8.13", new DateOnly(2026, 10, 15), "Resolve ambiguous ImageFormat references in PDF-to-Word raster processing.", new ChangeGroup[]
        {
            new ChangeGroup(ChangeKind.Fixed, new[]
            {
                "Qualified PNG/JPEG image encoders as System.Drawing.Imaging.ImageFormat through a DrawingImageFormat alias, resolving CS0104 conflicts with TesseractOCR.Enums.ImageFormat.",
                "Kept raster crop encoding and OCR image processing behavior unchanged; only the intended GDI+ image format enum is used for System.Drawing image operations."
            })
        }),
        new("2.8.12", new DateOnly(2026, 10, 15), "Fix duplicate inline-edit cancellation and restore undo/redo history cleanly when Cancel is pressed.", new ChangeGroup[]
        {
            new ChangeGroup(ChangeKind.Fixed, new[]
            {
                "Removed the stale duplicate CancelInlineEdit method from the EditorForm layout partial, resolving compiler error CS0111.",
                "Cancelling an inline edit restores the original page objects and the undo/redo history that existed before the edit session, including when text was formatted or dragged.",
                "Removed obsolete text/position fields used only by the duplicate cancellation path."
            }),
        }),
        new("2.8.11", new DateOnly(2026, 10, 15), "Keep raster text editable, preserve Edit PDF text scale and tidy the Add files menu.", new ChangeGroup[]
        {
            new ChangeGroup(ChangeKind.Fixed, new[]
            {
                "PDF-to-Word upscales raster text panels before OCR, accepts more legible low-resolution lines and maps their coordinates back to the original PDF page.",
                "Text-shaped image regions are rejected as draggable pictures even when antialiasing makes them look photographic; when OCR cannot recover the panel, it is omitted with a warning instead of flattened into a picture.",
                "Edit PDF applies the calibrated source horizontal scale across the full supported range to keep live text and the saved overlay aligned when PDF fonts have different installed substitutes.",
                "The Add PDF / image menu caption no longer collides with a rendered Ctrl+O hint; the keyboard shortcut continues to work."
            }),
            new ChangeGroup(ChangeKind.Changed, new[]
            {
                "Editable-first PDF-to-Word prioritizes flowing, searchable text. OCR results may need proofreading; small bounded photos/logos may remain individual images."
            })
        }),
        new("2.8.10", new DateOnly(2026, 10, 14), "Recover raster text inside nested PDF forms and keep Edit PDF text scaling stable while typing.", new ChangeGroup[]
        {
            new ChangeGroup(ChangeKind.Fixed, new[]
            {
                "PDF-to-Word finds images nested in Form XObjects and uses a page-level OCR fallback after stripping vector text, so embedded paragraphs are recovered as ordinary Word text where OCR can read them.",
                "Text-like image regions are suppressed from the Word picture list after OCR recovery. In editable-first mode, uncertain text panels and page-sized scans are omitted rather than exported as draggable pictures; only small bounded photo/logo candidates may remain pictures.",
                "Edit PDF reapplies the calibrated character scale after each edit keystroke and formatting change, keeping new characters consistent with the live editor and saved PDF overlay.",
                "The Add PDF / image menu label and shortcut spacing are improved, and cancelling a newly added text object no longer attempts to remove it twice."
            }),
            new ChangeGroup(ChangeKind.Changed, new[]
            {
                "Editable-first Word conversion favors flowing, searchable, editable paragraphs over preserving every raster decoration. Low-confidence OCR needs manual review, especially for non-English or highly stylized text.",
                "Edit PDF never silently squeezes longer replacements; it keeps the source scale and baseline and warns if text may overlap another field."
            })
        }),
        new("2.8.9", new DateOnly(2026, 10, 14), "Recognize text inside image panels and keep Edit PDF text geometrically stable.", new ChangeGroup[]
        {
            new ChangeGroup(ChangeKind.Fixed, new[]
            {
                "PDF-to-Word OCR now examines meaningful image regions before classifying them as photos, and converts paragraph-like raster text to ordinary Word paragraphs and runs instead of movable pictures.",
                "OCR uses multiple-line, character-count, confidence and text-coverage thresholds to avoid replacing real photos just because they contain a sign or label.",
                "Edit PDF calibrates source text width once and applies the same fixed horizontal scale to the live editor and final PDF overlay; it no longer changes the scale when typing ends.",
                "The first line baseline is measured from its actual mixed-format runs. The source-text cover expands behind longer replacements only up to the available field boundary, avoiding old glyph remnants and protecting neighboring fields."
            }),
            new ChangeGroup(ChangeKind.Changed, new[]
            {
                "English raster OCR is enabled by default and uses bundled Tesseract trained data. Full-page artwork is still opt-in; genuine bounded photos and logos may remain individual Word pictures.",
                "Edit PDF gives clearer typing and overlap guidance, retains the source text scale while editing, and lets Escape cancel the active edit."
            })
        }),
        new("2.8.7", new DateOnly(2026, 10, 14), "Prevent draggable text-picture exports and preserve existing text scale while editing.", new ChangeGroup[]
        {
            new ChangeGroup(ChangeKind.Fixed, new[]
            {
                "PDF → Word imports usable invisible OCR text layers and suppresses duplicate hidden glyphs when visible text already occupies the same position.",
                "Editable-first Word conversion no longer inserts large scans or raster panels that look like text as draggable page/text pictures; bounded genuine photos and logos remain separate pictures.",
                "Edit PDF preserves the original text horizontal scale and baseline when replacing text. Longer text is no longer silently squeezed into the original line width; users can explicitly reduce size or reposition the text."
            }),
            new ChangeGroup(ChangeKind.Changed, new[]
            {
                "Conversion messaging explains that raster-only text with no OCR layer cannot become editable without OCR and may be omitted instead of flattened into an image.",
                "PDF-to-Word remains editable-first by default; keeping a full-page background picture stays an explicit opt-in."
            })
        }),
        new("2.8.6", new DateOnly(2026, 10, 14), "Preserve underlined PDF text as native editable Word formatting.", new ChangeGroup[]
        {
            new ChangeGroup(ChangeKind.Fixed, new[]
            {
                "PDF → Word recognizes thin underline paths beneath extracted text and converts them to Word's native single-underline run formatting.",
                "Matched underline paths are removed from the page artwork, preventing detached lines when Word paragraphs reflow.",
                "Edit PDF imports recognized underline paths into per-character text styles, covers the original underline stroke when replacing text, and redraws it with the editable text.",
                "Known table borders are excluded from underline matching and continue to be rebuilt as editable Word table borders."
            })
        }),
        new("2.8.5", new DateOnly(2026, 10, 14), "Fix the PDF-to-Word writer build error and remove a Help view naming warning.", new ChangeGroup[]
        {
            new ChangeGroup(ChangeKind.Fixed, new[]
            {
                "PDF-to-Word table-cell paragraphs now use the existing AppendInlineRuns writer, fixing compiler error CS0103 while keeping cell text as editable Word runs.",
                "Renamed the Help guide's nested layout-cache type to TopicLayout so it no longer hides Control.Layout."
            })
        }),
        new("2.8.4", new DateOnly(2026, 10, 14), "Keep PDF text edits aligned and convert PDF text to editable Word paragraphs.", new ChangeGroup[]
        {
            new ChangeGroup(ChangeKind.Changed, new[]
            {
                "PDF → Word now writes extracted text as ordinary Word paragraphs and formatted runs instead of floating text boxes, so sentences can be selected, searched, rewritten and reflowed naturally.",
                "Wrapped lines and hanging-indented list items are grouped into flowing paragraphs; tables remain real editable Word tables and page graphics remain behind the text."
            }),
            new ChangeGroup(ChangeKind.Fixed, new[]
            {
                "Existing PDF text keeps its baseline when the font family, size, or per-character formatting changes; text-format controls update existing styled runs instead of leaving stale formatting behind.",
                "Longer replacements fit horizontally within the original line width to avoid spilling into adjacent fields. Deliberate resizing scales mixed-format runs and establishes a new fit width; larger text expands its whiteout cover.",
                "The inline typing control retains the natural text width while editing, even when the final PDF overlay will be fitted to the original field."
            })
        }),
        new("2.8.3", new DateOnly(2026, 10, 14), "Add PDFs and images in one workflow with visible import feedback.", new ChangeGroup[]
        {
            new ChangeGroup(ChangeKind.Added, new[]
            {
                "The Add files menu, Ctrl+O, empty-state button and workspace add tile can select PDFs and supported images together.",
                "Mixed imports preserve the order in which files were chosen, including the pages contained in each source file."
            }),
            new ChangeGroup(ChangeKind.Changed, new[]
            {
                "The first newly imported page is selected and previewed automatically so users can immediately confirm the import succeeded.",
                "Unsupported files dropped into the workspace are reported as skipped instead of being silently ignored."
            }),
            new ChangeGroup(ChangeKind.Fixed, new[]
            {
                "The trailing workspace tile now advertises both PDFs and images and opens the combined importer."
            })
        }),
        new("2.8.2", new DateOnly(2026, 10, 14), "Automatic background downloads with user-controlled installation.", new ChangeGroup[]
        {
            new ChangeGroup(ChangeKind.Added, new[]
            {
                "New releases download automatically in the background after a version check, so users can keep working while the transfer runs.",
                "Closing or hiding the modeless progress window does not cancel the download.",
                "After verification, users choose Update now or Update later; postponed updates stay staged and are offered again on the next launch."
            }),
            new ChangeGroup(ChangeKind.Changed, new[]
            {
                "PDF Studio never restarts into an update without the user's explicit Update now choice.",
                "The staged executable's size, Windows header and SHA-256 are checked on restore and rechecked immediately before installation."
            })
        }),
        new("2.8.1", new DateOnly(2026, 10, 10), "Steam-style differential updates download changed parts instead of the full application.", new ChangeGroup[]
        {
            new ChangeGroup(ChangeKind.Added, new[]
            {
                "The updater compares content-defined chunks in the installed executable with the new release and downloads only missing parts.",
                "Update progress shows preparation, changed-part download, local rebuilding and integrity verification."
            }),
            new ChangeGroup(ChangeKind.Changed, new[]
            {
                "Every changed part and the reconstructed executable are SHA-256 verified before installation.",
                "If a differential update is unavailable, damaged or inefficient, PDF Studio falls back to the compressed package and then the full executable."
            })
        }),
        new("2.8.0", new DateOnly(2026, 10, 9), "Device-level administrator access control through the PDF Studio Monitor.", new ChangeGroup[]
        {
            new ChangeGroup(ChangeKind.Added, new[]
            {
                "Administrators can enable or disable PDF Studio separately for each monitored Windows device.",
                "Disabled devices show a clear access lock and remain blocked offline until access is restored.",
                "The monitor keeps an audit trail with the administrator, reason and timestamp for each access change."
            }),
            new ChangeGroup(ChangeKind.Changed, new[]
            {
                "PDF Studio does not require server authentication to start. New or never-seen devices remain usable by default.",
                "The application checks its device policy in the background and rechecks it every 30 seconds."
            })
        }),
        new("2.7.0", new DateOnly(2026, 10, 8), "Smaller releases: the exe is zipped for upload and for in-app updates.", new ChangeGroup[]
        {
            new ChangeGroup(ChangeKind.Added, new[]
            {
                "The update window shows how big the download is before you start, and while downloading it shows the megabytes received, the percentage, the speed and the time left."
            }),
            new ChangeGroup(ChangeKind.Changed, new[]
            {
                "Updates now download a compressed package (about half the size of the exe) and PDF Studio unpacks it itself before restarting. If the package is unavailable or fails its check, the full exe is downloaded instead, so an update never gets stuck.",
                "Releasing uploads a zip of the signed exe instead of the exe itself, roughly halving the upload. The monitor verifies and unpacks it, and still keeps the plain exe for older copies."
            })
        }),
        new("2.6.6", new DateOnly(2026, 10, 8), "One exe: everything is packaged inside PdfStudio.exe.", new ChangeGroup[]
        {
            new ChangeGroup(ChangeKind.Changed, new[]
            {
                "PDFium (pdfium.dll) and SkiaSharp (libSkiaSharp.dll) are now bundled inside PdfStudio.exe. Ship and update just the exe; no loose DLLs are needed beside it."
            }),
            new ChangeGroup(ChangeKind.Fixed, new[]
            {
                "PDF page previews no longer vanish after an exe-only copy or update, which is what caused the \"Dll was not found\" error."
            })
        }),
        new("2.6.5", new DateOnly(2026, 10, 8), "Add images properly: they only become pages, and many at once is safe.", new ChangeGroup[]
        {
            new ChangeGroup(ChangeKind.Changed, new[]
            {
                "Add images now just adds the pictures to the workspace as pages (A4, fitted inside a 10 mm margin). No dialog opens and no PDF file is created or saved; the PDF is made when you export. Use Page size to change how the pages look.",
                "Convert > Images → PDF is the separate converter that asks for the layout and saves a PDF file. Its Result option is gone because it always saves a file."
            }),
            new ChangeGroup(ChangeKind.Fixed, new[]
            {
                "Adding many images no longer fails. Each picture is prepared on its own, so a single bad file is reported and skipped instead of stopping the rest, and memory use stays low.",
                "The \"DLL was not found\" error (PDFium) no longer appears. When pdfium.dll is missing, PDF pages show \"Preview unavailable\" with a clear status message; pictures you add are still drawn in the page grid, the preview and Edit PDF."
            })
        }),
        new("2.6.4", new DateOnly(2026, 10, 8), "The monitor recognises a PC by its name, so one PC stays one install.", new ChangeGroup[]
        {
            new ChangeGroup(ChangeKind.Added, new[]
            {
                "Usage statistics now include the PC's name and its network (LAN) address. The monitor shows both next to every session and install."
            }),
            new ChangeGroup(ChangeKind.Fixed, new[]
            {
                "A PC no longer shows up as a new install when its settings file is lost or reset (reinstall, cleaned profile, another Windows user on the same PC). The monitor matches the PC name, returns the PC's original install id, and the app keeps using it."
            })
        }),
        new("2.6.3", new DateOnly(2026, 10, 6), "Edit PDF: resizable side panel, a clearly visible text box and margin guides that match the page.", new ChangeGroup[]
        {
            new ChangeGroup(ChangeKind.Added, new[]
            {
                "Edit PDF: drag the thin bar between the page and the side panel to make the panel wider or narrower (double-click the bar to put it back). The width is remembered.",
                "Edit PDF > Page margins: a Fit to page text button (also in the Margins menu) that puts the guides exactly where the text on the page starts and ends."
            }),
            new ChangeGroup(ChangeKind.Changed, new[]
            {
                "Edit PDF: the margin guides of a page you have not adjusted yourself now follow the page's real text instead of a fixed 0.5 inch, so they line up with the page. Dragging a guide, typing a margin, Reset or Use on all pages makes them yours and they are left alone.",
                "Edit PDF: everything in the side panel stretches to the panel's width, so check boxes and buttons are never cut off and there is no sideways scroll bar.",
                "Help & user guide: topics now open through a new reader that is drawn in one pass, so the heading and first lines can no longer appear blank or half-painted.",
                "Help & user guide: a shimmering loading placeholder and a short fade-in play while a topic opens. Searching tints the matching paragraphs and jumps to the first one; Ctrl+C copies the topic.",
                "Update window: the release notes are shown as coloured Added / Changed / Fixed sections with a version header."
            }),
            new ChangeGroup(ChangeKind.Fixed, new[]
            {
                "Edit PDF: the text box being edited now has a clear frame (solid outline, soft band and four corner blocks). Before, the corner handles were half hidden behind the text box, which looked broken, and the box was hard to see on the page.",
                "Edit PDF: the frame can be dragged to move the text box, and the Apply / Cancel bar sits above the frame instead of on top of it."
            })
        }),
        new("2.6.2", new DateOnly(2026, 10, 6), "PDF compression that hits a percentage or an exact size.", new ChangeGroup[]
        {
            new ChangeGroup(ChangeKind.Added, new[]
            {
                "Export PDF > Compress: choose how to compress. Preset level (as before), Reduce by a percentage (for example 50% makes the file half its normal size) or Reduce to a target size (MB). PDF Studio tries the gentlest picture settings that reach the goal, measures the real file size and goes a little harsher if it is still over. After saving you see the before and after size, and a message if the goal cannot be reached.",
                "Compression now also handles pictures stored with PNG or TIFF predictors (common in PDFs made by Word, browsers and scanners' software), which were skipped before."
            }),
            new ChangeGroup(ChangeKind.Changed, new[]
            {
                "The Export window's Compress & protect tab is split into two tabs, Compress and Protect, so both fit comfortably.",
                "Pictures are re-encoded on several processor cores at once, so large scanned files compress much faster."
            }),
            new ChangeGroup(ChangeKind.Fixed, new[]
            {
                "Compression no longer converts pictures that could not be made smaller; a picture is only replaced when the new version is smaller (except when converting to grayscale)."
            })
        }),
        new("2.6.1", new DateOnly(2026, 10, 6), "Add PDF tile, a modern Export window and text-size fixes.", new ChangeGroup[]
        {
            new ChangeGroup(ChangeKind.Added, new[]
            {
                "An Add PDF placeholder tile at the end of the page thumbnails. Click it (or drop files on the grid) to add more PDFs."
            }),
            new ChangeGroup(ChangeKind.Changed, new[]
            {
                "The Export PDF window is redesigned: a cleaner tab bar, a heading and short description on every tab, consistent label and field alignment, fixed-width number fields, and the page-number and watermark fields are greyed out until the option is switched on."
            }),
            new ChangeGroup(ChangeKind.Fixed, new[]
            {
                "Edit PDF: applying bold, italic, underline, colour or a font to selected text no longer shrinks the text. The size was being read back from the editor in points instead of pixels, so every style change cut it to 75%.",
                "Export PDF: the labels on the Details, Watermark and other tabs were pushed to the bottom of the window and no longer lined up with their fields.",
                "Adding a PDF no longer selects all of its pages automatically; your current selection is left alone."
            })
        }),
        new("2.6.0", new DateOnly(2026, 10, 5), "Reviews, usage statistics and a calmer empty window.", new ChangeGroup[]
        {
            new ChangeGroup(ChangeKind.Added, new[]
            {
                "Review button in the header opens a new review window: rate PDF Studio with 1-5 stars while a little face and the header colours react to your rating, tap the things that stood out, optionally add your name and a few words, and send it to the developer. Ctrl+Enter sends; problems (no rating, no connection) are shown inside the window and a short thank-you screen confirms the send.",
                "Anonymous usage statistics sent to the PDF Studio Monitor web app: how many times the app is opened and for how long. Only a random install id, the app version and the Windows version are sent - never files or file names. They are always on (there is no checkbox); the Review window states that they are included. Events that cannot be delivered offline are kept and re-sent the next time the app starts."
            }),
            new ChangeGroup(ChangeKind.Changed, new[]
            {
                "The preview pane is now hidden until at least one PDF or image page has been added, so the empty start screen is no longer split in two. It appears automatically with the first page (the Preview button still hides it)."
            })
        }),
        new("2.5.1", new DateOnly(2026, 10, 5), "Move text boxes freely; nicer drop-down menus.", new ChangeGroup[]
        {
            new ChangeGroup(ChangeKind.Added, new[]
            {
                "Edit PDF: a Move handle in the Editing text bar. Press and drag it to reposition the text box while you are typing. Cancel puts the text back where it was.",
                "Edit PDF: distance indicators like Canva. While you move, resize or draw, pink lines show the gap to the nearest text or object on each side (and to the page edge) with the value in your margin unit. New equal-spacing snap: the object clicks into place when the space on both sides is equal, or equal to a gap elsewhere on the page; a dashed suggestion shows it just before it snaps. Alt moves freely.",
                "Drop-down menus: icons next to the commands (text no longer overlaps them), a muted shortcut column, rounded corners, a softer highlight and roomier rows. The button stays highlighted while its menu is open.",
                "Drop-down lists (font, units, page size, format, scope…): a rounded field and a rounded, themed list with a check mark on the current choice, instead of the white system list. Works in light and dark theme."
            }),
            new ChangeGroup(ChangeKind.Fixed, new[]
            {
                "Edit PDF: pressing on a line of existing text and dragging now moves it. A plain click still edits it. Before, a click opened the editor straight away and the text could not be dragged."
            })
        }),
        new("2.5.0", new DateOnly(2026, 10, 5), "Smart snapping, page margins and an Apply button for text editing.", new ChangeGroup[]
        {
            new ChangeGroup(ChangeKind.Added, new[]
            {
                "Edit PDF: an Apply / Cancel bar now floats above the text you are typing, so no keyboard shortcut is needed to finish (Ctrl+Enter also works). Cancel puts the text back exactly as it was.",
                "Edit PDF: snapping. Pictures, signatures, text, shapes and new objects click into place on the page margins, the page centre, other objects and the page's own text (left edge, end of line, same line). Pink guide lines with a label show what you snapped to; a dashed suggestion appears when you are close but not yet snapped. Hold Alt to move freely. The new Snap button in the toolbar turns snapping on or off.",
                "Edit PDF: page margins for the selected page. Show or hide the margin guides, drag a margin line on the page, or type exact values (inches, centimetres or points) in the new Page margins panel. Reset them, or use them on every page. Margins are guides only and are not printed.",
                "Edit PDF: Align on page buttons (Left, Centre, Right, Top, Middle, Bottom) and Snap to best spot, which moves the selected object to the nearest good position."
            }),
            new ChangeGroup(ChangeKind.Changed, new[]
            {
                "Edit PDF: clearer wording. The bottom button is now \"Save changes\", hints explain what to do next, and a short tip is shown when nothing is selected."
            })
        }),
        new("2.4.4", new DateOnly(2026, 10, 5), "Edit PDF keeps the original text size; New button.", new ChangeGroup[]
        {
            new ChangeGroup(ChangeKind.Added, new[]
            {
                "New button in the ribbon (Ctrl+N): removes all pages and the undo history to start a fresh document. Asks first if there are unexported changes."
            }),
            new ChangeGroup(ChangeKind.Changed, new[]
            {
                "Ribbon: related buttons are grouped into drop-downs so the toolbar fits on one row. Pages (duplicate, insert blank / PDF, rotate 180°, reset rotation, delete by range), Arrange (move earlier / later / to start / end / to page number, reverse), Add to page (text, image, remove added items), Extract (extract, split, export selected) and More (export options, open in viewer). Rotate left / right and Delete stay as single buttons."
            }),
            new ChangeGroup(ChangeKind.Fixed, new[]
            {
                "Drop-down buttons: clicking the button again while its menu is open now closes it (it used to close and instantly re-open).",
                "Edit PDF: edited text now keeps the exact font size of the original. PDFs printed from a browser store a scale in the page that was ignored, so the replacement text came out about one third too large and ran past the margin."
            })
        }),
        new("2.4.3", new DateOnly(2026, 10, 5), "Edit PDF text fix.", new ChangeGroup[]
        {
            new ChangeGroup(ChangeKind.Fixed, new[]
            {
                "Edit PDF: clicking existing text no longer squeezes the words together (\"REWOODLANESStoreopening…\"); the spaces between words are kept, so the text opens exactly as it reads in the PDF.",
                "Edit PDF: a line is no longer cut into pieces at commas and dots (e.g. \"19,732.14\" or \"PRINTER,ECOTANK\"), so one click selects the whole line."
            })
        }),
        new("2.4.2", new DateOnly(2026, 10, 5), "Real Word tables in PDF → Word.", new ChangeGroup[]
        {
            new ChangeGroup(ChangeKind.Changed, new[]
            {
                "PDF → Word: tables are now rebuilt as real Word tables (rows, columns, merged cells, borders) with their text typed into the cells, instead of a table picture with loose text boxes on top. Cell text is ordinary, editable Word text; right-aligned and centred text (amounts, headings) keeps its alignment.",
                "PDF → Word: table borders are taken out of the background picture, so lines are never drawn twice."
            }),
            new ChangeGroup(ChangeKind.Fixed, new[]
            {
                "PDF → Word: text inside tables was converted to floating text boxes; it now lives inside the table cells."
            })
        }),
        new("2.4.1", new DateOnly(2026, 10, 5), "Font accuracy release for PDF → Word and Edit PDF.", new ChangeGroup[]
        {
            new ChangeGroup(ChangeKind.Changed, new[]
            {
                "PDF → Word: the .docx records fallback fonts (alternate name, font class, PANOSE), so text keeps its width and appearance on PCs where the original font is not installed.",
                "Edit PDF: replacement text is mapped to the closest installed look-alike of the original font."
            }),
            new ChangeGroup(ChangeKind.Fixed, new[]
            {
                "PDF → Word: fonts are now identified from the font data embedded in the PDF, so converted documents use the document's real typeface instead of a generic substitute.",
                "PDF → Word: bold and italic faces are detected from the embedded font, replacing unreliable weight and flag values."
            })
        }),
        new("2.4.0", new DateOnly(2026, 10, 4), "PDF → Word is now fully built in.", new ChangeGroup[]
        {
            new ChangeGroup(ChangeKind.Added, new[]
            {
                "Built-in PDF → Word (.docx) engine: each page keeps its exact size, text stays editable at its original position, and graphics, tables and photos are preserved behind it."
            }),
            new ChangeGroup(ChangeKind.Changed, new[]
            {
                "PDF → Word no longer depends on LibreOffice or any other external program."
            })
        }),
        new("2.3.0", new DateOnly(2026, 10, 4), "Saved signature library.", new ChangeGroup[]
        {
            new ChangeGroup(ChangeKind.Added, new[]
            {
                "Saved signatures that persist between sessions and are placed in one click from the Signature menu in Edit PDF.",
                "Import a signature from a picture or scan; the paper background is removed automatically, with a live transparency preview.",
                "Draw a signature and keep it in the library; rename or delete entries from the management dialog."
            }),
            new ChangeGroup(ChangeKind.Removed, new[]
            {
                "Word → PDF conversion."
            })
        }),
        new("2.2.1", new DateOnly(2026, 10, 4), "Text fidelity in Edit PDF.", new ChangeGroup[]
        {
            new ChangeGroup(ChangeKind.Changed, new[]
            {
                "The editor renders pages losslessly at 1:1 scale for a sharper, truer view."
            }),
            new ChangeGroup(ChangeKind.Fixed, new[]
            {
                "Edit PDF: replaced text now sits on the original baseline and pen origin, so it aligns exactly with the surrounding text.",
                "Edit PDF: edited text matches the weight and line width of the original."
            })
        }),
        new("2.2.0", new DateOnly(2026, 10, 4), "Edit PDF window.", new ChangeGroup[]
        {
            new ChangeGroup(ChangeKind.Added, new[]
            {
                "Edit PDF window (Ctrl+E): edit existing text in place, add new text, and change font, size, style and colour.",
                "Insert pictures, logos and drawn signatures; move and resize any object with handles or exact values.",
                "Shapes: rectangle, ellipse, line, highlight, white-out and black box.",
                "Edits appear in the preview and are written to the exported PDF as vector text, with full undo / redo."
            })
        }),
        new("2.1.2", new DateOnly(2026, 10, 3), "One page size for every page.", new ChangeGroup[]
        {
            new ChangeGroup(ChangeKind.Added, new[]
            {
                "Page size tool: set a single size for all pages (A3 to Tabloid, custom, or match the first / largest page), with orientation, fit options and a live preview."
            }),
            new ChangeGroup(ChangeKind.Changed, new[]
            {
                "Resized pages are redrawn as vector so text stays sharp; pages that already match are copied untouched."
            })
        }),
        new("2.1.1", new DateOnly(2026, 10, 3), "Responsive layout.", new ChangeGroup[]
        {
            new ChangeGroup(ChangeKind.Changed, new[]
            {
                "Fully responsive interface: the ribbon, header and status bar adapt to the window width, down to a 600 × 460 minimum.",
                "The preview pane sits beside the pages on wide windows and below them on narrow ones; dialogs resize to fit small screens."
            })
        }),
        new("2.1.0", new DateOnly(2026, 10, 3), "Security, selection and export enhancements.", new ChangeGroup[]
        {
            new ChangeGroup(ChangeKind.Added, new[]
            {
                "Password-protected PDFs: prompted for the password when added (kept for the session only).",
                "Image overlays (logo, stamp, signature) with live preview.",
                "Export options: subject and keywords, grayscale, and open the result in your PDF viewer.",
                "Selection tools: blank pages, pages from the same file, and delete by range.",
                "Built-in Help guide (F1) and About window."
            }),
            new ChangeGroup(ChangeKind.Fixed, new[]
            {
                "Thumbnails now render as real page previews, loading progressively while scrolling."
            })
        }),
        new("2.0.0", new DateOnly(2026, 10, 2), "First release of the native Windows edition (C# / .NET 8).", new ChangeGroup[]
        {
            new ChangeGroup(ChangeKind.Added, new[]
            {
                "Page workspace: merge many PDFs and images, drag-and-drop reorder, multi-select, rotate, duplicate, delete, insert blank pages, and full undo / redo.",
                "Split and extract: every N pages, each page, at the active page, or by custom ranges.",
                "Export options: text overlays, page numbers, text watermark, compression and password protection.",
                "Conversion: PDF → Word, PDF → images (PNG, JPEG, WebP, BMP, TIFF, GIF) and images → PDF with page size and fit controls.",
                "Live preview pane and light / dark themes."
            })
        }),
    };

    public static ReleaseNotes Latest => Releases[0];

    /// <summary>The notes for "major.minor.build", or null when that version has no entry.</summary>
    public static ReleaseNotes? Find(string version) =>
        Releases.FirstOrDefault(r => string.Equals(r.Version, version, StringComparison.Ordinal));

    /// <summary>"October 5, 2026" - the same wording on every PC, whatever the regional settings.</summary>
    public static string FormatDate(DateOnly date) => date.ToString("MMMM d, yyyy", CultureInfo.InvariantCulture);

    /// <summary>The whole history in the Help window's mini markup ("## " heading, "### " sub-heading, "- " bullet).</summary>
    public static string ToHelpMarkup(string? currentVersion = null)
    {
        var sb = new StringBuilder();
        foreach (var r in Releases)
        {
            var current = r.Version == (currentVersion ?? Latest.Version) ? "  (current)" : "";
            sb.Append("## ").Append(r.Version).Append("  \u00B7  ").Append(FormatDate(r.Date)).Append(current).Append('\n');
            sb.Append(r.Summary).Append('\n');
            foreach (var g in r.Groups)
            {
                sb.Append("### ").Append(g.Kind).Append('\n');
                foreach (var item in g.Items) sb.Append("- ").Append(item).Append('\n');
            }
            sb.Append('\n');
        }
        return sb.ToString().TrimEnd();
    }
}
