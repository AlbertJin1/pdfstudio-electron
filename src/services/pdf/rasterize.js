import { PDFDocument } from 'pdf-lib';
import { loadPdfSource } from './pdfjs.js';

/**
 * Lossy compact export: rasterize each already-composed page to JPEG while retaining
 * page dimensions and watermarks. Text, links, and vector content become pixels.
 */
export async function rasterizePdfForCompression(bytes, { maxDimension = 1800, quality = 0.78, title = 'PDF Studio document', author = 'PDF Studio' } = {}) {
  const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const source = await loadPdfSource(input);
  const output = await PDFDocument.create();
  output.setTitle(title);
  output.setAuthor(author || 'PDF Studio');
  output.setCreator('PDF Studio for Desktop');
  output.setProducer('PDF Studio compact export');

  try {
    for (let index = 1; index <= source.numPages; index += 1) {
      const pdfPage = await source.getPage(index);
      const baseViewport = pdfPage.getViewport({ scale: 1 });
      const scale = Math.min(maxDimension / Math.max(baseViewport.width, baseViewport.height), 3);
      const viewport = pdfPage.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(viewport.width));
      canvas.height = Math.max(1, Math.round(viewport.height));
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) throw new Error('Could not create a canvas for compact PDF export.');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      await pdfPage.render({ canvasContext: context, viewport, background: '#ffffff' }).promise;
      const blob = await new Promise((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('Could not encode a compact page image.')), 'image/jpeg', quality));
      const imageBytes = new Uint8Array(await blob.arrayBuffer());
      const image = await output.embedJpg(imageBytes);
      const target = output.addPage([baseViewport.width, baseViewport.height]);
      target.drawImage(image, { x: 0, y: 0, width: baseViewport.width, height: baseViewport.height });
      canvas.width = 0;
      canvas.height = 0;
      pdfPage.cleanup?.();
    }
  } finally {
    await source.destroy?.();
  }
  return output.save({ useObjectStreams: true, addDefaultPage: false, objectsPerTick: 50 });
}
