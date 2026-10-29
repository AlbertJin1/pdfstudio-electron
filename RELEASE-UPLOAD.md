# Publishing the Electron V3 release

Run `release.bat auto` to check the LAN Monitor first, or choose `local` or `public`. The auto preflight checks whether `192.168.254.110:8080` accepts a TCP connection; if it is unavailable, the script selects the public zrok URL.

The release script builds the portable Electron EXE, verifies that its ProductName is `PDF Studio` and that its FileVersion matches `package.json`, extracts the version's release notes, then calls `publish_to_monitor.ps1`. The publisher explicitly sets Monitor app id `pdfstudio`, uses the universal `/api/upload.php` endpoint, compresses only when ZIP is smaller and supported, uploads resumable 4 MiB chunks, sends raw EXE chunks as binary and uses base64 transport only for ZIP packages, and verifies the completed package and EXE hashes. Finalization failures include the Monitor response body so server-side validation errors are visible instead of only showing an HTTP status.

For a migration-safe rollout, ensure V2.8.15 has already been published before publishing V3. The Monitor stores both releases under the same `pdfstudio` app, each by its own version.

Set `PDFSTUDIO_MONITOR_KEY` or create an ignored local `monitor-key.txt` with the publishing key. `release.bat` now passes the key-file path explicitly, and `publish_to_monitor.ps1` resolves this path after parameter binding (so PowerShell cannot fail on an empty `$PSScriptRoot` in a default parameter). If the file is absent and the environment variable is unset, the publisher prompts securely. Do not add a key to BAT files or commits.

The public downloads catalogue at `downloads.php` lists the latest release and renders every retained older version under **Earlier versions**, expanded by default. Each historical version has its own version-specific download button; downloads still require the configured server-side Cloudflare Turnstile validation.
