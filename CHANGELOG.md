## Unreleased

### Format converter (new tool)
- Fixed: dropped or picked images were rejected as "the file is empty" in newer Chromium/Electron (where File.bytes is a method, not data).
- Reachable from Overview, the Convert files view (which now also lists Image to text) and the sidebar Quick tools.
- Converts HEIC/HEIF, WebP, PNG, JPG, AVIF, TIFF, GIF, BMP, SVG and ICO into JPG, PNG, WebP or BMP, in batches, entirely offline. The real format is detected from the file contents, so a mislabelled file still converts.
- **Privacy shield**: shows what each photo secretly carries (GPS location, camera, date, serial number, owner, embedded thumbnail) and lets you remove everything, keep camera and date but drop location and personal info (JPG output), or keep all details. Converted files get a freshly built EXIF block, so removed data cannot linger in unused bytes.
- **File size limit**: squeezes each JPG/WebP under 100 KB - 5 MB by choosing the best quality that fits, shrinking the picture only when it must.
- Resize to a maximum side, quality slider, background color for transparent areas (JPG/BMP), EXIF orientation handled, save one file or a whole folder.
- New dependencies: `libheif-js` (HEIC decoding, WebAssembly, loaded only when a HEIC file is converted) and `utif` (TIFF). libheif-js is LGPL-3.0: keep its licence notice with releases.
- The drag-and-drop overlay now says "Only images..." for image tools instead of "Only PDF files".

### Image to text
- Pasting a screenshot (Ctrl+V) now replaces the previous image and its extracted text, so the next extraction always shows fresh output. Adding files with the picker or drag-and-drop still appends to the queue.
- Emoji recognition: emoji in the image are located, matched to the closest standard emoji from the system emoji font and written back into the text at the right place (new "Recognize emoji" option, on by default). Emoji are painted out of the OCR copy so they no longer appear as junk such as `&)`.
- Stray low-confidence punctuation specks (for example the edge of an avatar) are removed from lines that contain real words.
- "Save as .txt" writes a UTF-8 byte-order mark when the text has emoji or accents so Notepad shows them correctly.
- OCR results number paragraphs by their position in `paragraphs`, which keeps word/line indexes aligned.

# v9

- Compression: new Ultra preset, auto-escalating size goals, forced image re-encoding, RGB/ICC stripping, stacked engines, final lossless repack, auto-raster for scans.
- New tool: Image to text (offline OCR via bundled tesseract.js; English, Filipino and Cebuano models included; add more *.traineddata in resources/ocr/tessdata).
- PDF to Word OCR now falls back to the built-in engine when native Tesseract is not installed.

# PDF Studio Changelog

## Unreleased

- Rebuilt the PDF-to-Word hybrid path so detected tables remain real, editable Word tables even on layout-preserving pages; table regions are cleared from the page-artwork layer to avoid a flattened duplicate. Placed PDF image objects, including small signature-sized objects, are emitted as independent Word pictures or embedded in the corresponding table cell. The DOCX quality report now includes package-verified counts for native Word tables and embedded image references/media, alongside existing text coverage and XML/relationship checks.
- PDF-to-Word Acrobat-parity pass: (1) text that is invisible in the PDF (covered by a later opaque shape, white-on-white, clipped) is now detected from the text-free render and no longer exported, so stray fragments like "(V01, 07/2017)" or "MEMBER 'S P" no longer print on forms; (2) a signature/logo picture that only grazes a name no longer swallows it - text is treated as burned into a picture only when at least 80% of it lies inside, which fixed the missing "OMAR IAN F. NALIPONGUIT" in editable mode; (3) kerning fragments of one word ("ref" + "er") are fused into a single run instead of being separated by a tab. Added regression assertions to tests/pdf-to-docx-e2e.test.mjs and Node harness tools (tools/convert.mjs, tools/score.py, tools/scoreall.sh) that score word recall and visual similarity against the source PDF.
- Fixed PDF-to-Word conversion failing on every file with "preflightSummary is not defined": the preflight summary was declared inside the analysis `try` block but read after it closed. It is now declared in function scope. Added an end-to-end `pdfToDocx` regression test (tests/pdf-to-docx-e2e.test.mjs, part of `npm run test:pdf`) covering Automatic hybrid, Editable, Layout-preserving and Visual replica modes.
- Improved PDF-to-Word reliability with whole-document preflight analysis and per-page Automatic Hybrid mode; dense forms, signature-heavy reports, and screenshot-rich pages use high-resolution layout preservation with editable positioned text instead of fragile wide tables. Limited OCR to scan-only/nearly textless pages to avoid damaging screenshot content, added a one-time layout-preserving retry for unsafe table grids, and strengthened DOCX XML/relationship validation.

## 3.0.4

- Added verified differential update support for compatible V3-to-V3 portable executable updates.
- Added compressed-package fallback and SHA-256 verification before a downloaded executable is staged.
- Improved the release workflow with selectable public zrok and local Monitor upload targets.
- Kept the portable Windows release as a single `PdfStudio.exe` deliverable.
