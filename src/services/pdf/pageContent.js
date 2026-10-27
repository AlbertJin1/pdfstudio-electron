// Reads the existing content of a PDF page so it can be edited like in Acrobat:
// text is grouped into lines and paragraph blocks, images are located through the operator list.
import { getPdfJsLib } from './pdfjs.js';
import { familyFromName, textWidth } from './textMetrics.js';

const mul = (m, n) => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];

export function detectFont(realName = '', generic = '', fontObj = null) {
  const all = `${realName} ${generic} ${fontObj?.fallbackName || ''} ${fontObj?.family || ''}`;
  const bold = /bold|black|heavy|semibold|demi/i.test(`${realName} ${generic}`) || !!fontObj?.bold || !!fontObj?.black;
  const italic = /italic|oblique|-it\b|ital\b/i.test(`${realName} ${generic}`) || !!fontObj?.italic;
  let family = 'helvetica';
  if (/courier|mono|consolas|typewriter|menlo/i.test(all)) family = 'courier';
  else if (/times|garamond|georgia|palatino|minion|cambria|bookman|serif/i.test(all) && !/sans/i.test(all)) family = 'times';
  return { family, bold, italic, name: familyFromName(realName) };
}

function collectLines(content, page, viewport) {
  const items = [];
  for (const raw of content.items) {
    if (typeof raw.str !== 'string' || !raw.str.length) continue;
    const t = mul(viewport.transform, raw.transform);
    const size = Math.hypot(t[2], t[3]);
    if (size < 2 || Math.abs(Math.atan2(t[1], t[0])) > 0.035) continue; // upright text only
    const style = content.styles?.[raw.fontName] || {};
    const ascent = Number.isFinite(style.ascent) && style.ascent > 0.3 ? style.ascent : 0.88;
    const descent = Number.isFinite(style.descent) ? Math.abs(style.descent) : 0.22;
    let fontObj = null;
    try { if (page.commonObjs.has(raw.fontName)) fontObj = page.commonObjs.get(raw.fontName); } catch { /* font not resolved yet */ }
    const real = fontObj?.name || '';
    let width = Math.max(0.5, (raw.width || 0) * viewport.scale);
    const font = { ...detectFont(real, style.fontFamily, fontObj), ref: raw.fontName };
    // Leading/trailing spaces are part of the PDF run's advance width but are not visible text. Left in, they
    // made the selectable/editable box run on past the text (sometimes right up to the next column).
    const trimmed = raw.str.trim();
    if (!trimmed) continue;
    let left = t[4];
    if (trimmed.length !== raw.str.length) {
      const lead = raw.str.length - raw.str.trimStart().length;
      const trail = raw.str.length - raw.str.trimEnd().length;
      const full = textWidth(raw.str, font, 100);
      const unit = full > 0 ? width / full : width / raw.str.length;
      const leadW = full > 0 ? textWidth(raw.str.slice(0, lead), font, 100) * unit : (width * lead) / raw.str.length;
      const trailW = full > 0 ? textWidth(raw.str.slice(raw.str.length - trail), font, 100) * unit : (width * trail) / raw.str.length;
      left += leadW;
      width = Math.max(0.5, width - leadW - trailW);
    }
    items.push({
      str: trimmed, x: left, base: t[5], size, w: width,
      top: t[5] - size * ascent, bottom: t[5] + size * descent,
      font,
    });
  }
  // PDF content-stream order is not guaranteed to be visual order (tables and multi-column forms
  // often interleave cells). Reassemble upright text using page coordinates before grouping.
  items.sort((a, b) => (Math.abs(a.base - b.base) < Math.max(a.size, b.size) * 0.25 ? a.x - b.x : a.base - b.base));
  const lines = [];
  let line = null;
  for (const it of items) {
    const prev = line?.items[line.items.length - 1];
    const gap = prev ? it.x - (prev.x + prev.w) : 0;
    const sameBase = prev && Math.abs(it.base - prev.base) < Math.max(prev.size, it.size) * 0.3;
    const sameSize = prev && Math.abs(it.size - prev.size) < Math.max(prev.size, it.size) * 0.25;
    const sameFont = prev && prev.font.family === it.font.family && prev.font.bold === it.font.bold && prev.font.italic === it.font.italic && prev.font.name === it.font.name && prev.font.ref === it.font.ref;
    if (prev && sameBase && sameSize && sameFont && gap > -it.size * 0.4 && gap < it.size * 0.82) {
      const needsSpace = gap > it.size * 0.18 && !/\s$/.test(prev.str) && !/^\s/.test(it.str);
      line.text += (needsSpace ? ' ' : '') + it.str;
      line.items.push(it);
      line.right = Math.max(line.right, it.x + it.w);
      line.top = Math.min(line.top, it.top);
      line.bottom = Math.max(line.bottom, it.bottom);
    } else {
      line = { items: [it], text: it.str, x: it.x, right: it.x + it.w, base: it.base, size: it.size, top: it.top, bottom: it.bottom, font: it.font };
      lines.push(line);
    }
  }
  return lines.map((l) => ({ ...l, text: l.text.replace(/\s+$/, '') })).filter((l) => l.text.trim().length);
}

