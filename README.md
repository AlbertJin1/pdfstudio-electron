# PDF Studio — Windows desktop app

**PDF Studio 3.1.0** is an Electron desktop rebuild of the original PDF Studio, for **Windows only**. The new app uses Electron + Node.js for native desktop capabilities, React for the interface, Tailwind CSS for styling utilities, PDF.js for PDF rendering, and `pdf-lib` for page composition and export.

It can be run as a desktop app during development and is packaged as a single no-install Windows portable `.exe`. There are no macOS or Linux builds.

## Quick start

Install a supported **Node.js LTS release** and npm. Then, in this folder:

```bash
npm install
npm start
```

`npm start` **builds the frontend first and then launches Electron**, so a missing `dist/index.html` cannot silently open a blank white window. For hot-reload development, use `npm run dev`; it starts Vite and Electron together. If the frontend cannot be compiled or loaded, the app displays a startup diagnostic with the next steps. The desktop app does not need a cloud account or PDF conversion server.

## Production bundle size and PDF.js runtime

The production frontend uses feature-based code splitting. PDF.js, `pdf-lib`, and DOCX generation load only when document operations need them; React, Motion, and Lucide icons are placed in cacheable vendor chunks. The PDF.js worker is copied as a local runtime asset at `public/pdfjs/pdf.worker.min.mjs` rather than imported into the JavaScript chunk graph. The default 500 kB warning threshold is intentionally left unchanged so future oversized application chunks remain visible.

`npm run web:build`, `npm start`, and the release scripts run `prepare:pdfjs-assets` before Vite. This keeps the PDF.js worker and supporting files in the packaged application even if `postinstall` was skipped during an earlier dependency install. No PDF.js assets are fetched from a CDN at runtime.

## Build the Windows release

Run `build_publish.bat` or `npm run build` (alias of `npm run build:win`). To build and publish, run `release.bat` and choose public zrok or the local Monitor (`192.168.254.110:8080`). The release script validates product/version metadata, compresses the EXE into a ZIP when smaller, uploads resumable chunks, verifies hashes, and safely falls back to the raw EXE if ZIP support is unavailable. Use `release.bat noupload` to build only, `release.bat local -Force` to force replacement, or `release.bat local -NoZip` to skip ZIP packaging.

| Command | Output |
|---|---|
| `build_publish.bat` / `npm run build` | `publish/PdfStudio.exe` — the **only** file in `publish/`; portable, no installer, no install step |

The build empties `publish/` first and removes electron-builder's intermediate files afterwards (`scripts/release-tool.cjs`), then fails if anything but the single EXE is left. See [BUILD-WINDOWS.md](BUILD-WINDOWS.md). `build_publish.bat` Authenticode-signs the exe through `signing\sign.ps1` (the same signing setup as the legacy C# build) when that script is present; otherwise the exe is left unsigned and Windows SmartScreen may show its normal warning.

To verify the frontend bundle without packaging the desktop shell:

```bash
npm run check
```

If you ever need to launch Electron directly without rebuilding, use `npx electron .` only after `npm run web:build` has succeeded and `dist/index.html` exists. Prefer `npm start` for the normal launch path.

## Included in this rebuild

### Workspace and UI

- Responsive page workspace with a unique, modern UI, light and dark themes, a fullscreen per-page viewer with zoom controls, document source list, and local-only status.
- Import multiple PDF and image files, mixed-source workspaces, drag-and-drop file import, per-file source overview, and image pages.
- Drag-and-drop page reordering; click, Ctrl/Cmd-click and Shift-click selection; search within the page list.
- Rotate, duplicate, delete, reverse order, insert blank pages, undo and redo common page-list changes.
- Native open/save/folder dialogs in Electron and custom desktop window controls.

### PDF and conversion actions

