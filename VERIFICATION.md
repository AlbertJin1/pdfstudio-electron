# PDF Studio 3 portable verification

## Checks completed in this workspace

- `package.json` parses; `npm start` now builds the Vite frontend before launching Electron, fixing the reported `ERR_FILE_NOT_FOUND` for `dist/index.html`. The only release target is the Windows `portable` EXE.
- Electron checks that the frontend HTML exists and displays an actionable startup diagnostics page instead of an empty white window if the page is missing or cannot load.
- The renderer includes a startup watchdog for frontend script/load failures that prevent React from mounting.
- `node --check electron/main.cjs`, `package.json` parsing, and the inline startup-watchdog JavaScript syntax check passed.
- Build and publish scripts point to the Windows portable artifact and do not publish an NSIS setup executable.
- Electron main process stores user data in `%AppData%\PDF Studio` and never creates a folder beside the portable EXE.

## Required on-machine validation

Static source validation was performed for this startup fix, but this environment has not verified a real Electron bundle build because this checkout does not include `node_modules`. On the target Windows machine, run `npm install`, then `npm start`; `npm start` now builds the frontend automatically. Verify that `dist/index.html` is generated before Electron opens. Also run `npm run check`. Before production release, build on Windows with Node.js/npm; verify `publish\PdfStudio.exe` (built by `build_publish.bat`) reports `ProductName=PDF Studio` and `FileVersion=3.0.0.x`; confirm no installer/UAC appears; and upload the actual portable EXE to the monitor.
## UI/UX and settings update

- JSX syntax verified with the TypeScript TSX parser; no syntax diagnostics.
- CSS parsed successfully with PostCSS.
- Electron main/preload scripts pass `node --check`.
- Added persisted preferences for theme, font scale, workspace density, reduced motion, page inspector visibility, delete confirmation, and image export defaults.
- Added confirmation flow for deleting pages, including toolbar, keyboard, and page-menu entry points.
- A full Vite build was not run in this environment because the project dependencies are not installed (`vite: not found`); run `npm install` and `npm run check` on the target machine before packaging.


## UI/UX preferences and updater validation

Static checks completed for the UI update:

- `src/App.jsx` and `src/main.jsx` parsed using the TypeScript JSX transpiler without syntax diagnostics.
- `src/index.css` parsed using PostCSS.
- `electron/main.cjs` and `electron/preload.cjs` passed `node --check`.
- The update IPC bridge exposes platform detection, automatic/manual release checks, persisted background download progress, cancellation, staged-package readiness, and explicit Update now / Update later choices.
- Update checks are bound to the configured zrok PDF Studio Monitor API; downloads are HTTPS-only, are bounded at 2 GB, use unique safe filenames, clean up partial files on failure/cancel, and require a valid Monitor-published SHA-256 checksum before saving the finished package.

A fresh Vite production build was **not verified in this environment**: npm dependency installation could not complete because the npm registry request timed out, leaving `vite` unavailable. On a machine with registry access, run `npm ci` followed by `npm run check`; `npm start` and the packaging scripts rebuild the frontend from the updated React/CSS sources.

Before publishing, manually verify six accent presets and all text-size options in Settings; dark mode, high contrast, reduced motion, responsive About layout, platform-specific shortcut keycaps; then test Monitor no-update and new-update cases on Windows, a successful authenticated download, cancellation, invalid/mismatched checksum, and unreachable/unauthorized Monitor responses. The staged updater applies only after the user chooses Update now. Windows portable launcher replacement still requires a native packaging check on Windows.


## Motion and application animation pass

