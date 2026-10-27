# Optional Ghostscript runtime for smart PDF compression

PDF Studio includes a built-in image-object compression path that recompresses compatible embedded image XObjects without rasterizing whole pages. Ghostscript is an optional accelerator for broader image-codec support, effective-display-resolution downsampling, PDF stream rewriting, duplicate resource reuse, and font optimization.

If you choose to stage Ghostscript here, the expected Windows x64 entry point is `resources/ghostscript/bin/gswin64c.exe`; a complete matching runtime/library distribution must accompany it. PDF Studio does not download Ghostscript automatically.

**Licensing:** Ghostscript is available under AGPL or a commercial Artifex license. Before redistributing a Ghostscript runtime in a closed-source/proprietary application, verify the applicable license and obligations. See the official licensing FAQ: https://ghostscript.com/faq/

Without Ghostscript, the built-in image-object optimizer remains available. It supports compatible embedded raster image encodings only and safely skips unsupported images rather than flattening text or vector content. Whole-page raster fallback is explicit opt-in only.


## Built-in engine (no install needed)

PDF Studio ships Ghostscript compiled to WebAssembly (`@jspawn/ghostscript-wasm`, pinned in package.json). When no
native Ghostscript is found (this folder, `GHOSTSCRIPT_PATH`, PATH, or a default install location), smart compression
automatically uses the built-in engine in a background worker thread. A native `gswin64c.exe` dropped into
`resources/ghostscript/bin/` is still preferred because it is faster on very large files.

Licensing: Ghostscript is AGPL-3.0 (Artifex). If you distribute PDF Studio, keep the license text from
`node_modules/@jspawn/ghostscript-wasm/LICENSE` with the app and make the corresponding source available as the AGPL requires.
