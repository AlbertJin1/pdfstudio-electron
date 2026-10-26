import { renderPageCanvas } from './render.js';

export async function renderPdfImages(pdfSource, pages, options = {}) {
  const selected = options.selectedOnly ? pages : pages;
  const outputs = [];
  const quality = Math.min(1, Math.max(0.3, Number(options.quality) || 0.92));
  const format = options.format === 'jpeg' ? 'image/jpeg' : 'image/png';
  const ext = format === 'image/jpeg' ? 'jpg' : 'png';
  for (let i = 0; i < selected.length; i += 1) {
    const page = selected[i];
    const canvas = await renderPageCanvas(page, pdfSource, Math.min(2400, Math.max(500, Number(options.maxDimension) || 1600)), true);
    const dataUrl = canvas.toDataURL(format, quality);
    const base64 = dataUrl.split(',')[1];
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let j = 0; j < binary.length; j += 1) bytes[j] = binary.charCodeAt(j);
    outputs.push({ name: `page-${String(i + 1).padStart(3, '0')}.${ext}`, data: bytes });
  }
  return outputs;
}
