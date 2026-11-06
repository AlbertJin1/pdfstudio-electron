// PDF → Word "flowing document" engine (the default conversion).
//
// The approach mirrors professional converters: read the PDF's real content (glyph positions, fonts, colours,
// vector rules, fills and images) instead of guessing from pixels, then rebuild it as native Word structure:
//   • text → flowing paragraphs with the source alignment, indents, tab stops, line pitch and spacing
//   • ruled grids / shaded text boxes → real Word tables with merged cells, per-side borders and cell shading
//   • two/three-column regions → Word column sections
//   • photos, logos, signatures and vector artwork → separate Word pictures (inline where they sit alone,
//     page-anchored where they share a band with text)
//   • stand-alone rules and coloured panels → native Word shapes behind the text
//   • links → Word hyperlinks; super/subscript, underline and strikeout are preserved
// Each PDF page becomes its own Word section with the source page size, so pagination matches the PDF.

import JSZip from 'jszip';
import { getPdfJsLib, loadPdfSource } from '../pdfjs.js';
import { applyPoint, interpretPage, paintingOperatorSet } from './extract.js';
import {
  BASELINE_RATIO, assignVerticalSpacing, buildLines, buildParagraphs, buildTableBlock, classifyPaths, layoutLines, detectAlignedTables, detectBoxes, detectColumnRegions,
  detectFigures, detectTables, detectTextDecorations, prepareGlyphs, setFontTable, __layoutInternals,
} from './layout.js';
import {
  CT, REL, anchoredPicture, anchoredShape, appPropsXml, contentTypesXml, corePropsXml, documentXml, fontTableXml,
  inlinePicture, paragraphXml, relsXml, resetDrawingIds, sectPrXml, settingsXml, stylesXml, tabRun, tableXml, textRun,
  tw, wordFontFamily, esc,
} from './ooxml.js';

const { median, intersects, inside, boxArea, glyphBox, isWhite } = __layoutInternals;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const percentile = (values, p) => {
  const list = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!list.length) return 0;
  return list[Math.min(list.length - 1, Math.max(0, Math.round((list.length - 1) * p)))];
};
const tokens = (text) => String(text || '').normalize('NFKC').toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) || [];

// ---------------------------------------------------------------------------------------------------------------
// Canvas helpers (browser/Electron renderer, with a fallback for Node test harnesses)
// ---------------------------------------------------------------------------------------------------------------

function createCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

async function encodeCanvas(canvas, type = 'image/png', quality = 0.9) {
  if (typeof canvas.toBlob === 'function') {
    const blob = await new Promise((resolve, reject) => canvas.toBlob((value) => (value ? resolve(value) : reject(new Error('Image encoding failed.'))), type, quality));
    return new Uint8Array(await blob.arrayBuffer());
  }
  if (typeof canvas.convertToBlob === 'function') {
    const blob = await canvas.convertToBlob({ type, quality });
    return new Uint8Array(await blob.arrayBuffer());
  }
  if (typeof canvas.encode === 'function') return new Uint8Array(await canvas.encode(type === 'image/jpeg' ? 'jpeg' : 'png', Math.round(quality * 100)));
  if (typeof canvas.toBuffer === 'function') return new Uint8Array(canvas.toBuffer(type));
  throw new Error('Canvas image encoding is not available.');
}

/** Render only the selected painting operators of a page, cropped to `box` (points). */
async function renderRegion(page, pdfjsLib, rotation, box, keepOps, scale) {
  const OPS = pdfjsLib.OPS;
  const paint = paintingOperatorSet(pdfjsLib);
  const filter = keepOps === null ? undefined : (index, list) => {
    const fn = list?.fnArray?.[index];
    if (!paint.has(fn)) return true;
    if (fn === OPS.constructPath) { const args = list.argsArray?.[index]; if (args && args[0] === OPS.endPath) return true; }
    return keepOps.has(index);
  };
  const width = Math.max(1, Math.round((box.x1 - box.x0) * scale));
  const height = Math.max(1, Math.round((box.y1 - box.y0) * scale));
  // Stretch by the rounding remainder so the content fills every pixel row/column (no transparent hairline).
  const kx = width / Math.max(1e-6, (box.x1 - box.x0) * scale);
  const ky = height / Math.max(1e-6, (box.y1 - box.y0) * scale);
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');
  const viewport = page.getViewport({ scale, rotation });
  await page.render({
    canvasContext: context, canvas, viewport, intent: 'print', background: 'rgba(0,0,0,0)',
    transform: [kx, 0, 0, ky, -box.x0 * scale * kx, -box.y0 * scale * ky],
    ...(filter ? { operationsFilter: filter } : {}),
  }).promise;
  return canvas;
}

function canvasHasTransparency(canvas) {
  try {
    const context = canvas.getContext('2d');
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    const step = Math.max(4, Math.floor(data.length / 4 / 40000) * 4);
    for (let i = 3; i < data.length; i += step) if (data[i] < 250) return true;
  } catch { /* tainted/unsupported → assume opaque */ }
  return false;
}

function flattenOnWhite(canvas) {
  const out = createCanvas(canvas.width, canvas.height);
  const context = out.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, out.width, out.height);
  context.drawImage(canvas, 0, 0);
  return out;
}

function isBlank(canvas) {
  try {
    const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    const step = Math.max(4, Math.floor(data.length / 4 / 20000) * 4);
    for (let i = 3; i < data.length; i += step) if (data[i] > 8) return false;
    return true;
  } catch { return false; }
}

// ---------------------------------------------------------------------------------------------------------------
// OCR (desktop app only)
// ---------------------------------------------------------------------------------------------------------------

