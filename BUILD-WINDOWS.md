# Build PDF Studio 3 on Windows (portable only)

Requirements: Node.js LTS and npm. The Windows release is a **single no-install portable EXE**; this project no longer produces NSIS setup installers.

Double-click `build-windows.bat`, or run:

```powershell
npm install
npm run dev
npm run build:win
```

Expected output:

- `release\PDF-Studio-3.0.0-Portable-x64.exe` — standalone Electron portable launcher. Copy it to any writable folder or USB drive and run it directly. No installation or administrator permission is required.

The portable build stores `PDF Studio Data` next to the portable launcher when that folder is writable; otherwise it falls back to the standard per-user app data location. For distribution through PDF Studio Monitor, run `publish-v3-portable-to-monitor.bat` after a successful build. The publisher requires the executable to identify itself as product `PDF Studio` and carry a file version of 3.0.0 or later.

`build-and-publish-v3.bat` performs both operations. Do not use the retired `publish-v3-installer-to-monitor.bat` helper; it intentionally exits with a message because Version 3 is portable-only.
