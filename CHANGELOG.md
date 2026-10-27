# Changelog

## 3.0.6 — Startup splash reliability
- Keep the Electron splash visible until its opening animation and final progress transition have completed.
- Wait for the renderer-ready handshake before revealing the main application.
- Route renderer boot failures and startup timeouts to a visible diagnostic screen instead of revealing a blank window.
- Add a preload bridge for reporting startup failures safely to the main process.

## 3.0.5

- Reduced the single-file Windows portable build size by using Electron Builder maximum compression instead of uncompressed (`store`) packaging.
- Added a size-aware build-time resource staging policy. If a Tesseract runtime is supplied, English and Traditional Chinese language models are bundled by default instead of every model in `tessdata`.
- Excluded the optional native Ghostscript installation from the default package because the built-in Ghostscript WebAssembly engine remains available. A native runtime can still be explicitly included when needed.
- Added build output reporting for staged OCR/Ghostscript assets and a warning when the resulting EXE remains above 250 MiB.
- Preserved opt-in configuration for extended OCR language models and native Ghostscript distributions.

# PDF Studio Changelog

## 3.0.4

- Added verified differential update support for compatible V3-to-V3 portable executable updates.
- Added compressed-package fallback and SHA-256 verification before a downloaded executable is staged.
- Improved the release workflow with selectable public zrok and local Monitor upload targets.
- Kept the portable Windows release as a single `PdfStudio.exe` deliverable.
