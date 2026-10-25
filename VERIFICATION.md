# PDF Studio 3 portable migration verification

## Checks completed in this workspace

- `package.json` parses and release targets are set to Windows `portable`, macOS `zip`, and Linux `AppImage` only.
- Build and publish scripts point to the Windows portable artifact and do not publish an NSIS setup executable.
- Legacy updater migration path is written to use a raw Version 3 portable EXE, verify size/SHA-256, replace the current EXE when writable, and use a LocalAppData fallback otherwise.
- Legacy startup has a redirect hook for the fallback portable copy so existing shortcuts remain useful.
- Monitor publisher continues to use the existing release API and wraps the portable launcher under its required `PdfStudio.exe` ZIP entry.
- Electron main process stores user data beside portable artifacts when writable, with a user-profile fallback.

## Required on-machine validation

This environment has not verified a real Electron build or compiled the C# project. Before production release, build on Windows with Node.js/npm and .NET 8 SDK; verify the portable EXE reports `ProductName=PDF Studio` and `FileVersion=3.0.0.x`; compile/publish the legacy 2.8.15 bridge; test upgrade from an older C# copy in a writable folder and from a protected folder; confirm no installer/UAC appears; and upload the actual portable EXE to the monitor. Also build on native macOS/Linux hosts and test portable launch and data persistence.
