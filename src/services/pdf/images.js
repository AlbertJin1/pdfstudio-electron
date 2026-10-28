const MAX_SIDE = 10000;      // px, longest edge
const MAX_PIXELS = 40e6;     // ≈160 MB RGBA; keeps very large pages from exhausting memory

/**
 * Renders pages of an open pdf.js document to PNG/JPEG one at a time and hands each result to onImage
 * immediately, so memory stays flat no matter how many pages are exported (one reused canvas, no batching).
 *
 *   pageNumbers : 1-based page numbers inside `pdf`
 *   onImage     : async ({ data: Uint8Array, pageNumber, index, total }) => void
 */
export async function renderPdfImages(pdf, pageNumbers, { format = 'png', quality = 0.92, dpi = 150, onImage, onProgress } = {}) {
  const mime = format === 'jpeg' ? 'image/jpeg' : 'image/png';
  const jpegQuality = Math.min(1, Math.max(0.3, Number(quality) || 0.92));
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('Canvas rendering is not available.');
  try {
    for (let index = 0; index < pageNumbers.length; index += 1) {
      const pageNumber = pageNumbers[index];
      onProgress?.({ index, total: pageNumbers.length, pageNumber });
      const page = await pdf.getPage(pageNumber);
      try {
        const base = page.getViewport({ scale: 1 });
        const wanted = Math.max(0.1, dpi / 72);
        const scale = Math.min(wanted, MAX_SIDE / Math.max(base.width, base.height), Math.sqrt(MAX_PIXELS / (base.width * base.height)));
        const viewport = page.getViewport({ scale });
        canvas.width = Math.max(1, Math.round(viewport.width));
        canvas.height = Math.max(1, Math.round(viewport.height));
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: context, viewport, background: '#ffffff' }).promise;
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, mime, mime === 'image/jpeg' ? jpegQuality : undefined));
        if (!blob) throw new Error(`Page ${pageNumber} is too large to export as an image at this resolution. Choose a lower resolution.`);
        const data = new Uint8Array(await blob.arrayBuffer());
        await onImage?.({ data, pageNumber, index, total: pageNumbers.length });
      } finally { page.cleanup(); }
    }
  } finally { canvas.width = 0; canvas.height = 0; }
}
