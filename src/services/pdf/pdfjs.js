import { normalizeBytes } from '../../utils/files.js';

// Heavy document libraries are loaded only when a PDF operation actually needs them.
// This keeps the application shell small and lets Vite create feature-specific chunks.
let pdfjsLibPromise;

export async function getPdfJsLib() {
  if (!pdfjsLibPromise) {
    pdfjsLibPromise = import('pdfjs-dist/build/pdf.min.mjs').then((pdfjsLib) => {
      // The worker is copied into public/pdfjs by the postinstall script. Keeping it as a
      // public runtime asset avoids bundling a 1 MB+ worker into Vite's chunk graph.
      pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs/pdf.worker.min.mjs', window.location.href).href;
      return pdfjsLib;
    }).catch((error) => {
      pdfjsLibPromise = undefined;
      throw error;
    });
  }
  return pdfjsLibPromise;
}

export async function loadPdfSource(bytes, password) {
  const data = normalizeBytes(bytes).slice();
  const resourceBase = new URL('pdfjs/', window.location.href);
  const pdfjsLib = await getPdfJsLib();
  return pdfjsLib.getDocument({
    data,
    password,
    wasmUrl: new URL('wasm/', resourceBase).href,
    cMapUrl: new URL('cmaps/', resourceBase).href,
    cMapPacked: true,
    standardFontDataUrl: new URL('standard_fonts/', resourceBase).href,
    iccUrl: new URL('iccs/', resourceBase).href,
    useSystemFonts: true,
    // Keeps the real font names so the editor can match and embed the original font.
    fontExtraProperties: true,
  }).promise;
}
