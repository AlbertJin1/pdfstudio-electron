# Optional local OCR engine for PDF Studio

PDF Studio now supports hybrid OCR through a local Tesseract executable. To enable OCR in a packaged Windows build, place the official Windows Tesseract executable, its required DLLs, and language data files here before running `npm run build:win`:

- `resources/ocr/tesseract.exe`
- `resources/ocr/*.dll` (all runtime DLLs shipped with the selected Tesseract build)
- `resources/ocr/tessdata/eng.traineddata`
- `resources/ocr/tessdata/chi_tra.traineddata` (optional Traditional Chinese)
- `resources/ocr/tessdata/chi_sim.traineddata` (optional Simplified Chinese)
- Any other supported `*.traineddata` language model selected in the conversion dialog

The executable and language models are not included in this source archive. They are third-party binaries/data and must be obtained from a trusted distribution with appropriate license notices. If no bundled executable is present, PDF Studio also tries the `PDFSTUDIO_TESSERACT_PATH` environment variable and then the system `PATH`. OCR is completely local; no PDF or image is uploaded.
