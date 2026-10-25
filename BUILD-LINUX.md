# Build PDF Studio 3 on Linux (portable AppImage)

Requirements: Node.js LTS, npm, and the system libraries required by Electron.

```bash
./build-linux.sh
# Optional target architectures:
./build-linux.sh x64
./build-linux.sh arm64
```

The output is a single AppImage in `release/`. Make it executable (`chmod +x PDF-Studio-*.AppImage`) and run it. This does not install the application through a package manager.
