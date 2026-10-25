# PDF Studio — Cross-platform desktop rebuild

**PDF Studio 3.0.0** is a separate Electron desktop rebuild of the original Windows-only PDF Studio. The new app uses Electron + Node.js for native desktop capabilities, React for the interface, Tailwind CSS for styling utilities, PDF.js for PDF rendering, and `pdf-lib` for page composition and export.

The project is intended for **Windows, macOS and Linux**. It can be run as a desktop app during development and packaged as a no-install Windows portable `.exe`, macOS `.zip` containing `PDF Studio.app`, or Linux AppImage.

## Quick start

Install a supported **Node.js LTS release** and npm. Then, in this folder:

```bash
npm install
npm run dev
```

The development command starts Vite and Electron together. The desktop app does not need a cloud account or PDF conversion server.

## Build desktop releases

Run the command for the operating system you are targeting, or use the included OS-specific scripts:

| Target | Command | Output |
|---|---|---|
| Windows | `build-windows.bat` or `npm run build:win` | Portable `.exe` only; no installer |
| macOS | `./build-macos.sh` or `npm run build:mac` | Portable `.zip` containing `PDF Studio.app` |
| Linux | `./build-linux.sh` or `npm run build:linux` | Portable `.AppImage` |
| Unpacked app directory | `npm run build:dir` | Unpacked Electron application |

On macOS, `build-macos.command` can also be double-clicked in Finder. The `.sh` scripts intentionally require the matching OS and optionally accept `x64` or `arm64` as an argument. macOS ZIP and Linux AppImage outputs are no-install packages; they are not setup installers.

Build on the target OS for the most reliable signed/native release. The Windows output is written to `release/`. Code signing is not configured in this rebuild; Windows or macOS may show the normal warning for unsigned applications until a signing identity is supplied.

To verify the frontend bundle without packaging the desktop shell:

```bash
npm run check
```

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

## Important limitations

This is a functional cross-platform rebuild, **not a line-for-line port of every legacy Windows feature**. The original C# project is retained in `legacy-windows/` for reference and has not been compiled into the Electron app.

- Text overlays are added on top of a page. The current UI does not rewrite existing PDF text objects in-place.
- “Cover area” is a visual rectangle overlay, **not secure/certified redaction**. Do not rely on it to remove confidential data from the underlying PDF structure.
- PDF-to-Word exports selectable text into regular DOCX paragraphs with page breaks. It does not yet match the legacy app’s advanced table reconstruction, image placement, and OCR fallback; scanned PDFs without text layers may produce little or no text.
- Word-to-PDF is based on DOCX-to-HTML conversion and Chromium printing. Documents with complex layouts, custom fonts, or special floating objects may not look exactly the same as in Word.
- PDF export uses object streams, but does not promise a smaller file size; it does not yet expose a dedicated image-downsampling compression engine.
- PDF encryption on output, permission restrictions, true redaction, signature library management, OCR customization, Version 3 self-updating, device access control, usage telemetry/monitor integration, and the full legacy editor are not migrated in this release. The legacy C# updater remains in `legacy-windows/` to migrate Windows users to the portable V3 launcher; it is not a cross-platform updater for the Electron app.
- Some encrypted or malformed PDFs may be exported as page images if PDF.js can render them but `pdf-lib` cannot copy their original structure. Those output pages will not retain selectable text.
- TIFF/GIF/WebP support for image embedding relies on Chromium decoding the imported image; unsupported inputs should be converted to PNG/JPEG first.

## Legacy C# → Version 3 migration

Version 3 is a portable Electron EXE, not an installer. The Monitor 2.4.8+ updater API enforces a safe bridge gate: legacy clients below 2.8.15 receive the bridge release first, even if 3.0.0 is already published. Deploy the updated Monitor source before the V3 rollout. Build it with `build-windows.bat` and publish the output using `publish-v3-portable-to-monitor.bat`. The Monitor publishes the launcher through the existing `PdfStudio.exe` update channel. Existing C# builds can replace their EXE when their folder is writable; the patched 2.8.15 bridge also supports a user-local portable fallback when the old folder is protected. For the most reliable migration, publish and test the 2.8.15 bridge first, then publish Version 3 after bridge users have received it. There is no NSIS, Setup EXE, or install requirement. See [MIGRATION-V3.md](MIGRATION-V3.md) for the rollout workflow.
## Architecture

```text
PDFStudio-CrossPlatform/
├── electron/
│   ├── main.cjs          # Electron window, dialogs, local file operations, DOCX → PDF
│   └── preload.cjs       # Small allow-listed IPC surface (context isolation enabled)
├── src/
│   ├── App.jsx           # Responsive workspace, page tools, conversions and dialogs
│   ├── index.css         # Tailwind entry plus custom design system and responsive UI
│   ├── main.jsx
│   └── lib/pdfWorkspace.js # PDF.js rendering, page composition, export and DOCX creation
├── legacy-windows/       # C# 2.8.15 migration bridge and legacy Windows source
├── build-macos.sh        # macOS packaging script
├── build-linux.sh        # Linux packaging script
├── MIGRATION-V3.md       # legacy-to-Electron migration/release sequence
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
