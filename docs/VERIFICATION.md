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
- The Electron client now calls `client-gateway.php?resource=update&action=latest`; the server gateway translates that to the legacy Monitor `update.php` shape and injects `X-Api-Key` server-side only.
- Windows packages retain the Monitor's backward-compatible `action=latest` / `action=download` behavior through the gateway.
- The download handler accepts only HTTPS URLs from the configured PDF Studio Monitor host and only the gateway's `resource=update&action=download` operation.
- Main-process requests verify any Monitor SHA-256 value before committing the downloaded file and delete partial files on failures/cancellation.
- Static JavaScript syntax and archive integrity must be checked on the target build environment; a live remote check and full package build require reachable zrok Monitor service and npm dependencies.

Regression tests now verify that Electron never loads or sends `X-Api-Key`, access policy and telemetry use the gateway, and the server gateway uses the server-side API key only for allowlisted requests. A live zrok request and production package were not verified in this environment; deploy/configure the gateway on the Monitor server before publishing this client build.


## Production chunk warning remediation (2026-10-25)

- Replaced the statically imported PDF.js worker URL with a local `public/pdfjs/pdf.worker.min.mjs` runtime asset, copied from the exact installed `pdfjs-dist` version. All build/dev commands now run the PDF.js asset preparation script first.
- PDF.js, `pdf-lib`, and `docx` are dynamically imported by the specific operations that need them. PDF.js uses its official minified entry point to avoid shipping the unminified main library into a large application chunk.
- Added Vite 8 / Rolldown code-splitting groups for React, Motion, and Lucide React. The 500 kB warning threshold has not been raised.
- Source syntax and configuration checks were run, but the production bundle was not rebuilt in this environment because the dependency cache lacks the required npm tarballs and registry access is not available here. Run `npm ci` and `npm run check` on a connected development machine and confirm that every reported JavaScript chunk is under 500 kB; the PDF.js worker should appear only as a copied public runtime asset, not as a JavaScript chunk.

## Background update and Monitor session tracking

- The app checks shortly after its main window opens, retries transient failures after 15 minutes, and repeats periodic checks during long sessions. Verified packages are persisted in the user-data update staging directory; a staged update remains available if the connection is temporarily unavailable.
- Once verified, the app shows an Update now / Update later dialog. Update later defers installation for the current app session and retains the staged package for the next launch.
- Legacy-compatible session telemetry sends `open`, cumulative `heartbeat` (every 60 seconds) and `close` events with `app`, version, OS, stable random install ID, random session ID, hostname, local IP, start time and elapsed seconds. Failed events are queued locally and retried. Document content, PDF bytes and file names are not part of telemetry.
- UI status text is intentionally generic: the service endpoint remains fixed in the main process, but the shared API key resides only on the Monitor server and is never bundled in Electron.
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
- Regression checks: `node --check electron/main.cjs`, `node --check electron/services/monitor-api.cjs`, `node tests/monitor-telemetry.cjs`, and PHP syntax validation passed. The live Monitor endpoint could not be tested from this environment because its DNS host was not resolvable here; a fresh GUI package build also requires the project dependencies to be installed.


## Device access control: Monitor enable / disable (3.0.3 security follow-up, 2026-10-26)

