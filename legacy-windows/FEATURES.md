# PDF Studio — feature list

This is the current feature set. What changed in each version, and when, is in `CHANGELOG.md` (also in the app: Help › Version history).

## Page workspace
- Add many PDFs and images into one workspace (combined multi-select picker, separate PDF/image pickers, or drag-and-drop); mixed selections keep their input order, and the first new page is previewed automatically
- **Drag-and-drop reorder**: grab any page (or a multi-selection) and drop it between two pages; insertion marker, auto-scroll, Esc cancels, one-step undo
- Select: click, Ctrl+click, Shift+click range, rubber-band, checkbox, Ctrl+A, invert, odd / even, by range ("1-3, 5, 8-")
- Rotate left / right (also 180° via twice), duplicate, delete, reverse (selection or all), insert blank pages (size / orientation / position)
- Move earlier / later, to start / end, to a page number; Ctrl+Shift+←/→
- Hover quick actions on each page (rotate, delete); right-click menu
- Undo / redo for every change
- Zoomable thumbnails (slider or Ctrl+wheel); live preview pane with fit / zoom / pan / rotate
- Text overlays (font, size, bold/italic, colour, 9 anchor positions + nudge) on this page / selected / all pages
- Extract selected pages; Split: every N pages, each page, at the active page, custom ranges

## Export options
- Document title / author
- Page numbers (6 positions, 4 formats, start number, skip cover)
- Text watermark (opacity, size, angle)
- Compression (built in, nothing to install): light / balanced / strong presets, reduce by a percentage, or reduce to a target size in MB
- Password protection (open password, owner password, allow print / copy / edit)

## Conversion
- PDF → Word (.docx) — built in, no other software: page size retained, tables rebuilt as real Word tables (merged cells, borders, text in cells), other extracted text as ordinary flowing Word paragraphs/runs (not text boxes), underline strokes mapped to native editable Word underline formatting when detected, bounded genuine photos/logos as separate images (no full-page image by default); image-based text with hidden OCR text is extracted, and raster-only English text panels are upscaled and OCRed into ordinary Word paragraphs/runs; text-shaped panels are never left as draggable pictures if OCR fails (they are reported as omitted instead); font substitutions may change exact line breaks
- PDF → images: PNG, JPEG, WebP, BMP, TIFF, GIF; 36–1200 dpi; JPEG/WebP quality; all / selected / range of pages
- Images → PDF: PNG, JPG, BMP, GIF, TIFF (multi-page), WebP; page size = same as image, A4, A3, A5, B5, Letter, Legal, Tabloid or custom mm; orientation auto / portrait / landscape; fit inside / fill / stretch / actual size; margin; live to-scale preview; EXIF rotation honoured; JPEGs embedded losslessly

## Device access control
- PDF Studio can be enabled or disabled per monitored Windows device by an administrator.
- Access is checked in the background and rechecked every 30 seconds; startup does not require server authentication.
- A previously disabled device stays locked offline until the monitor restores access.

## Interface
- Light and dark themes (remembered), owner-drawn flat controls, high-DPI aware

## New in 2.1
- **Thumbnails fixed**: pages now render as real previews (fade in as they load; scroll-aware; retried after unlocking a file)
- Password-protected PDFs: prompted for the password on add (3 tries), remembered for the session only
- Image overlays (logo / stamp / signature) alongside text overlays, with live preview
- Select blank pages, select pages from the same file, delete by range, rotate 180° / reset / rotate all
- Export: subject and keywords, grayscale (built in), open result in your PDF viewer (Ctrl+P), export selected (Ctrl+Shift+S)
- Responsive window: ribbon wraps, header goes compact, preview pane can be hidden (auto-hides on narrow windows), tiles auto-fit the full width
- Animated buttons, smooth scrolling, toast notifications, dialog fade-in, tooltips on every button
- Detailed searchable **Help guide** (F1) and an **About** window; developer footer
- Thumbnail size, fit and preview visibility remembered between sessions

