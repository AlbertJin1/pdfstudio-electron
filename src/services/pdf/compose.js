import { normalizeBytes } from '../../utils/files.js';
import { getImageBitmap, renderPageCanvas } from './render.js';

export async function imageSourceForPdf(source) {
  const mime = source.mime || 'image/png';
  if (mime === 'image/png' || mime === 'image/jpeg') return { bytes: normalizeBytes(source.bytes), mime };
  const bitmap = await getImageBitmap(source);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close?.();
  const blob = await new Promise((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('Unable to convert image for PDF.')), 'image/jpeg', 0.94));
  return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: 'image/jpeg' };
}

export async function composePdf(pages, sources, metadata = {}) {
  if (!pages.length) throw new Error('Add at least one page before exporting.');
  const { PDFDocument, StandardFonts, rgb, degrees } = await import('pdf-lib');
  const output = await PDFDocument.create();
  const sourcePdfs = new Map();
  const font = await output.embedFont(StandardFonts.Helvetica);
  if (metadata.title) output.setTitle(metadata.title);
  output.setAuthor(metadata.author || 'PDF Studio');
  output.setCreator('PDF Studio for Desktop');
  output.setProducer('PDF Studio');
  output.setCreationDate(new Date());

  for (let index = 0; index < pages.length; index += 1) {
    const page = pages[index];
    let target;
    if (page.kind === 'blank') {
      const width = Number(page.width) || 595.28;
      const height = Number(page.height) || 841.89;
      target = output.addPage([width, height]);
    } else if (page.kind === 'pdf') {
      const source = sources.get(page.sourceId);
      if (!source) throw new Error(`Missing source for page ${index + 1}.`);
      if (!sourcePdfs.has(page.sourceId)) {
        try {
          sourcePdfs.set(page.sourceId, { pdf: await PDFDocument.load(normalizeBytes(source.bytes).slice()), rasterFallback: false });
        } catch (error) {
          // PDF.js can decrypt password-protected documents after the user supplies a password.
          // When pdf-lib cannot copy the original structure, preserve the visible page as a high-resolution image.
          if (!source.pdf) throw error;
          sourcePdfs.set(page.sourceId, { pdf: null, rasterFallback: true });
        }
      }
      const sourceEntry = sourcePdfs.get(page.sourceId);
      if (sourceEntry.rasterFallback) {
        const rendered = await renderPageCanvas(page, sources, 2400, true);
        const pngUrl = rendered.toDataURL('image/png');
        const binary = atob(pngUrl.split(',')[1]);
        const pngBytes = new Uint8Array(binary.length);
        for (let byteIndex = 0; byteIndex < binary.length; byteIndex += 1) pngBytes[byteIndex] = binary.charCodeAt(byteIndex);
        const embedded = await output.embedPng(pngBytes);
        const pdfJsPage = await source.pdf.getPage(page.sourcePageIndex + 1);
        const viewport = pdfJsPage.getViewport({ scale: 1, rotation: ((pdfJsPage.rotate || 0) + (page.rotation || 0) + 360) % 360 });
        target = output.addPage([viewport.width, viewport.height]);
        target.drawImage(embedded, { x: 0, y: 0, width: viewport.width, height: viewport.height });
      } else {
        const [copied] = await output.copyPages(sourceEntry.pdf, [page.sourcePageIndex]);
        target = output.addPage(copied);
        const original = target.getRotation().angle || 0;
        target.setRotation(degrees(((original + (page.rotation || 0)) % 360 + 360) % 360));
      }
    } else {
      const source = sources.get(page.sourceId);
      if (!source) throw new Error(`Missing image source for page ${index + 1}.`);
      const prepared = await imageSourceForPdf(source);
      const image = prepared.mime === 'image/png' ? await output.embedPng(prepared.bytes) : await output.embedJpg(prepared.bytes);
      const maxWidth = 595.28;
      const maxHeight = 841.89;
      const factor = Math.min(maxWidth / image.width, maxHeight / image.height);
      const width = Math.max(1, image.width * factor);
      const height = Math.max(1, image.height * factor);
      target = output.addPage([maxWidth, maxHeight]);
      target.drawImage(image, { x: (maxWidth - width) / 2, y: (maxHeight - height) / 2, width, height });
      if (page.rotation) target.setRotation(degrees(page.rotation));
    }

    const { width, height } = target.getSize();
    for (const overlay of page.overlays || []) {
      if (overlay.type === 'rect') {
        const w = Math.max(4, (Number(overlay.width) || 30) / 100 * width);
        const h = Math.max(4, (Number(overlay.height) || 8) / 100 * height);
        target.drawRectangle({ x: (Number(overlay.x) || 50) / 100 * width, y: height - ((Number(overlay.y) || 50) / 100 * height) - h, width: w, height: h, color: hexToPdfColor(overlay.color || '#272a3c', rgb), opacity: 0.95 });
      } else if (overlay.text) {
        const size = Math.max(6, Math.min(72, Number(overlay.size) || 18));
        const textWidth = font.widthOfTextAtSize(String(overlay.text), size);
        const x = Math.max(0, Math.min(width - textWidth, (Number(overlay.x) || 50) / 100 * width));
        const y = Math.max(0, Math.min(height - size, height - (Number(overlay.y) || 50) / 100 * height - size));
        target.drawText(String(overlay.text), { x, y, size, font, color: hexToPdfColor(overlay.color || '#6e54ea', rgb), opacity: 0.98 });
      }
    }
    if (metadata.pageNumbers) {
      const label = String((Number(metadata.numberStart) || 1) + index);
      const size = 9;
      const labelWidth = font.widthOfTextAtSize(label, size);
      target.drawText(label, { x: Math.max(8, (width - labelWidth) / 2), y: 16, size, font, color: rgb(0.42, 0.43, 0.51), opacity: 0.82 });
    }
    if (String(metadata.watermark || '').trim()) {
      const label = String(metadata.watermark).trim().slice(0, 100);
      const size = Math.min(44, Math.max(20, width / 14));
      const labelWidth = font.widthOfTextAtSize(label, size);
      target.drawText(label, { x: Math.max(8, (width - labelWidth) / 2), y: height * 0.48, size, font, color: rgb(0.5, 0.49, 0.62), opacity: 0.17, rotate: degrees(35) });
    }
  }
  return output.save({ useObjectStreams: true, addDefaultPage: false, objectsPerTick: 50 });
}

function hexToPdfColor(hex, rgb) {
  const safe = /^#[0-9a-f]{6}$/i.test(hex) ? hex : '#6e54ea';
  return rgb(parseInt(safe.slice(1, 3), 16) / 255, parseInt(safe.slice(3, 5), 16) / 255, parseInt(safe.slice(5, 7), 16) / 255);
}
