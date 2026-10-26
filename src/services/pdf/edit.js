import { normalizeBytes } from '../../utils/files.js';

const SAFE_COLOR = '#202939';

function hexToRgb(hex, rgb) {
  const value = /^#[0-9a-f]{6}$/i.test(String(hex || '')) ? hex : SAFE_COLOR;
  return rgb(
    Number.parseInt(value.slice(1, 3), 16) / 255,
    Number.parseInt(value.slice(3, 5), 16) / 255,
    Number.parseInt(value.slice(5, 7), 16) / 255,
  );
}

function dataUrlToBytes(dataUrl) {
  const encoded = String(dataUrl || '').split(',')[1];
  if (!encoded) throw new Error('The image or signature data is not valid.');
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function mapBox(annotation, viewport) {
  const x = (Number(annotation.x) || 0) / 100 * viewport.width;
  const y = (Number(annotation.y) || 0) / 100 * viewport.height;
  const w = Math.max(0.2, Number(annotation.w) || 0.2) / 100 * viewport.width;
  const h = Math.max(0.2, Number(annotation.h) || 0.2) / 100 * viewport.height;
  const points = [
    viewport.convertToPdfPoint(x, y),
    viewport.convertToPdfPoint(x + w, y),
    viewport.convertToPdfPoint(x, y + h),
    viewport.convertToPdfPoint(x + w, y + h),
  ];
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(0.2, Math.max(...xs) - Math.min(...xs)),
    height: Math.max(0.2, Math.max(...ys) - Math.min(...ys)),
    center: [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2],
  };
}

function mapPoint(point, viewport) {
  return viewport.convertToPdfPoint(
    Math.max(0, Math.min(100, Number(point.x) || 0)) / 100 * viewport.width,
    Math.max(0, Math.min(100, Number(point.y) || 0)) / 100 * viewport.height,
  );
}

function drawLine(pdfPage, start, end, color, thickness, opacity) {
  pdfPage.drawLine({
    start: { x: start[0], y: start[1] },
    end: { x: end[0], y: end[1] },
    color,
    thickness: Math.max(0.4, Number(thickness) || 1.5),
    opacity: Math.max(0.05, Math.min(1, Number(opacity) || 1)),
  });
}