function guessAlign(lines) {
  if (lines.length < 2) return 'left';
  const near = (a, b) => Math.abs(a - b) < 1.5;
  if (lines.every((l) => near(l.x, lines[0].x))) return 'left';
  if (lines.every((l) => near(l.right, lines[0].right))) return 'right';
  if (lines.every((l) => near((l.x + l.right) / 2, (lines[0].x + lines[0].right) / 2))) return 'center';
  return 'left';
}

function toBlock(lines, index, pageIndex) {
  const x = Math.min(...lines.map((l) => l.x));
  const right = Math.max(...lines.map((l) => l.right));
  const top = Math.min(...lines.map((l) => l.top));
  const bottom = Math.max(...lines.map((l) => l.bottom));
  const first = lines[0];
  const size = Math.round(first.size * 10) / 10;
  const spacing = lines.length > 1 ? (lines[lines.length - 1].base - first.base) / (lines.length - 1) / first.size : 1.2;
  return {
    id: `blk:${pageIndex}:${index}`, kind: 'text', x, y: top, w: right - x, h: bottom - top,
    text: lines.map((l) => l.text).join('\n'), size, font: first.font, align: guessAlign(lines),
    lineHeight: Math.min(2.2, Math.max(0.9, Math.round(spacing * 100) / 100)),
    firstBaseline: first.base, firstX: first.x,
    lines: lines.map((l) => ({ x: l.x, right: l.right, base: l.base, size: l.size })),
  };
}

function groupBlocks(lines, pageIndex) {
  const blocks = [];
  let current = [];
  const flush = () => { if (current.length) blocks.push(toBlock(current, blocks.length, pageIndex)); current = []; };
  for (const line of lines) {
    const prev = current[current.length - 1];
    if (prev) {
      const step = line.base - prev.base;
      const sizeOk = Math.abs(line.size - prev.size) < Math.max(prev.size, line.size) * 0.15;
      const left = current[0];
      const aligned = Math.abs(line.x - left.x) < line.size * 0.6
        || Math.abs(line.right - left.right) < line.size * 0.6
        || Math.abs((line.x + line.right) / 2 - (left.x + left.right) / 2) < line.size * 0.6;
      const overlaps = line.x < Math.max(...current.map((l) => l.right)) && line.right > Math.min(...current.map((l) => l.x));
      if (!(sizeOk && aligned && overlaps && step > line.size * 0.7 && step < line.size * 1.7 && prev.font.family === line.font.family && prev.font.bold === line.font.bold && prev.font.italic === line.font.italic && prev.font.name === line.font.name && prev.font.ref === line.font.ref)) flush();
    }
    current.push(line);
  }
  flush();
  return blocks;
}

