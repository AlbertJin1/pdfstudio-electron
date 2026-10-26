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
  const watermarkFont = String(metadata.watermark || '').trim() ? await output.embedFont(StandardFonts.HelveticaBold) : null;
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

    if (metadata.paperSize && metadata.paperSize !== 'original') fitPageToPaper(target, metadata.paperSize);
    const pageBox = target.getMediaBox();
    const originX = pageBox.x || 0;
    const originY = pageBox.y || 0;
    const width = pageBox.width;
    const height = pageBox.height;
    for (const overlay of page.overlays || []) {
      if (overlay.type === 'rect') {
        const w = Math.max(4, (Number(overlay.width) || 30) / 100 * width);
        const h = Math.max(4, (Number(overlay.height) || 8) / 100 * height);
        target.drawRectangle({ x: originX + (Number(overlay.x) || 50) / 100 * width, y: originY + height - ((Number(overlay.y) || 50) / 100 * height) - h, width: w, height: h, color: hexToPdfColor(overlay.color || '#272a3c', rgb), opacity: 0.95 });
      } else if (overlay.text) {
        const size = Math.max(6, Math.min(72, Number(overlay.size) || 18));
        const textWidth = font.widthOfTextAtSize(String(overlay.text), size);
        const x = originX + Math.max(0, Math.min(width - textWidth, (Number(overlay.x) || 50) / 100 * width));
        const y = originY + Math.max(0, Math.min(height - size, height - (Number(overlay.y) || 50) / 100 * height - size));
        target.drawText(String(overlay.text), { x, y, size, font, color: hexToPdfColor(overlay.color || '#6e54ea', rgb), opacity: 0.98 });
      }
    }
    if (metadata.pageNumbers) {
      const label = String((Number(metadata.numberStart) || 1) + index);
      const size = 9;
      const labelWidth = font.widthOfTextAtSize(label, size);
      target.drawText(label, { x: originX + Math.max(8, (width - labelWidth) / 2), y: originY + 16, size, font, color: rgb(0.42, 0.43, 0.51), opacity: 0.82 });
    }
    if (String(metadata.watermark || '').trim()) {
      // Enterprise-style diagonal watermark: bold, uppercase, centered, and sized against
      // the page diagonal so short and long labels both read clearly across the sheet.
      const label = String(metadata.watermark).trim().replace(/\s+/g, ' ').slice(0, 100).toUpperCase();
      const diagonal = Math.hypot(width, height);
      const widthAtOnePoint = Math.max(1, watermarkFont.widthOfTextAtSize(label, 1));
      const size = Math.max(34, Math.min(112, diagonal * 0.84 / widthAtOnePoint));
      const labelWidth = watermarkFont.widthOfTextAtSize(label, size);
      const textHeight = size * 1.12;
      const angle = Math.max(-75, Math.min(75, Number(metadata.watermarkAngle ?? 35))) || 35;
      const opacity = Math.max(0.08, Math.min(0.72, Number(metadata.watermarkOpacity ?? 0.32)));
      const color = hexToPdfColor(metadata.watermarkColor || '#626b7c', rgb);
      const radians = angle * Math.PI / 180;
      const corners = [
        [0, 0],
        [labelWidth * Math.cos(radians), labelWidth * Math.sin(radians)],
        [-textHeight * Math.sin(radians), textHeight * Math.cos(radians)],
        [labelWidth * Math.cos(radians) - textHeight * Math.sin(radians), labelWidth * Math.sin(radians) + textHeight * Math.cos(radians)],
      ];
      const minX = Math.min(...corners.map(([x]) => x));
      const maxX = Math.max(...corners.map(([x]) => x));
      const minY = Math.min(...corners.map(([, y]) => y));
      const maxY = Math.max(...corners.map(([, y]) => y));
      const x = originX + width / 2 - (minX + maxX) / 2;
      const y = originY + height / 2 - (minY + maxY) / 2;
      target.drawText(label, { x, y, size, font: watermarkFont, color, opacity, rotate: degrees(angle), characterSpacing: Math.min(1.4, size * 0.012) });
    }
  }
  return output.save({ useObjectStreams: true, addDefaultPage: false, objectsPerTick: 50 });
}


const PAPER_DIMENSIONS = {
  a3: [841.89, 1190.55],
  a4: [595.28, 841.89],
  a5: [419.53, 595.28],
  letter: [612, 792],
  legal: [612, 1008],
  folio: [612, 936], // 8.5 × 13 inches, in PDF points
};

function fitPageToPaper(page, paperSize) {
  const dimensions = PAPER_DIMENSIONS[String(paperSize).toLowerCase()];
  if (!dimensions) return;
  let [paperWidth, paperHeight] = dimensions;
  const rotation = ((page.getRotation?.().angle || 0) % 360 + 360) % 360;
  // PDF page boxes are stored before page rotation; swap the paper box so its displayed
  // orientation still matches the selected paper size.
  if (rotation === 90 || rotation === 270) [paperWidth, paperHeight] = [paperHeight, paperWidth];
  const box = page.getMediaBox();
  const originX = box.x || 0;
  const originY = box.y || 0;
  const currentWidth = box.width;
  const currentHeight = box.height;
  if (!(currentWidth > 0 && currentHeight > 0)) { page.setSize(paperWidth, paperHeight); return; }
  const scale = Math.min(paperWidth / currentWidth, paperHeight / currentHeight);
  // Account for source pages whose MediaBox does not start at (0, 0).
  const offsetX = (paperWidth - currentWidth * scale) / 2 + originX * (1 - scale);
  const offsetY = (paperHeight - currentHeight * scale) / 2 + originY * (1 - scale);
  // Fit proportionally and center on the chosen paper, preserving vectors and selectable text.
  page.scaleContent(scale, scale);
  page.scaleAnnotations?.(scale, scale);
  page.translateContent(offsetX, offsetY);
  page.translateAnnotations?.(offsetX, offsetY);
  page.setSize(paperWidth, paperHeight);
}

function hexToPdfColor(hex, rgb) {
  const safe = /^#[0-9a-f]{6}$/i.test(hex) ? hex : '#6e54ea';
  return rgb(parseInt(safe.slice(1, 3), 16) / 255, parseInt(safe.slice(3, 5), 16) / 255, parseInt(safe.slice(5, 7), 16) / 255);
}
