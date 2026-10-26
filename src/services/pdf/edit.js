import { normalizeBytes } from '../../utils/files.js';
import { TEXT_TYPES, baselineOf, isEncodable, layoutItem } from './textMetrics.js';

const SAFE_COLOR = '#202939';
const REPLACEMENTS = { '\u2212': '-', '\u00a0': ' ', '\u2022': '\u2022', '\u2192': '->', '\u2190': '<-', '\u2713': 'v', '\u2714': 'v', '\u2610': '[ ]' };

function hexToRgb(hex, rgb) {
  const value = /^#[0-9a-f]{6}$/i.test(String(hex || '')) ? hex : SAFE_COLOR;
  return rgb(Number.parseInt(value.slice(1, 3), 16) / 255, Number.parseInt(value.slice(3, 5), 16) / 255, Number.parseInt(value.slice(5, 7), 16) / 255);
}

function dataUrlToBytes(dataUrl) {
  const encoded = String(dataUrl || '').split(',')[1];
  if (!encoded) throw new Error('The image or signature data is not valid.');
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Standard PDF fonts only cover WinAnsi; anything else would throw, so swap it for a safe character. */
const safeText = (text) => [...String(text)].map((ch) => (isEncodable(ch) ? ch : (REPLACEMENTS[ch] ?? '?'))).join('');

/**
 * Apply the editor's objects to a copy of the original PDF; the source file is never mutated.
 * All geometry is in points measured from the top-left of the displayed (rotated) page.
 */
export async function exportEditedPdf(sourceBytes, pdfJsDocument, annotationsByPage, metadata = {}) {
  const { PDFDocument, StandardFonts, rgb, degrees, BlendMode } = await import('pdf-lib');
  const output = await PDFDocument.load(normalizeBytes(sourceBytes).slice(), { ignoreEncryption: false });
  const pages = output.getPages();
  const fontCache = new Map();
  const fontNames = {
    'helvetica-0-0': StandardFonts.Helvetica, 'helvetica-1-0': StandardFonts.HelveticaBold, 'helvetica-0-1': StandardFonts.HelveticaOblique, 'helvetica-1-1': StandardFonts.HelveticaBoldOblique,
    'times-0-0': StandardFonts.TimesRoman, 'times-1-0': StandardFonts.TimesRomanBold, 'times-0-1': StandardFonts.TimesRomanItalic, 'times-1-1': StandardFonts.TimesRomanBoldItalic,
    'courier-0-0': StandardFonts.Courier, 'courier-1-0': StandardFonts.CourierBold, 'courier-0-1': StandardFonts.CourierOblique, 'courier-1-1': StandardFonts.CourierBoldOblique,
  };
  const getFont = async (family, bold, italic) => {
    const key = `${fontNames[`${family}-${bold ? 1 : 0}-${italic ? 1 : 0}`] ? family : 'helvetica'}-${bold ? 1 : 0}-${italic ? 1 : 0}`;
    if (!fontCache.has(key)) fontCache.set(key, await output.embedFont(fontNames[key]));
    return fontCache.get(key);
  };
  const imageCache = new Map();

  // Real fonts: when the document's font is installed, embed that exact font so edited text looks identical.
  let fontkitReady = false;
  const customFonts = new Map();
  const finder = metadata.findFont;
  const getCustomFont = async (layout) => {
    if (!layout.fontName || typeof finder !== 'function') return null;
    const key = `${layout.fontName}|${layout.bold ? 1 : 0}|${layout.italic ? 1 : 0}`;
    if (customFonts.has(key)) return customFonts.get(key);
    let result = null;
    try {
      const bytes = await finder({ family: layout.fontName, bold: layout.bold, italic: layout.italic });
      if (bytes && bytes.length) {
        if (!fontkitReady) { const mod = await import('@pdf-lib/fontkit'); output.registerFontkit(mod.default || mod); fontkitReady = true; }
        const font = await output.embedFont(bytes, { subset: true });
        result = { font, chars: new Set(font.getCharacterSet()) };
      }
    } catch (error) { console.warn('Could not embed the original font', layout.fontName, error); }
    customFonts.set(key, result);
    return result;
  };

  for (const [pageKey, items] of Object.entries(annotationsByPage || {})) {
    const pageIndex = Number(pageKey);
    if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= pages.length || !Array.isArray(items) || !items.length) continue;
    const page = pages[pageIndex];
    const pdfJsPage = await pdfJsDocument.getPage(pageIndex + 1);
    const viewport = pdfJsPage.getViewport({ scale: 1, rotation: ((Number(pdfJsPage.rotate) || 0) % 360 + 360) % 360 });
    const P = (x, y) => viewport.convertToPdfPoint(x, y);
    const origin = P(0, 0);
    const unitX = P(1, 0);
    const angle = Math.atan2(unitX[1] - origin[1], unitX[0] - origin[0]) * 180 / Math.PI;
    const rotate = degrees(angle);

    const box = (x, y, w, h) => {
      const pts = [P(x, y), P(x + w, y), P(x, y + h), P(x + w, y + h)];
      const xs = pts.map((p) => p[0]); const ys = pts.map((p) => p[1]);
      const left = Math.min(...xs); const bottom = Math.min(...ys);
      return { x: left, y: bottom, width: Math.max(0.2, Math.max(...xs) - left), height: Math.max(0.2, Math.max(...ys) - bottom), cx: (left + Math.max(...xs)) / 2, cy: (bottom + Math.max(...ys)) / 2 };
    };
    const line = (a, b, color, thickness, opacity) => {
      const p = P(a.x, a.y); const q = P(b.x, b.y);
      page.drawLine({ start: { x: p[0], y: p[1] }, end: { x: q[0], y: q[1] }, color, thickness: Math.max(0.4, Number(thickness) || 1.5), opacity });
    };
    const cover = (rect, colorHex) => {
      const b = box(rect.x - 0.75, rect.y - 0.75, rect.w + 1.5, rect.h + 1.5);
      page.drawRectangle({ x: b.x, y: b.y, width: b.width, height: b.height, color: hexToRgb(colorHex || '#ffffff', rgb), borderWidth: 0, opacity: 1 });
    };

    for (const item of items) {
      if (!item || item.hidden) continue;
      const color = hexToRgb(item.color || SAFE_COLOR, rgb);
      const opacity = Math.max(0.05, Math.min(1, Number(item.opacity) || 1));
      const lineWidth = Math.max(0.4, Math.min(30, Number(item.lineWidth) || 2));
      const x = Number(item.x) || 0; const y = Number(item.y) || 0;
      const w = Math.max(0.2, Number(item.w) || 0.2); const h = Math.max(0.2, Number(item.h) || 0.2);

      if (item.type === 'textedit' || item.type === 'imageedit') {
        if (item.src && (item.type === 'textedit' || item.data || item.deleted)) cover(item.src, item.cover);
      }

      if (TEXT_TYPES.has(item.type)) {
        if (item.deleted) continue;
        const rawText = String(item.text || '');
        const layout = layoutItem({ ...item, text: rawText });
        const b = box(x, y, w, h);
        if (item.type === 'stamp') page.drawRectangle({ x: b.x, y: b.y, width: b.width, height: b.height, borderColor: color, borderWidth: lineWidth, opacity: 0.96 });
        if (item.type === 'note') page.drawRectangle({ x: b.x, y: b.y, width: b.width, height: b.height, color: rgb(1, 0.96, 0.72), borderColor: rgb(0.91, 0.78, 0.35), borderWidth: 0.7, opacity: 0.98 });
        if (!rawText.trim()) continue;
        const custom = await getCustomFont(layout);
        const canUseCustom = custom && [...rawText].every((ch) => ch === '\n' || custom.chars.has(ch.codePointAt(0)));
        const font = canUseCustom ? custom.font : await getFont(layout.family, layout.bold, layout.italic);
        const inner = w - 2 * layout.pad;
        const totalH = layout.lines.length * layout.lineH;
        const offsetY = layout.valign === 'middle' ? Math.max(0, (h - 2 * layout.pad - totalH) / 2) : 0;
        const thickness = Math.max(0.5, layout.size * 0.065);
        layout.lines.forEach((rawLine, index) => {
          if (!rawLine.trim()) return;
          const text = canUseCustom ? rawLine : safeText(rawLine);
          const lineW = font.widthOfTextAtSize(text, layout.size);
          const dx = layout.align === 'center' ? (inner - lineW) / 2 : layout.align === 'right' ? inner - lineW : 0;
          const lx = x + layout.pad + dx;
          const base = baselineOf(layout, y, index) + offsetY;
          const [px, py] = P(lx, base);
          page.drawText(text, { x: px, y: py, size: layout.size, font, color, opacity, rotate });
          if (layout.underline) line({ x: lx, y: base + layout.size * 0.12 }, { x: lx + lineW, y: base + layout.size * 0.12 }, color, thickness, opacity);
          if (layout.strike) line({ x: lx, y: base - layout.size * 0.3 }, { x: lx + lineW, y: base - layout.size * 0.3 }, color, thickness, opacity);
        });
      } else if (item.type === 'highlight') {
        const b = box(x, y, w, h);
        page.drawRectangle({ x: b.x, y: b.y, width: b.width, height: b.height, color, opacity: Math.min(0.55, Number(item.opacity) || 0.34), borderWidth: 0, blendMode: BlendMode.Multiply });
      } else if (item.type === 'whiteout') {
        const b = box(x, y, w, h);
        page.drawRectangle({ x: b.x, y: b.y, width: b.width, height: b.height, color: rgb(1, 1, 1), opacity: 1, borderWidth: 0 });
      } else if (item.type === 'rect') {
        const b = box(x, y, w, h);
        page.drawRectangle({ x: b.x, y: b.y, width: b.width, height: b.height, borderColor: color, borderWidth: lineWidth, opacity });
      } else if (item.type === 'ellipse') {
        const b = box(x, y, w, h);
        page.drawEllipse({ x: b.cx, y: b.cy, xScale: b.width / 2, yScale: b.height / 2, borderColor: color, borderWidth: lineWidth, opacity });
      } else if (item.type === 'line') {
        line(item.startPoint || { x, y }, item.endPoint || { x: x + w, y: y + h }, color, lineWidth, opacity);
      } else if (item.type === 'underline' || item.type === 'strike') {
        const ly = item.type === 'strike' ? y + h * 0.52 : y + h;
        line({ x, y: ly }, { x: x + w, y: ly }, color, lineWidth, opacity);
      } else if (item.type === 'draw' && Array.isArray(item.points) && item.points.length > 1) {
        for (let i = 1; i < item.points.length; i += 1) line(item.points[i - 1], item.points[i], color, lineWidth, opacity);
      } else if (item.type === 'signature' || item.type === 'image' || item.type === 'imageedit') {
        if (!item.data || item.deleted) continue;
        let image = imageCache.get(item.data);
        if (!image) {
          const bytes = dataUrlToBytes(item.data);
          image = String(item.data).startsWith('data:image/jpeg') ? await output.embedJpg(bytes) : await output.embedPng(bytes);
          imageCache.set(item.data, image);
        }
        const [px, py] = P(x, y + h);
        page.drawImage(image, { x: px, y: py, width: w, height: h, rotate, opacity });
      }
    }
  }

  output.setProducer('PDF Studio');
  output.setCreator('PDF Studio');
  if (metadata.title) output.setTitle(String(metadata.title).slice(0, 240));
  return output.save({ useObjectStreams: true, objectsPerTick: 50 });
}
