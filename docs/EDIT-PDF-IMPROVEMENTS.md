# Edit PDF improvements (3.0.3 patch)

## What changed

- Added persistent, independent collapse controls for the editing tools, page thumbnails, and properties sidebar. The tool rail collapses to an icon-only rail; the other panels can be fully hidden to maximize document space.
- Corrected CSS font-family selection so PDF.js internal font object IDs are not treated as browser font names. Bold and italic state now remain reflected in the live editor instead of disappearing for fonts represented by internal PDF.js refs.
- Improved text item grouping and ordering to reduce accidental merging of adjacent form/table columns into one editable selection.
- Initialized existing-text selection boxes from measured PDF text bounds and made their live editor tall enough for the current line layout. First focus selects the old field text so replacement typing does not append unexpectedly.
- Added exact-source-font lookup for font data exposed by PDF.js, followed by installed-font lookup and a controlled open-font fallback during embedding.
- Added a per-user font cache in Electron's application data. The only automatic mappings are Arial → Arimo, Calibri → Carlito, and Times New Roman → Tinos. Download candidates are fixed HTTPS GitHub raw URLs; license text must identify the SIL Open Font License; font byte size and file signatures are checked; downloaded files are not installed into Windows or another system font directory.
- Patched the shipped `dist` bundle as well as the React/Electron source so the included prebuilt app has the panel controls and key text editing fixes without requiring an immediate rebuild.

## Export behavior and limitations

This implementation still applies edits to a copy of the original PDF. Existing text edits use a carefully sized cover area and replacement text, rather than rewriting arbitrary compressed PDF content-stream text operands in place. Untouched page content remains in the original PDF structure, but a changed text field can still require background coverage and may need visual review when it touches lines, gradients, images, transparency, rotated text, or unusual fonts. Whiteout is not secure redaction. Review the exported PDF before relying on it for official documents.

The font fallback is best-effort and requires internet access only when the selected font is missing. It does not guarantee every glyph or exact metrics for every document; unrelated or unknown families are not downloaded from arbitrary websites.

## Verification

- Source JSX/JavaScript syntax parsed successfully (87 source files in the validation run).
- `node --check` passed for the Electron main/preload files, the patched editor bundle, runtime patch, and PDF export source.
- Existing access-policy and monitor-telemetry regression scripts passed.
- A full Vite/Electron rebuild could not be completed in this environment because the npm dependency cache is incomplete and the environment cannot reach the npm registry. Rebuild with `npm install` in a connected development environment, then run `npm run check` and `npm run build:win` before publishing a production installer.
