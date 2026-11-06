# PDF-to-Word conversion and standalone PDF compression

## PDF to Word

### Default: Editable Word document (flowing engine, `src/services/pdf/word/`)

Since 3.1.0 the default conversion works like Acrobat's Word export: it reads the PDF's real content and rebuilds native Word structure. Nothing is placed over a page picture.

1. **Interpretation** (`extract.js`) — walks the PDF.js operator list exactly like the canvas renderer and records every glyph (position, advance, font, size, fill colour, render mode), every vector path (stroke/fill colour, width, geometry, rectangles, curves, clip) and every image placement. Form XObjects and filled form-field appearances are included. Coordinates are top-left points with the page rotation applied.
2. **Layout analysis** (`layout.js`)
   - ruling lines → **ruled tables** (grid columns/rows from line positions, merged cells where internal lines are missing, per-side borders with weight/colour, cell shading from fills that sit on the grid); frames that contain chart bars or tick marks are recognised as drawings, not tables;
   - **aligned-column tables** without a full grid (horizontal rules only, zebra stripes, or no decoration) with rules as row borders and stripes as shading;
   - shaded or bordered text panels (including rounded cards) → single-cell tables; side-by-side text (letterheads) → borderless tables;
   - underline/strikeout from rules under/through text; bullets drawn as vector dots → bullet characters; super/subscripts;
   - lines → **paragraphs** using a wrap test (a line ends a paragraph when the next word would have fitted), with alignment (left/centre/right/justify), indents, first-line/hanging indent, tab stops, list markers;
   - two/three-column regions → Word column sections; sideways pages are turned upright;
   - images, vector artwork and chart labels → pictures; stand-alone lines and coloured panels → native Word shapes.
3. **Writing** (`ooxml.js`, `index.js`) — WordprocessingML is generated directly: one section per PDF page with the source page size and margins on the real text edges, exact line pitch (baselines placed at 80 % of the line box, as Word/LibreOffice do), paragraph spacing derived from the source baselines, fixed-layout tables with zero cell margins so text sits where it was, inline or page-anchored pictures, hyperlinks. The package is reopened and validated (well-formed XML, relationships).

Measured on the regression corpus (LibreOffice, ReportLab, Chrome and matplotlib PDFs: letters, reports, forms, invoices, liquidation tables, newsletters, web pages, photo reports): 100 % of the words are recovered in order, and text positions after rendering the DOCX are typically within 0.1–0.5 pt of the PDF.

### Other modes

- **Exact page layout** (`mode: 'layout'`): the legacy layout-preserving path — text positioned at the source coordinates over page artwork. Use for unusual forms where fixed placement matters more than editing.
- **Visual replica** (`mode: 'visual'`): each page as a high-resolution image; not editable.
- The legacy *automatic hybrid* and *editable* strategies remain callable (`mode: 'auto'` with `engine: 'legacy'`, `mode: 'editable'`) and are used automatically if the flowing engine throws on a file.
- **OCR**: scanned pages (no text layer) are OCRed in the desktop app when OCR is enabled; searchable scans use their invisible text layer. Without OCR such pages are kept as images and reported.

### Accuracy boundary

The supplied comparison set includes a signature-heavy IT equipment assessment, a table-based liquidation report, a screenshot-rich software installation procedure, and a formal letter with logos/signatures. These demonstrate distinct failure modes: over-wide form grids, joined headings/fields after reflow, screenshot text being mistaken for document text by OCR, and signature/logo placement drift. The automatic page strategy and OCR restrictions specifically guard against those problems.

This is a local reconstruction pipeline, not Adobe Acrobat Pro's proprietary conversion engine. No generic converter can guarantee that every arbitrary PDF becomes a 100% pixel-identical and fully reflowable Word document: PDFs may use subsetted/unavailable fonts, text rendered as paths, embedded scanned pages, transparency, unusual scripts, handwriting, layered drawings, or non-semantic placement. The default flowing engine prioritizes a normal, editable Word document that looks like the PDF; Exact page layout prioritizes fixed placement; Visual replica prioritizes appearance and intentionally uses images.