- Added the maintained Motion for React API (`motion/react`) as an explicit production dependency; the application uses the same hardcoded zrok Monitor URL and updater IPC paths as before.
- Added coordinated app-entry and view transitions, settings-tab presence animations, animated shared navigation selection, dashboard/conversion card stagger, page/document list layout changes, inspector visibility feedback, modal backdrop/card enter and exit, loading/toast presence transitions, button hover/press springs, and updater status/progress animation.
- Animations are kept short and restrained; the in-app Reduce motion setting and the operating system's reduced-motion preference are respected. CSS fallbacks also suppress transition/animation duration when reduced motion is requested.
- Static TypeScript JSX transpilation passed for `src/App.jsx` and `src/main.jsx`; JavaScript syntax checks passed for the Electron main/preload files; `package.json` and `package-lock.json` parsed and the Motion package dependency chain was confirmed present.
- The zrok endpoint is hardcoded only in the Electron main process. The renderer receives sanitized update state and never displays the endpoint or API key.
- A fresh Vite production build could not be confirmed in this environment because npm registry access timed out during prior dependency restoration. Run `npm ci` and `npm run check` on a machine with registry access, then interactively test page/view changes, dialogs, page reordering and removal, update progress, and both in-app and OS reduced-motion behavior before release.

## PDF Studio Monitor updater wiring

- The Electron update base URL is fixed to `https://pdfstudio.shares.zrok.io/pdfstudio-monitor/api`, matching the legacy C# `UsageTracker.DefaultBaseUrl` exactly.
- The request shape matches `Services/UpdateService.cs`: `GET update.php?action=latest&version=<app version>` with `X-Api-Key` and `ngrok-skip-browser-warning: 1`.
- Windows packages use the Monitor's backward-compatible `action=latest` / `action=download` URLs.
- The download handler accepts only HTTPS URLs from the PDF Studio Monitor API and only the Monitor `download` action.
- Main-process requests verify any Monitor SHA-256 value before committing the downloaded file and delete partial files on failures/cancellation.
- Static JavaScript syntax and archive integrity must be checked on the target build environment; a live remote check and full package build require reachable zrok Monitor service and npm dependencies.

Targeted mocked updater integration tests passed for Windows (legacy `action=latest` / `action=download`). Tests verified the zrok host/path, release query parameters, `X-Api-Key` and tunnel-warning headers, successful SHA-256 validation, and rejection of non-Monitor download URLs. A live zrok request could not be verified in this environment because DNS resolution for `pdfstudio.shares.zrok.io` failed; recheck against the deployed Monitor before publishing.


## Production chunk warning remediation (2026-10-25)

- Replaced the statically imported PDF.js worker URL with a local `public/pdfjs/pdf.worker.min.mjs` runtime asset, copied from the exact installed `pdfjs-dist` version. All build/dev commands now run the PDF.js asset preparation script first.
- PDF.js, `pdf-lib`, and `docx` are dynamically imported by the specific operations that need them. PDF.js uses its official minified entry point to avoid shipping the unminified main library into a large application chunk.
- Added Vite 8 / Rolldown code-splitting groups for React, Motion, and Lucide React. The 500 kB warning threshold has not been raised.
- Source syntax and configuration checks were run, but the production bundle was not rebuilt in this environment because the dependency cache lacks the required npm tarballs and registry access is not available here. Run `npm ci` and `npm run check` on a connected development machine and confirm that every reported JavaScript chunk is under 500 kB; the PDF.js worker should appear only as a copied public runtime asset, not as a JavaScript chunk.

## Background update and Monitor session tracking

- The app checks shortly after its main window opens, retries transient failures after 15 minutes, and repeats periodic checks during long sessions. Verified packages are persisted in the user-data update staging directory; a staged update remains available if the connection is temporarily unavailable.
- Once verified, the app shows an Update now / Update later dialog. Update later defers installation for the current app session and retains the staged package for the next launch.
- Legacy-compatible session telemetry sends `open`, cumulative `heartbeat` (every 60 seconds) and `close` events with `app`, version, OS, stable random install ID, random session ID, hostname, local IP, start time and elapsed seconds. Failed events are queued locally and retried. Document content, PDF bytes and file names are not part of telemetry.
- UI status text is intentionally generic: the hardcoded service endpoint and API key remain in the main process, and connection details are not rendered in Settings.
- Static syntax and source-contract checks were run. A live zrok request and production build were not verified in this environment.