async function ocrPage(page, pdfjsLib, rotation, width, height, language, onProgress, pageIndex, pages) {
  if (typeof window === 'undefined' || typeof window.pdfStudio?.ocrImage !== 'function') return { available: false, words: [] };
  try {
    onProgress({ phase: 'ocr', page: pageIndex, pages, profile: `Recognizing scanned text on page ${pageIndex} (${language})` });
    const scale = clamp(2600 / Math.max(width, height), 1.5, 4);
    const canvas = await renderRegion(page, pdfjsLib, rotation, { x0: 0, y0: 0, x1: width, y1: height }, null, scale);
    const image = await encodeCanvas(flattenOnWhite(canvas), 'image/png');
    const result = await window.pdfStudio.ocrImage({ image, language, timeoutMs: 120000 });
    const words = Array.isArray(result?.words) ? result.words : [];
    return {
      available: Boolean(result?.available),
      confidence: Number(result?.confidence) || 0,
      words: words.filter((w) => String(w.text || '').trim() && Number(w.confidence ?? 100) >= 30).map((w) => {
        const h = (Number(w.height) || 10) / scale;
        const size = clamp(h / 0.72, 4, 96);
        const x0 = (Number(w.left) || 0) / scale; const x1 = x0 + (Number(w.width) || 0) / scale;
        const baseline = ((Number(w.top) || 0) + (Number(w.height) || 0) * 0.82) / scale;
        return { ch: String(w.text).trim(), isSpace: false, x0, x1, ox: x0, oy: baseline, baseline, size, angle: 0, font: '__ocr__', color: '000000', alpha: 1, invisible: false, opIndex: -1 };
      }),
    };
  } catch (error) {
    return { available: false, words: [], warning: String(error?.message || error) };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Page analysis → page model
// ---------------------------------------------------------------------------------------------------------------

async function readLinks(page, viewport) {
  try {
    const annotations = await page.getAnnotations({ intent: 'display' });
    return annotations.filter((a) => a.subtype === 'Link' && a.url && a.rect?.length >= 4).map((a) => {
      const [x0, y0] = applyPoint(viewport.transform, a.rect[0], a.rect[1]);
      const [x1, y1] = applyPoint(viewport.transform, a.rect[2], a.rect[3]);
      return { url: a.url, box: { x0: Math.min(x0, x1), y0: Math.min(y0, y1), x1: Math.max(x0, x1), y1: Math.max(y0, y1) } };
    });
  } catch { return []; }
}

function rotatedArt(rotated) {
  // Group rotated glyphs by their drawing operator so the text can be rendered as artwork.
  const byOp = new Map();
  for (const glyph of rotated) {
    const box = { x0: Math.min(glyph.ox, glyph.x1) - glyph.size, y0: glyph.oy - glyph.size * 1.1, x1: Math.max(glyph.ox, glyph.x1) + glyph.size, y1: glyph.oy + glyph.size * 1.1 };
    const entry = byOp.get(glyph.opIndex);
    if (entry) entry.box = { x0: Math.min(entry.box.x0, box.x0), y0: Math.min(entry.box.y0, box.y0), x1: Math.max(entry.box.x1, box.x1), y1: Math.max(entry.box.y1, box.y1) };
    else byOp.set(glyph.opIndex, { box, opIndex: glyph.opIndex, fill: '000000', hasCurves: true });
  }
  // Tighten boxes: a rotated run's real extent is its glyph origins plus one em on each side.
  for (const entry of byOp.values()) {
    const glyphs = rotated.filter((g) => g.opIndex === entry.opIndex);
    const xs = glyphs.flatMap((g) => [g.ox, g.ox + Math.cos(g.angle) * (g.x1 - g.x0)]);
    const ys = glyphs.flatMap((g) => [g.oy, g.oy + Math.sin(g.angle) * Math.hypot(g.x1 - g.x0, 1)]);
    const em = Math.max(...glyphs.map((g) => g.size));
    entry.box = { x0: Math.min(...xs) - em, x1: Math.max(...xs) + em, y0: Math.min(...ys) - em, y1: Math.max(...ys) + em };
  }
  return [...byOp.values()];
}

function sidewaysRotation(glyphs) {
  const ink = glyphs.filter((g) => !g.isSpace && !g.invisible);
  if (ink.length < 20) return 0;
  const bucket = (angle) => { const deg = ((Math.round(angle * 180 / Math.PI / 90) * 90) % 360 + 360) % 360; return deg; };
  const counts = new Map();
  for (const g of ink) { const b = bucket(g.angle); counts.set(b, (counts.get(b) || 0) + 1); }
  const [best, count] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (best === 0 || count < ink.length * 0.6) return 0;
  // Text advancing downwards (90°) reads correctly after turning the page 270° clockwise, and so on.
  return (360 - best) % 360;
}

async function analyzePage(page, pdfjsLib, options, pageIndex, pages) {
  const operatorList = await page.getOperatorList({ intent: 'print' });
  let viewport = page.getViewport({ scale: 1 });
  let content = interpretPage(page, operatorList, viewport, pdfjsLib);
  const turn = sidewaysRotation(content.glyphs);
  if (turn) {
    viewport = page.getViewport({ scale: 1, rotation: (viewport.rotation + turn) % 360 });
    content = interpretPage(page, operatorList, viewport, pdfjsLib);
  }
  const W = viewport.width; const H = viewport.height;
  const fonts = content.fonts;
  fonts.set('__ocr__', { name: 'Arial', bold: false, italic: false });
  setFontTable(fonts);
  const model = { width: W, height: H, rotation: viewport.rotation, turned: turn, fonts, blocks: [], anchors: [], figures: [], warnings: [], stats: { tables: 0, figures: 0, shapes: 0, columns: 0, ocr: false, scanned: false } };

  let { horizontal, rotated } = prepareGlyphs(content.glyphs);
  let images = content.images;
  const pageArea = W * H;
  const bigImages = images.filter((image) => boxArea(image.box) > pageArea * 0.45);
  const inkCount = horizontal.filter((g) => !g.isSpace).length;
  if (inkCount < 3 && bigImages.length) {
    model.stats.scanned = true;
    const searchable = prepareGlyphs(content.glyphs, { useInvisible: true }).horizontal;
    if (searchable.filter((g) => !g.isSpace).length >= 3) {
      horizontal = searchable;
      images = images.filter((image) => !bigImages.includes(image));
    } else if (options.ocrEnabled !== false) {
      const ocr = await ocrPage(page, pdfjsLib, viewport.rotation, W, H, options.ocrLanguage || 'eng', options.onProgress, pageIndex, pages);
      if (ocr.words.length >= 3 && (ocr.confidence === 0 || ocr.confidence >= 55)) {
        horizontal = ocr.words; images = images.filter((image) => !bigImages.includes(image)); model.stats.ocr = true;
        model.warnings.push(`Page ${pageIndex} is a scan; its text was recognized with OCR. Check spelling and layout in Word.`);
      } else {
        model.visualOnly = true;
        model.warnings.push(ocr.available
          ? `Page ${pageIndex} is a scan and OCR could not read it reliably; the page was kept as an image.`
          : `Page ${pageIndex} is a scan without a text layer; it was kept as an image. Enable OCR in the desktop app to make it editable.`);
        return model;
      }
    } else {
      model.visualOnly = true;
      model.warnings.push(`Page ${pageIndex} is a scan without a text layer; it was kept as an image because OCR is off.`);
      return model;
    }
  }

  // Hyperlinks.
  const links = await readLinks(page, viewport);
  if (links.length) for (const glyph of horizontal) {
    const cx = (glyph.x0 + glyph.x1) / 2; const cy = glyph.baseline - glyph.size * 0.3;
    const link = links.find((l) => cx >= l.box.x0 - 0.5 && cx <= l.box.x1 + 0.5 && cy >= l.box.y0 - 1 && cy <= l.box.y1 + 1);
    if (link) glyph.link = link.url;
  }

  // Vector content.
  let { hRules, vRules, fills, art, rings } = classifyPaths(content.paths, W, H);
  ({ remaining: hRules } = detectTextDecorations(hRules, horizontal));
  const tables = detectTables(hRules, vRules, fills, horizontal, W, H);
  // Frames that turned out to be charts/diagrams: everything vector inside them becomes artwork.
  for (const drawing of tables.drawings || []) {
    const zone = { x0: drawing.box.x0 - 10, y0: drawing.box.y0 - 10, x1: drawing.box.x1 + 10, y1: drawing.box.y1 + 10 };
    const toArt = (box, op) => art.push({ box, opIndex: op, fill: '000000', hasCurves: false });
    hRules = hRules.filter((r) => { const b = { x0: r.x0, x1: r.x1, y0: r.y - r.width / 2, y1: r.y + r.width / 2 }; if (inside(b, zone)) { toArt(b, r.op); return false; } return true; });
    vRules = vRules.filter((r) => { const b = { x0: r.x - r.width / 2, x1: r.x + r.width / 2, y0: r.y0, y1: r.y1 }; if (inside(b, zone)) { toArt(b, r.op); return false; } return true; });
    fills = fills.filter((f) => { if (inside(f, zone)) { toArt(f, f.op); return false; } return true; });
  }
  const near = (rule, box, kind) => (kind === 'h'
    ? rule.y >= box.y0 - 2.5 && rule.y <= box.y1 + 2.5 && rule.x0 >= box.x0 - 2.5 && rule.x1 <= box.x1 + 2.5
    : rule.x >= box.x0 - 2.5 && rule.x <= box.x1 + 2.5 && rule.y0 >= box.y0 - 2.5 && rule.y1 <= box.y1 + 2.5);
  hRules = hRules.filter((rule) => !tables.some((t) => near(rule, t.box, 'h')));
  vRules = vRules.filter((rule) => !tables.some((t) => near(rule, t.box, 'v')));
  fills = fills.filter((fill) => !tables.some((t) => inside(fill, t.box, 2)));
  // Tables without a full grid (aligned columns + optional row rules/stripes), found on text outside ruled tables.
  const outsideRuled = horizontal.filter((g) => !tables.some((t) => { const cx = (g.x0 + g.x1) / 2; const cy = g.baseline - g.size * 0.3; return cx >= t.box.x0 && cx <= t.box.x1 && cy >= t.box.y0 && cy <= t.box.y1; }));
  const soft = detectAlignedTables(buildLines(outsideRuled), hRules, fills);
  const softGlyphs = new Set();
  for (const table of soft.tables) {
    for (const cell of table.cells) for (const line of cell.lines) for (const seg of line.segments) for (const g of seg.glyphs || []) softGlyphs.add(g);
    tables.push(table);
  }
  hRules = hRules.filter((r) => !soft.usedRules.has(r));
  fills = fills.filter((f) => !soft.usedFills.has(f));
  const boxes = detectBoxes(fills, horizontal.filter((g) => !softGlyphs.has(g)), tables, W, H, rings);
  // Rings that did not frame a text panel are ordinary artwork.
  for (const ring of rings) if (!ring.used) art.push({ box: ring.box, opIndex: ring.op, fill: ring.color, hasCurves: true });
  fills = fills.filter((fill) => !boxes.some((b) => Math.abs(b.box.x0 - fill.x0) < 0.5 && Math.abs(b.box.y0 - fill.y0) < 0.5 && Math.abs(b.box.x1 - fill.x1) < 0.5 && Math.abs(b.box.y1 - fill.y1) < 0.5));
  // Rules lying inside a shaded box are decoration of that box; keep them as shapes.
  const allTables = [...tables, ...boxes].sort((a, b) => a.box.y0 - b.box.y0);

  // Figures: images, vector artwork, rotated text.
  const figures = detectFigures(images, [...art, ...rotatedArt(rotated)], W, H);
  // Bullets drawn as tiny vector dots/squares become real bullet characters in front of their text.
  for (const figure of [...figures]) {
    if (figure.images || figure.ops.length > 2) continue;
    const fb = figure.box; const fw = fb.x1 - fb.x0; const fh = fb.y1 - fb.y0;
    if (fw > 9 || fh > 9 || fw < 1.2 || fh < 1.2 || fw / fh > 1.8 || fh / fw > 1.8) continue;
    const cy = (fb.y0 + fb.y1) / 2;
    const next = horizontal.filter((g) => !g.isSpace && g.x0 > fb.x1 && g.x0 - fb.x1 < g.size * 3 && Math.max(fw, fh) <= g.size * 0.8
      && Math.abs((g.baseline - g.size * 0.32) - cy) < g.size * 0.35).sort((a, b) => a.x0 - b.x0)[0];
    if (!next) continue;
    const before = horizontal.some((g) => !g.isSpace && g.x1 <= fb.x0 && fb.x0 - g.x1 < next.size * 2 && Math.abs(g.baseline - next.baseline) < next.size * 0.3);
    if (before) continue;
    horizontal.push({ ch: figure.curves ? '\u2022' : '\u25AA', isSpace: false, x0: fb.x0, x1: fb.x1, ox: fb.x0, oy: next.baseline, baseline: next.baseline, size: next.size, angle: 0, font: next.font, color: figure.color || next.color, alpha: 1, invisible: false, opIndex: -1 });
    figures.splice(figures.indexOf(figure), 1);
  }
  // Vector charts/diagrams keep their own labels as part of the picture when the labels sit fully inside.
  const textOps = new Map();
  for (const glyph of horizontal) {
    if (glyph.opIndex < 0) continue;
    const list = textOps.get(glyph.opIndex) || []; list.push(glyph); textOps.set(glyph.opIndex, list);
  }
  const consumed = new Set();
  const inkTotal = horizontal.filter((g) => !g.isSpace).length || 1;
  for (const figure of figures) {
    if (!figure.hasArt || figure.images > 0) continue;
    const area = boxArea(figure.box);
    if (area < 2500 || area > pageArea * 0.5) continue;
    if (allTables.some((t) => intersects(t.box, figure.box, -1))) continue;
    // Only real drawings (several vector pieces) take their labels; a single panel behind a paragraph does not.
    if (figure.ops.length < 4) continue;
    // Labels belong to the drawing when they sit inside it or within about one em of its edge (axis titles,
    // tick labels, legends). Grow the box as labels are absorbed so stacked labels are caught too.
    let absorbed = 0;
    for (let pass = 0; pass < 3; pass += 1) {
      const opsInside = [...textOps.entries()].filter(([op, glyphs]) => !figure.ops.includes(op) && glyphs.every((g) => !consumed.has(g) && inside(glyphBox(g), figure.box, Math.min(14, g.size * 1.1))));
      if (!opsInside.length) break;
      const count = opsInside.reduce((sum, [, gl]) => sum + gl.filter((g) => !g.isSpace).length, 0);
      if ((absorbed + count) / inkTotal > 0.35) break;
      absorbed += count;
      for (const [op, glyphs] of opsInside) {
        figure.ops.push(op);
        for (const g of glyphs) { consumed.add(g); const b = glyphBox(g); figure.box = { x0: Math.min(figure.box.x0, b.x0), y0: Math.min(figure.box.y0, b.y0), x1: Math.max(figure.box.x1, b.x1), y1: Math.max(figure.box.y1, b.y1) }; }
      }
    }
    if (!absorbed) continue;
    figure.withText = true;
  }
  horizontal = horizontal.filter((g) => !consumed.has(g));

  // Distribute text and pictures into table cells.
  const flowGlyphs = [];
  for (const glyph of horizontal) {
    if (softGlyphs.has(glyph)) continue; // already placed in an aligned-column table
    const cx = (glyph.x0 + glyph.x1) / 2; const cy = glyph.baseline - glyph.size * 0.3;
    let placed = false;
    for (const table of allTables) {
      if (cx < table.box.x0 || cx > table.box.x1 || cy < table.box.y0 || cy > table.box.y1) continue;
      const cell = table.cells.find((c) => cx >= c.box.x0 && cx <= c.box.x1 && cy >= c.box.y0 && cy <= c.box.y1);
      if (cell) { cell.glyphs.push(glyph); placed = true; break; }
    }
    if (!placed) flowGlyphs.push(glyph);
  }
  const anchoredFigures = [];
  const floatingFigures = [];
  for (const figure of [...figures]) {
    let placed = false;
    for (const table of allTables) {
      const cell = table.cells.find((c) => inside(figure.box, c.box, 2));
      if (!cell) continue;
      const cover = boxArea(figure.box) / Math.max(1, boxArea(cell.box));
      const underText = cell.glyphs.some((g) => intersects(glyphBox(g), figure.box, -0.5));
      if (underText && cover >= 0.5) {
        // A background behind the cell text. Pure vector backgrounds of shaded panels are already reproduced by
        // the cell shading/border; anything else (photo, gradient) is anchored behind the table.
        if (!figure.images && (cell.shade || table.fromFill) && cover >= 0.75) { figures.splice(figures.indexOf(figure), 1); placed = true; break; }
        figure.background = true;
        break;
      }
      cell.images.push(figure); placed = true; break;
    }
    if (!placed && figures.includes(figure)) floatingFigures.push(figure);
  }
  model.figures = figures;

  // Lines of flowing text and the page's text column.
  const lines = buildLines(flowGlyphs);
  const lineLefts = lines.map((l) => l.x0);
  const lineRights = lines.filter((l) => l.segments.length === 1).map((l) => l.x1);
  let L = lines.length ? percentile(lineLefts, 0.06) : (allTables.length ? Math.min(...allTables.map((t) => t.box.x0)) : 72);
  L = clamp(L, 0, W * 0.45);
  let R = lines.length ? Math.max(percentile(lineRights.length ? lineRights : lines.map((l) => l.x1), 0.94), ...allTables.map((t) => Math.min(t.box.x1, W))) : W - L;
  const symmetric = W - L;
  if (R < symmetric && Math.max(...lines.map((l) => l.x1), 0) >= symmetric - 4) R = symmetric;
  if (R < L + 72) R = Math.min(W, Math.max(symmetric, L + 72));
  R = clamp(R, L + 36, W);

  // Columns.
  const regions = detectColumnRegions(lines, L, R);
  const inRegion = new Set(regions.flatMap((r) => r.lines));
  model.stats.columns = regions.length;

  // Inline vs. anchored pictures. A picture is inline when nothing else shares its horizontal band.
  const blocksY = [];
  for (const figure of floatingFigures) {
    const b = figure.box;
    const sharesBand = lines.some((l) => !inRegion.has(l) && l.bottom > b.y0 + 1 && l.top < b.y1 - 1)
      || allTables.some((t) => t.box.y1 > b.y0 + 1 && t.box.y0 < b.y1 - 1)
      || regions.some((r) => r.y1 > b.y0 + 1 && r.y0 < b.y1 - 1)
      || floatingFigures.some((other) => other !== figure && other.box.y1 > b.y0 + 1 && other.box.y0 < b.y1 - 1);
    const tooWide = b.x0 < 0 || b.x1 > W;
    if (figure.background || sharesBand || tooWide || boxArea(b) > pageArea * 0.8) anchoredFigures.push(figure);
    else blocksY.push({ y: b.y0, kind: 'image', figure });
  }
  for (const line of lines) if (!inRegion.has(line)) blocksY.push({ y: line.top, kind: 'line', line });
  for (const table of allTables) blocksY.push({ y: table.box.y0, kind: 'table', table });
  for (const region of regions) blocksY.push({ y: region.y0, kind: 'columns', region });
  blocksY.sort((a, b) => a.y - b.y || (a.kind === 'line' ? 1 : -1));

  // Build blocks in reading order, turning consecutive line runs into paragraphs.
  const container = { left: L, right: R };
  let pendingLines = [];
  const flushLines = () => {
    if (!pendingLines.length) return;
    model.blocks.push(...layoutLines(pendingLines, container));
    pendingLines = [];
  };
  for (const item of blocksY) {
    if (item.kind === 'line') { pendingLines.push(item.line); continue; }
    flushLines();
    if (item.kind === 'image') {
      const b = item.figure.box;
      const centered = Math.abs((b.x0 + b.x1) / 2 - (L + R) / 2) <= 3;
      model.blocks.push({ type: 'image', box: b, figure: item.figure, align: centered ? 'center' : 'left', indLeft: centered ? 0 : b.x0 - L });
    } else if (item.kind === 'table') {
      model.blocks.push(buildTableBlock(item.table, L));
      model.stats.tables += 1;
    } else if (item.kind === 'columns') {
      const region = item.region;
      const bounds = region.columns.map((col, k) => ({
        left: k === 0 ? L : col.x0,
        right: k === region.columns.length - 1 ? R : col.x1,
      }));
      model.blocks.push({
        type: 'columns', y0: region.y0, y1: region.y1,
        columns: region.columns.map((col, k) => ({ box: bounds[k], blocks: layoutLines(col.lines, bounds[k]) })),
        section: bounds.map((b, k) => ({ width: b.right - b.left, space: k < bounds.length - 1 ? bounds[k + 1].left - b.right : 0 })),
      });
    }
  }
  flushLines();

  // Page anchors: pictures sharing a band with text, stand-alone rules, coloured panels.
  for (const figure of anchoredFigures) {
    const behind = lines.some((l) => intersects({ x0: l.x0, x1: l.x1, y0: l.top, y1: l.bottom }, figure.box, -0.5)) || allTables.some((t) => intersects(t.box, figure.box, -0.5));
    model.anchors.push({ kind: 'picture', figure, box: figure.box, behind });
  }
  const shapeZ = [];
  for (const fill of fills) {
    if (isWhite(fill.color) || fill.alpha === 0) continue;
    shapeZ.push({ kind: 'rect', box: fill, fill: fill.color, behind: true, op: fill.op });
  }
  for (const rule of hRules) shapeZ.push({ kind: 'line', box: { x0: rule.x0, x1: rule.x1, y0: rule.y, y1: rule.y }, stroke: rule.color, lineWidth: rule.width, behind: false, op: rule.op });
  for (const rule of vRules) shapeZ.push({ kind: 'line', box: { x0: rule.x, x1: rule.x, y0: rule.y0, y1: rule.y1 }, stroke: rule.color, lineWidth: rule.width, behind: false, op: rule.op });
  shapeZ.sort((a, b) => a.op - b.op);
  model.anchors.push(...shapeZ.map((shape) => ({ kind: 'shape', shape })));
  model.stats.shapes = shapeZ.length;
  model.stats.figures = figures.length;

  // Margins and vertical rhythm.
  const topOf = (b) => (b.type === 'paragraph' ? b.firstBaseline - BASELINE_RATIO * Math.max(b.pitch || 0, b.size * 1.15)
    : b.type === 'columns' ? Math.min(...b.columns.flatMap((c) => c.blocks.map(topOf))) : b.box.y0);
  // The top margin lands exactly on the first line box (or 1pt above a leading table, whose spacer paragraph
  // carries the page anchors), so "space before" at the top of a page never matters — Word and LibreOffice
  // treat it differently after page breaks.
  const tops = model.blocks.map(topOf).filter(Number.isFinite);
  const firstIsTable = model.blocks[0] && model.blocks[0].type !== 'paragraph' && model.blocks[0].type !== 'columns';
  const top = clamp((tops.length ? Math.min(...tops) : 36) - (firstIsTable ? 0.1 : 0), 0, H * 0.5);
  const end = assignVerticalSpacing(model.blocks, top);
  model.margins = { left: L, right: Math.max(0, W - R), top, bottom: clamp(H - end - 14, 0, H * 0.4), header: Math.min(18, top), footer: 0 };
  return model;
}

// ---------------------------------------------------------------------------------------------------------------
// XML emission
// ---------------------------------------------------------------------------------------------------------------

function runFor(run, paragraphSize) {
  const font = currentFontInfo.get(run.font) || {};
  return {
    text: run.text,
    wordFont: wordFontFamily(run.family || font.name, { monospace: font.monospace, serif: font.serif }),
    size: run.vert ? paragraphSize : run.size,
    bold: run.bold, italic: run.italic, color: run.color, underline: run.underline, strike: run.strike, vert: run.vert,
    link: run.link,
  };
}
let currentFontInfo = new Map();

function paragraphContent(paragraph, ctx) {
  const parts = [];
  let linkUrl = ''; let linkParts = [];
  const flushLink = () => {
    if (!linkParts.length) return;
    if (linkUrl) parts.push(`<w:hyperlink r:id="${ctx.linkRel(linkUrl)}" w:history="1">${linkParts.join('')}</w:hyperlink>`);
    else parts.push(...linkParts);
    linkParts = []; linkUrl = '';
  };
  const push = (xml, url = '') => { if (url !== linkUrl) flushLink(); linkUrl = url; linkParts.push(xml); };
  const size = paragraph.size || 11;
  paragraph.lines.forEach((line, li) => {
    line.segments.forEach((segment, si) => {
      if (si > 0) push(tabRun(runFor(segment.runs[0], size)));
      for (const run of segment.runs) {
        const r = runFor(run, size);
        push(textRun(r), r.link || '');
        ctx.text.push(run.text);
        ctx.fonts.add(r.wordFont);
      }
    });
    if (li < paragraph.lines.length - 1) {
      const lastSeg = line.segments[line.segments.length - 1];
      const lastRun = lastSeg.runs[lastSeg.runs.length - 1];
      if (!/[-‐‑­\s]$/.test(lastRun.text)) push(textRun({ ...runFor(lastRun, size), text: ' ' }), lastRun.link || '');
    }
    ctx.text.push('\n');
  });
  flushLink();
  return parts.join('');
}

function paragraphProps(block) {
  return {
    spaceBefore: block.spaceBefore, lineHeight: block.lineHeight, lineRule: 'exact',
    indLeft: block.indLeft, indRight: block.indRight, firstLine: block.firstLine, align: block.align, tabs: block.tabs,
  };
}

function spacerParagraph(height, extra = '') {
  const h = Math.max(0.1, height);
  return `<w:p><w:pPr><w:widowControl w:val="0"/><w:snapToGrid w:val="0"/><w:spacing w:before="0" w:after="0" w:line="${Math.max(2, tw(h))}" w:lineRule="exact"/><w:rPr><w:sz w:val="2"/><w:szCs w:val="2"/></w:rPr></w:pPr>${extra}</w:p>`;
}

function emitBlocks(blocks, ctx, { inCell = false } = {}) {
  const out = [];
  let previousWasTable = false;
  for (const block of blocks) {
    if (block.type === 'paragraph') {
      const extra = !inCell ? ctx.takeAnchors() : '';
      out.push(paragraphXml(paragraphProps(block), extra + paragraphContent(block, ctx)));
      previousWasTable = false;
    } else if (block.type === 'image') {
      const relId = ctx.figureRel(block.figure);
      const extra = !inCell ? ctx.takeAnchors() : '';
      const w = block.box.x1 - block.box.x0; const h = block.box.y1 - block.box.y0;
      const props = { spaceBefore: block.spaceBefore, lineHeight: null, indLeft: block.align === 'center' ? 0 : block.indLeft, align: block.align, markRunSize: 2 };
      out.push(paragraphXml(props, extra + (relId ? inlinePicture(relId, w, h) : '')));
      previousWasTable = false;
    } else if (block.type === 'table') {
      const before = block.spaceBefore || 0;
      const anchors = !inCell ? ctx.takeAnchors() : '';
      if (before >= 0.3 || previousWasTable || anchors) out.push(spacerParagraph(before, anchors));
      const cells = block.cells.map((cell) => ({ ...cell, content: emitBlocks(cell.blocks || [], ctx, { inCell: true }) || spacerParagraph(1) }));
      // Cell content must end with a paragraph; a nested image or paragraph always does.
      for (const cell of cells) if (!/<\/w:p>$/.test(cell.content)) cell.content += spacerParagraph(1);
      out.push(tableXml({ xs: block.xs, ys: block.ys, cells, indent: block.indent }));
      ctx.tables += 1;
      previousWasTable = true;
    }
  }
  return out.join('');
}

function emitPage(model, ctx, isLastPage) {
  const section = { width: model.width, height: model.height, margins: model.margins, type: 'nextPage' };
  const pieces = [];
  ctx.pageAnchors = model.anchors;
  ctx.takeAnchors = () => {
    if (!ctx.pageAnchors?.length) return '';
    const xml = ctx.pageAnchors.map((anchor, index) => {
      if (anchor.kind === 'picture') {
        const relId = ctx.figureRel(anchor.figure);
        return relId ? anchoredPicture(relId, anchor.box, { behind: anchor.behind, z: index + 1 }) : '';
      }
      ctx.shapes += 1;
      return anchoredShape(anchor.shape, { z: index + 1 });
    }).join('');
    ctx.pageAnchors = [];
    return xml;
  };

  if (model.visualOnly) {
    const relId = ctx.figureRel(model.pageFigure);
    const zero = { ...section, margins: { left: 0, right: 0, top: 0, bottom: 0, header: 0, footer: 0 } };
    const picture = relId ? inlinePicture(relId, model.width - 0.5, model.height - 0.5, 'Page') : '';
    return paragraphXml({ spaceBefore: 0, lineHeight: null, markRunSize: 2 }, picture, isLastPage ? '' : sectPrXml(zero)) + (isLastPage ? `\u0000SECT${sectPrXml(zero)}` : '');
  }

  // Split the page into single-column and multi-column segments.
  const segments = [];
  let current = { columns: null, blocks: [] };
  for (const block of model.blocks) {
    if (block.type === 'columns') {
      if (current.blocks.length) segments.push(current);
      segments.push({ columns: block, blocks: [] });
      current = { columns: null, blocks: [] };
    } else current.blocks.push(block);
  }
  if (current.blocks.length || !segments.length) segments.push(current);

  segments.forEach((segment, index) => {
    const segSection = { ...section, type: index === 0 ? 'nextPage' : 'continuous', columns: segment.columns ? segment.columns.section : null };
    let xml = '';
    if (segment.columns) {
      // Each column starts at the region top; a column break separates them.
      segment.columns.columns.forEach((column, k) => {
        let colXml = emitBlocks(column.blocks, ctx);
        if (k > 0) colXml = colXml.replace(/(<w:p>(?:<w:pPr>[\s\S]*?<\/w:pPr>)?)/, '$1<w:r><w:br w:type="column"/></w:r>');
        xml += colXml;
      });
    } else {
      xml = emitBlocks(segment.blocks, ctx);
    }
    const anchorsLeft = ctx.takeAnchors();
    if (anchorsLeft) xml = spacerParagraph(1, anchorsLeft) + xml;
    const isFinal = index === segments.length - 1;
    const sect = sectPrXml(segSection);
    if (isFinal && isLastPage) { pieces.push(xml || spacerParagraph(1)); pieces.push(`\u0000SECT${sect}`); return; }
    // Put the section break into the last paragraph of the segment (adding one if it ends with a table).
    if (/<\/w:p>$/.test(xml)) {
      const lastStart = xml.lastIndexOf('<w:p>');
      let last = xml.slice(lastStart);
      last = last.includes('<w:pPr>') ? last.replace('</w:pPr>', `${sect}</w:pPr>`) : last.replace('<w:p>', `<w:p><w:pPr>${sect}</w:pPr>`);
      xml = xml.slice(0, lastStart) + last;
    } else {
      xml += `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/><w:rPr><w:sz w:val="2"/></w:rPr>${sect}</w:pPr></w:p>`;
    }
    pieces.push(xml);
  });
  return pieces.join('');
}

// ---------------------------------------------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------------------------------------------

export async function pdfToWordFlow(pdfBytes, pdfSource, options = {}) {
  const pdfjsLib = await getPdfJsLib();
  const pdf = pdfSource || await loadPdfSource(pdfBytes, options.password);
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
  const opts = { ...options, onProgress };
  resetDrawingIds();
  const media = [];
  const relationships = [
    { id: 'rId1', type: REL.styles, target: 'styles.xml' },
    { id: 'rId2', type: REL.settings, target: 'settings.xml' },
    { id: 'rId3', type: REL.fontTable, target: 'fontTable.xml' },
  ];
  let relCounter = relationships.length;
  const linkRels = new Map();
  const ctx = {
    text: [], fonts: new Set(), tables: 0, shapes: 0, pictures: 0,
    linkRel(url) {
      if (!linkRels.has(url)) { const id = `rId${++relCounter}`; linkRels.set(url, id); relationships.push({ id, type: REL.hyperlink, target: url, external: true }); }
      return linkRels.get(url);
    },
    figureRel(figure) { return figure?.relId || null; },
  };
  const warnings = [];
  const sourceText = [];
  const pageReports = [];
  const sizeVotes = new Map(); const fontVotes = new Map();
  const bodyParts = [];
  let pagesWithoutText = 0;
  try {
    for (let pageIndex = 1; pageIndex <= pdf.numPages; pageIndex += 1) {
      onProgress({ page: pageIndex, pages: pdf.numPages, phase: 'extracting', profile: `Reading page ${pageIndex} of ${pdf.numPages}: text, fonts, tables and pictures` });
      const page = await pdf.getPage(pageIndex);
      try {
        const model = await analyzePage(page, pdfjsLib, opts, pageIndex, pdf.numPages);
        currentFontInfo = model.fonts || new Map();
        warnings.push(...model.warnings);
        // Render pictures.
        onProgress({ page: pageIndex, pages: pdf.numPages, phase: 'images', profile: `Extracting pictures on page ${pageIndex}` });
        if (model.visualOnly) {
          const scale = clamp(2400 / Math.max(model.width, model.height), 1, 3);
          const canvas = await renderRegion(page, pdfjsLib, model.rotation, { x0: 0, y0: 0, x1: model.width, y1: model.height }, null, scale);
          const bytes = await encodeCanvas(flattenOnWhite(canvas), 'image/jpeg', 0.9);
          model.pageFigure = { relId: addMedia(bytes, 'jpeg') };
          pagesWithoutText += 1;
        }
        for (const figure of model.figures) {
          const b = figure.box;
          const w = b.x1 - b.x0; const h = b.y1 - b.y0;
          let scale = figure.images && figure.pixelWidth ? clamp(figure.pixelWidth / Math.max(1, w), 2, 4.2) : 3.2;
          scale = Math.min(scale, 3200 / Math.max(w, h), Math.sqrt(9e6 / Math.max(1, w * h)));
          // Small artwork (icons, bullets, check marks) still needs enough pixels to stay crisp.
          scale = Math.max(scale, Math.min(12, 48 / Math.max(1, Math.min(w, h))), 0.5);
          try {
            const canvas = await renderRegion(page, pdfjsLib, model.rotation, b, new Set(figure.ops), scale);
            if (isBlank(canvas)) { figure.relId = null; continue; }
            const transparent = canvasHasTransparency(canvas);
            const photo = figure.images > 0 && !figure.hasArt && !figure.maskOnly && canvas.width * canvas.height > 160000 && !transparent;
            const bytes = photo ? await encodeCanvas(flattenOnWhite(canvas), 'image/jpeg', 0.92) : await encodeCanvas(canvas, 'image/png');
            figure.relId = addMedia(bytes, photo ? 'jpeg' : 'png');
            ctx.pictures += 1;
          } catch (error) {
            figure.relId = null;
            warnings.push(`Page ${pageIndex}: a picture could not be extracted (${String(error?.message || error).slice(0, 100)}).`);
          }
        }
        // Statistics for document defaults.
        for (const block of model.blocks) {
          if (block.type !== 'paragraph') continue;
          for (const line of block.lines) for (const seg of line.segments) for (const run of seg.runs) {
            const n = run.text.length;
            sizeVotes.set(run.size, (sizeVotes.get(run.size) || 0) + n);
            const fam = wordFontFamily(run.family);
            fontVotes.set(fam, (fontVotes.get(fam) || 0) + n);
          }
        }
        onProgress({ page: pageIndex, pages: pdf.numPages, phase: 'building', profile: `Building Word page ${pageIndex}` });
        const textBefore = ctx.text.length;
        bodyParts.push(emitPage(model, ctx, pageIndex === pdf.numPages));
        const pageText = ctx.text.slice(textBefore).join('');
        sourceText.push(pageText);
        if (!pageText.trim() && !model.visualOnly) pagesWithoutText += 1;
        pageReports.push({ page: pageIndex, conversionStrategy: model.visualOnly ? 'visual' : 'flow', ...model.stats, width: model.width, height: model.height });
      } finally {
        page.cleanup?.();
      }
    }
  } finally {
    if (!pdfSource) await pdf.destroy?.();
  }

  function addMedia(bytes, ext) {
    const name = `media/image${media.length + 1}.${ext === 'jpeg' ? 'jpeg' : 'png'}`;
    media.push({ name, bytes, ext: ext === 'jpeg' ? 'jpeg' : 'png' });
    const id = `rId${++relCounter}`;
    relationships.push({ id, type: REL.image, target: name });
    return id;
  }

  // Assemble the body; the final section properties go last in <w:body>.
  let body = bodyParts.join('');
  const finalSect = body.lastIndexOf('\u0000SECT');
  let sectTail = '';
  if (finalSect >= 0) { sectTail = body.slice(finalSect + 5); body = body.slice(0, finalSect); }
  body = body.replace(/\u0000SECT/g, '');
  const dominantFont = [...fontVotes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 'Calibri';
  const dominantSize = [...sizeVotes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 11;

  const zip = new JSZip();
  const parts = [
    ['word/document.xml', CT.document], ['word/styles.xml', CT.styles], ['word/settings.xml', CT.settings], ['word/fontTable.xml', CT.fontTable],
    ['docProps/core.xml', CT.core], ['docProps/app.xml', CT.app],
  ];
  zip.file('[Content_Types].xml', contentTypesXml(parts, media.map((m) => m.ext)));
  zip.file('_rels/.rels', relsXml([
    { id: 'rId1', type: REL.officeDocument, target: 'word/document.xml' },
    { id: 'rId2', type: REL.core, target: 'docProps/core.xml' },
    { id: 'rId3', type: REL.app, target: 'docProps/app.xml' },
  ]));
  zip.file('word/document.xml', documentXml(body + sectTail));
  zip.file('word/styles.xml', stylesXml({ font: dominantFont, size: dominantSize }));
  zip.file('word/settings.xml', settingsXml());
  zip.file('word/fontTable.xml', fontTableXml([...ctx.fonts, dominantFont]));
  zip.file('word/_rels/document.xml.rels', relsXml(relationships));
  zip.file('docProps/core.xml', corePropsXml({ title: options.title || 'Converted from PDF' }));
  zip.file('docProps/app.xml', appPropsXml(pdf.numPages || pageReports.length));
  for (const item of media) zip.file(`word/${item.name}`, item.bytes);
  onProgress({ phase: 'validation', page: pageReports.length, pages: pageReports.length, profile: 'Checking the Word package' });
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  const validation = await validatePackage(bytes);

  const wordText = sourceText.join('\n');
  const quality = {
    mode: 'flow',
    engine: 'flow',
    validDocxPackage: validation.valid,
    pageStrategies: pageReports.map(({ page, conversionStrategy }) => ({ page, conversionStrategy })),
    tablesReconstructed: ctx.tables,
    separateWordImageAssets: ctx.pictures,
    nativeShapes: ctx.shapes,
    hyperlinks: linkRels.size,
    pagesWithColumns: pageReports.filter((r) => r.columns).length,
    ocrPages: pageReports.filter((r) => r.ocr).map((r) => r.page),
    scannedPages: pageReports.filter((r) => r.scanned).map((r) => r.page),
    editableWords: tokens(wordText).length,
    warnings: [...new Set(warnings)],
    pageReports,
  };
  return {
    bytes, pages: pageReports.length, textItems: tokens(wordText).length, pagesWithoutText,
    pagesWithPartialText: pageReports.filter((r) => r.conversionStrategy === 'visual').length,
    mode: 'flow', visualPages: pageReports.filter((r) => r.conversionStrategy === 'visual').length, quality, validation,
    preflight: {
      pages: pageReports.length,
      pagesWithNativeText: pageReports.filter((r) => !r.scanned).length,
      pagesLikelyScanned: pageReports.filter((r) => r.scanned).length,
      nativeTextSpans: tokens(wordText).length,
      nativeTextCharacters: wordText.length,
    },
  };
}

async function validatePackage(bytes) {
  const zip = await JSZip.loadAsync(bytes, { checkCRC32: true });
  const required = ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/_rels/document.xml.rels', 'word/styles.xml'];
  const missing = required.filter((name) => !zip.file(name));
  if (missing.length) throw new Error(`The generated Word package is missing ${missing.join(', ')}.`);
  const xmlNames = Object.keys(zip.files).filter((name) => /\.(xml|rels)$/.test(name));
  for (const name of xmlNames) {
    const xml = await zip.file(name).async('string');
    if (typeof DOMParser !== 'undefined') {
      const parsed = new DOMParser().parseFromString(xml, 'application/xml');
      if (parsed.getElementsByTagName('parsererror').length) throw new Error(`${name} in the generated Word file is not valid XML.`);
    }
  }
  const rels = await zip.file('word/_rels/document.xml.rels').async('string');
  const doc = await zip.file('word/document.xml').async('string');
  const ids = new Set([...rels.matchAll(/Id="([^"]+)"/g)].map((m) => m[1]));
  const used = [...doc.matchAll(/r:(?:embed|id)="([^"]+)"/g)].map((m) => m[1]);
  const dangling = used.filter((id) => !ids.has(id));
  if (dangling.length) throw new Error(`The generated Word file references missing parts (${[...new Set(dangling)].join(', ')}).`);
  return { valid: true, parts: xmlNames.length, tables: (doc.match(/<w:tbl>/g) || []).length, pictures: (doc.match(/<pic:pic /g) || []).length };
}

export const __flowInternals = { analyzePage, emitPage, validatePackage, renderRegion, esc };