/** Apply editor annotations to a copy of the original PDF. The source file is never mutated. */
export async function exportEditedPdf(sourceBytes, pdfJsDocument, annotationsByPage, metadata = {}) {
  const { PDFDocument, StandardFonts, rgb, degrees } = await import('pdf-lib');
  const output = await PDFDocument.load(normalizeBytes(sourceBytes).slice());
  const pages = output.getPages();
  const regular = await output.embedFont(StandardFonts.Helvetica);
  const bold = await output.embedFont(StandardFonts.HelveticaBold);
  const italic = await output.embedFont(StandardFonts.HelveticaOblique);
  const fontMap = { regular, bold, italic };
  const embeddedImages = new Map();

  for (const [pageKey, annotations] of Object.entries(annotationsByPage || {})) {
    const pageIndex = Number(pageKey);
    if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= pages.length || !Array.isArray(annotations)) continue;
    const outputPage = pages[pageIndex];
    const pdfJsPage = await pdfJsDocument.getPage(pageIndex + 1);
    const rotation = ((Number(pdfJsPage.rotate) || 0) % 360 + 360) % 360;
    const viewport = pdfJsPage.getViewport({ scale: 1, rotation });
    const rotationCorrection = degrees((360 - rotation) % 360);

    for (const annotation of annotations) {
      if (!annotation || annotation.hidden) continue;
      const color = hexToRgb(annotation.color || SAFE_COLOR, rgb);
      const opacity = Math.max(0.05, Math.min(1, Number(annotation.opacity) || 1));
      const box = mapBox(annotation, viewport);
      const size = Math.max(4, Math.min(160, Number(annotation.size) || 16));
      const lineWidth = Math.max(0.4, Math.min(30, Number(annotation.lineWidth) || 2));

      if (annotation.type === 'text' || annotation.type === 'stamp' || annotation.type === 'note') {
        const font = fontMap[annotation.fontStyle] || (annotation.type === 'stamp' ? bold : regular);
        const text = String(annotation.text || '').slice(0, 10000);
        if (!text) continue;
        const textWidth = Math.min(Math.max(1, box.width), font.widthOfTextAtSize(text.split('\n')[0] || ' ', size));
        const isSideways = rotation === 90 || rotation === 270;
        const anchor = mapPoint({ x: annotation.x, y: annotation.y }, viewport);
        let x;
        let y;
        if (rotation === 0 && annotation.type !== 'stamp') {
          // Keep typed text and note content anchored at the same top-left position as the editor preview.
          const padding = annotation.type === 'note' ? 4 : 0;
          x = anchor[0] + padding;
          y = anchor[1] - size - padding;
        } else {
          x = box.center[0] - (isSideways ? size : textWidth) / 2;
          y = box.center[1] - (isSideways ? textWidth : size) / 2;
        }
        if (annotation.type === 'stamp') {
          outputPage.drawRectangle({ x: box.x, y: box.y, width: box.width, height: box.height, borderColor: color, borderWidth: Math.max(1, lineWidth), opacity: 0.96 });
        } else if (annotation.type === 'note') {
          outputPage.drawRectangle({ x: box.x, y: box.y, width: box.width, height: box.height, color: rgb(1, 0.96, 0.72), borderColor: rgb(0.91, 0.78, 0.35), borderWidth: 0.7, opacity: 0.98 });
        }
        outputPage.drawText(text, {
          x, y, size, font, color, opacity,
          maxWidth: Math.max(size, (isSideways ? box.height : box.width) - (annotation.type === 'note' ? 8 : 0)),
          lineHeight: size * 1.22,
          rotate: rotationCorrection,
        });
      } else if (annotation.type === 'highlight') {
        outputPage.drawRectangle({ x: box.x, y: box.y, width: box.width, height: box.height, color, opacity: Math.min(0.48, Number(annotation.opacity) || 0.34), borderWidth: 0 });
      } else if (annotation.type === 'whiteout') {
        outputPage.drawRectangle({ x: box.x, y: box.y, width: box.width, height: box.height, color: rgb(1, 1, 1), opacity: 1, borderWidth: 0 });
      } else if (annotation.type === 'rect') {
        outputPage.drawRectangle({ x: box.x, y: box.y, width: box.width, height: box.height, borderColor: color, borderWidth: lineWidth, opacity });
      } else if (annotation.type === 'ellipse') {
        outputPage.drawEllipse({ x: box.center[0], y: box.center[1], xScale: box.width / 2, yScale: box.height / 2, borderColor: color, borderWidth: lineWidth, opacity });
      } else if (annotation.type === 'line' || annotation.type === 'underline' || annotation.type === 'strike') {
        const lineY = annotation.y + (annotation.type === 'strike' ? annotation.h * 0.52 : annotation.h);
        const p1 = annotation.type === 'line' && annotation.startPoint ? mapPoint(annotation.startPoint, viewport) : mapPoint({ x: annotation.x, y: lineY }, viewport);
        const p2 = annotation.type === 'line' && annotation.endPoint ? mapPoint(annotation.endPoint, viewport) : mapPoint({ x: annotation.x + annotation.w, y: lineY }, viewport);
        drawLine(outputPage, p1, p2, color, lineWidth, opacity);
      } else if (annotation.type === 'draw' && Array.isArray(annotation.points) && annotation.points.length > 1) {
        for (let i = 1; i < annotation.points.length; i += 1) {
          drawLine(outputPage, mapPoint(annotation.points[i - 1], viewport), mapPoint(annotation.points[i], viewport), color, lineWidth, opacity);
        }
      } else if (annotation.type === 'signature' || annotation.type === 'image') {
        if (!annotation.data) continue;
        let image = embeddedImages.get(annotation.id);
        if (!image) {
          const bytes = dataUrlToBytes(annotation.data);
          image = String(annotation.mime || annotation.data).includes('jpeg') || String(annotation.data).startsWith('data:image/jpeg')
            ? await output.embedJpg(bytes)
            : await output.embedPng(bytes);
          embeddedImages.set(annotation.id, image);
        }
        const sideways = rotation === 90 || rotation === 270;
        outputPage.drawImage(image, {
          x: sideways ? box.center[0] - box.height / 2 : box.x,
          y: sideways ? box.center[1] - box.width / 2 : box.y,
          width: sideways ? box.height : box.width,
          height: sideways ? box.width : box.height,
          rotate: rotationCorrection,
          opacity,
        });
      }
    }
  }

  output.setProducer('PDF Studio');
  output.setCreator('PDF Studio');
  if (metadata.title) output.setTitle(String(metadata.title).slice(0, 240));
  return output.save({ useObjectStreams: true, objectsPerTick: 50 });
}