Before using a converted file as a legally, medically, or commercially critical document, open it in Microsoft Word and compare it with the PDF. The app performs structural checks, but those do not replace a fresh Microsoft Word compatibility and visual regression check. For Acrobat-class semantic fidelity, integrate a purpose-built PDF-to-Office SDK and a validated OCR engine/model distribution.

## Standalone Compress PDF

Open **Compress PDF** from Conversion Studio or quick-launch. The workflow analyzes the selected source, prepares a preview, compares size and structure checks, then saves a separate `-compressed.pdf` copy only when the user chooses Save.

- **PDF analysis:** PDF.js counts pages, text items/characters, image paint operations, annotations, links, form widgets, bookmarks, attachments, and page geometry. A best-effort `pdf-lib` object scan estimates image stream bytes, largest image payload, embedded font streams, total stream payload and duplicate-image candidates. Raw object statistics may be unavailable for encrypted or unusual PDFs; those fields are marked unavailable instead of guessed.
- **Lossless only:** tries the local PDF toolkit optimizer and preserves the original when it cannot produce a smaller file. It does not rasterize pages.
- **Smart object compression:** when Ghostscript is available, its `pdfwrite` high-level device selectively down-samples images by effective display resolution, recompresses color/gray image streams, reuses duplicate images, compresses streams, and compresses/subsets fonts. If Ghostscript is unavailable (as in a source build that does not stage its licensed runtime), a built-in MIT-licensed image-object optimizer recompresses supported embedded raster images in place. It keeps native text, vectors, links, and forms instead of flattening whole pages. Unsupported codecs may be skipped. The actual result is measured and retained only when it is smaller and passes structural checks.
- **Presets and target size:** High quality, Recommended, Smaller file, and Smallest file select DPI/quality profiles. Target size accepts MB or a percentage and tries progressively stronger profiles, choosing the smallest safe candidate found and reporting when the target is missed.
- **Visual preview and integrity checks:** renders a selected page of the original and candidate side by side. Before accepting a smart rewrite, the app checks page count/geometry, selectable text token coverage, links, form widgets, embedded attachment counts, bookmarks and annotation counts. When the smart result fails hard checks, it is rejected and the smaller safe result (lossless/original) is retained.
- **Explicit raster fallback:** whole-page rasterization is disabled by default. Users must opt in before applying it. Rasterization can lose searchable text, links, forms, vectors, bookmarks, attachments, accessibility structure, and signatures; it is only offered as a last resort. True black-and-white page output requires this fallback; object-preserving grayscale is supported by Ghostscript.
- **Signed PDFs:** if a signature marker is found, the app skips compression to avoid silently invalidating the signed document. Signature detection is conservative and cannot replace specialist signature validation.
- **Password and report:** a source password can open protected PDFs; an optional AES-256 output password is applied when saving. The report calculates final size again after protection because encryption can add bytes.

### Smart compression engine availability

The app detects Ghostscript from `PATH` or `resources/ghostscript/bin/gswin64c.exe` in a Windows package (or `gs` on Unix-like development systems). To make the smart optimizer available in a release, stage a complete, licensed Ghostscript runtime in `resources/ghostscript` before packaging. PDF Studio does not download it automatically. Ghostscript's `pdfwrite` reconstructs a new PDF, not a byte-preserving edit; non-marking metadata, comments, links, bookmarks, forms, and specialized structures may not all survive. The app rejects candidates when its hard structural checks detect missing text, links, form widgets, or attachments, but this is not a full ISO conformance or signature-validation system.

**If Ghostscript is unavailable:** the built-in embedded-image optimizer is tried after the lossless pass, including a bounded target-size profile search. It recompresses compatible image XObjects without intentionally rasterizing native text/vector content. If no supported image objects can be safely made smaller (for example, because the PDF uses unsupported image codecs or is encrypted), the original/lossless candidate is retained and the report explains the limitation. Whole-page raster fallback remains explicitly opt-in.

## Build and checks

Run `npm ci`, then `npm run web:build` or `npm run build:win`. Tests: `npm run test:pdf` exercises validation, option normalization, measured lossless/target flows and summary metrics; `npm run test:access` runs the existing access-policy, telemetry, and review-queue checks. A fresh Vite/Windows package build must be performed in an environment with npm registry access.
