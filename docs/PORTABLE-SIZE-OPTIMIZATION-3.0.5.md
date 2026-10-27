# PDF Studio 3.0.5 — portable EXE size optimization

## What changed

- Windows portable packaging now uses Electron Builder `compression: maximum` instead of `store` (which favors faster builds over compression).
- `scripts/prepare-bundled-resources.cjs` stages optional runtime assets before packaging. This prevents accidental inclusion of every OCR language model and a duplicate native Ghostscript distribution.
- If `resources/ocr/tesseract.exe` is staged, the default portable package includes the executable, its root DLLs and license notices, Tesseract config folders, and only the available `eng` and `chi_tra` models.
- The built-in `@jspawn/ghostscript-wasm` engine remains included. Native Ghostscript is an optional accelerator and is no longer copied into the package by default.
- The build prints staged resource sizes and reports the final EXE size. It warns when the EXE remains above 250 MiB.

## Build defaults and options

Run `npm run build:win` (or `release.bat`, which invokes the build). The `prebuild:win` lifecycle cleans the previous output and stages runtime assets before the frontend and portable executable are built.

PowerShell examples:

```powershell
# Default: English + Traditional Chinese OCR models; no native Ghostscript copy
npm run build:win

# Bundle additional models that exist under resources/ocr/tessdata
$env:PDFSTUDIO_OCR_LANGS = 'eng,chi_tra,jpn'
npm run build:win

# Bundle every *.traineddata file (may substantially increase EXE size)
$env:PDFSTUDIO_OCR_LANGS = 'all'
npm run build:win

# Explicitly include a staged native Ghostscript runtime (check redistribution licensing)
$env:PDFSTUDIO_BUNDLE_NATIVE_GHOSTSCRIPT = '1'
npm run build:win

# Skip bundled OCR runtime entirely; external Tesseract remains discoverable
$env:PDFSTUDIO_BUNDLE_OCR = '0'
npm run build:win
```

Unset the environment variables after a special build so the default size-conscious policy applies next time:

```powershell
Remove-Item Env:PDFSTUDIO_OCR_LANGS -ErrorAction SilentlyContinue
Remove-Item Env:PDFSTUDIO_BUNDLE_NATIVE_GHOSTSCRIPT -ErrorAction SilentlyContinue
Remove-Item Env:PDFSTUDIO_BUNDLE_OCR -ErrorAction SilentlyContinue
```

## Verification and limitations

Run `npm run test:build-size` and `npm run test:release-script` to validate the staging policy and release workflow. Also run the PDF/OCR tests before publishing.

The source change is designed to materially reduce a build that was accidentally bundling oversized optional assets. The exact output size depends on the runtime files staged on the Windows build machine and must be measured from `publish\\PdfStudio.exe`; this source-only environment cannot establish the final packaged size. If it is still above 250 MiB, review the staging size report and check whether a custom native runtime or many language models are being included.

The slim default bundles only English and Traditional Chinese OCR models when available. Additional language choices require the corresponding model to be supplied via an opt-in build or installed local Tesseract runtime. PDF text rendering, page editing, exports, PDF.js, and the built-in Ghostscript WASM path remain bundled.
