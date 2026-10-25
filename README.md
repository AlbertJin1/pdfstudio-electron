# PDF Studio — Windows desktop app

**PDF Studio 3.0.2** is an Electron desktop rebuild of the original PDF Studio, for **Windows only**. The new app uses Electron + Node.js for native desktop capabilities, React for the interface, Tailwind CSS for styling utilities, PDF.js for PDF rendering, and `pdf-lib` for page composition and export.

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

Run `build_publish.bat` or `npm run build` (alias of `npm run build:win`). To build **and** upload the build as the latest release, run `release.bat` ( `release.bat noupload` builds only, `release.bat -Force` uploads even if the monitor already has the identical exe).

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

- Responsive workspace with a unique, modern UI, light and dark themes, live page preview, document source list, and local-only status.
- Import multiple PDF and image files, mixed-source workspaces, drag-and-drop file import, per-file source overview, and image pages.
- Drag-and-drop page reordering; click, Ctrl/Cmd-click and Shift-click selection; search within the page list.
- Rotate, duplicate, delete, reverse order, insert blank pages, undo and redo common page-list changes.
- Native open/save/folder dialogs in Electron and custom desktop window controls.

### PDF and conversion actions

- Combine multiple PDFs and images into a single PDF.
- Export the current page order, selected pages, rotations and added overlay objects.
- Export page ranges as separate PDFs, split into single-page PDFs, or split into groups of N pages.
- Add text overlays, optional page numbers, and text watermarks.
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
- Motion for React (the maintained successor to Framer Motion) powers page transitions, settings-tab changes, shared active-navigation movement, staggered dashboard cards, page/document list layout changes, dialog enter/exit, inspector panels, loading overlays, toast notifications, and update-status/progress transitions. Buttons and tool cards use spring-based hover and press feedback. Animations are intentionally short and restrained rather than decorative. The in-app Reduce motion option and the operating-system accessibility preference are respected.
- The Updates & downloads center silently checks for updates after launch, downloads new packages in the background, verifies the published SHA-256, and offers Update now / Update later when a package is ready. The service URL and credentials remain in the Electron main process and are not shown in the UI.
- Desktop usage reporting starts as soon as Electron is ready and sends `open`, `heartbeat`, and `close` events to Universal App Monitor. It supports both `/pdfstudio-monitor/api/` and `/pdfstudio-monitor/public/api/` deployments, validates the JSON acknowledgement, retries transient network failures, and writes rejected-report details to `monitor-usage.log` in the app user-data folder.

### Motion and accessibility

The renderer uses the `motion` package with imports from `motion/react`. This is the current Motion for React API, previously known as Framer Motion; it supports React 18.2+ and is compatible with this React 19 project. See the [official Motion for React installation guide](https://motion.dev/docs/react-installation). Motion is used for meaningful state feedback (navigation, view changes, dialogs, page lists, and update progress), not continuously moving decoration. The Settings > Appearance > Reduce motion option limits application animations, and OS-level reduced-motion preference is also detected.

## Important limitations

This is a functional Electron rebuild and does not include every feature of the earlier C# app.

- Text overlays are added on top of a page. The current UI does not rewrite existing PDF text objects in-place.
- “Cover area” is a visual rectangle overlay, **not secure/certified redaction**. Do not rely on it to remove confidential data from the underlying PDF structure.
- PDF-to-Word exports selectable text into regular DOCX paragraphs with page breaks. It does not yet match the legacy app’s advanced table reconstruction, image placement, and OCR fallback; scanned PDFs without text layers may produce little or no text.
- Word-to-PDF is based on DOCX-to-HTML conversion and Chromium printing. Documents with complex layouts, custom fonts, or special floating objects may not look exactly the same as in Word.
- PDF export uses object streams, but does not promise a smaller file size; it does not yet expose a dedicated image-downsampling compression engine.
- PDF encryption on output, permission restrictions, true redaction, signature library management, OCR customization, device access control, and the full legacy editor are not migrated in this release. The Electron app now uses the legacy Monitor for anonymous session reporting and verified staged updates. Update installation is explicitly user-approved; it is never run automatically without the Update now action.
- Some encrypted or malformed PDFs may be exported as page images if PDF.js can render them but `pdf-lib` cannot copy their original structure. Those output pages will not retain selectable text.
- TIFF/GIF/WebP support for image embedding relies on Chromium decoding the imported image; unsupported inputs should be converted to PNG/JPEG first.

## Architecture

```text
PDFStudio-Windows/
├── electron/
│   ├── main.cjs          # Electron window, dialogs, local file operations, DOCX → PDF
│   └── preload.cjs       # Small allow-listed IPC surface (context isolation enabled)
├── src/
│   ├── App.jsx           # Responsive workspace, page tools, conversions and dialogs
│   ├── index.css         # Tailwind entry plus custom design system and responsive UI
│   ├── main.jsx
│   └── lib/pdfWorkspace.js # PDF.js rendering, page composition, export and DOCX creation
├── build_publish.bat     # Builds the single portable publish\PdfStudio.exe
├── release.bat           # build_publish.bat + upload to the Monitor with CHANGELOG notes
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

### PDF Studio Monitor update channel

The updater uses a hardcoded Monitor API endpoint matching the legacy C# client. It is defined in `electron/main.cjs`, is not user-configurable, and cannot be overridden by saved preferences or a settings field:

`https://pdfstudio.shares.zrok.io/pdfstudio-monitor/api`

Like `Services/UsageTracker.cs` / `Services/UpdateService.cs` in the legacy client, Electron requests `GET /update.php?action=latest&version=<current-version>` with the `X-Api-Key` header and `ngrok-skip-browser-warning: 1`. The API key is intentionally the matching client-side key configured as `api_key` in the Monitor's `config/config.php`; changing the Monitor key requires updating both clients. The Electron main process only sends that header to the configured HTTPS Monitor API path and does not forward it to unrelated redirect hosts.

Windows uses the existing legacy-compatible `action=latest` / `action=download` release channel. The update UI shows only generic checking, download, and readiness states. It does not display the endpoint, API key, server link, or external release-page URL.

New packages are downloaded to the app’s private update-staging directory in the background, verified against the published SHA-256, and persisted across restarts. When a verified package is ready, the user is prompted to choose Update now or Update later. The package is never executed without the user choosing Update now.
## Installation and application icon

The Motion animation dependency is pinned to the published `13.5.0` package set because the previous lockfile referenced a missing `motion-utils@14.5.0` tarball. Use `npm ci` to install from the corrected lockfile.

The desktop app icon is a hand-authored vector asset at `public/icons/pdf-studio.svg`, with PNG and ICO exports generated from that same source. The Windows executable and taskbar use the ICO; the in-app brand uses the PNG. Electron windows and the in-app brand/About view use the same icon.



#### Renderer app-icon asset paths

The titlebar and About dialog refer to `./icons/pdf-studio.png` relative to `dist/index.html`, and favicon links are also relative. This is intentional: packaged Electron windows load the renderer with `file://`, where root-absolute `/icons/...` paths can resolve outside the app bundle. Vite's `base: './'` and the relative paths keep these icons working in development and packaged builds.
