# Publishing the Electron V3 release

Run `release.bat auto` to check the LAN Monitor first, or choose `local` or `public`. The auto preflight checks whether `192.168.254.110:8080` accepts a TCP connection; if it is unavailable, the script selects the public zrok URL.

The release script builds the portable Electron EXE, verifies that its ProductName is `PDF Studio` and that its FileVersion matches `package.json`, extracts the version's release notes, then calls `publish_to_monitor.ps1`. The publisher explicitly sets Monitor app id `pdfstudio`, uses the universal `/api/upload.php` endpoint, compresses only when ZIP is smaller and supported, uploads resumable 4 MiB chunks, prefers base64 chunk transport for the current API, and verifies the completed package and EXE hashes.

For a migration-safe rollout, ensure V2.8.15 has already been published before publishing V3. The Monitor stores both releases under the same `pdfstudio` app, each by its own version.

Set `PDFSTUDIO_MONITOR_KEY` or create an ignored local `monitor-key.txt` with the publishing key. Do not add a key to BAT files or commits.
