# Build PDF Studio 3 on macOS (portable ZIP)

Requirements: Node.js LTS and npm. The build outputs a ZIP with `PDF Studio.app` rather than a DMG installer.

```bash
./build-macos.sh
# Optional target architectures:
./build-macos.sh x64
./build-macos.sh arm64
```

Extract the ZIP and run `PDF Studio.app` from the folder of your choice. Code signing/notarization credentials are not bundled with this source, so Gatekeeper may still show the usual first-run warning for an unsigned build.
