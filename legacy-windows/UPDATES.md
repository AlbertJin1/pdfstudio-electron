# In-app updates (from your PDF Studio Monitor)

PDF Studio checks your **PDF Studio Monitor** server (the PHP app behind your ngrok address) a few seconds after it
starts, and from **About → Check for updates**. When a newer `PdfStudio.exe` is found, PDF Studio starts downloading
and verifying it automatically in the background. The modeless progress window can be closed or hidden at any time;
that does not cancel the download, and you can keep working while it runs.

When the executable has been fully downloaded and verified, PDF Studio asks the user to choose:

| Button | What happens |
|---|---|
| **Update now** | checks for unsaved page edits, replaces the executable, and restarts PDF Studio only after the user confirms |
| **Update later** | keeps the verified update staged and offers it again the next time PDF Studio starts |
| **Hide window** / **X** on the progress window | hides the progress UI; the background download continues while PDF Studio remains running |

PDF Studio never installs or restarts into an update automatically. An incomplete download is not treated as ready, and
a completed staged update is checked again on the next launch before the user is prompted. Its size, executable header and SHA-256 are checked when restored and again before installation.

No GitHub, no tokens, nothing to configure: the updater uses the same server address and API key as the usage statistics
(`UsageTracker.DefaultBaseUrl` / `DefaultApiKey`, or `monitor_url` / `monitor_key` in settings.txt).

## Shipping an update

1. Raise `<Version>` **and** `<FileVersion>` in `PdfStudioCS.csproj` to the same number (e.g. `2.7.0` / `2.7.0.0`) and add the
   CHANGELOG.md and Services/ChangeLog.cs entries (the build already enforces this).
2. Run `release.bat`. It builds `publish\PdfStudio.exe`, shows the version inside it, then uploads a zip of it to the monitor.
3. Open the monitor → **Releases**, drop `PdfStudio.exe` (or a `.zip` containing it) in, optionally type *What's new*, press **Upload release**.

You never type a version number: the monitor reads it from the exe and stores the file as
`release/<version>/PdfStudio.exe` (e.g. `release/2.7.0/PdfStudio.exe`). The highest version is what the app is offered.
Only `major.minor.build` counts; the 4th number is ignored.

## How the app decides

* The app compares **its own exe's file version** (Windows → Properties → Details → File version) with the highest
  uploaded version. Both sides read the same field, so they cannot disagree.
* Versions are compared as numbers: `2.10.0` is newer than `2.9.0`.
* Older installs may still have `update_skip=<version>` in settings.txt from the former **Skip this version** button. The current updater ignores this legacy skip preference and uses **Update later**, which keeps the verified download and offers it again on the next launch.
* `auto_update=0` in the same file turns off the check at startup (the About button still works).

## Notes

* The exe must be in a folder the user can write to (not `C:\Program Files`); otherwise the app explains this and stops.
* The old exe is renamed to `PdfStudio.exe.old` and deleted by the new copy at its next start.
* Downloads are verified for size, the Windows "MZ" header and the SHA-256 the monitor computed when you uploaded the file.
* Running via `dotnet run` never self-updates.
* A version released here cannot be installed by copies **older than the first build that contains this updater**; those
  must be replaced by hand once.
* If the monitor is offline when the app starts, nothing is shown (a manual check from About shows the reason).
* **Steam-style differential updates (v2.8.1+).** When a new release is published, the monitor creates a content-defined chunk
  manifest for the executable. The updater scans the installed executable, reuses any matching SHA-256 chunks (even when their
  offsets moved), and requests only missing chunks. It reconstructs `PdfStudio.exe.new` locally, verifies each downloaded part,
  then verifies the full executable's size, Windows header and SHA-256 before swapping it into place. The monitor prepares a compact
  raw-DEFLATE patch stream using PHP's zlib extension; no external patch utility is required. If the patch is not available, fails
  verification, or is likely less efficient than a compressed full download, the client falls back to the compressed package and
  finally the plain executable. Existing clients keep working with the original ZIP and EXE endpoints.
* **Compressed fallback (v2.7.0+).** `release.bat` zips the signed exe and uploads `PdfStudio.zip`, about half the size of the exe.
  The monitor checks the ZIP's SHA-256, extracts and verifies the executable, and stores both the plain EXE (for older clients) and
  the ZIP (for current clients). `publish_to_monitor.ps1 -NoZip` uploads the plain EXE. Copies older than 2.7.0 still download the
  full exe once to get to a build that supports compressed updates.
