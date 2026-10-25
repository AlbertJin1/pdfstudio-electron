# PDF Studio 3 portable migration verification

## Checks completed in this workspace

- `package.json` parses; `npm start` now builds the Vite frontend before launching Electron, fixing the reported `ERR_FILE_NOT_FOUND` for `dist/index.html`. Release targets remain Windows `portable`, macOS `zip`, and Linux `AppImage` only.
- Electron checks that the frontend HTML exists and displays an actionable startup diagnostics page instead of an empty white window if the page is missing or cannot load.
- The renderer includes a startup watchdog for frontend script/load failures that prevent React from mounting.
- `node --check electron/main.cjs`, `package.json` parsing, and the inline startup-watchdog JavaScript syntax check passed.
- Build and publish scripts point to the Windows portable artifact and do not publish an NSIS setup executable.
- Legacy updater migration path is written to use a raw Version 3 portable EXE, verify size/SHA-256, replace the current EXE when writable, and use a LocalAppData fallback otherwise.
- Legacy startup has a redirect hook for the fallback portable copy so existing shortcuts remain useful.
- Monitor publisher continues to use the existing release API and wraps the portable launcher under its required `PdfStudio.exe` ZIP entry.
- Electron main process stores user data beside portable artifacts when writable, with a user-profile fallback.

## Required on-machine validation

Static source validation was performed for this startup fix, but this environment has not verified a real Electron bundle build or compiled the C# project because this checkout does not include `node_modules`. On the target Windows machine, run `npm install`, then `npm start`; `npm start` now builds the frontend automatically. Verify that `dist/index.html` is generated before Electron opens. Also run `npm run check`. Before production release, build on Windows with Node.js/npm and .NET 8 SDK; verify the portable EXE reports `ProductName=PDF Studio` and `FileVersion=3.0.0.x`; compile/publish the legacy 2.8.15 bridge; test upgrade from an older C# copy in a writable folder and from a protected folder; confirm no installer/UAC appears; and upload the actual portable EXE to the monitor. Also build on native macOS/Linux hosts and test portable launch and data persistence.
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

Before publishing, manually verify six accent presets and all text-size options in Settings; dark mode, high contrast, reduced motion, responsive About layout, platform-specific shortcut keycaps; then test Monitor no-update and new-update cases on each supported platform, a successful authenticated download, cancellation, invalid/mismatched checksum, and unreachable/unauthorized Monitor responses. The staged updater applies only after the user chooses Update now. Windows portable launcher replacement and macOS/Linux package replacement still require native packaging checks on their target operating systems.


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
- Windows packages use the Monitor's backward-compatible `action=download` URL; macOS/Linux use `action=latest&platform=...&architecture=...` and `action=platform-download`.
- The download handler accepts only HTTPS URLs from the PDF Studio Monitor API and only the Monitor `download` / `platform-download` actions.
- Main-process requests verify any Monitor SHA-256 value before committing the downloaded file and delete partial files on failures/cancellation.
- Static JavaScript syntax and archive integrity must be checked on the target build environment; a live remote check and full package build require reachable zrok Monitor service and npm dependencies.

Targeted mocked updater integration tests passed for Windows (legacy `action=latest` / `action=download`), macOS ARM64 and Linux x64 (platform-aware routes). Tests verified the zrok host/path, release query parameters, `X-Api-Key` and tunnel-warning headers, successful SHA-256 validation, and rejection of non-Monitor download URLs. A live zrok request could not be verified in this environment because DNS resolution for `pdfstudio.shares.zrok.io` failed; recheck against the deployed Monitor before publishing.


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