- Dedicated Edit PDF workspace with PDF.js page preview, page navigation, zoom, independent collapsible tools/page-thumbnail/properties panels, and tools for existing-text edits, new text, signatures, images, highlight, underline, strikeout, freehand ink, rectangles, ovals, lines, sticky notes, status stamps, and whiteout.
- Select, move, resize, recolor, restyle, and delete placed items; Ctrl+Z / Ctrl+Y undo and redo editor changes. Save As writes a new edited PDF and leaves the original file unchanged.
- Combine multiple PDFs and images into a single PDF.
- Export the current page order, selected pages, rotations and added overlay objects.
- Export page ranges as separate PDFs, split into single-page PDFs, or split into groups of N pages.
- Merge/export options: preserve each page size or fit all pages to A3/A4/A5/Folio (8.5 × 13 in)/Letter/Legal; diagonal DRAFT, CONFIDENTIAL, INTERNAL USE ONLY or custom watermarks; optional AES-256 open-password protection; lossless QPDF optimization or explicitly lossy compact raster export.
- Export applies page numbers and configurable diagonal text watermarks on every page; legacy overlay objects already present in the workspace are also included.
- Export PDF pages to PNG or JPEG.
- Convert selectable PDF text to editable DOCX paragraphs with page breaks.
- Import `.docx` by converting its readable content to PDF in a hidden Electron print window; layout fidelity depends on the source document.
- Save common image inputs (PNG/JPEG/WebP/BMP/GIF/TIFF where the runtime can decode them) into PDF pages.
- Password prompt for encrypted input PDFs; if the original page structure cannot be copied, the export fallback preserves the rendered page as an image.
- PDF metadata includes title, author, creator and producer on export.

### UI/UX preferences and motion

- The About dialog presents the app purpose, key capabilities, local-processing model, platform, version, and a distinct developer signature for **Jessie Albert Regualos**.
- Appearance settings include six accent presets (Violet, Ocean blue, Teal, Emerald, Rose, Amber), light/dark mode, Standard/Large/Extra large text, compact/comfortable density, high contrast, and reduced motion. Preferences persist locally.
- Keyboard-shortcut help renders Ctrl keycaps with accessible screen-reader labels.
- Motion for React (the maintained successor to Framer Motion) powers page transitions, settings-tab changes, shared active-navigation movement, staggered dashboard cards, page/document list layout changes, dialog enter/exit, editor properties panels, loading overlays, toast notifications, and update-status/progress transitions. Buttons and tool cards use spring-based hover and press feedback. Animations are intentionally short and restrained rather than decorative. The in-app Reduce motion option and the operating-system accessibility preference are respected.
- The Updates & downloads center checks after launch and stages updates in the background. For Electron v3-to-v3 updates it reuses matching content-defined SHA-256 chunks and downloads only changed parts when that is smaller than a compressed full package; otherwise it verifies and extracts the Monitor ZIP, then falls back to the raw EXE for older Monitor deployments. The final portable EXE is verified before Update now / Update later is offered.
- Desktop usage reporting starts as soon as Electron is ready and sends `open`, `heartbeat`, and `close` events to Universal App Monitor. It supports both `/pdfstudio-monitor/api/` and `/pdfstudio-monitor/public/api/` deployments, validates the JSON acknowledgement, retries transient network failures, and writes rejected-report details to `monitor-usage.log` in the app user-data folder.

### Motion and accessibility

