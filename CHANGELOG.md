# PDF Studio Changelog

## 3.0.10

_Taskbar fix: the running app and its pinned icon now share one taskbar button._

### Taskbar
- Every window now carries the app's stable Windows identity plus a relaunch command that points at the real portable EXE (not the temporary unpacked copy), so the pinned icon and the running window group into a single taskbar button.
- On startup, an existing taskbar pin of this EXE is linked to the same identity (best effort; only the pin's app ID is changed). Windows may need Explorer restarted or a sign-out/sign-in to show the change once.
- Launching the app again only brings the running window forward (and shows it if hidden); it never opens a second window.
- During an update, the old window is hidden before the new build starts so two taskbar buttons never appear side by side. If the new build cannot start, the window comes back.

## 3.0.9

_Test release for the in-place update: installing this from 3.0.8 should keep the same file name and leave no `.old` file behind._

## 3.0.8

_In-place update release: the app keeps the same file name when it updates._

### Updates
- Updates now replace the app **in place under the same file name** (no more `PdfStudio-<version>.exe` copies). A running portable EXE cannot be renamed by Windows, so a short helper step finishes the update: the old app closes, the helper renames the old EXE to `<name>.old`, puts the new build under the original name and starts it. The new version then deletes `<name>.old` (and the helper's temporary `<name>.updating.exe`) as soon as the old process has exited.
- Every step is written to `%AppData%\PDF Studio\update.log` for troubleshooting.
- If anything fails, the previous EXE is restored under its original name. If the EXE's folder is read-only or the rename is refused, the previous behavior (versioned name, then taking over the old name) is used as a fallback.
- Updating *from* 3.0.7 or older still uses the old flow once, because the old version performs that step; the new version tidies up and takes the original name. Every update after that uses the in-place swap.

## 3.0.7

_Update reliability release for PDF Studio 3._

### Updates
- After an update installs successfully, the new version deletes the previous PDF Studio EXE and then renames itself to that EXE's file name, so a copy the user renamed (and any shortcut or taskbar pin pointing to it) keeps working. Older `PdfStudio-<version>.exe` copies left by earlier updates are removed too.
- The old file is locked while it runs, so this happens a few seconds after the new version starts, retrying until the old process has exited. If the rename is refused, the new EXE simply keeps its versioned name.
- Guarded: only the EXE the old version recorded for itself (same folder, same size), only when the running version is newer, and never the running file.

## 3.0.6

_Application-aware monitoring and reliability update for PDF Studio 3._

### Monitoring and compatibility
- PDF Studio monitor requests identify the application explicitly with `app_id=pdfstudio`, while retaining the legacy `app=pdfstudio` field for older Monitor gateways.
- Desktop telemetry, access checks, reviews, and update requests remain scoped to PDF Studio so they cannot be confused with sessions or releases from other applications hosted by the Universal App Monitor.
- The existing Monitor gateway compatibility paths are retained, allowing the updated client to work with the multi-application routing fix.

### Startup and packaging
- Includes the hardened startup-splash handshake, watchdog, and renderer failure recovery.
- Carries forward the portable packaging optimizations documented for the 3.0.5 build work, reducing unnecessary bundled OCR and native runtime assets while preserving the built-in PDF features.

## 3.0.4

_PDF Studio 3 is a ground-up rebuild of PDF Studio on Electron, and the first release after the legacy 2.8.x line. Your documents are still processed on your own computer._

### Highlights
- **All-new app.** A new interface with light and dark themes, six accent colors, a fast page workspace and a built-in guided tour (press F1 any time).
- **One portable file.** PDF Studio ships as a single `PdfStudio.exe`. There is no installer, no admin prompt and nothing else to download.
- **Four new tools.** Image to text (OCR), Format converter, Photo Editing and a much bigger Edit PDF workspace.
- **Smarter updates.** Later updates download only what changed and are verified before you are asked to install.

### New tools
- **Edit PDF.** Click existing text or images to change them, add text, images, signatures, highlights, underline, strikeout, freehand ink, rectangles, ovals, lines, sticky notes and status stamps. Rulers, guides, margins and snapping keep everything lined up. Saved signatures can be drawn, typed or uploaded. Save As creates a new PDF and never touches your original.
- **Image to text.** Offline OCR for photos, screenshots and scans, with English, Filipino and Cebuano built in. Paste a screenshot with Ctrl+V, copy the result or save it as .txt. Emoji in the picture are recognized and kept in the text.
- **Format converter.** Convert HEIC, WebP, PNG, JPG, AVIF, TIFF, GIF, BMP, SVG and ICO to JPG, PNG, WebP or BMP in batches, fully offline. A privacy shield shows hidden GPS, camera and owner data and lets you strip it. You can also compress each file to fit a size limit from 100 KB to 5 MB.
- **Photo Editing.** A dedicated workspace to crop, rotate, flip, resize, adjust brightness, contrast and saturation, blur, add a text watermark and remove EXIF/GPS data.

### Page workspace
- Open PDFs, images and Word files together and arrange them as pages. Drag to reorder, select with click, Ctrl or Shift, then rotate, duplicate, delete, reverse or insert blank pages, with full undo and redo.
- Full-screen page preview, page search, and a Recent sources list for the session.
- Export in the current order or only the selected pages, with paper-size fitting, page numbers, diagonal watermarks and optional AES-256 password protection.
- Split a PDF by every page, every N pages or custom ranges such as 1-3, 4, 6-8.

### Convert and compress
- **PDF to Word** has four modes: Automatic hybrid, Editable, Layout-preserving and Visual replica. Tables stay real Word tables, pictures and signatures come across as separate images, and hidden or covered text is no longer exported. A quality report checks the result.
- **PDF to images** exports pages as PNG or JPG.
- **Compress PDF** has quality presets, an Ultra mode, a target size in MB or percent, a side-by-side preview and integrity checks. It keeps text, links and forms wherever possible, skips signed PDFs, and only uses page rasterizing if you allow it.
- **Images to PDF** builds a PDF from your image files.

### Look, feel and accessibility
- Light, dark or system theme, six accent colors, three text sizes, compact or comfortable density, high contrast and a Reduce motion option.
- Keyboard shortcuts throughout, including Ctrl+O, Ctrl+1 to 5, Ctrl+S, Ctrl+Z and Ctrl+Y.
- Rate PDF Studio from the About window. Reviews made offline are saved and sent later.

### Updating
- Installs on 2.8.15 or later are offered V3 through the in-app updater. Older installs are offered 2.8.15 first.
- V3 to V3 updates download only the changed parts and check SHA-256 before you are asked to choose Update now or Update later.

### Good to know
- Whiteout and text cover-ups are visual only. They are not secure redaction.
- PDF to Word is not Acrobat-grade. Check complex forms, scans and merged tables in Word.
- Not carried over from 2.8.x: certified redaction and some legacy editor features.

## Developer and release notes (3.0.7)

_Not shown in the update window. The uploader only sends the `## 3.0.7` section above._

### Build and release
- Application version, lockfile and the renderer fallback version are aligned at `3.0.7`.
- `electron/services/old-version-cleanup.cjs` is new; `npm run test:update` now also runs `tests/old-version-cleanup.test.cjs`.
- Rebuild the Windows portable EXE on the supported Windows build machine before publishing; this source package does not claim to contain a newly built `PdfStudio.exe`.
- Test the rename path once with a custom-named EXE on real Windows before shipping.

## Developer and release notes (3.0.6)

_Not shown in the update window. The uploader only sends the `## 3.0.6` section above._

### Build and release
- Application version and lockfile are aligned at `3.0.6`; the renderer fallback version is aligned as well.
- The release uploader discovers the matching changelog section from the built EXE version instead of relying on a hard-coded release number.
- Monitor requests explicitly identify the PDF Studio application. The Universal App Monitor must include the multi-application gateway routing fix (2.4.26 or newer).

### Validation
- `tests/startup-splash.test.cjs` verifies the startup handshake and asserts that the package and lockfile versions are both `3.0.6`.
- Rebuild the Windows portable EXE on the supported Windows build machine before publishing; this source package does not claim to contain a newly built `PdfStudio.exe`.

## Developer and release notes (3.0.4)

_Not shown in the update window. The uploader only sends the `## 3.0.4` section above._

### Stack
- Electron 45, React 19, Vite 8, Tailwind CSS 3, Motion 13, PDF.js 6, pdf-lib, `docx`, tesseract.js, libheif-js, utif and Ghostscript WASM.
- Security: context isolation and sandbox on, Node integration off, a small allow-listed preload bridge, and hardened Electron fuses.
- User data lives in `%AppData%\PDF Studio`. The portable EXE never writes next to itself.

### Build and release
- Single x64 portable `publish\PdfStudio.exe` built with `compression: maximum`. Optional OCR and native Ghostscript runtimes are staged only when requested (see `docs/PORTABLE-SIZE-OPTIMIZATION-3.0.5.md`).
- `release.bat` validates product name `PDF Studio`, EXE version against `package.json`, and this changelog heading, then uploads to the Monitor over LAN or public zrok in resumable, SHA-256-verified chunks.
- The Monitor must be 2.4.24 or newer for the launcher to be accepted, and 2.8.15 must stay downloadable. See `RELEASE-UPLOAD.md` and `docs/UPDATER-ROLLOUT-3.0.4.md`.

### Updater
- Content-defined chunk delta for V3 to V3, with a Monitor ZIP fallback and then the raw EXE. Every chunk and the final EXE are verified, and nothing runs until the user picks Update now.
- 3.0.3 clients lack this code, so their first update to 3.0.4 uses the full EXE.

### Known server requirement
- Review submissions require Universal App Monitor 2.4.26 or newer, whose gateway validates review events and routes them under `app_id=pdfstudio`. Older gateways return HTTP 400 and the app keeps the review queued.

### Test commands
- `npm run test:pdf`, `test:access`, `test:update`, `test:release-script`, `test:build-size`, `test:photo-editor`, `test:branding`, `test:theme-ux`, `test:workspace-ui`