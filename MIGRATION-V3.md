# PDF Studio Version 3 — Portable migration and release workflow

PDF Studio 3 is distributed as a **portable Electron launcher** on Windows. It does not use NSIS, does not create an installer, does not require administrator rights, and does not register itself as an installed program. The macOS build is a ZIP containing `PDF Studio.app`; Linux is an AppImage.

## How legacy C# updates reach V3

The Monitor keeps the canonical Windows payload named `PdfStudio.exe` and publishes a verified ZIP copy for older/current clients. Version 3's portable executable has the same `PDF Studio` product metadata and a `3.x` file version, so existing C# updater clients can download it using the existing monitor API. The update service validates byte length, MZ/PE header, and SHA-256 before any launch or replacement.

For the patched C# 2.8.15 bridge included here:

1. The raw V3 portable EXE is downloaded to `%LOCALAPPDATA%\PdfStudio\migration` and verified against the monitor manifest.
2. If the legacy executable folder is writable, the updater safely swaps the portable launcher into the current `PdfStudio.exe` path, preserving existing shortcuts, then starts V3.
3. If the legacy folder is protected or locked, the verified portable app is placed at `%LOCALAPPDATA%\PdfStudio\Version3\PdfStudio.exe` and launched. A migration marker makes later launches through the old shortcut redirect to that portable copy. No setup program or elevation is used.
4. The monitor publication uses the raw portable EXE as the canonical executable. It must never be published using an NSIS setup artifact.

Older C# updater builds that use the ordinary same-format EXE replacement path also receive the portable launcher directly. Very old builds in protected folders may not have the user-local fallback logic, but they still do not need an installer; such users can run the downloaded portable EXE manually if their existing directory is not writable.

## Server-enforced rollout gate

Deploy Universal App Monitor **2.4.8 or newer** before publishing the V3 release. The updater endpoint and signed heartbeat hint now enforce the bridge sequence: if the client reports a version older than final 2.8.15 (or no readable version), the server returns the 2.8.15 release rather than 3.0.0. If the bridge binary is not available, the server offers only an available pre-3.0 release or returns a blocked/no-target response. After the client restarts and reports 2.8.15, the server may offer V3.

This gate protects against accidentally offering Version 3 directly to pre-bridge clients even if both releases are published at the same time. It does **not** patch behavior in binaries already installed on PCs: older versions that refuse to download updates from protected folders may still require the old executable to be moved to a writable folder or the user to run a portable copy manually before the 2.8.15 bridge can take over.

The server policy lives in `pdfstudio-monitor/src/versions.php` and is configured by `pdfstudio_v3_bridge_version` (`2.8.15`) and `pdfstudio_v3_first_version` (`3.0.0`). The API returns a policy identifier plus `bridge_release_available`, allowing the app-side publish preflight (`scripts/test-monitor-v3-rollout.ps1`) to refuse publication unless the gate is deployed and the bridge artifact exists. Regression tests are in `pdfstudio-monitor/tests/update_rollout_test.php` and can be run with `php tests/update_rollout_test.php` from the Monitor project root.

## Recommended rollout order

1. Publish the patched legacy C# bridge first: run `publish-legacy-bridge.bat` from this checkout. It builds and publishes version 2.8.15 using the existing C# release workflow.
2. Verify a copy of a prior C# build can receive 2.8.15, and test that the patched bridge can migrate from a writable folder and from a protected folder to a user-local portable copy. Older builds already using a writable folder can generally replace their EXE directly, but only the patched bridge knows the protected-folder fallback.
3. After that bridge has been published and tested, build V3 on Windows with Node.js LTS/npm installed by running `build-windows.bat`.
4. Confirm the file `release\PDF-Studio-3.0.0-Portable-x64.exe` exists.
5. Run `publish-v3-portable-to-monitor.bat`. It checks the EXE's product name and embedded file version and then uses the existing monitor publisher. The API stores the portable binary as `PdfStudio.exe` and also creates its verified ZIP download for existing clients.
6. Test with an actual legacy C# copy: check for updates, download, choose the portable migration action, verify V3 opens, restart the old shortcut to verify fallback redirection (when using a protected directory), and confirm no UAC or installation dialog appears.

`build-and-publish-v3.bat` asks for confirmation before publishing. The actual publisher also runs `scripts/test-monitor-v3-rollout.ps1`, which checks the live Monitor API policy and verifies that the bridge artifact is available; publishing stops if either check fails. It intentionally has no NSIS/setup output path.

## Cross-platform no-install build outputs

- Windows: `build-windows.bat` → `release/PDF-Studio-3.0.0-Portable-x64.exe`.
- macOS: `./build-macos.sh` → ZIP containing `PDF Studio.app`; extract and run it.
- Linux: `./build-linux.sh` → AppImage; make it executable and run it.

Cross-build architecture options are `x64` or `arm64` (native builds are recommended for macOS signing and runtime compatibility).

## Monitor compatibility

The included monitor project already supports versioned EXE payloads, PE version metadata, SHA-256 validation, a raw executable download, and a ZIP package containing `PdfStudio.exe`. No new installer API is needed. The monitor's `expected_product` must remain `PDF Studio`, and the new portable EXE's ProductName/FileVersion must pass the publishing check before release.