The renderer uses the `motion` package with imports from `motion/react`. This is the current Motion for React API, previously known as Framer Motion; it supports React 18.2+ and is compatible with this React 19 project. See the [official Motion for React installation guide](https://motion.dev/docs/react-installation). Motion is used for meaningful state feedback (navigation, view changes, dialogs, page lists, and update progress), not continuously moving decoration. The Settings > Appearance > Reduce motion option limits application animations, and OS-level reduced-motion preference is also detected.

## Important limitations

This is a functional Electron rebuild and does not include every feature of the earlier C# app.

- Existing PDF text edits are applied as carefully aligned cover-and-replacement overlays. The source PDF is never mutated, and untouched page objects are preserved, but the editor does not yet rewrite arbitrary embedded PDF text operators in-place. The editor measures source text runs, keeps selection bounds tied to the source glyph box, applies the detected bold/italic flags in the live input, and resizes the replacement box to fit changed text. Complex backgrounds, transparency, rotated/skewed text, unusual encodings, and heavily subsetted fonts may still need manual review after export.
- Whiteout and existing-text cover patches are visual overlays, **not secure/certified redaction**. Covered text or images can remain in the underlying PDF content and may still be extractable. Do not rely on them to remove confidential data.
- If Arial, Calibri, or Times New Roman cannot be found locally, the desktop editor may silently cache an SIL Open Font License metric-compatible substitute (Arimo, Carlito, or Tinos) under the per-user PDF Studio data folder, without installing a Windows font. Downloading requires an internet connection; if unavailable, the editor falls back to a built-in PDF font. Other missing font families are not downloaded from arbitrary sites.
- PDF-to-Word uses a hybrid page-artwork layer plus page-positioned editable Word text frames, heuristic font/coordinate reconstruction, native Word tables for clear fully ruled grids, token/order diagnostics, and optional local Tesseract OCR. The source archive does not include the Tesseract executable or language models. This is not Acrobat Pro-equivalent: complex objects, merged/borderless tables, some unsupported text, and semantic Word headers/footers remain incomplete. See `docs/PDF-WORD-AND-COMPRESSION.md` and `resources/ocr/README.md`.
- Word-to-PDF is based on DOCX-to-HTML conversion and Chromium printing. Documents with complex layouts, custom fonts, or special floating objects may not look exactly the same as in Word.
- Standalone **Compress PDF** analyzes page text, image placements, stream/image/font resource estimates, annotations, links, fields, attachments, bookmarks, and signature markers; previews a compressed page; attempts lossless optimization first; then uses Ghostscript `pdfwrite` for object-aware image downsampling, content-aware image filters, duplicate-image reuse, font/stream compression, and font subsetting where the runtime is available. It checks page geometry, text coverage, links, form widgets, attachments, bookmarks and annotation counts and reports actual savings. The Ghostscript runtime is not bundled in this source archive. If Ghostscript is unavailable, the built-in image-object optimizer recompresses supported embedded image streams while preserving native text and vectors; unsupported image codecs may still require Ghostscript. Raster fallback remains off by default. The separate Merge/export compression choices still include explicitly lossy page-raster modes, so use standalone Compress PDF when preserving native text/vector objects matters.
- Merge/export now supports optional AES-256 open-password encryption using QPDF WebAssembly inside a dedicated Electron Node worker thread, plus lossless PDF stream optimization. Separate owner-password and granular print/copy/edit permission controls are not exposed in the UI yet. Secure/certified redaction, signature library management, OCR customization, device access control, and the full legacy editor are not migrated in this release. QPDF processing runs off the Electron UI thread and saves the finalized PDF directly from the main process to avoid sending the large output buffer through the renderer twice. The Electron app uses the legacy Monitor for session reporting and verified staged updates. Update installation is explicitly user-approved; it is never run automatically without the Update now action.
- Some encrypted or malformed PDFs may be exported as page images if PDF.js can render them but `pdf-lib` cannot copy their original structure. Those output pages will not retain selectable text.
- TIFF/GIF/WebP support for image embedding relies on Chromium decoding the imported image; unsupported inputs should be converted to PNG/JPEG first.

## Architecture

```text
PDFStudio-Windows/
├── electron/                   # Main process (Node / Electron)
│   ├── main.cjs                # Window, dialogs, local file operations, DOCX → PDF, updater
│   ├── preload.cjs             # Small allow-listed IPC surface (context isolation enabled)
│   ├── pdf-toolkit-worker.mjs  # QPDF/WASM compression and AES-256 encryption off the UI thread
│   └── services/
│       ├── ghostscript-compression.cjs  # image-aware, vector-preserving PDF rewrite integration
│       ├── access-policy.cjs   # Monitor enable / disable decision logic
│       └── monitor-api.cjs     # Monitor endpoint validation helpers
├── src/                        # Renderer (React)
│   ├── main.jsx                # React entry point
│   ├── App.jsx                 # Thin composition root: wires hooks to layout, views and modals
│   ├── components/
│   │   ├── common/             # ActionButton, IconButton, Modal, SectionLabel, SettingToggle, ShortcutKeys
│   │   ├── layout/             # TitleBar, WindowControls, Sidebar, Topbar, LoadingOverlay, Toast
│   │   ├── workspace/          # PageGridPanel, PageCard, AddPagesCard, InspectorPanel, PagePreview, ...
│   │   └── access/             # AccessLockScreen
│   ├── views/                  # HomeView, WorkspaceView, ConvertView, HistoryView
│   │   └── settings/           # SettingsView, SettingsNav and one component per settings tab
│   ├── modals/                 # ModalHost plus one component per dialog
│   ├── hooks/                  # State + behaviour (useWorkspace, useExporters, usePreferences, ...)
│   ├── services/pdf/           # PDF.js rendering, pdf-lib composition, DOCX and image export
│   ├── constants/              # Motion presets, tool list, accent presets, default preferences
│   ├── utils/                  # cx, formatting, ids, byte helpers, browser download fallback
│   └── styles/                 # index.css (Tailwind + design system) and ui-refresh.css
├── public/                     # Icons and the PDF.js worker / cmaps (copied by postinstall)
├── scripts/                    # Build tooling (release-tool, copy-pdfjs-assets)
├── tests/                      # Node tests for access policy and monitor telemetry
├── docs/                       # BUILD-WINDOWS.md, VERIFICATION.md
├── build_publish.bat           # Builds the single portable publish\PdfStudio.exe
├── release.bat                 # build_publish.bat + upload to the Monitor with CHANGELOG notes
├── run-dev.bat
├── package.json
└── README.md
```

### Security choices

- Renderer Node integration is disabled.
- Electron context isolation and sandboxing are enabled.
- The renderer can only call the explicit methods exposed by `electron/preload.cjs`.
- External navigation from the desktop window is denied; only explicit HTTPS open requests are passed to the OS.
- No document content is uploaded by this rebuild. Files are read and written locally.

## Developer

**Jessie Albert Regualos** — IT Specialist – Mindanao
## Version 3 interface and settings

The workspace UI uses a higher-contrast typographic hierarchy and larger consistent control hit areas. Settings are available from the left navigation and include:

- Light/dark theme, six accent-color presets, standard/large/extra-large interface text, comfortable/compact workspace density, high contrast, and reduced-motion preference.
- Show/hide page preview inspector and confirm-before-delete protection.
- Default PNG/JPEG image export format and stored JPEG quality.
- Local privacy information and keyboard shortcut keycaps (Control).
- An automatic update flow using the same authenticated release channel as the legacy C# app. It checks after launch, downloads packages in the background into a private staging directory, verifies the published SHA-256, and asks the user to choose Update now or Update later. Settings show generic update states and never display the endpoint or API key.

Preferences persist locally in the Electron renderer's settings storage. Reset to defaults resets preferences only; it does not delete source files or change the current document. Page deletion confirmations remove pages only from the current workspace and the operation can be undone.


### Efficient portable updates and V2 → V3 rollout

- **V3 → V3:** the updater downloads the target manifest, indexes the currently running portable launcher using the same content-defined chunking algorithm as the Monitor and legacy C# updater, then requests only missing chunk hashes. Every compressed chunk is decompressed and hash-checked before the target EXE is rebuilt; the complete rebuilt EXE must match the published SHA-256 and size.
- **Fallbacks:** if the manifest/delta path is unavailable or the changed content would cost more than a compressed full package, the updater downloads the Monitor ZIP, verifies its checksum, extracts only `PdfStudio.exe`, and verifies the final EXE. The raw EXE remains the final compatibility fallback.
- **V2 → V3:** the patched V2 C# source prefers the compressed ZIP migration package and verifies the extracted portable Electron launcher. This optimization applies only after that source is built and shipped in the bridge executable; already-installed bridge binaries cannot gain it retroactively. The V2-to-V3 transition still needs the target executable contents once because the binary architecture changed.
- **Required rollout sequence:** the Monitor selects exact `2.8.15` for clients below the bridge whenever V3 is published. Only clients reporting `2.8.15` or later are offered V3+. Keep the `2.8.15` bridge artifact available on the Monitor before publishing V3.

### PDF Studio Monitor update channel

The updater uses a hardcoded Monitor API endpoint matching the legacy C# client. It is defined in `electron/main.cjs`, is not user-configurable, and cannot be overridden by saved preferences or a settings field:

`https://pdfstudio.shares.zrok.io/pdfstudio-monitor/api`

Electron communicates with the Monitor through the server-side gateway in `server-bridge/public/api/client-gateway.php`. The desktop source and packaged EXE do not contain, load, decrypt, or send the shared Monitor API key. The gateway injects the server-side `X-Api-Key` only when proxying a small allowlist of Monitor operations; it also validates requests, enforces size/method restrictions and basic rate limits, verifies HTTPS, and never follows upstream redirects with the server key attached.

**Deployment requirement:** before using remote updates, access control, or telemetry with this build, deploy Universal App Monitor 2.4.26 (which includes the app-ID-aware gateway and application-scoped dashboards) to the existing Monitor installation. The gateway uses the same server-side `MONITOR_API_KEY` as Monitor's protected APIs and defaults to the canonical HTTPS API route; no separate gateway config file is required. Full instructions are in [`server-bridge/README.md`](server-bridge/README.md). Until the gateway is deployed/configured, local PDF features continue to work, but Monitor-backed features will report that the gateway is unavailable. The gateway supports the legacy-compatible `action=latest` / `action=download` paths plus the explicitly allowlisted `format=zip`, `action=manifest`, and POST `action=delta` operations. It injects the shared Monitor API key server-side and does not expose it to Electron. Deploy the updated Monitor 2.4.26 package before enabling compressed or differential updates. Update UI messages do not expose the API key or external release URL.

New executables are reconstructed in the app’s private update-staging directory: delta chunks and the final executable are SHA-256-verified, compressed ZIP packages are verified before extracting only `PdfStudio.exe`, and raw-EXE fallback packages are checked against the published checksum. Staging is persisted across restarts. When a verified package is ready, the user is prompted to choose Update now or Update later. The package is never executed without the user choosing Update now.
## Installation and application icon

The Motion animation dependency is pinned to the published `13.5.0` package set because the previous lockfile referenced a missing `motion-utils@14.5.0` tarball. Use `npm ci` to install from the corrected lockfile.

The desktop app icon is a hand-authored vector asset at `public/icons/pdf-studio.svg`, with PNG and ICO exports generated from that same source. The Windows executable and taskbar use the ICO; the in-app brand uses the PNG. Electron windows and the in-app brand/About view use the same icon.

The source archive omits generated `dist/` output to avoid shipping an outdated renderer bundle. Run `npm ci` and then `npm run web:build` before `npm run start:fast`; `npm run build:win` performs the frontend build automatically. Ghostscript accelerates object-aware compression when a complete, appropriately licensed runtime is installed or staged under `resources/ghostscript`; it is no longer required for basic embedded-image recompression.



#### Renderer app-icon asset paths

The titlebar and About dialog refer to `./icons/pdf-studio.png` relative to `dist/index.html`, and favicon links are also relative. This is intentional: packaged Electron windows load the renderer with `file://`, where root-absolute `/icons/...` paths can resolve outside the app bundle. Vite's `base: './'` and the relative paths keep these icons working in development and packaged builds.

## Edit PDF as an in-app tab

The Edit PDF workspace now opens as a browser-style tab in the main frameless title bar rather than creating a second Electron window. The Edit PDF tab can be switched to/from the main workspace, shows the current PDF filename, has a dedicated close control, and asks before discarding unsaved edits. While Edit PDF is active, the app's outer navigation/sidebar is hidden so the editor uses the available workspace width; the shared title bar and native-feeling window controls remain visible. `public/editor-tabs-compat.js` is a no-op when the current React title bar is present and provides a compatibility tab strip for the bundled `dist` renderer.

To create a clean distributable on Windows, install dependencies from this project folder and run `npm run build:win`. The supplied patch archive contains the updated source and compatibility runtime. A fresh Vite production rebuild could not be run in the current editing environment because package dependencies were unavailable locally and the npm registry request timed out; run the build command after `npm ci` on a connected build machine before publishing a release.


### Page reorder performance (3.0.3 patch)

Page reordering uses pointer events and requestAnimationFrame rather than the browser's throttled HTML5 dragover loop. The floating preview updates only through compositor-friendly transforms; page tiles are memoized, Motion layout animation is disabled during active reorder, and the destination placeholder stays static while dragging. Drag from a page card (or its grip); controls on the tile remain clickable.


## Review prompt and submission integration

- PDF Studio tracks cumulative active usage in `%AppData%\PDF Studio\review-state.json`; after 30 minutes of usage it considers a randomized review prompt. Prompt history and the user's choice to snooze or stop prompts are stored per Windows user installation. Successful submission suppresses future prompts. The About dialog also provides a manual `Review PDF Studio` action.
- Review payloads use the server-side Monitor gateway with `app_id=pdfstudio`; the app does not contain the Monitor API key. Deploy the paired Universal App Monitor 2.4.26 package for the corresponding server-side routing and dashboard isolation.
- **Server integration:** the paired Universal App Monitor 2.4.26 gateway validates and forwards `open`, `heartbeat`, `close`, and `review` events under the explicit `app_id=pdfstudio` namespace. Deploy the matching Monitor 2.4.26 package so the review queue and telemetry use the same app-scoped gateway.

## Review prompt and offline submission

PDF Studio saves pending review submissions in a Windows-user-encrypted local outbox and retries delivery automatically with backoff. A pending or server-acknowledged review suppresses future automatic review prompts. See [Review offline queue](docs/REVIEW-OFFLINE-QUEUE.md) for persistence, privacy, recovery behavior, and the current Monitor gateway compatibility requirement.