async function collectImages(page, viewport, pageIndex) {
  const pdfjsLib = await getPdfJsLib();
  const { OPS } = pdfjsLib;
  const list = await page.getOperatorList();
  const imageOps = new Set([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageXObjectRepeat, OPS.paintJpegXObject].filter((v) => v !== undefined));
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];
  const found = [];
  for (let i = 0; i < list.fnArray.length; i += 1) {
    const fn = list.fnArray[i];
    const args = list.argsArray[i];
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
    else if (fn === OPS.transform) ctm = mul(ctm, args);
    else if (fn === OPS.paintFormXObjectBegin) { stack.push(ctm); if (Array.isArray(args?.[0])) ctm = mul(ctm, args[0]); }
    else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() || ctm;
    else if (imageOps.has(fn)) {
      const m = mul(viewport.transform, ctm);
      if (Math.abs(m[1]) > 0.02 * Math.abs(m[0]) || Math.abs(m[2]) > 0.02 * Math.abs(m[3])) continue; // rotated/skewed: not editable
      const xs = [m[4], m[4] + m[0], m[4] + m[2], m[4] + m[0] + m[2]];
      const ys = [m[5], m[5] + m[1], m[5] + m[3], m[5] + m[1] + m[3]];
      const x = Math.min(...xs); const y = Math.min(...ys);
      const w = Math.max(...xs) - x; const h = Math.max(...ys) - y;
      if (w < 6 || h < 6) continue;
      if (found.some((f) => Math.abs(f.x - x) < 1 && Math.abs(f.y - y) < 1 && Math.abs(f.w - w) < 1 && Math.abs(f.h - h) < 1)) continue;
      found.push({ id: `img:${pageIndex}:${found.length}`, kind: 'image', x, y, w, h });
    }
  }
  return found;
}

/** Everything on the page that can be selected and edited. Viewport must be scale 1 at the page rotation. */
export async function extractPageContent(page, viewport, pageIndex) {
  const [content, images] = await Promise.all([
    page.getTextContent().catch(() => ({ items: [], styles: {} })),
    collectImages(page, viewport, pageIndex).catch(() => []),
  ]);
  return { blocks: groupBlocks(collectLines(content, page, viewport), pageIndex), images };
}

/** Right-most column (in page points) that holds real ink inside `rect`, or null when nothing can be read. */
function inkRightOf(context, canvas, k, rect, bgRgb) {
  const x0 = Math.max(0, Math.floor((rect.x - 1) * k)); const x1 = Math.min(canvas.width, Math.ceil((rect.x + rect.w + 1) * k));
  const y0 = Math.max(0, Math.floor(rect.y * k)); const y1 = Math.min(canvas.height, Math.ceil((rect.y + rect.h) * k));
  const w = x1 - x0; const h = y1 - y0;
  if (w < 3 || h < 3) return null;
  let data;
  try { data = context.getImageData(x0, y0, w, h).data; } catch { return null; }
  for (let x = w - 1; x >= 0; x -= 1) {
    for (let y = 0; y < h; y += 1) {
      const i = (y * w + x) * 4;
      if (Math.abs(data[i] - bgRgb[0]) + Math.abs(data[i + 1] - bgRgb[1]) + Math.abs(data[i + 2] - bgRgb[2]) >= 48) return (x0 + x + 1) / k;
    }
  }
  return null;
}

/** PDF text runs often report a width wider than the glyphs actually drawn (padding, tab stops, justified cells).
 * Shrink each line's right edge to the ink really present on the rendered page so the hover box, the selection box
 * and the edit box all hug the visible text. Edges only ever shrink, and never past the text itself. */
export function tightenBlocksToInk(canvas, k, blocks) {
  const context = canvas?.getContext('2d');
  if (!context || !canvas.width || !(k > 0)) return blocks;
  return blocks.map((block) => {
    if (block.kind !== 'text' || !block.lines?.length) return block;
    const lines = block.lines.map((line) => {
      const rect = { x: line.x, y: line.base - line.size * 0.9, w: Math.max(1, line.right - line.x), h: line.size * 1.2 };
      const bg = parseHex(sampleColors(canvas, k, rect).bg);
      const ink = inkRightOf(context, canvas, k, rect, bg);
      if (ink == null) return line;
      const right = Math.min(line.right, ink + Math.max(0.6, 1.2 / k));
      return right < line.right - 0.4 && right > line.x + 1 ? { ...line, right } : line;
    });
    const x = Math.min(...lines.map((l) => l.x));
    const right = Math.max(...lines.map((l) => l.right));
    if (Math.abs(right - (block.x + block.w)) < 0.01) return block;
    return { ...block, x, w: right - x, lines };
  });
}

