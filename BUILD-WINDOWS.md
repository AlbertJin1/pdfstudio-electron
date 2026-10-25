# Build and release PDF Studio on Windows (single portable EXE)

PDF Studio is a **Windows-only** app. The build produces **one file**: a no-install portable EXE, `publish\PdfStudio.exe`. There is no setup installer, no MSI, and no extra folders to ship.

Requirements: Windows 10/11 x64, Node.js LTS and npm.

## Build — `build_publish.bat`

Double-click `build_publish.bat`, or run `npm install` then `npm run build`.

It closes a running `PdfStudio.exe`, cleans `dist\` and `publish\`, installs dependencies, builds the app, signs the exe (via `signing\sign.ps1`, when present) and leaves exactly:

- `publish\PdfStudio.exe` — copy it to any folder or USB drive and run it. No installation or administrator permission is required.

How "only one file" is guaranteed: `npm run build:win` first empties `publish\`, runs `electron-builder --win portable --x64`, then `scripts/release-tool.cjs finalize` deletes electron-builder's intermediate files (`win-unpacked\`, `builder-debug.yml`, `builder-effective-config.yaml`) and fails the build if anything other than `PdfStudio.exe` remains.

## Release — `release.bat`

Run `release.bat` to build and upload the build as the latest release:

- builds with `build_publish.bat`, then shows the version inside the exe (the monitor reads it from there) next to `package.json`;
- uploads `publish\PdfStudio.exe` with the version's `CHANGELOG.md` notes through `publish_to_monitor.ps1`. New version = uploaded; same version but a changed exe = overwritten; identical = skipped.
- `release.bat noupload` builds only; `release.bat -Force` uploads even if the monitor has the identical exe.

The monitor requires the exe to identify itself as product `PDF Studio`.

## Notes

- On first launch the portable EXE unpacks itself to a temporary folder, so the first start takes a moment longer than a normal app.
- The app never creates a folder beside the EXE. Settings and caches are stored in `%AppData%\PDF Studio`; a `PDF Studio Data` folder left by an earlier build is copied there once and then ignored.
- If the build stops with a "Cannot create symbolic link" / "required privilege is not held" error, enable Windows Developer Mode (Settings > System > For developers) or run the build once from an Administrator terminal.
- `run-dev.bat` / `npm run dev` starts the app in development mode.

`release.bat` expects `publish_to_monitor.ps1` and `CHANGELOG.md` in this folder (next to `release.bat`).
