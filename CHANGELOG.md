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