const hex = (r, g, b) => `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;

/** Sample the page background (outer ring) and ink colour (strongest contrast) of a region of the rendered canvas. */
export function sampleColors(canvas, k, rect) {
  const context = canvas?.getContext('2d');
  const fallback = { bg: '#ffffff', fg: '#000000' };
  if (!context) return fallback;
  const x0 = Math.max(0, Math.floor((rect.x - 2) * k)); const y0 = Math.max(0, Math.floor((rect.y - 2) * k));
  const x1 = Math.min(canvas.width, Math.ceil((rect.x + rect.w + 2) * k)); const y1 = Math.min(canvas.height, Math.ceil((rect.y + rect.h + 2) * k));
  const w = x1 - x0; const h = y1 - y0;
  if (w < 3 || h < 3) return fallback;
  let data;
  try { data = context.getImageData(x0, y0, w, h).data; } catch { return fallback; }
  const ring = Math.max(1, Math.round(k * 1.5));
  const buckets = new Map();
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (x >= ring && x < w - ring && y >= ring && y < h - ring) { x = w - ring - 1; continue; }
      const i = (y * w + x) * 4;
      const key = ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3);
      const bucket = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 };
      bucket.n += 1; bucket.r += data[i]; bucket.g += data[i + 1]; bucket.b += data[i + 2];
      buckets.set(key, bucket);
    }
  }
  let top = null;
  for (const bucket of buckets.values()) if (!top || bucket.n > top.n) top = bucket;
  if (!top) return fallback;
  const bg = [top.r / top.n, top.g / top.n, top.b / top.n];
  let max = 0;
  const dist = (i) => Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]);
  for (let i = 0; i < data.length; i += 4) max = Math.max(max, dist(i));
  let r = 0; let g = 0; let b = 0; let n = 0;
  if (max >= 60) {
    for (let i = 0; i < data.length; i += 4) {
      if (dist(i) >= max * 0.82) { r += data[i]; g += data[i + 1]; b += data[i + 2]; n += 1; }
    }
  }
  const lum = 0.299 * bg[0] + 0.587 * bg[1] + 0.114 * bg[2];
  return { bg: hex(...bg), fg: n ? hex(r / n, g / n, b / n) : (lum < 110 ? '#ffffff' : '#000000') };
}

/** Render one rectangle of a page (view points) to a PNG data URL, used to move or resize existing images. */
export async function renderRegionToDataUrl(page, rect, maxPixels = 2400) {
  const scale = Math.min(6, Math.max(1, maxPixels / Math.max(rect.w, rect.h)));
  const viewport = page.getViewport({ scale, rotation: page.rotate || 0 });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(rect.w * scale));
  canvas.height = Math.max(1, Math.ceil(rect.h * scale));
  const context = canvas.getContext('2d');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: context, viewport, transform: [1, 0, 0, 1, -rect.x * scale, -rect.y * scale], background: '#fff' }).promise;
  return canvas.toDataURL('image/png');
}

const parseHex = (value) => [1, 3, 5].map((i) => Number.parseInt(String(value).slice(i, i + 2), 16) || 0);

/** Look for a horizontal rule just below each text line (an underline) in the rendered page. */
export function detectUnderline(canvas, k, block, bgHex, fgHex) {
  const context = canvas?.getContext('2d');
  if (!context || !block.lines?.length) return false;
  const bg = parseHex(bgHex); const fg = parseHex(fgHex);
  const diff = (i, data, c) => Math.abs(data[i] - c[0]) + Math.abs(data[i + 1] - c[1]) + Math.abs(data[i + 2] - c[2]);
  let withRule = 0;
  for (const line of block.lines) {
    const x0 = Math.max(0, Math.floor(line.x * k)); const x1 = Math.min(canvas.width, Math.ceil(line.right * k));
    const y0 = Math.max(0, Math.floor((line.base + line.size * 0.04) * k)); const y1 = Math.min(canvas.height, Math.ceil((line.base + line.size * 0.24) * k));
    const w = x1 - x0; const h = y1 - y0;
    if (w < 6 || h < 1) continue;
    let data;
    try { data = context.getImageData(x0, y0, w, h).data; } catch { return false; }
    let found = false;
    for (let y = 0; y < h && !found; y += 1) {
      let hits = 0;
      for (let x = 0; x < w; x += 1) { const i = (y * w + x) * 4; if (diff(i, data, fg) + 30 < diff(i, data, bg)) hits += 1; }
      if (hits / w > 0.88) found = true;
    }
    if (found) withRule += 1;
  }
  return withRule >= Math.ceil(block.lines.length / 2);
}