- The Monitor administrator can disable a single PC from the dashboard's Installs table. Electron polls the read-only `client-gateway.php?resource=access` operation about every 30 seconds and when the window regains focus; the gateway forwards to `access.php` using the server-only API key.
- New and unknown devices are enabled by default and PDF Studio never waits for the network to start. A "disabled" answer locks the app immediately; an "enabled" answer unlocks a running copy on the next successful check. The Monitor's canonical install id is adopted so the policy follows the PC after a reinstall.
- The last answer is cached in `monitor-access.json` (user-data folder) and loaded synchronously before the first window is created, so a disabled device stays locked after a restart or while the Monitor is unreachable. Network errors, 401/404/5xx and tunnel HTML pages never change the current decision; only a valid policy can lock or unlock.
- Enforcement is in the main process: `files:open`, `files:save` and `files:save-batch` refuse while locked. The renderer shows a full-screen lock screen (administrator's reason, computer name, device id, who/when, offline note, "Check again", "Quit PDF Studio"), makes the application shell inert, and also guards the picker, drag-and-drop and shortcuts. Telemetry continues while locked so the administrator still sees the device.
- Tests: `npm run test:access` (policy parsing, cache, back-off, fail-safe transitions, route fallback, wiring checks). Also verified end to end against the real Monitor code on PostgreSQL (new device enabled -> admin disables -> reinstall with a new id stays disabled -> admin enables), and the main process was exercised with a stubbed Electron (cached lock at startup, IPC refusals, live lock/unlock, monitor-down behaviour). A full GUI run requires building and launching the Electron package.


## PDF-to-Word conversion structure update (2026-10-27)

- The default Editable Word document mode creates normal Word paragraphs, reconstructed native Word tables, and separate inline image assets instead of placing the full page as a background and anchoring each text line in a text box. Page size comes from the PDF's point dimensions. Layout-preserving mode retains the legacy fixed-position approach, and Visual replica remains image-only.
- The editable table detector accepts partial interior vertical rules so table rows can have merged cells. Ambiguous/borderless structures remain heuristic and may need review. PDF image objects are identified from the PDF.js operator stream and cropped from a high-resolution render for separate placement in Word; source-image byte data is not always directly reusable.
- Hybrid OCR remains routed to Electron's main process, calls Tesseract through `spawn` without a shell, accepts bounded image sizes and allowlisted language combinations, and parses per-word boxes/confidence. Tesseract and selected trained-data are optional until bundled under `resources/ocr` or available on PATH.
- DOCX finalization checks required package XML parts, relationships, XML well-formedness, and ZIP CRC integrity. The layout-heuristics tests cover table detection, merged-cell row structure, image-row grouping, OCR/native deduplication, legacy DrawingML placement, content token coverage, reading-order transitions, and XML helpers.
- Verification status for this update must be taken from the execution results recorded with the current source archive. A real Microsoft Word round-trip and final Word-vs-PDF pixel comparison are required before claiming Acrobat-class conversion fidelity.
- Known gaps: image cropping can include pixels from overlapping PDF image objects; scan-only pages remain page images when text reconstruction cannot be trusted; borderless tables, semantic headers/footers, complex numbering/paragraph styles, wrap-around objects, rotated/vertical/RTL text, and automatic final-DOCX visual difference correction are not complete. The converter is not advertised as equivalent to Adobe Acrobat Pro.


## PDF-to-Word reliability follow-up (2026-10-27)

- Image regions are cropped after a text-free render is available. Photo-like regions containing overlaid text can still use the normal render so baked-in captions remain visible; wide header/banner composites prefer the text-free layer to avoid duplicating native headings. Crop source is recorded on each detected image region for diagnostics.
- OCR-only scan pages now take a separate fallback: preserve the masked scan artwork and overlay editable OCR lines as positioned Word frames. If OCR yields no usable editable spans, keep the original scan image. This fallback is intentionally visual-first for scan-only pages and can require OCR cleanup.
- Flow paragraphs use a median measured source baseline pitch for exact Word line spacing and defensive numeric checks for margins/indents. Regression tests cover multi-line cell left alignment, malformed-coordinate indent safety, no-table/multi-page flow content, photo spacing, image crop strategy, and nested Form XObject transforms.
- Validation performed in this execution: the complete `npm run test:pdf` suite passed, including Ghostscript/compression contracts, PDF-to-Word policy checks, OCR service checks, and the layout regression suite. `npm ci` could not complete because the npm registry was unreachable in this environment; `npm run web:build` consequently failed because `node_modules/pdfjs-dist/package.json` was unavailable. The updated source archive omits stale `dist/` output so it cannot be mistaken for a fresh build. Install dependencies and run `npm start` (or `npm run web:build`) to regenerate it; `build_publish.bat`/`release.bat` perform a fresh Windows build. Launching in the real Electron 45 app and visually inspecting newly generated DOCX outputs remain unverified. Do not interpret passing unit/contract tests as proof of perfect Acrobat equivalence; validate representative PDFs and open the results in Microsoft Word before release.

## PDF-to-Word image-size preservation follow-up (2026-10-27)

- Compared the supplied four-page Netskope procedure PDF and both DOCX conversions. On PDF page 1, the two source screenshot placements are approximately 275 × 223 pt and 430 × 177 pt; the earlier Editable conversion wrote them at approximately 114 × 92 pt and 223 × 92 pt because the external-image builder imposed a 92 pt maximum height.
- Removed the arbitrary 92 pt limit for external image groups and the 150/180 pt default height limits for inline/cell image groups. Source PDF placement dimensions are now retained in Word when they fit. If an image group exceeds available page/cell width, it is scaled proportionally to fit; its original aspect ratio is maintained.
- Added regression assertions using the supplied PDF's image sizes and a width-overflow case. The complete `npm run test:pdf` suite and access/telemetry/review policy tests passed after the changes.
- A fresh production DOCX conversion and Electron 45 runtime verification are still outstanding in this workspace because the installed dependency tree is incomplete (`pdfjs-dist` is unavailable); the tests validate the generated Word image extents from the production layout helpers, not a fresh full GUI conversion. On Windows, run `npm ci`, `npm run test:pdf`, `npm run web:build`, and compare the regenerated Editable DOCX against the PDF and Acrobat DOCX before release.
