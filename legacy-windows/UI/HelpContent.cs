using PdfStudio.Services;

namespace PdfStudio.UI;

/// <summary>One page of the user guide. Body uses the mini markup described in <see cref="HelpContent"/>.</summary>
public sealed record HelpTopic(string Glyph, string Title, string Body);

/// <summary>
/// The text of the Help &amp; user guide. Content only: parsing lives in <see cref="HelpParser"/>, drawing in <see cref="GuideView"/>.
/// Mini markup: "## " sub-heading, "### " small label, "- " bullet, "&gt; " tip, "|Key|Meaning" shortcut row, blank line = paragraph break.
/// </summary>
public static class HelpContent
{
    private static IReadOnlyList<HelpTopic>? all;

    /// <summary>All topics, built on first use (the version history is read from the change log at that moment).</summary>
    public static IReadOnlyList<HelpTopic> All => all ??= Build();

    private static HelpTopic[] Build() => new HelpTopic[]
    {
        new("\uE80F", "Welcome & quick start",
@"PDF Studio lets you build a PDF visually. Every page of every file you add becomes a thumbnail tile; you arrange the tiles, edit them, and export the result.

## The 5-step workflow
- Add files: click Add files, press Ctrl+O, or simply drag PDFs and pictures onto the window.
- Arrange: drag thumbnails to reorder, or use Move earlier / Move later.
- Edit: rotate, duplicate, delete, insert blank pages, add text or images.
- Check: select a page to see it large in the preview pane on the right.
- Export: click Export PDF (Ctrl+S) and choose where to save.

> Nothing is changed in your original files. PDF Studio only writes the new file you export.
> Made a mistake? Press Ctrl+Z. Every change can be undone and redone."),

        new("\uE710", "Adding files",
@"## Supported files
- PDF documents (any number of files; every page is added).
- Pictures: PNG, JPG, BMP, GIF, TIFF (multi-page TIFFs too) and WebP. Added pictures use A4 pages with automatic orientation and contain-fit by default; use Page size to change the document layout.

## Ways to add
- Add files menu or Ctrl+O: choose PDFs and pictures together, or pick only one type. The trailing Add PDF / image tile opens the same combined picker. Pictures become pages in the workspace; no output PDF is saved until you export. Convert > Images → PDF saves a PDF file directly.
- Drag files from Windows Explorer onto the window to add them at the end.
- Drag files between two thumbnails to insert them exactly there (an insertion line shows where).
- More tools > Insert PDF after selection puts a whole PDF right after the selected page.

## Password-protected PDFs
If a PDF is locked, PDF Studio asks for its password. After you unlock it, the password is remembered until you close the app (it is never saved to disk).

> Adding the same file twice is allowed. It is handy for repeating a page.
> Large files are read quickly because only page sizes are read up front. Thumbnails load as you scroll."),

        new("\uE8A9", "Page grid & thumbnails",
@"The big area in the middle shows every page as a thumbnail with its page number and source file name underneath.

## Thumbnails
- Thumbnails are drawn only for the pages you can see and fade in smoothly as they finish.
- A tile that says Loading… is waiting its turn. One that says Preview unavailable could not be rendered (damaged page or locked file).
- Changing order or rotation never re-renders thumbnails, so it stays instant even with hundreds of pages.

## Size & layout
- Use the thumbnail slider, the + / − buttons in the status bar, or Ctrl + mouse wheel to resize the tiles.
- Fit columns (status bar) stretches tiles slightly so each row fills the whole width with no wasted space. Turn it off for exact sizes.
- Hide the preview pane (button at the far right of the status bar) to give the grid the whole window. The preview hides itself automatically on narrow windows.
- The mouse wheel scrolls smoothly; dragging near the top or bottom edge auto-scrolls.

## Markers on a tile
- ↻90° means you rotated the page.
- ✎ means the page has text added. ▣ means it has a picture added.
- A check circle in the corner means the page is selected."),

        new("\uE762", "Selecting pages",
@"Most commands act on the selected pages. If nothing is selected they act on the page you last clicked.

## With the mouse
- Click a page to select only that page.
- Ctrl+click adds or removes a page. Shift+click selects a range.
- Click the check circle in a tile's corner to toggle it.
- Drag a rubber-band rectangle on the empty background to select many pages. Hold Ctrl to add to the selection.

## With the keyboard
- Arrow keys, Home, End, Page Up and Page Down move the selection. Add Shift to extend it.
- Space toggles the active page. Ctrl+A selects all. Ctrl+I inverts. Esc clears the selection.

## Select menu & tools
- Odd pages / Even pages: ideal for double-sided scans.
- By page range: type something like 1-3, 5, 8-  (8- means from page 8 to the end). Words odd and even also work.
- More tools > Select blank pages finds empty or nearly empty pages (scanner separators) so you can delete them.
- More tools > Select pages from the same file picks every page that came from the same source."),

        new("\uE8CB", "Reordering & arranging",
@"## Drag and drop
- Grab any tile and drop it between two others. A purple insertion line shows where it will land.
- Select several pages first, then drag one of them: the whole group moves together (a badge shows how many).
- Press Esc while dragging to cancel. Dropping a page back where it was does nothing.
- Drag to the top or bottom edge of the grid to scroll while dragging.

## Buttons
- Move earlier / Move later nudge the selection one place (Ctrl+Shift+← / →).
- Move to > To the start, To the end, or To page number.
- Reverse flips the order of the selected pages, or of all pages when fewer than two are selected.

> Every move is a single undo step, even when you move many pages at once."),

        new("\uE70F", "Editing pages",
@"## Rotate
- Rotate left / right (Ctrl+← / Ctrl+→) turn the selected pages 90 degrees. Use it twice for upside-down pages.
- Hover over a tile to get quick Rotate and Delete buttons.
- More tools also offers Rotate 180°, Reset rotation, and Rotate ALL pages.

## Duplicate & delete
- Duplicate (Ctrl+D) places a copy right after each selected page.
- Delete (Del) removes the selected pages from your document only, never from the original file.
- More tools > Delete pages by range removes pages such as 2-4, 9.

## Blank pages
Blank page inserts empty pages: choose size (same as current page, A4, A3, A5, Letter, Legal), orientation, how many, and where.

## Undo & redo
Ctrl+Z undoes, Ctrl+Y redoes. Rotation, order, text, deletions and insertions are all covered."),

        new("\uE8D2", "Text & image overlays",
@"Add words or pictures on top of pages: titles, notes, stamps like APPROVED, company logos or a signature.

## Add text
- Click Add text (or the Text button in the preview pane).
- Type the text, choose font, size, bold/italic and colour.
- Position is chosen by anchor (left, centre, right and top, middle, bottom) plus a nudge in points. Because it is anchored to the page edges, one setting works on A4, Letter and landscape pages alike.
- Choose whether it goes on this page, the selected pages, or all pages.

## Add an image
- Click Add image and pick a PNG, JPG, BMP, GIF or TIFF.
- Set the width in millimetres; the height follows automatically.
- Use a PNG with a transparent background for signatures and logos.

## Your saved signatures
- In Edit PDF, click Signature. Your saved signatures are listed with a preview; click one to place it on the page, then drag and resize it.
- First time: choose Add signature picture and pick a PNG, JPG or scan of your signature. A PNG with a transparent background is kept as it is. For a photo or scan on white paper, tick Remove the paper background and adjust Cleanup until the checkerboard shows only your ink.
- Or choose Draw a new signature and keep Keep it in My signatures ticked.
- Saved signatures stay on this computer and are there every time you open PDF Studio. Manage saved signatures lets you rename (F2) or delete them.
- The Add image window also has a Saved signature list, for stamping a signature on many pages at once.

## Remove
More tools > Remove text and images from selected pages clears all overlays on those pages. The trash button in the preview pane does the same for the current page.

> Overlays are written into the PDF when you export. The preview pane shows them live.
> Overlays are not true redaction. They sit on top of the page and do not remove the content underneath."),

        new("\uE8C6", "Splitting & extracting",
@"## Extract
Extract saves the selected pages as a new PDF, leaving your workspace untouched.

## Split
Split cuts your current page sequence into several PDF files in a folder you choose.
- Every N pages: for example every 10 pages.
- Each page as its own PDF.
- Two parts: split after the page you have selected.
- Custom ranges: 1-3, 4-6, 9 creates three files.
Files are named Part_01.pdf, Part_02.pdf and so on (you can change the base name).

> Split and Extract use the pages as they currently appear in the grid, including your rotations, overlays and ordering."),

        new("\uE896", "Exporting",
@"Click Export PDF (Ctrl+S) to write the final document. Pages stay vector (text stays sharp and searchable); nothing is flattened to pictures.

## Export options (tabs)
- Details: document title, author, subject and keywords.
- Page numbers: position (six places), format (1, Page 1, Page 1 of 10, 1 / 10), start number, font size, and skip the cover page.
- Watermark: text, opacity, size and angle (e.g. CONFIDENTIAL, DRAFT).
- Compress: a preset level, a percentage ('make it smaller by N %') or a size limit ('keep it under X MB'); plus grayscale.
- Protect: passwords and permissions.

## Compression and grayscale (built in)
- Pictures are re-encoded as JPEG and scaled down if they are larger than needed; everything else is packed tighter. Text and vector graphics are never turned into pictures.
- Light keeps print quality (about 300 dpi), Balanced suits email (about 150 dpi), Strong gives the smallest file (about 100 dpi). The result only replaces the original if it is smaller.
- Make it smaller by N %: the file is shrunk to N % below its normal size (50 = half). Keep it under X MB: the file is shrunk to fit that limit. PDF Studio tries the gentlest picture settings that reach the goal, checks the real file size, and tells you if the goal is out of reach (a file that is mostly text cannot shrink much).
- Grayscale converts pictures and colours in the pages to shades of grey.

## Password protection
- Open password: required to open the file.
- Owner password: needed to change permissions. If you leave it blank, a random one is used so the permissions are still enforced.
- Allow printing, copying and editing can be switched off individually.
- Passwords are never stored; you enter them each time.

## Other export commands
- Export selected pages (More tools) writes only the selection.
- Open in viewer builds a temporary copy and opens it in your default PDF app to check the result before saving."),

        new("\uE8AB", "Converting",
@"Open the Convert menu in the top bar.

## PDF to Word
Converts the whole workspace, only the selected pages, or any PDF file to a Word (.docx) document. It is built into PDF Studio — no Word or any other program is needed to convert.

Each PDF page becomes a Word section of the same size with no margins. Extracted text is real, editable Word paragraphs/runs; tables are real Word tables. Hidden OCR text is imported when available, and bundled English OCR attempts to recover text from meaningful embedded image regions, including images nested inside Form XObjects. A page-level OCR fallback runs on the remaining graphics after vector text is removed. Paragraph-like raster panels become editable Word paragraphs where OCR can read them; uncertain text-like regions are omitted instead of becoming draggable pictures. Only small bounded photo/logo candidates may remain as separate pictures, while full-page artwork is an optional appearance-first setting.

- Graphics quality: Standard (150 dpi), High (220 dpi) or Draft (96 dpi). It affects preserved pictures. Full-page artwork is opt-in; normal mode prioritizes editable text.
- Extracted lines are grouped into ordinary Word paragraphs where reading order is clear. Font substitutions and paragraph reflow can change exact line breaks.
- Text that is rotated or slanted stays in the picture (it looks right but is not editable).
- English raster text can be converted to editable paragraphs through the bundled OCR engine. OCR may make mistakes and cannot reliably reconstruct complex layouts; if a text-like region cannot be read, the editable-first converter omits it rather than making the paragraph a floating picture. Enable full-page artwork only when visual appearance matters more than editability.

## PDF to images
- Formats: PNG, JPEG, WebP, BMP, TIFF, GIF.
- Resolution 36 to 1200 dpi (150 is good for screens, 300 for print).
- JPEG and WebP quality slider; choose all pages, selected pages, or a range.
- Files are named with your prefix and page number.

## Images to PDF
- Page size: same as the image, A4, A3, A5, B5, Letter, Legal, Tabloid or custom.
- Orientation: automatic, portrait or landscape.
- Fit: fit inside, fill, stretch or actual size, with a margin.
- A live preview shows exactly how the picture will sit on the page. Phone photos are rotated correctly using their EXIF data."),

        new("\uE7B3", "Preview pane",
@"Select a page to see it large on the right.

- Zoom with the − and + buttons or Ctrl + mouse wheel. Fit shows the whole page.
- When zoomed in, drag the page with the mouse to pan.
- The arrow buttons step to the previous or next page.
- Rotate buttons, Text, Image and the trash button work on the current page.
- The preview includes your rotation, text and images exactly as they will be exported.

> Page numbers and watermarks are applied at export time, so they are not drawn in the preview."),

        new("\uE765", "Keyboard & mouse shortcuts",
@"## Files & export
|Ctrl+O|Add PDF or image files
|Ctrl+S|Export PDF
|Ctrl+Shift+S|Export selected pages
|Ctrl+P|Open the result in your PDF viewer
|F1|Open this help guide

## Selecting
|Ctrl+A|Select all pages
|Ctrl+I|Invert selection
|Esc|Clear selection / cancel a drag
|Arrow keys, Home, End|Move the selection
|Shift + arrow keys|Extend the selection
|Space|Toggle the active page

## Editing
|Ctrl+Z / Ctrl+Y|Undo / Redo
|Ctrl+← / Ctrl+→|Rotate left / right
|Ctrl+D|Duplicate
|Del|Delete
|Ctrl+Shift+← / →|Move earlier / later
|Ctrl+T|Add text

## View
|Ctrl + mouse wheel|Resize thumbnails (in the grid) or zoom (in the preview)
|Ctrl + plus / minus|Make thumbnails larger / smaller
|Double-click a tile|Select it and show it in the preview
|Right-click|Context menu with the most-used commands"),

        new("\uE713", "Optional components",
@"PDF Studio works on its own for merging, reordering, editing, images, splitting, compression, PDF to image and PDF to Word. Nothing else needs installing.

## PDF to Word
PDF to Word is built in too. No Word or any other program is needed to convert."),

        new("\uE946", "Troubleshooting & FAQ",
@"## Thumbnails stay blank or say Preview unavailable
- The PDF page may be damaged or use an unsupported feature. Try exporting it again from the original program.
- If the file is password protected, remove the page and re-add the file, entering the password when asked.

## 'This PDF is password-protected'
Add the file again and enter its password when prompted. Wrong password? You get three tries per file.

## PDF to Word text looks slightly different from the PDF
Word uses the fonts installed on your PC. If the PDF used a font you do not have, a similar one is used and the spacing is adjusted so every line keeps its width. Install the original font to get an exact match.

## Compression made no difference
The file is only replaced when the compressed version is smaller. PDFs that are mostly text, or already optimised, often cannot shrink much. Pick Strong for scans and photo-heavy files.

## The text I added is in the wrong place
Positions are anchored to the page edges after the page's own rotation. Use the Nudge values to fine-tune, and check the preview pane.

## Does PDF Studio change my original files?
Never. It only ever writes the new files you ask for.

## Where are temporary files kept?
In a session folder in your Windows temp directory. It is deleted automatically when you close the app.

## Settings
Your theme, thumbnail size and preview visibility are remembered between sessions."),

        new("\uE81C", "Version history",
            ChangeLog.ToHelpMarkup(AppInfo.Version)),

        new("\uE77B", "About & credits",
@"PDF Studio is built and maintained by:

## Jessie Albert Regualos
IT Specialist - Mindanao

## Built with
- PDFsharp for assembling pages, overlays, stamps and security.
- PDFium (through PDFtoImage) for sharp page rendering.
- Windows Forms on .NET 8 for the user interface.

Open the About window from the (i) button in the top bar for version and system information.")
    };
}