## Spinner stability and OS version reporting (2026-10-25)

- The Updates & Downloads status tile is now a static wrapper; only the inner Lucide `LoaderCircle` glyph rotates while checking/downloading/applying. This prevents the rounded status tile/background from rotating with the spinner.
- Electron session events now send conventional OS names. On Windows, kernel `10.0.<build>` maps to Windows 11 when the build is at least 22000 and Windows 10 otherwise; legacy kernel versions map to Windows 8.1/8/7/Vista/XP/2000. Architecture remains visible, e.g. `Windows 11 (x64)`.
- Syntax checks passed for Electron main/preload, the React JSX source, and CSS. The Monitor OS formatter was separately exercised against Windows 11, Windows 10, Windows 8.1, Windows 8 and Windows 7 payload formats.


## Telemetry delivery fix (3.0.1, 2026-10-25)

- Desktop telemetry now starts when Electron becomes ready instead of depending only on the window `ready-to-show` event.
- The Monitor API client supports both the rewritten `/pdfstudio-monitor/api/` path and direct `/pdfstudio-monitor/public/api/` path, falls back on route/auth/not-found errors and HTML tunnel responses, and keeps API credentials restricted to the configured Monitor host and approved API paths.
- A telemetry event is considered delivered only when the Monitor returns valid JSON with `ok: true`. Transient failures are queued; permanent API rejections are logged instead of being falsely reported as successful.
- Desktop diagnostics are written to `monitor-usage.log` under the app's user-data folder. Monitor-side accepted/rejected events are logged to `logs/desktop-telemetry.log` with size-capped rotation.
- Regression checks: `node --check electron/main.cjs`, `node --check electron/monitor-api.cjs`, `node scripts/test-monitor-telemetry.cjs`, and PHP syntax validation passed. The live Monitor endpoint could not be tested from this environment because its DNS host was not resolvable here; a fresh GUI package build also requires the project dependencies to be installed.


## Device access control: Monitor enable / disable (3.0.2, 2026-10-25)

