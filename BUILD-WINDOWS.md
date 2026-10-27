# Build and release PDF Studio on Windows (single portable EXE)

PDF Studio is a **Windows-only** app. The build produces **one file**: a no-install portable EXE, `publish\PdfStudio.exe`. There is no setup installer, no MSI, and no extra folders to ship.

Requirements: Windows 10/11 x64, Node.js LTS and npm.

The portable build uses Electron Builder's maximum compression and stages only the selected optional runtime assets. By default, if Tesseract is staged under `resources\ocr`, the build includes its executable/DLLs and only the English and Traditional Chinese language models; the built-in Ghostscript WASM engine remains included, while a separate native Ghostscript runtime is omitted by default. This avoids accidentally embedding every OCR language model and a second, large Ghostscript installation in the single EXE.

## Build — `build_publish.bat`

Double-click `build_publish.bat`, or run `npm install` then `npm run build`.

It closes a running `PdfStudio.exe`, cleans `dist\` and `publish\`, installs dependencies, builds the app, signs the exe (via `signing\sign.ps1`, when present) and leaves exactly:

- `publish\PdfStudio.exe` — copy it to any folder or USB drive and run it. No installation or administrator permission is required.

How "only one file" is guaranteed: `npm run build:win` first empties `publish\`, runs `electron-builder --win portable --x64`, then `scripts/release-tool.cjs finalize` deletes electron-builder's intermediate files (`win-unpacked\`, `builder-debug.yml`, `builder-effective-config.yaml`) and fails the build if anything other than `PdfStudio.exe` remains.

## Optional large runtime assets

- Default OCR language models: `eng` and `chi_tra` when those files exist in `resources\ocr\tessdata`.
- To bundle specific models, set `PDFSTUDIO_OCR_LANGS=eng,chi_tra,jpn` before building. Use `PDFSTUDIO_OCR_LANGS=all` only when you intentionally want every `*.traineddata` file.
- To omit Tesseract entirely, set `PDFSTUDIO_BUNDLE_OCR=0`.
- Native Ghostscript is excluded by default because PDF Studio already ships a WASM Ghostscript engine. To include a staged native Ghostscript runtime as an optional accelerator, set `PDFSTUDIO_BUNDLE_NATIVE_GHOSTSCRIPT=1`; ensure licensing and redistribution obligations are satisfied first.
- The build logs the size of staged OCR/Ghostscript resources. After packaging it reports the final portable EXE size and warns if it remains above 250 MiB. Compression may still produce a larger file depending on the selected runtime/data files; verify the actual output after a Windows build.

## Release — `release.bat`

Run `release.bat` to build and publish a V3 release. It prompts you to choose the public zrok Monitor or your local Monitor host:

- Public: `https://pdfstudio.shares.zrok.io/pdfstudio-monitor`
- Local: `http://192.168.254.110:8080/pdfstudio-monitor` (trusted LAN only; HTTP does not encrypt the API key)
- validates the EXE product name and embedded version against `package.json` before publishing;
- reads matching release notes from `CHANGELOG.md`, then packages `PdfStudio.exe` into a ZIP when it makes the upload smaller and the Monitor confirms ZIP support;
- uploads resumable 4 MB chunks, verifies SHA-256, and falls back to the raw EXE if the ZIP is not smaller or the Monitor does not support ZIP packages;
- publishes a new version, replaces the same version if its EXE changed, and skips the binary upload when the exact EXE is already present.

Commands: `release.bat public`, `release.bat local`, `release.bat local -Force`, `release.bat local -NoZip`, and `release.bat noupload`. The API key is read from `PDFSTUDIO_MONITOR_KEY`, a local ignored `monitor-key.txt`, or a secure prompt; do not commit the key.

The monitor requires the EXE to identify itself as product `PDF Studio`.

## Notes

- On first launch the portable EXE unpacks itself to a temporary folder, so the first start takes a moment longer than a normal app.
- The app never creates a folder beside the EXE. Settings and caches are stored in `%AppData%\PDF Studio`; a `PDF Studio Data` folder left by an earlier build is copied there once and then ignored.
- If the build stops with a "Cannot create symbolic link" / "required privilege is not held" error, enable Windows Developer Mode (Settings > System > For developers) or run the build once from an Administrator terminal.
- `run-dev.bat` / `npm run dev` starts the app in development mode.

`release.bat` expects `publish_to_monitor.ps1` and `CHANGELOG.md` in this folder (next to `release.bat`).

## UI branding regression checks

Run `npm run test:branding` to verify that the ITRS splash assets and animations, the theme-switched RSC marks in the sidebar and About dialog, and the developer role/hover treatment remain wired correctly. The supplied ITRS/RSC PNG assets live under `public\branding` for the renderer and `electron\branding` for the native startup splash.

## Startup splash verification

The native splash waits for both the completed splash animation and the renderer-ready handshake before opening the app. The frontend watchdog reports boot errors to Electron; the main process displays a diagnostic page rather than exposing a blank window. Update validation and telemetry start only after the main window is visible.

Run `npm run test:startup` to check the startup sequencing. For a full Windows smoke test, run `npm ci`, `npm run test:startup`, and `npm start`; verify that a normal launch reaches the PDF Studio workspace and that an intentionally missing frontend asset produces a visible diagnostic instead of a stuck splash.

## Startup splash reliability (3.0.6)

This source archive intentionally omits the generated `dist/` bundle so that stale frontend files cannot be mistaken for the updated application. On Windows, run `npm ci` and then `npm start` to rebuild the renderer and launch Electron. For a portable release, run `npm run build:win` after dependencies install. The main window is shown only after the renderer sends its ready handshake and the splash progress animation completes. If the frontend fails to mount, Electron switches to a startup diagnostic instead of showing a blank window.

Run `npm run test:startup` to verify the ready/error handshake, bounded splash visibility, renderer-crash recovery, and startup timeout policy.