## Fully responsive layout (2.1.1)
- Opens at ~94 % of the screen; minimum window is only 600 × 460
- Header, ribbon and status bar adapt in steps (labels -> icon-only, zoom controls and captions hide) so nothing overlaps
- Preview pane sits beside the pages on wide windows, **underneath** them on narrow-but-tall windows, and keeps its proportion when you resize; the divider is easy to grab
- Few pages? Thumbnails grow to use the free space (with "Fit columns" on)
- Welcome card, dialogs and the export / images-to-PDF forms scale with the window; dialogs are resizable and fit small screens

## One page size for all pages (2.1.2)
- Ribbon **Page size** button (also a tab in the Export dialog) - choose the size of every page in the exported PDF
- Size: keep each page's own, same as the first page, same as the largest page, A3 / A4 / A5 / B5 / Letter / Legal / Tabloid, or a custom size in mm
- Orientation: auto (match each page), portrait or landscape
- Fit for pages of a different size: fit inside, shrink only, fill (crop), stretch, actual size; optional margin
- Live preview of any page in the document; shows how many pages of each size you have
- Pages are redrawn as vector (text stays sharp); pages that already match are copied untouched; text/image overlays, rotation, page numbers and watermarks all follow the new size

## Edit PDF window (2.2) — ribbon **Edit PDF**, Ctrl+E
A separate full-screen editor for the active page (page arrows / Page Up-Down to move through the document).
- **Edit existing text**: hover any line of text already in the PDF, click it, retype it. Recognized underline strokes are imported as per-character formatting and redrawn with the editable text; the old line is covered with the
  sampled paper colour and replacement text is placed on the same baseline in the mapped font, size and colour. Existing text keeps its source horizontal scale and baseline while you type; it is no longer silently squeezed. If edited text exceeds its field, explicitly reduce font size or move/resize the text object.
  Delete the replacement text to remove the original line.
- **Add text** anywhere; **change font, size, bold / italic / underline, colour** at any time (also for edited text). Double-click to retype.
- **Images, logos and signatures**: insert a picture or *draw a signature* (saved with a transparent background).
- **Move and resize** every object: drag to move, drag the handles to resize (text scales its font size, pictures keep proportions — hold Shift to stretch), arrow keys nudge (Shift = 10 pt), exact X / Y / width / height boxes.
- **Shapes**: rectangle, ellipse, line, highlight, white-out, black box (redact); fill, opacity, outline colour and width.
- Duplicate, bring to front / send to back, delete, right-click menu, undo / redo (Ctrl+Z / Ctrl+Y), zoom (Ctrl+wheel), fit.
- Edits live on the pages in the workspace (shown in the preview, undoable from the main window) and are written into the PDF as vector text on export,
  together with page size, rotation, page numbers and watermark options.
- Note: text editing covers and re-draws a line; it does not rewrite the original PDF content stream, so the old text remains in the file structure under the cover. Use the black box + export with compression/flatten if you need true redaction.

## Saved signatures (2.3)
- Edit PDF > **Signature** opens a quick-pick menu of your saved signatures (thumbnail + name); one click places it on the page.
- **Add signature picture**: PNG / JPG / BMP / GIF / TIFF. Transparent PNGs are kept as they are; photos and scans on white paper can have the paper removed
  (soft edges, no white halo, adjustable Cleanup, live checkerboard preview). Camera rotation (EXIF) is honoured; margins are trimmed.
- **Draw a new signature** can be kept in the library with one tick.
- Signatures are stored as normalised transparent PNGs in `%LOCALAPPDATA%\PdfStudio\signatures` and persist between sessions. Manage dialog: add, draw, rename (F2), delete.
- Add image (main window) has a **Saved signature** list too.

## Removed (2.3)
- Word → PDF conversion (Convert menu, welcome button, built-in .docx engine). PDF → Word is now built in (v2.4).