- The Monitor administrator can now disable a single PC from the dashboard's Installs table, and the Electron app honours it exactly like the legacy Windows client: `electron/access-policy.cjs` polls `api/access.php` with the shared API key (about every 30 seconds, and again when the window regains focus), using the same canonical/`public/api` route fallback as telemetry.
- New and unknown devices are enabled by default and PDF Studio never waits for the network to start. A "disabled" answer locks the app immediately; an "enabled" answer unlocks a running copy on the next successful check. The Monitor's canonical install id is adopted so the policy follows the PC after a reinstall.
- The last answer is cached in `monitor-access.json` (user-data folder) and loaded synchronously before the first window is created, so a disabled device stays locked after a restart or while the Monitor is unreachable. Network errors, 401/404/5xx and tunnel HTML pages never change the current decision; only a valid policy can lock or unlock.
- Enforcement is in the main process: `files:open`, `files:save` and `files:save-batch` refuse while locked. The renderer shows a full-screen lock screen (administrator's reason, computer name, device id, who/when, offline note, "Check again", "Quit PDF Studio"), makes the application shell inert, and also guards the picker, drag-and-drop and shortcuts. Telemetry continues while locked so the administrator still sees the device.
- Tests: `npm run test:access` (policy parsing, cache, back-off, fail-safe transitions, route fallback, wiring checks). Also verified end to end against the real Monitor code on PostgreSQL (new device enabled -> admin disables -> reinstall with a new id stays disabled -> admin enables), and the main process was exercised with a stubbed Electron (cached lock at startup, IPC refusals, live lock/unlock, monitor-down behaviour). A full GUI run requires building and launching the Electron package.

## In-app Edit PDF tabs (2026-10-26)

- Replaced the renderer's `editor:open` launch path with in-app mode navigation; the preload no longer exposes the separate-window `openEditor` method.
- Added browser-style title-bar tabs (PDF Studio and Edit PDF), a plus button to open the editor, active-state indicators, and a close-tab action.
- The Edit PDF route hides the standard application sidebar and secondary topbar to give the editor full workspace width while keeping the main title bar and minimize/maximize/close controls.
- Added tab-title and dirty-state callbacks, a per-tab unsaved-edit confirmation, `Ctrl+W` support for closing the Edit PDF tab, and a main-window close guard for unsaved edits.
- Added `public/editor-tabs-compat.js` and copied it into the prebuilt `dist` output so the previous renderer bundle can show an in-app tab instead of a detached editor window.
- Validation: `node --check` passed for the compatibility script, preload, and main process; TypeScript JSX transpile diagnostics reported no syntax errors for `src/App.jsx`, `src/components/layout/TitleBar.jsx`, and `src/views/EditPdfView.jsx`; access policy and monitor telemetry regression tests passed.
- Production Vite build not run: `node_modules/.bin/vite` was unavailable, offline npm install reported a missing cache entry, and the online npm install request timed out.


## Edit tab and page-reordering UX update

- The page-route `AnimatePresence` subtree is now not mounted while Edit PDF is active, preventing the Overview/Home view from remaining under the editor. The editor stays mounted in its own persistent panel so switching tabs preserves state.
- Page reorder now shows a page thumbnail placeholder and a numbered destination slot before/after the hovered page, including an end-of-list slot. The destination number accounts for removing the dragged page from its original position.
- The native drag source stays mounted but is removed from grid flow during drag; a live cloned page follows the cursor with direction- and speed-responsive tilt/sway.
- Drop placement is determined from the pointer's actual side at release time to avoid stale drop-cue state. Dropping on Add Pages now moves the page after the last page other than itself.
- JSX syntax checks passed for the touched files. `scripts/test-access-policy.cjs` and `scripts/test-monitor-telemetry.cjs` passed.
- Full Vite build could not be run in this packaging environment because the archive's `node_modules/pdfjs-dist/package.json` and Vite executable are not installed; run `npm install` followed by `npm start` on the Windows development machine to verify the production build.


## Page reorder lag optimization

- Replaced native page `dragover` sorting with pointer-event tracking and requestAnimationFrame rendering.
- Removed per-event CSS transition and box-shadow updates from the drag preview.
- Memoized page cards and limited drop-cue state changes to actual destination changes.
- Disabled Motion layout/hover animations while a reorder is active and removed placeholder spring animations during drag.
- Checked JSX syntax for the modified workspace components with TypeScript's JSX parser.
- `npm run test:access` passed: access-policy and Monitor telemetry regression tests.
- A full Vite/Electron production build was not run in this environment because project dependencies are not installed locally.


## Merge/export enhancement notes

- Removed the redundant workspace Live Preview/Page Details inspector and the related Add text/Cover area toolbar shortcuts.
- Export modal now offers per-page original sizing or fitted A3/A4/A5/Folio (8.5 × 13 in)/Letter/Legal sizes, preset/custom diagonal watermarks with angle/opacity/color controls, page numbers, AES-256 open-password protection, lossless QPDF compression, and explicit compact/smallest raster modes.
- The original browser-worker integration triggered a TypeError because the package’s Node-oriented WASM runtime was being resolved through Vite. The current fix moves QPDF/WASM into `electron/pdf-toolkit-worker.mjs`, a dedicated Node worker thread, and exposes a constrained `files:save-finalized-pdf` IPC operation. The final output is saved by the main process, avoiding a second large buffer round-trip through the renderer.
- Compact/smallest modes intentionally flatten page content to JPEG images; text selection, links, vector editability and form fields are not preserved in those modes.
- A fresh Vite/Electron build was not run in this environment because dependencies are not present and package registry DNS is unavailable.


## Workspace inspector removal and merge/export options (2026-10-27)

- Removed the right-side Live Preview / Page Details inspector from the page workspace, making the page grid use the available width. Removed its Add text overlay and Cover area toolbar shortcuts; separate in-document editing features are unaffected.
- Merge & export now supports preserved source page sizes or fitting pages to A3/A4/A5/Folio (8.5 × 13 in)/Letter/Legal, page numbers, diagonal preset/custom watermark with color/opacity/angle, optional AES-256 open-password protection, and a lossless QPDF optimization pass.
- Added explicit Compact and Smallest JPEG-raster modes. The UI warns that they flatten text, links, annotations, vectors and form fields into pixels.
- QPDF WebAssembly password/compression operations run in a Node worker thread so they do not execute on the Electron main or renderer UI thread. `pdfstudio@0.4.0` remains a production dependency and must be installed by `npm install` before building.
- Validation: TypeScript JSX parser checked all 54 JSX/TSX files with zero syntax errors; `node --check` passed for compose/export/worker files; package.json and package-lock dependency entries agree; access-policy and Monitor telemetry regression tests passed. ZIP integrity is verified after packaging.
- Build caveat: a full Vite/Electron production build and PDF round-trip tests could not be run here because package registry access is unavailable and dependencies are not installed in this environment. On Windows, update the source files, run `npm install`, then `npm start` to rebuild and validate the live app.


## Folio sizing and export-worker correction (2026-10-27)

- Added Folio paper size to Merge & Export: 8.5 × 13 inches, represented as 612 × 936 PDF points.
- Fixed export-finalization routing: the Vite renderer no longer imports `pdfstudio` into a browser worker. This removes the Node `node:module` / `node:fs/promises` externalization path that could surface as `TypeError: t is not a function` in the renderer worker callback.
- Added `electron/pdf-toolkit-worker.mjs`, which runs `createPdfToolkit()` in a dedicated Node worker thread, where the package can use Node's filesystem and module resolution correctly. Compression and AES-256 encryption remain off the UI thread.
- Added allow-listed `saveFinalizedPdf` preload bridge and main-process `files:save-finalized-pdf` handler. It opens the native save dialog first, processes only when requested, writes only after successful finalization, enforces the existing 2 GB file-size cap, and avoids returning the finished PDF to the renderer before sending it back for saving.
- Source validation: `node --check` passed for `electron/main.cjs`, `electron/preload.cjs`, `electron/pdf-toolkit-worker.mjs`, `src/services/pdf/compose.js`, and `src/hooks/useExporters.js`; TypeScript's parser passed on `src/modals/ExportModal.jsx` and `src/hooks/useExporters.js`.
- Access-policy and Monitor telemetry regression tests passed. Confirmed there are no remaining renderer-side imports of `pdfstudio`.
- The full Vite build and real QPDF password/compression round-trip were not executable in this packaging environment because project dependencies are not installed locally. Verify `npm start` and test both a lossless export and an AES-256 password export on Windows.


## App review integration note
- Review prompt logic and persistent per-installation state were added to the Electron app, without changing the Monitor project.
- The uploaded Monitor 2.4.18 gateway explicitly rejects `review` as a telemetry event; therefore its server-side submission cannot succeed through that gateway until review forwarding is enabled there. Failed submissions are not marked as complete.
- PDF save IPC now opens the destination folder after a successful save.
- Export watermark now uses bold Helvetica, uppercase text, a page-diagonal-based font size, and a higher-opacity default.


## PDF-to-Word and dedicated compression follow-up (2026-10-27)

- PDF-to-Word now defaults to **Editable Word document**: normal Word paragraphs, native tables for clearly ruled grids (including some merged cells), separate image assets for detected photos/logos, and retained source page dimensions. **Layout-preserving** remains available for fixed-position text over original page artwork; **Visual replica** keeps pages as images. The semantic detector is geometry-based and cannot reliably infer every borderless or complex table. Scan-only pages may remain page images when no reliable native text layer is available.
- Fidelity boundary: this is a local hybrid conversion, not the Adobe Acrobat Pro conversion engine. It does not semantically reconstruct every table/chart/vector/hyperlink/form, and scanned-page text needs OCR. Complex backgrounds may cause artefacts in the edit-oriented mode; use Visual replica where appearance matters more than editability.
- Standalone Compress PDF includes lossless-only optimization, High quality / Recommended / Smaller file / Smallest file presets, percent-or-MB target mode with measured output and best-effort refinement, resolution and JPEG quality controls, color/grayscale/monochrome modes, metadata and annotation rendering controls, and optional AES-256 output password protection. Lossy raster modes explicitly warn that text selection, hyperlinks, forms, vector objects, bookmarks, and digital signatures are not preserved. Lossless-only mode preserves the original when the local optimizer cannot safely reduce it instead of silently rasterizing it.
- Added source-policy regression checks and expanded compression unit checks, including PDF headers preceded by a short prefix and optimizer failure in lossless-only mode. `npm run test:pdf` and `npm run test:access` passed. Node syntax checks passed for touched service/Electron/test files; JSX and CSS parsing are checked separately.
- A full Vite/Windows package build and generated DOCX rendering round-trip could not be verified in this environment because the npm registry request timed out and the project dependencies were not fully installed. On the Windows development machine, run `npm ci`, `npm run test:pdf`, `npm run test:access`, `npm run web:build`, and `npm run build:win` before releasing.


## PDF-to-Word image-size preservation follow-up (2026-10-27)

- Compared the supplied four-page Netskope procedure PDF and both DOCX conversions. On PDF page 1, the two source screenshot placements are approximately 275 × 223 pt and 430 × 177 pt; the earlier Editable conversion wrote them at approximately 114 × 92 pt and 223 × 92 pt because the external-image builder imposed a 92 pt maximum height.
- Removed the arbitrary 92 pt limit for external image groups and the 150/180 pt default height limits for inline/cell image groups. Source PDF placement dimensions are now retained in Word when they fit. If an image group exceeds available page/cell width, it is scaled proportionally to fit; its original aspect ratio is maintained.
- Added regression assertions using the supplied PDF's image sizes and a width-overflow case. `npm run test:pdf` passed after the changes.
- A fresh production DOCX conversion and Electron 45 runtime verification are still outstanding in this workspace because the installed dependency tree is incomplete (`pdfjs-dist` is unavailable); the test validates the generated Word image extents from the production layout helpers, not a fresh full GUI conversion. On Windows, run `npm ci`, `npm run test:pdf`, `npm run web:build`, and compare the regenerated Editable DOCX against the PDF and Acrobat DOCX before release.

## Startup splash and About branding update (October 27, 2026)

- Added the supplied ITRS mark as local PNG assets in `public/branding/` and `electron/branding/`. The white variant preserves the source transparency and is used on dark surfaces.
- Added an animated ITRS mark to the Electron splash, including an entrance reveal, a subtle ambient glow, and a periodic glint. The splash CSP now allows only same-origin/local image assets as needed. Reduced-motion preferences switch the animation off and preserve a stable logo.
- Added theme-switched ITRS and RSC logo treatments to the About dialog and a compact RSC logo to the main sidebar footer. The light/dark RSC marks swap automatically with the workspace theme.
- Updated the About dialog's developer signature area with the requested `IT Specialist - WVM` role and a hover sheen / monogram sparkle animation. Motion is disabled for reduced-motion settings.
- Added `npm run test:branding` for splash assets, theme variants, logo dimensions, role text and animation selectors.
- Verified `npm run test:branding`, `npm run test:pdf`, `npm run test:access`, HTML parsing, JSX transpilation checks for changed components, and PostCSS parsing for changed styles.
- A fresh Vite production build and Electron visual launch remain unverified in this environment because the installed dependencies are incomplete (`vite` and `pdfjs-dist` are missing locally). Reinstall dependencies on Windows with `npm ci`, then run `npm run test:branding`, `npm run check`, and `npm start` to verify the final packaged splash, About dialog, and theme switching.
