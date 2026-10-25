import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib';
import { Document, Paragraph, TextRun, PageBreak, Packer } from 'docx';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export const isPdf = (item) => item?.kind === 'pdf' || item?.mime === 'application/pdf';
export const isImage = (item) => item?.kind === 'image' || String(item?.mime || '').startsWith('image/');
export const uid = () => globalThis.crypto?.randomUUID?.() || `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
export const normalizeBytes = (value) => value instanceof Uint8Array ? value : new Uint8Array(value || []);

export async function loadPdfSource(bytes, password) {
  const data = normalizeBytes(bytes).slice();
  const resourceBase = new URL('pdfjs/', window.location.href);
  return pdfjsLib.getDocument({
    data,
    password,
    wasmUrl: new URL('wasm/', resourceBase).href,
    cMapUrl: new URL('cmaps/', resourceBase).href,
    cMapPacked: true,
    standardFontDataUrl: new URL('standard_fonts/', resourceBase).href,
    iccUrl: new URL('iccs/', resourceBase).href,
    useSystemFonts: true,
  }).promise;
}

async function getImageBitmap(source) {
  const blob = new Blob([normalizeBytes(source.bytes)], { type: source.mime || 'image/png' });
  if ('createImageBitmap' in window) return createImageBitmap(blob);
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  } finally {
    // ImageBitmap does not need an object URL after it is decoded.
    URL.revokeObjectURL(url);
  }
}

export async function renderPageCanvas(page, sources, maxDimension = 720, highQuality = false) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('Canvas rendering is not available.');

  if (page.kind === 'blank') {
    const ratio = page.rotation % 180 === 90 ? page.height / page.width : page.width / page.height;
    let width = maxDimension;
    let height = Math.max(1, Math.round(maxDimension / ratio));
    if (ratio > 1) { height = maxDimension; width = Math.max(1, Math.round(maxDimension * ratio)); }
    canvas.width = width;
    canvas.height = height;
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    return canvas;
  }

  const source = sources.get(page.sourceId);
  if (!source) throw new Error('The source file for this page is no longer available.');

  if (page.kind === 'pdf') {
    const pdfPage = await source.pdf.getPage(page.sourcePageIndex + 1);
    const totalRotation = ((pdfPage.rotate || 0) + (page.rotation || 0) + 360) % 360;
    const initial = pdfPage.getViewport({ scale: 1, rotation: totalRotation });
    const target = highQuality ? Math.min(maxDimension * 1.25, 1400) : maxDimension;
    const scale = target / Math.max(initial.width, initial.height);
    const viewport = pdfPage.getViewport({ scale, rotation: totalRotation });
    const outputScale = highQuality ? Math.min(window.devicePixelRatio || 1, 2) : 1;
    canvas.width = Math.max(1, Math.floor(viewport.width * outputScale));
    canvas.height = Math.max(1, Math.floor(viewport.height * outputScale));
    canvas.style.width = `${Math.floor(viewport.width)}px`;
    canvas.style.height = `${Math.floor(viewport.height)}px`;
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    await pdfPage.render({ canvasContext: context, viewport, transform: outputScale === 1 ? null : [outputScale, 0, 0, outputScale, 0, 0], background: '#ffffff' }).promise;
    return canvas;
  }

  const image = await getImageBitmap(source);
  const angle = ((page.rotation || 0) % 360 + 360) % 360;
  const sideways = angle === 90 || angle === 270;
  const rotatedWidth = sideways ? image.height : image.width;
  const rotatedHeight = sideways ? image.width : image.height;
  const scale = maxDimension / Math.max(rotatedWidth, rotatedHeight);
  canvas.width = Math.max(1, Math.round(rotatedWidth * scale));
  canvas.height = Math.max(1, Math.round(rotatedHeight * scale));
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.save();
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate(angle * Math.PI / 180);
  context.drawImage(image, -image.width * scale / 2, -image.height * scale / 2, image.width * scale, image.height * scale);
  context.restore();
  image.close?.();
  return canvas;
}

export async function createPageThumbnail(page, sources) {
  try {
    const canvas = await renderPageCanvas(page, sources, 230, false);
    return canvas.toDataURL('image/jpeg', 0.78);
  } catch (error) {
    console.error('Could not render page thumbnail', error);
    return null;
  }
}

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
        target.drawRectangle({ x: (Number(overlay.x) || 50) / 100 * width, y: height - ((Number(overlay.y) || 50) / 100 * height) - h, width: w, height: h, color: hexToPdfColor(overlay.color || '#272a3c'), opacity: 0.95 });
      } else if (overlay.text) {
        const size = Math.max(6, Math.min(72, Number(overlay.size) || 18));
        const textWidth = font.widthOfTextAtSize(String(overlay.text), size);
        const x = Math.max(0, Math.min(width - textWidth, (Number(overlay.x) || 50) / 100 * width));
        const y = Math.max(0, Math.min(height - size, height - (Number(overlay.y) || 50) / 100 * height - size));
        target.drawText(String(overlay.text), { x, y, size, font, color: hexToPdfColor(overlay.color || '#6e54ea'), opacity: 0.98 });
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

function hexToPdfColor(hex) {
  const safe = /^#[0-9a-f]{6}$/i.test(hex) ? hex : '#6e54ea';
  return rgb(parseInt(safe.slice(1, 3), 16) / 255, parseInt(safe.slice(3, 5), 16) / 255, parseInt(safe.slice(5, 7), 16) / 255);
}

export async function pdfToDocx(pdfBytes, pdfSource) {
  const pdf = pdfSource || await loadPdfSource(pdfBytes);
  const children = [];
  for (let pageIndex = 1; pageIndex <= pdf.numPages; pageIndex += 1) {
    const page = await pdf.getPage(pageIndex);
    const content = await page.getTextContent();
    const lines = new Map();
    for (const item of content.items || []) {
      if (!item.str || !item.str.trim()) continue;
      const y = Math.round((item.transform?.[5] || 0) / 2) * 2;
      const list = lines.get(y) || [];
      list.push({ x: item.transform?.[4] || 0, text: item.str, font: item.fontName || '' });
      lines.set(y, list);
    }
    const ordered = [...lines.entries()].sort((a, b) => b[0] - a[0]);
    if (!ordered.length) children.push(new Paragraph({ children: [new TextRun({ text: '(No selectable text found on this page)', italics: true, color: '888888' })], spacing: { after: 160 } }));
    for (const [, items] of ordered) {
      items.sort((a, b) => a.x - b.x);
      const text = items.map((item) => item.text).join(' ').replace(/[ \t]+/g, ' ').trim();
      if (text) children.push(new Paragraph({ children: [new TextRun(text)], spacing: { after: 100 } }));
    }
    if (pageIndex < pdf.numPages) children.push(new Paragraph({ children: [new PageBreak()] }));
  }
  const document = new Document({
    creator: 'PDF Studio', title: 'Converted from PDF',
    sections: [{ properties: { page: { margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 } } }, children }],
  });
  const blob = await Packer.toBlob(document);
  return new Uint8Array(await blob.arrayBuffer());
}

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

export function getPageSize(page, sources) {
  if (page.kind === 'blank') return { width: page.width || 595.28, height: page.height || 841.89 };
  if (page.kind === 'pdf') {
    const source = sources.get(page.sourceId);
    const ref = source?.pdf?.getPage(page.sourcePageIndex + 1);
    if (!ref) return { width: 595.28, height: 841.89 };
    return ref.then((pdfPage) => {
      const viewport = pdfPage.getViewport({ scale: 1, rotation: (pdfPage.rotate + (page.rotation || 0)) % 360 });
      return { width: viewport.width, height: viewport.height };
    });
  }
  return { width: 595.28, height: 841.89 };
}
