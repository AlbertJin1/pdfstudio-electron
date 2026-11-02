# Publishing the Electron V3 release

`release.bat` and `publish_to_monitor.ps1` are now the **same workflow as the legacy 2.8.x project**.

```bat
release.bat              build, then choose 1 public / 2 local / 3 automatic (default 3)
release.bat local        build and upload straight to http://192.168.254.110:8080/pdfstudio-monitor
release.bat auto         LAN first, public zrok fallback
release.bat public       public zrok only
release.bat local -Force replace an identical release
release.bat noupload     build only
```

Retry an upload without rebuilding:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File publish_to_monitor.ps1 -Target local
```

## What it does
1. Validates the EXE: product name `PDF Studio`, File version equals `package.json`, and CHANGELOG.md has a heading matching the EXE File version (for this source release, `## 3.0.9`).
2. Zips the EXE only if that saves at least 5% (the NSIS portable file is already compressed, so it normally uploads raw).
3. Uploads resumable 4 MiB chunks (`begin` / `chunk` / `finish`) with SHA-256 verification. Raw chunks are used on the LAN and for raw EXEs; base64 chunks are used only for ZIPs on a public route.
4. **Prints the Monitor's own error text** if anything is rejected (`UPLOAD FAILED: ... (HTTP 422): <reason>`).

API key: `PDFSTUDIO_MONITOR_KEY`, or `monitor-key.txt` next to the script, or a secure prompt. Never put it in a BAT file or the app.

## Why the old uploader failed with HTTP 422
electron-builder's `portable` file is an NSIS launcher, which is a 32-bit (x86) PE that starts the 64-bit Electron app. Monitor 2.4.23 rejected every V3 file that was not x64/ARM64 at the final `finish` step, and the old PowerShell 5.1 `Invoke-RestMethod` code hid the message. **Monitor 2.4.24 accepts the launcher and records it as x64** - deploy it before uploading V3.

## Required order
1. Deploy Monitor 2.4.24 (copy the patch files over the Monitor folder; no database change).
2. Make sure 2.8.15 is already published (legacy `release.bat`).
3. Publish V3 with `release.bat`.

Clients: below 2.8.15 are offered 2.8.15; 2.8.15+ are offered V3 through the in-app updater; V3 -> V3 uses chunk-level delta updates when the Monitor has a manifest.
