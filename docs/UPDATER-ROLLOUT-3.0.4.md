# PDF Studio 3.0.4 updater rollout and deployment

## What this release changes

- V3 portable-to-portable updates can reuse byte-identical content-defined chunks from the currently running `PdfStudio.exe` and download only missing chunks.
- Every downloaded delta chunk is decompressed and SHA-256-verified. The reconstructed executable must match the Monitor's published total size and SHA-256 before it can be staged.
- If delta metadata is absent, a delta request fails, or too much of the file changed, the client tries the Monitor's SHA-256-verified ZIP containing `PdfStudio.exe`. It extracts only that entry and separately verifies the rebuilt EXE. The old raw-EXE endpoint remains the final fallback.
- Existing V3.0.3 clients do not contain this new updater code. Their one-time bootstrap update to 3.0.4 therefore uses the old raw-EXE endpoint; it is not possible to make an already-shipped client understand ZIP/delta responses without first updating its executable. Once 3.0.4 is installed, later V3 updates can use delta/ZIP paths. Likewise, the V2-to-V3 architecture transition must fetch the V3 executable once; it cannot reuse C# V2 chunks that do not match the Electron launcher.
- The patched V2 source prefers the compressed migration ZIP only after it is compiled and published as a bridge executable. Already-installed 2.8.15 binaries cannot gain this behavior retroactively; making every already-installed 2.8.15 client use the new compressed migration path would require a separately versioned bridge release, which would add an extra step to the rollout.

## Required rollout sequence

The Monitor's `pdfstudio-v3-bridge-gate-v1` policy is the authority for release routing:

1. Any client below final version `2.8.15` is offered `2.8.15` (the bridge) instead of a 3.x release. Missing or invalid client versions fail closed to the legacy-compatible route.
2. A client reporting `2.8.15` or newer is eligible for the published V3 release.
3. Do not remove the downloadable `2.8.15` bridge artifact while older clients remain in use. The Monitor regression suite covers old, missing, invalid, pre-release, bridge-ready, and no-bridge-artifact cases.

This is a server-enforced staged release path, not remote control over an already-installed client's buttons. Offline users cannot be updated remotely; the current legacy clients keep offering the bridge through their update flow until they accept it.

## Deployment checklist

1. Deploy the updated `public/api/client-gateway.php` from Monitor 2.4.18 (either the canonical public file or the matching `server-bridge/public/api/client-gateway.php` file in the Electron source). It exposes only allowlisted `latest`, raw/ZIP `download`, `manifest`, and POST `delta` operations, with the API key injected on the server only.
2. Keep the existing Monitor server-side `MONITOR_API_KEY` configured. Do not place that key in Electron source or release artifacts.
3. On a Windows build machine with supported Node/npm and network access, in the Electron project directory run:

   ```powershell
   npm ci
   npm run test:update
   npm run build:win
   ```

4. Upload the newly built `publish/PdfStudio.exe` to the Monitor as version `3.0.4`. The Monitor release workflow should build/cache the ZIP package and content-defined delta manifest. Verify the uploaded release size and SHA-256.
5. Keep the release `2.8.15` downloadable before publishing 3.0.4 or any later 3.x release.
6. Test these version routes against the deployed Monitor: `2.8.14` -> `2.8.15`; `2.8.15` -> latest 3.x; `3.0.3` -> `3.0.4`. The 3.0.3-to-3.0.4 bootstrap will use its old full-EXE transfer; then publish a later V3 release and verify a 3.0.4 client uses `action=manifest` and POST `action=delta` when the payload is smaller than the ZIP fallback.

## Compatibility and integrity

Older Monitor gateways may not support ZIP, manifest, or delta requests; Electron therefore falls back to the raw EXE path if the newer package metadata is unavailable. The updated Monitor gateway is required for the optimized transfer paths. No update is applied until a complete target EXE has passed SHA-256 and size verification.
