import { getPdfJsLib, loadPdfSource } from './pdfjs.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const twips = (points) => Math.round(clamp(Number(points) || 0, 0, 31680 / 20) * 20);
const MARKER_PREFIX = 'PDFSTUDIOFRAME';

const toHex = (rgb) => rgb.map((value) => Math.round(clamp(value, 0, 255)).toString(16).padStart(2, '0')).join('').toUpperCase();
const normalizeForMatch = (value) => String(value || '').normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const getWordTokens = (value) => String(value || '').normalize('NFKC').toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) || [];

function cleanPdfFontName(value = '') {
  const cleaned = String(value)
    .replace(/^[A-Z]{6}\+/, '')
    .replace(/(?:PSMT|PS|MT|Regular|Roman|BoldItalic|Italic|Oblique|Bold|Semibold|Demi|Black|Heavy|Medium|Light)+$/i, '')
    .replace(/[-_,\s]+$/g, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ').trim();
  return /^(?:g_d\d+_f\d+|font\d+|f\d+)$/i.test(cleaned) ? '' : cleaned;
}

function resolveFontName(style = {}, rawName = '', fontObject = {}) {
  const candidates = [fontObject?.family, fontObject?.name, style.fontFamily, rawName]
    .map((value) => cleanPdfFontName(value || ''))
    .filter(Boolean);
  const raw = candidates.join(' ').toLowerCase();
  if (/helvetica|nimbus ?sans|liberation ?sans|arimo|swiss|dejavu ?sans|freesans|tex ?gyre ?heros/.test(raw) && !/narrow|condensed/.test(raw)) return 'Arial';
  if (/arial ?narrow|helvetica ?narrow|nimbus ?sans ?narrow/.test(raw)) return 'Arial Narrow';
  if (/courier|consolas|mono|typewriter|liberation mono|nimbus ?mono/.test(raw)) return 'Courier New';
  if (/times|georgia|palatino|garamond|cambria|liberation serif|bookman|baskerville/.test(raw) && !/sans/.test(raw)) {
    if (/georgia/.test(raw)) return 'Georgia';
    if (/cambria/.test(raw)) return 'Cambria';
    if (/palatino/.test(raw)) return 'Palatino Linotype';
    return 'Times New Roman';
  }
  if (/calibri/.test(raw)) return 'Calibri';
  if (/arial/.test(raw)) return 'Arial';
  if (/verdana/.test(raw)) return 'Verdana';
  if (/tahoma/.test(raw)) return 'Tahoma';
  if (/segoe/.test(raw)) return 'Segoe UI';
  if (/trebuchet/.test(raw)) return 'Trebuchet MS';
  if (/comic sans/.test(raw)) return 'Comic Sans MS';
  if (/impact/.test(raw)) return 'Impact';
  if (/symbol|dingbat|zapf/.test(raw)) return 'Arial';
  // Preserve a known named font when PDF.js provides one; otherwise use the closest general metric family.
  const first = candidates.find((name) => name && !/^(sans[- ]?serif|serif|monospace|math|cursive|fantasy|unknown|g_d\d+_f\d+|font\d+|f\d+)$/i.test(name));
  if (first && /^[\w .-]{2,48}$/.test(first)) return first;
  return /serif/.test(raw) && !/sans/.test(raw) ? 'Times New Roman' : 'Arial';
}

function fontObjectFor(page, fontName) {
  try { return page?.commonObjs?.get?.(fontName) || null; } catch { return null; }
}

function getTextMetadata(page, item, style = {}) {
  const loadedFont = fontObjectFor(page, item.fontName);
  const realName = loadedFont?.name || loadedFont?.loadedName || style.fontFamily || item.fontName || '';
  const styleName = `${realName} ${loadedFont?.name || ''}`.toLowerCase();
  const weightValue = Number(style.fontWeight ?? style.weight ?? loadedFont?.fontWeight);
  const inferredBold = loadedFont?.bold === true || (Number.isFinite(weightValue) && weightValue >= 600) || /bold|black|heavy|demi|semibold/.test(styleName);
  const inferredItalic = loadedFont?.italic === true || Boolean(style.italic) || /italic|oblique|slanted/.test(styleName);
  return {
    fontName: realName,
    pdfFontName: String(item.fontName || ''),
    fontFamily: style.fontFamily || loadedFont?.family || '',
    wordFont: resolveFontName(style, realName, loadedFont),
    fontWeight: inferredBold ? 700 : (Number.isFinite(weightValue) ? weightValue : 400),
    italic: inferredItalic,
    bold: inferredBold,
    ascent: Number.isFinite(Number(style.ascent)) ? Number(style.ascent) : 0.8,
    descent: Number.isFinite(Number(style.descent)) ? Number(style.descent) : -0.22,
    verticalFont: Boolean(style.vertical || loadedFont?.vertical),
    type3: Boolean(loadedFont?.isType3Font),
  };
}

function getGeometry(item, viewportTransform, pdfjsLib) {
  if (item?.__geometry === true) return item;
  if (!item || typeof item.str !== 'string' || !item.str.trim() || !Array.isArray(item.transform)) return null;
  const matrix = pdfjsLib.Util.transform ? pdfjsLib.Util.transform(viewportTransform, item.transform) : item.transform;
  if (!Array.isArray(matrix) || matrix.length < 6 || !matrix.every((number) => Number.isFinite(Number(number)))) return null;
  const metadata = item.textMetadata || {};
  const fontSize = clamp(Math.hypot(Number(matrix[2]) || 0, Number(matrix[3]) || 0) || Number(item.height) || 10, 3, 160);
  const angle = Math.atan2(Number(matrix[1]) || 0, Number(matrix[0]) || 0);
  const x = Number(matrix[4]) || 0;
  const baseline = Number(matrix[5]) || 0;
  const width = Math.max(0, Number(item.width) || [...item.str].length * fontSize * 0.45);
  if (!Number.isFinite(x + baseline + width) || width <= 0) return null;
  const top = baseline - fontSize * clamp(Number(metadata.ascent) || 0.8, 0.35, 1.2);
  const bottom = baseline - fontSize * clamp(Number(metadata.descent) || -0.22, -0.55, 0.12);
  const orientationSupported = Math.abs(angle) <= 0.035 && !metadata.verticalFont && item.dir !== 'rtl' && item.dir !== 'ttb';
  const bold = Boolean(metadata.bold);
  const italic = Boolean(metadata.italic);
  return {
    __geometry: true,
    text: item.str,
    x,
    top: Math.min(top, bottom),
    bottom: Math.max(top, bottom),
    baseline,
    fontSize,
    width,
    angle,
    fontName: metadata.fontName || item.fontName || '',
    pdfFontName: metadata.pdfFontName || item.fontName || '',
    fontFamily: metadata.fontFamily || '',
    fontWeight: metadata.fontWeight ?? 400,
    bold,
    italic,
    wordFont: metadata.wordFont || resolveFontName({ fontFamily: metadata.fontFamily }, metadata.fontName || item.fontName),
    hasEOL: Boolean(item.hasEOL),
    dir: item.dir || 'ltr',
    source: 'pdf-text',
    textColor: '000000',
    characterSpacingPt: 0,
    orientationSupported,
    keepInArtwork: !orientationSupported,
    tableCellKey: '',
    mask: {
      x: Math.max(0, x - 0.8),
      y: Math.max(0, Math.min(top, bottom) - 0.5),
      width: Math.max(1, width + 1.6),
      height: Math.max(2, Math.abs(bottom - top) + 1.0),
    },
  };
}

function estimateCharacterSpacing(item) {
  if (!item || !item.text || item.text.length < 2 || typeof document === 'undefined') return 0;
  try {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) return 0;
    context.font = `${item.italic ? 'italic ' : ''}${item.bold ? 'bold ' : ''}${Math.max(1, item.fontSize * 4 / 3)}px "${String(item.wordFont || 'Arial').replace(/"/g, '')}"`;
    const naturalWidthPt = context.measureText(item.text).width * 0.75;
    const glyphCount = [...item.text].filter((character) => !/\s/.test(character)).length;
    if (glyphCount < 2) return 0;
    // A tiny tracking correction compensates for Word/PDF font metric differences. Large corrections
    // are unsafe because they normally indicate a font mapping or extraction issue.
    return clamp((item.width - naturalWidthPt) / (glyphCount - 1), -1.25, 1.25);
  } catch { return 0; }
}

function getOcrGeometry(word, scale) {
  // OCR boxes approximate glyph/cap height (~70–75% of em size), so divide by that ratio.
  const fontSize = clamp(((Number(word.height) || 12) / scale) / 0.72, 3, 160);
  const x = Math.max(0, Number(word.left) / scale || 0);
  const top = Math.max(0, Number(word.top) / scale || 0);
  const width = Math.max(0.5, Number(word.width) / scale || 0.5);
  const height = Math.max(1, Number(word.height) / scale || fontSize);
  const baseline = top + height * 0.9;
  return {
    __geometry: true,
    text: String(word.text || '').trim(), x, top, bottom: top + height, baseline, fontSize, width,
    angle: 0, fontName: 'OCR estimate', pdfFontName: '', fontFamily: 'sans-serif', fontWeight: 400,
    bold: false, italic: false, wordFont: 'Arial', hasEOL: false, dir: 'ltr', source: 'ocr',
    confidence: Number(word.confidence) || 0, textColor: '000000', characterSpacingPt: 0,
    orientationSupported: true, keepInArtwork: false, tableCellKey: '',
    mask: { x: Math.max(0, x - 0.55), y: Math.max(0, top - 0.35), width: width + 1.1, height: height + 0.7 },
  };
}

function overlapRatio(a, b) {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.bottom, b.bottom);
  const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
  const smaller = Math.min(Math.max(1, (a.x + a.width - a.x) * (a.bottom - a.top)), Math.max(1, (b.x + b.width - b.x) * (b.bottom - b.top)));
  return intersection / smaller;
}

function mergeHybridText(nativeItems, ocrWords, scale) {
  const direct = (nativeItems || []).map((item) => item).filter((item) => item?.__geometry && item.text);
  const output = [...direct];
  let rejectedDuplicates = 0;
  for (const word of ocrWords || []) {
    if (!String(word.text || '').trim() || Number(word.confidence) < 20) continue;
    const candidate = getOcrGeometry(word, scale);
    const candidateText = normalizeForMatch(candidate.text);
    // Geometry alone is not evidence of a duplicate: raster text and the PDF text layer may
    // overlap while containing different strings. Reject OCR only when both placement and text
    // evidence agree, or when exact text is repeated at effectively the same baseline.
    const duplicate = direct.some((native) => {
      const nativeText = normalizeForMatch(native.text);
      const textEquivalent = nativeText === candidateText
        || (candidateText.length >= 3 && nativeText.includes(candidateText))
        || (nativeText.length >= 3 && candidateText.includes(nativeText));
      const overlap = overlapRatio(native, candidate) >= 0.28;
      const sameBaseline = Math.abs(native.baseline - candidate.baseline) < Math.max(3, candidate.fontSize * 0.65);
      const sameOrigin = Math.abs(native.x - candidate.x) < Math.max(3, candidate.fontSize);
      return (overlap && textEquivalent) || (sameBaseline && sameOrigin && textEquivalent);
    });
    if (duplicate) { rejectedDuplicates += 1; continue; }
    output.push(candidate);
  }
  return { items: output, rejectedDuplicates };
}

function groupTextIntoLines(items) {
  const supported = (items || []).filter((item) => item?.__geometry && item.text && item.orientationSupported);
  const bands = [];
  for (const item of [...supported].sort((a, b) => a.baseline - b.baseline || a.x - b.x)) {
    let band = null;
    let bestDistance = Infinity;
    for (let index = Math.max(0, bands.length - 4); index < bands.length; index += 1) {
      const candidate = bands[index];
      const tolerance = Math.max(1.4, Math.min(4.8, Math.max(candidate.fontSize, item.fontSize) * 0.28));
      const distance = Math.abs(candidate.baseline - item.baseline);
      if (distance <= tolerance && distance < bestDistance) { band = candidate; bestDistance = distance; }
    }
    if (!band) {
      band = { baseline: item.baseline, fontSize: item.fontSize, items: [] };
      bands.push(band);
    }
    band.items.push(item);
    band.baseline = band.items.reduce((sum, entry) => sum + entry.baseline, 0) / band.items.length;
    band.fontSize = band.items.reduce((sum, entry) => sum + entry.fontSize, 0) / band.items.length;
  }

  const rows = [];
  let lineGroup = 0;
  for (const band of bands.sort((a, b) => a.baseline - b.baseline)) {
    const sorted = band.items.sort((a, b) => a.x - b.x);
    let segment = [];
    const emitSegment = () => {
      if (!segment.length) return;
      segment.sort((a, b) => a.x - b.x);
      const maxFontSize = Math.max(...segment.map((item) => item.fontSize));
      const minX = Math.min(...segment.map((item) => item.x));
      const maxX = Math.max(...segment.map((item) => item.x + item.width));
      const baseline = segment.reduce((sum, item) => sum + item.baseline, 0) / segment.length;
      const top = Math.min(...segment.map((item) => item.top));
      const bottom = Math.max(...segment.map((item) => item.bottom));
      rows.push({
        items: segment, minX, maxX, baseline, top, bottom, fontSize: maxFontSize, maxFontSize,
        firstTop: Math.max(0, top - maxFontSize * 0.03), lineHeight: clamp(Math.max(bottom - top, maxFontSize * 1.16), 5, 180),
        spacingAfter: 0, spacingAfterTwips: 0, lineGroup, column: 0, tableItems: segment.some((item) => Boolean(item.tableCellKey)),
      });
      segment = [];
    };
    for (const item of sorted) {
      const previous = segment[segment.length - 1];
      const gap = previous ? item.x - (previous.x + previous.width) : 0;
      const splitGap = Math.max(28, Math.max(previous?.fontSize || 0, item.fontSize) * 3.2);
      if (previous && gap > splitGap) emitSegment();
      segment.push(item);
    }
    emitSegment();
    lineGroup += 1;
  }

  const columnSeparator = inferColumnSeparator(rows);
  const orderedRows = orderReadingRows(rows, columnSeparator);
  for (let index = 0; index < orderedRows.length; index += 1) {
    const row = orderedRows[index];
    const next = orderedRows[index + 1];
    const prev = orderedRows[index - 1];
    const gap = next ? Math.max(0, next.top - row.bottom) : 0;
    row.spacingAfter = clamp(gap, 0, 160);
    row.spacingAfterTwips = twips(row.spacingAfter);
    row.paragraphStart = !prev || prev.column !== row.column || row.baseline - prev.baseline > Math.max(prev.fontSize, row.fontSize) * 1.8 || startsList(row);
    row.paragraphEnd = !next || next.column !== row.column || next.baseline - row.baseline > Math.max(row.fontSize, next.fontSize) * 1.8;
    row.listType = detectListType(row);
    row.semanticText = makeSemanticRowText(row);
    row.tableItems = row.items.some((item) => Boolean(item.tableCellKey));
  }
  return { rows: orderedRows, columnSeparator };
}

function inferColumnSeparator(rows) {
  const byGroup = new Map();
  for (const row of rows) {
    if (!byGroup.has(row.lineGroup)) byGroup.set(row.lineGroup, []);
    byGroup.get(row.lineGroup).push(row);
  }
  const candidates = [];
  for (const groupRows of byGroup.values()) {
    if (groupRows.length < 2) continue;
    const sorted = [...groupRows].sort((a, b) => a.minX - b.minX);
    for (let index = 0; index < sorted.length - 1; index += 1) {
      const left = sorted[index];
      const right = sorted[index + 1];
      const gap = right.minX - left.maxX;
      if (gap >= Math.max(28, Math.max(left.fontSize, right.fontSize) * 3.2)) candidates.push((left.maxX + right.minX) / 2);
    }
  }
  if (candidates.length < 3) return null;
  const median = [...candidates].sort((a, b) => a - b)[Math.floor(candidates.length / 2)];
  const close = candidates.filter((value) => Math.abs(value - median) <= 14);
  if (close.length < 3 || close.length / candidates.length < 0.55) return null;
  const leftRows = rows.filter((row) => row.maxX < median - 5).length;
  const rightRows = rows.filter((row) => row.minX > median + 5).length;
  if (leftRows < 3 || rightRows < 3) return null;
  return median;
}

function orderReadingRows(rows, separator) {
  if (!separator) return [...rows].sort((a, b) => a.baseline - b.baseline || a.minX - b.minX);
  const left = rows.filter((row) => row.maxX <= separator).map((row) => ({ ...row, column: 1 }));
  const right = rows.filter((row) => row.minX >= separator).map((row) => ({ ...row, column: 2 }));
  const spanning = rows.filter((row) => row.minX < separator && row.maxX > separator).map((row) => ({ ...row, column: 0 }));
  if (left.length < 3 || right.length < 3) return [...rows].sort((a, b) => a.baseline - b.baseline || a.minX - b.minX);
  const columnFirst = Math.min(...left.map((row) => row.baseline), ...right.map((row) => row.baseline));
  const columnLast = Math.max(...left.map((row) => row.baseline), ...right.map((row) => row.baseline));
  const topSpanning = spanning.filter((row) => row.baseline < columnFirst + Math.max(8, row.fontSize * 1.2));
  const bottomSpanning = spanning.filter((row) => row.baseline > columnLast - Math.max(8, row.fontSize * 1.2));
  const middleSpanning = spanning.filter((row) => !topSpanning.includes(row) && !bottomSpanning.includes(row));
  return [
    ...topSpanning.sort((a, b) => a.baseline - b.baseline),
    ...left.sort((a, b) => a.baseline - b.baseline),
    ...middleSpanning.sort((a, b) => a.baseline - b.baseline),
    ...right.sort((a, b) => a.baseline - b.baseline),
    ...bottomSpanning.sort((a, b) => a.baseline - b.baseline),
  ];
}

function makeSemanticRowText(row) {
  const items = row.items.filter((item) => !item.keepInArtwork && !item.tableCellKey);
  const sorted = [...items].sort((a, b) => a.x - b.x);
  return sorted.map((item) => item.text).join(' ');
}

function detectListType(row) {
  const text = makeSemanticRowText(row).trim();
  if (/^(?:[•●▪◦‣⁃*-])\s+/.test(text)) return 'bullet';
  if (/^(?:\d{1,3}[.)]|[a-zA-Z][.)]|[ivxlcdmIVXLCDM]{1,6}[.)])\s+/.test(text)) return 'numbered';
  return '';
}
function startsList(row) { return Boolean(detectListType(row)); }

function buildRowsAndColumns(items) {
  return groupTextIntoLines(items);
}

function readPixel(data, width, height, x, y) {
  const px = Math.round(clamp(x, 0, width - 1));
  const py = Math.round(clamp(y, 0, height - 1));
  const offset = (py * width + px) * 4;
  return [data[offset], data[offset + 1], data[offset + 2]];
}
function averageColor(data, points) {
  if (!points.length) return [255, 255, 255];
  return [0, 1, 2].map((channel) => points.reduce((sum, color) => sum + color[channel], 0) / points.length);
}
function colorDistance(a, b) {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
}
function luminance(color) { return color[0] * 0.2126 + color[1] * 0.7152 + color[2] * 0.0722; }

function maskTextAreas(imageData, width, height, rows, scale, context) {
  const pixels = imageData.data;
  const masks = [];
  for (const row of rows) {
    for (const item of row.items) {
      if (item.keepInArtwork) continue;
      const mask = item.mask;
      const left = Math.round(clamp(mask.x * scale, 0, width - 1));
      const top = Math.round(clamp(mask.y * scale, 0, height - 1));
      const right = Math.round(clamp((mask.x + mask.width) * scale, left + 1, width));
      const bottom = Math.round(clamp((mask.y + mask.height) * scale, top + 1, height));
      if (right <= left || bottom <= top) { item.keepInArtwork = true; continue; }
      const pad = Math.max(2, Math.round(scale * 1.2));
      const edgePoints = [
        readPixel(pixels, width, height, left - pad, top - pad),
        readPixel(pixels, width, height, right + pad, top - pad),
        readPixel(pixels, width, height, left - pad, bottom + pad),
        readPixel(pixels, width, height, right + pad, bottom + pad),
        readPixel(pixels, width, height, (left + right) / 2, top - pad),
        readPixel(pixels, width, height, (left + right) / 2, bottom + pad),
      ];
      const background = averageColor(pixels, edgePoints);
      const spread = Math.max(...edgePoints.map((color) => colorDistance(color, background)));
      // Do not paint over photographs, gradients, colored shapes or scan texture. Keep that span visual-only.
      if (spread > 48) { item.keepInArtwork = true; continue; }
      if (background.every((channel) => channel > 222)) background[0] = background[1] = background[2] = 255;

      const glyphColors = [];
      const stepX = Math.max(1, Math.floor((right - left) / 32));
      const stepY = Math.max(1, Math.floor((bottom - top) / 14));
      for (let y = top; y < bottom; y += stepY) {
        for (let x = left; x < right; x += stepX) {
          const color = readPixel(pixels, width, height, x, y);
          const lum = luminance(color);
          const bgLum = luminance(background);
          const saturation = Math.max(...color) - Math.min(...color);
          if (colorDistance(color, background) > 58 && (lum < 238 || saturation > 45 || (bgLum < 140 && lum > 145))) glyphColors.push(color);
        }
      }
      if (glyphColors.length) item.textColor = toHex(averageColor(pixels, glyphColors));
      item.characterSpacingPt = estimateCharacterSpacing(item);
      masks.push({ left, top, width: right - left, height: bottom - top, background, item });
    }
  }

  for (const mask of masks) {
    context.fillStyle = `rgb(${Math.round(mask.background[0])}, ${Math.round(mask.background[1])}, ${Math.round(mask.background[2])})`;
    context.fillRect(mask.left, mask.top, mask.width, mask.height);
  }
  return masks;
}

function isInk(data, width, height, x, y) {
  const color = readPixel(data, width, height, x, y);
  const lum = luminance(color);
  const saturation = Math.max(...color) - Math.min(...color);
  return lum < 222 || (saturation > 48 && lum < 242);
}

function clusterRuleRecords(records, positionKey) {
  records.sort((a, b) => a[positionKey] - b[positionKey]);
  const clusters = [];
  for (const record of records) {
    const prior = clusters[clusters.length - 1];
    if (prior && record[positionKey] - prior.position <= 2) {
      prior.positions.push(record[positionKey]);
      prior.position = prior.positions.reduce((sum, value) => sum + value, 0) / prior.positions.length;
      prior.segments.push(...record.segments);
    } else clusters.push({ position: record[positionKey], positions: [record[positionKey]], segments: [...record.segments] });
  }
  for (const cluster of clusters) {
    cluster.segments.sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const segment of cluster.segments) {
      const last = merged[merged.length - 1];
      if (last && segment[0] <= last[1] + 3) last[1] = Math.max(last[1], segment[1]);
      else merged.push([...segment]);
    }
    cluster.segments = merged;
  }
  return clusters;
}

function findHorizontalRules(data, width, height) {
  const threshold = Math.max(28, Math.round(width * 0.018));
  const records = [];
  for (let y = 0; y < height; y += 1) {
    const segments = [];
    let start = -1;
    let gap = 0;
    for (let x = 0; x < width; x += 1) {
      if (isInk(data, width, height, x, y)) {
        if (start < 0) start = x;
        gap = 0;
      } else if (start >= 0 && gap < 2) { gap += 1; }
      else if (start >= 0) {
        const end = x - gap - 1;
        if (end - start + 1 >= threshold) segments.push([start, end]);
        start = -1; gap = 0;
      }
    }
    if (start >= 0 && width - start >= threshold) segments.push([start, width - 1]);
    if (segments.length) records.push({ y, segments });
  }
  return clusterRuleRecords(records, 'y');
}

function findVerticalRules(data, width, height, minLengthRatio = 0.018) {
  const threshold = Math.max(24, Math.round(height * clamp(minLengthRatio, 0.006, 0.05)));
  const records = [];
  for (let x = 0; x < width; x += 1) {
    const segments = [];
    let start = -1;
    let gap = 0;
    for (let y = 0; y < height; y += 1) {
      if (isInk(data, width, height, x, y)) {
        if (start < 0) start = y;
        gap = 0;
      } else if (start >= 0 && gap < 2) { gap += 1; }
      else if (start >= 0) {
        const end = y - gap - 1;
        if (end - start + 1 >= threshold) segments.push([start, end]);
        start = -1; gap = 0;
      }
    }
    if (start >= 0 && height - start >= threshold) segments.push([start, height - 1]);
    if (segments.length) records.push({ x, segments });
  }
  return clusterRuleRecords(records, 'x');
}

function ruleIntersectsHorizontalAndVertical(horizontal, vertical) {
  const x = vertical.position;
  const y = horizontal.position;
  const hIntersects = horizontal.segments.some(([start, end]) => x >= start - 3 && x <= end + 3);
  const vIntersects = vertical.segments.some(([start, end]) => y >= start - 3 && y <= end + 3);
  return hIntersects && vIntersects;
}

function detectGridTables(imageData, width, height, scale, items) {
  // Grid reconstruction is limited to clearly ruled tables; ambiguous column layouts remain editable text frames.
  if (!items.length || items.length < 4 || !imageData?.data) return [];
  const horizontal = findHorizontalRules(imageData.data, width, height);
  const vertical = findVerticalRules(imageData.data, width, height);
  const hToV = new Map();
  const vToH = new Map();
  for (let h = 0; h < horizontal.length; h += 1) {
    for (let v = 0; v < vertical.length; v += 1) {
      if (!ruleIntersectsHorizontalAndVertical(horizontal[h], vertical[v])) continue;
      if (!hToV.has(h)) hToV.set(h, []);
      if (!vToH.has(v)) vToH.set(v, []);
      hToV.get(h).push(v);
      vToH.get(v).push(h);
    }
  }
  const visitedH = new Set();
  const visitedV = new Set();
  const tables = [];
  for (const startH of hToV.keys()) {
    if (visitedH.has(startH)) continue;
    const componentH = new Set();
    const componentV = new Set();
    const queue = [{ kind: 'h', index: startH }];
    while (queue.length) {
      const node = queue.pop();
      if (node.kind === 'h') {
        if (componentH.has(node.index)) continue;
        componentH.add(node.index); visitedH.add(node.index);
        for (const v of hToV.get(node.index) || []) queue.push({ kind: 'v', index: v });
      } else {
        if (componentV.has(node.index)) continue;
        componentV.add(node.index); visitedV.add(node.index);
        for (const h of vToH.get(node.index) || []) queue.push({ kind: 'h', index: h });
      }
    }
    const hLines = [...componentH].map((index) => horizontal[index]).sort((a, b) => a.position - b.position);
    const vLines = [...componentV].map((index) => vertical[index]).sort((a, b) => a.position - b.position);
    if (hLines.length < 2 || vLines.length < 2 || (hLines.length < 3 && vLines.length < 3)) continue;
    const leftPx = vLines[0].position;
    const rightPx = vLines[vLines.length - 1].position;
    const topPx = hLines[0].position;
    const bottomPx = hLines[hLines.length - 1].position;
    const tableWidthPx = rightPx - leftPx;
    const tableHeightPx = bottomPx - topPx;
    if (tableWidthPx < 42 || tableHeightPx < 20) continue;
    // Only rebuild a complete rectangular grid. Missing rule segments can indicate merged cells;
    // retain those as positioned editable text over the original artwork rather than guessing spans.
    const fullWidthRules = hLines.every((line) => line.segments.some(([start, end]) => start <= leftPx + 4 && end >= rightPx - 4));
    const fullHeightRules = vLines.every((line) => line.segments.some(([start, end]) => start <= topPx + 4 && end >= bottomPx - 4));
    if (!fullWidthRules || !fullHeightRules) continue;
    // Exclude a page-border component; otherwise it can be mistaken for one giant table.
    if (leftPx < 12 && topPx < 12 && rightPx > width - 12 && bottomPx > height - 12) continue;
    const xEdges = vLines.map((line) => line.position / scale);
    const yEdges = hLines.map((line) => line.position / scale);
    const cells = [];
    let cellsWithText = 0;
    for (let row = 0; row < yEdges.length - 1; row += 1) {
      const cellRow = [];
      for (let col = 0; col < xEdges.length - 1; col += 1) {
        const cell = { row, col, x: xEdges[col], y: yEdges[row], width: xEdges[col + 1] - xEdges[col], height: yEdges[row + 1] - yEdges[row], items: [] };
        cellRow.push(cell);
      }
      cells.push(cellRow);
    }
    for (const item of items) {
      const centerX = item.x + item.width / 2;
      const centerY = (item.top + item.bottom) / 2;
      if (centerX <= xEdges[0] || centerX >= xEdges[xEdges.length - 1] || centerY <= yEdges[0] || centerY >= yEdges[yEdges.length - 1]) continue;
      const col = xEdges.findIndex((edge, index) => index < xEdges.length - 1 && centerX >= edge && centerX < xEdges[index + 1]);
      const row = yEdges.findIndex((edge, index) => index < yEdges.length - 1 && centerY >= edge && centerY < yEdges[index + 1]);
      if (row < 0 || col < 0) continue;
      cells[row][col].items.push(item);
    }
    for (const cellRow of cells) for (const cell of cellRow) if (cell.items.length) cellsWithText += 1;
    if (cellsWithText < 2) continue;
    const table = { id: `grid-${tables.length + 1}`, left: xEdges[0], top: yEdges[0], right: xEdges[xEdges.length - 1], bottom: yEdges[yEdges.length - 1], xEdges, yEdges, cells, ruleCount: hLines.length + vLines.length };
    tables.push(table);
  }
  // De-duplicate overlapping connected rule components before assigning cell ownership;
  // otherwise a rejected duplicate region could leave stale tableCellKey values on text spans.
  const uniqueTables = tables.filter((table, index, all) => !all.slice(0, index).some((prior) => {
    const intersection = Math.max(0, Math.min(table.right, prior.right) - Math.max(table.left, prior.left)) * Math.max(0, Math.min(table.bottom, prior.bottom) - Math.max(table.top, prior.top));
    const area = (table.right - table.left) * (table.bottom - table.top);
    return area > 0 && intersection / area > 0.8;
  }));
  for (const table of uniqueTables) {
    for (const cellRow of table.cells) for (const cell of cellRow) {
      for (const item of cell.items) if (!item.tableCellKey) item.tableCellKey = `${table.id}:${cell.row}:${cell.col}`;
    }
  }
  return uniqueTables;
}


/**
 * Returns a compact profile of a detected table candidate. A real table can have many rows, but
 * hundreds of very narrow columns usually mean the detector has grouped independent form controls
 * (date boxes, number boxes, checkbox rows) into a single page-wide table. Emitting such a grid can
 * explode DOCX XML size and causes some versions of Word to reject or badly render the file.
 */
function tableComplexityProfile(table, pageWidth = 0) {
  const xEdges = Array.isArray(table?.xEdges) ? table.xEdges.map(Number).filter(Number.isFinite) : [];
  const yEdges = Array.isArray(table?.yEdges) ? table.yEdges.map(Number).filter(Number.isFinite) : [];
  const columns = Math.max(0, xEdges.length - 1);
  const rows = Math.max(0, yEdges.length - 1);
  const cells = (table?.cells || []).reduce((sum, row) => sum + (Array.isArray(row) ? row.length : 0), 0);
  const tableWidth = xEdges.length >= 2 ? Math.max(0, xEdges[xEdges.length - 1] - xEdges[0]) : Math.max(0, Number(table?.right) - Number(table?.left));
  const averageColumnWidth = columns ? tableWidth / columns : 0;
  const pageCoverage = Number(pageWidth) > 0 ? tableWidth / Number(pageWidth) : 0;
  const hasExcessiveColumns = columns > 48;
  const hasPathologicalCellCount = cells > 1400 || rows > 120;
  const resemblesMergedFormControls = columns > 24 && averageColumnWidth < 5.2 && pageCoverage >= 0.45;
  return {
    columns,
    rows,
    cells,
    tableWidth,
    averageColumnWidth,
    pageCoverage,
    suspicious: hasExcessiveColumns || hasPathologicalCellCount || resemblesMergedFormControls,
  };
}

function needsLayoutPreservingFallback(tables, pageWidth = 0) {
  return (tables || []).some((table) => tableComplexityProfile(table, pageWidth).suspicious);
}

/**
 * Reconstructs clearly ruled tables as normal Word tables, including rows whose cells are merged.
 * Unlike the layout-preserving detector, this detector does not require every vertical rule to run
 * through every row; that requirement incorrectly rejects common forms and report templates.
 */
function detectFlowTables(imageData, width, height, scale, items) {
  if (!items?.length || items.length < 4 || !imageData?.data) return [];
  const horizontal = findHorizontalRules(imageData.data, width, height);
  // A modest threshold is needed for short vertical borders in rows with merged cells. Text strokes
  // are filtered below by requiring them to intersect multiple long, continuous table-border rules.
  const vertical = findVerticalRules(imageData.data, width, height, 0.012);
  if (horizontal.length < 3 || vertical.length < 2) return [];

  const minimumRuleLength = Math.max(60, width * 0.42);
  const endpointTolerance = Math.max(6, width * 0.006);
  const boundaryTolerance = Math.max(5, height * 0.002);
  const mergeLineTolerance = Math.max(4, height * 0.0016);
  const horizontalGroups = [];

  // Only continuous horizontal strokes are suitable as table borders. Text lines often contain many
  // separate short ink runs; treating those as borders connected the whole page into one component.
  for (const line of horizontal) {
    for (const [left, right] of line.segments) {
      if (right - left + 1 < minimumRuleLength) continue;
      let group = horizontalGroups.find((candidate) =>
        Math.abs(candidate.left - left) <= endpointTolerance
        && Math.abs(candidate.right - right) <= endpointTolerance);
      if (!group) {
        group = { left, right, entries: [] };
        horizontalGroups.push(group);
      }
      group.entries.push({ position: line.position, left, right });
      group.left = group.entries.reduce((sum, entry) => sum + entry.left, 0) / group.entries.length;
      group.right = group.entries.reduce((sum, entry) => sum + entry.right, 0) / group.entries.length;
    }
  }

  const candidates = [];
  for (const group of horizontalGroups) {
    if (group.right - group.left < Math.max(42, width * 0.42)) continue;
    const ordered = group.entries.sort((a, b) => a.position - b.position);
    const yLines = [];
    // Rasterized vector rules can be 2–4 pixels thick and get reported as adjacent rows. Collapse
    // those pixels into one boundary so a thick rule is not interpreted as an extra, tiny table row.
    for (const entry of ordered) {
      const prior = yLines[yLines.length - 1];
      if (prior && entry.position - prior.position <= mergeLineTolerance) {
        prior.position = (prior.position * prior.count + entry.position) / (prior.count + 1);
        prior.count += 1;
      } else yLines.push({ position: entry.position, count: 1 });
    }
    if (yLines.length < 3) continue;

    const leftEdges = vertical.filter((line) => Math.abs(line.position - group.left) <= endpointTolerance);
    const rightEdges = vertical.filter((line) => Math.abs(line.position - group.right) <= endpointTolerance);
    if (!leftEdges.length || !rightEdges.length) continue;

    for (const leftEdge of leftEdges) for (const rightEdge of rightEdges) {
      if (rightEdge.position - leftEdge.position < Math.max(42, width * 0.42)) continue;
      for (const leftSegment of leftEdge.segments) for (const rightSegment of rightEdge.segments) {
        const segmentTop = Math.max(leftSegment[0], rightSegment[0]);
        const segmentBottom = Math.min(leftSegment[1], rightSegment[1]);
        if (segmentBottom - segmentTop < Math.max(20, height * 0.025)) continue;
        let topIndex = -1;
        let bottomIndex = -1;
        let topDistance = Infinity;
        let bottomDistance = Infinity;
        for (let index = 0; index < yLines.length; index += 1) {
          const topDiff = Math.abs(yLines[index].position - segmentTop);
          const bottomDiff = Math.abs(yLines[index].position - segmentBottom);
          if (topDiff < topDistance) { topDistance = topDiff; topIndex = index; }
          if (bottomDiff < bottomDistance) { bottomDistance = bottomDiff; bottomIndex = index; }
        }
        if (topIndex < 0 || bottomIndex <= topIndex || topDistance > boundaryTolerance || bottomDistance > boundaryTolerance) continue;
        const tableYLines = yLines.slice(topIndex, bottomIndex + 1);
        if (tableYLines.length < 3) continue;
        const left = leftEdge.position;
        const right = rightEdge.position;
        const top = tableYLines[0].position;
        const bottom = tableYLines[tableYLines.length - 1].position;

        const tableVerticals = vertical.filter((line) => {
          if (line.position < left - 3 || line.position > right + 3) return false;
          const intersections = tableYLines.filter((horizontalLine) => line.segments.some(([start, end]) =>
            start <= horizontalLine.position + boundaryTolerance && end >= horizontalLine.position - boundaryTolerance)).length;
          return intersections >= 2;
        });
        // Always keep the outer borders even if antialiasing makes an intersection slightly fuzzy.
        for (const edge of [leftEdge, rightEdge]) {
          if (!tableVerticals.some((line) => Math.abs(line.position - edge.position) <= 1)) tableVerticals.push(edge);
        }
        tableVerticals.sort((a, b) => a.position - b.position);
        // Word draws shared cell borders as two hairlines roughly 1-2 pt apart. A real column is never narrower than a few
        // points, so merge by physical distance (not a fixed pixel count) or a sliver column and a doubled border appear.
        const minColumnPx = Math.max(2.5, 3.2 * scale);
        const uniqueVerticals = [];
        for (const line of tableVerticals) {
          const previousLine = uniqueVerticals[uniqueVerticals.length - 1];
          if (previousLine && line.position - previousLine.position <= minColumnPx) {
            previousLine.segments = [...previousLine.segments, ...line.segments];
            continue;
          }
          uniqueVerticals.push({ ...line, segments: [...line.segments] });
        }
        if (uniqueVerticals.length < 2) continue;

        const xEdgesPx = uniqueVerticals.map((line) => line.position);
        const yEdges = tableYLines.map((line) => line.position / scale);
        const xEdges = xEdgesPx.map((value) => value / scale);
        const rowCells = [];
        for (let rowIndex = 0; rowIndex < yEdges.length - 1; rowIndex += 1) {
          const topPx = tableYLines[rowIndex].position;
          const bottomPx = tableYLines[rowIndex + 1].position;
          const middle = (topPx + bottomPx) / 2;
          const activeEdges = [];
          for (let edgeIndex = 0; edgeIndex < uniqueVerticals.length; edgeIndex += 1) {
            const line = uniqueVerticals[edgeIndex];
            const crossesRow = line.segments.some(([start, end]) => start <= middle + 3 && end >= middle - 3);
            if (crossesRow || edgeIndex === 0 || edgeIndex === uniqueVerticals.length - 1) activeEdges.push(edgeIndex);
          }
          const cells = [];
          for (let index = 0; index < activeEdges.length - 1; index += 1) {
            const colStart = activeEdges[index];
            const colEnd = activeEdges[index + 1];
            if (colEnd <= colStart) continue;
            cells.push({
              row: rowIndex,
              col: colStart,
              colStart,
              colSpan: colEnd - colStart,
              x: xEdges[colStart],
              y: yEdges[rowIndex],
              width: xEdges[colEnd] - xEdges[colStart],
              height: yEdges[rowIndex + 1] - yEdges[rowIndex],
              right: xEdges[colEnd],
              bottom: yEdges[rowIndex + 1],
              items: [],
              images: [],
            });
          }
          rowCells.push(cells);
        }

        let cellsWithText = 0;
        for (const item of items) {
          const centerX = item.x + item.width / 2;
          const centerY = (item.top + item.bottom) / 2;
          if (centerX < xEdges[0] || centerX > xEdges[xEdges.length - 1] || centerY < yEdges[0] || centerY > yEdges[yEdges.length - 1]) continue;
          const rowIndex = yEdges.findIndex((edge, index) => index < yEdges.length - 1
            && centerY >= edge - 0.2
            && centerY < yEdges[index + 1] + (index === yEdges.length - 2 ? 0.2 : 0));
          if (rowIndex < 0 || !rowCells[rowIndex]?.length) continue;
          const cell = rowCells[rowIndex].find((candidate) => centerX >= candidate.x - 0.2 && centerX <= candidate.right + 0.2);
          if (cell) cell.items.push(item);
        }
        for (const row of rowCells) for (const cell of row) if (cell.items.length) cellsWithText += 1;
        if (cellsWithText < 2) continue;

        candidates.push({
          id: `flow-table-${candidates.length + 1}`,
          left: xEdges[0], top: yEdges[0], right: xEdges[xEdges.length - 1], bottom: yEdges[yEdges.length - 1],
          xEdges, yEdges, cells: rowCells,
          ruleCount: uniqueVerticals.length + tableYLines.length,
        });
      }
    }
  }

  // Prefer each complete outer table rectangle over nested rectangles produced by inner border pairs.
  const unique = [];
  for (const table of candidates.sort((a, b) => ((b.right - b.left) * (b.bottom - b.top)) - ((a.right - a.left) * (a.bottom - a.top)))) {
    const area = Math.max(1, (table.right - table.left) * (table.bottom - table.top));
    const duplicate = unique.some((other) => {
      const intersection = Math.max(0, Math.min(table.right, other.right) - Math.max(table.left, other.left))
        * Math.max(0, Math.min(table.bottom, other.bottom) - Math.max(table.top, other.top));
      const otherArea = Math.max(1, (other.right - other.left) * (other.bottom - other.top));
      return intersection / Math.min(area, otherArea) > 0.86;
    });
    if (!duplicate) unique.push(table);
  }
  unique.sort((a, b) => a.top - b.top || a.left - b.left);
  unique.forEach((table, tableIndex) => {
    table.id = `flow-table-${tableIndex + 1}`;
    for (const row of table.cells) for (const cell of row) {
      for (const item of cell.items) {
        if (!item.tableCellKey) item.tableCellKey = `${table.id}:${cell.row}:${cell.colStart}`;
      }
    }
  });
  return unique;
}

/** Collects placed image-XObject rectangles from the PDF operator stream. We crop those regions
 * from the high-resolution page render and place them as individual Word images instead of retaining
 * a single full-page bitmap as the editable document's background. */
function collectPageImageRegions(operatorList, viewport, pdfjsLib) {
  const names = new Map(Object.entries(pdfjsLib?.OPS || {}).map(([name, id]) => [id, name]));
  const ops = pdfjsLib?.OPS || {};
  const regions = [];
  const stack = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  const transformMatrix = (left, right) => pdfjsLib?.Util?.transform ? pdfjsLib.Util.transform(left, right) : left;
  for (let index = 0; index < (operatorList?.fnArray || []).length; index += 1) {
    const name = names.get(operatorList.fnArray[index]) || '';
    const args = operatorList.argsArray?.[index] || [];
    if (name === 'save') { stack.push(ctm.slice()); continue; }
    if (name === 'restore') { ctm = stack.pop() || [1, 0, 0, 1, 0, 0]; continue; }
    // Form XObjects (used by Word/Acrobat for headers, logos and soft-masked pictures) carry their own
    // matrix. pdf.js emits it as an argument of paintFormXObjectBegin and the form's content is
    // positioned relative to it, so ignoring it places every nested image far outside the page.
    if (name === 'paintFormXObjectBegin') {
      stack.push(ctm.slice());
      const formMatrix = args[0] && args[0].length >= 6 ? Array.from(args[0]).slice(0, 6).map(Number) : null;
      if (formMatrix && formMatrix.every(Number.isFinite)) ctm = transformMatrix(ctm, formMatrix);
      continue;
    }
    if (name === 'paintFormXObjectEnd') { ctm = stack.pop() || [1, 0, 0, 1, 0, 0]; continue; }
    if (name === 'transform' && args.length >= 6) {
      ctm = transformMatrix(ctm, args.slice(0, 6).map(Number));
      continue;
    }
    if (name === 'setTransform' && args.length >= 6) {
      ctm = args.slice(0, 6).map(Number);
      continue;
    }
    if (!/^paint(?:Jpeg(?:Image)?|Image|InlineImage|ImageMask)XObject$/.test(name)) continue;
    const matrix = transformMatrix(viewport.transform || [1, 0, 0, 1, 0, 0], ctm);
    const corners = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => ({
      x: matrix[0] * x + matrix[2] * y + matrix[4],
      y: matrix[1] * x + matrix[3] * y + matrix[5],
    }));
    const left = Math.min(...corners.map((point) => point.x));
    const right = Math.max(...corners.map((point) => point.x));
    const top = Math.min(...corners.map((point) => point.y));
    const bottom = Math.max(...corners.map((point) => point.y));
    const width = right - left;
    const height = bottom - top;
    const area = width * height;
    const pageArea = Math.max(1, viewport.width * viewport.height);
    // Signatures, initials, check marks and small ID photos are often legitimate placed image XObjects.
    // The previous 18x14 pt / 420 pt² floor discarded many of these and left them baked into a page bitmap.
    // Keep small but real image objects; the minimum area check still filters single-pixel artifacts.
    if (!Number.isFinite(left + top + width + height) || width < 6 || height < 5 || area < 50 || area > pageArea * 0.78) continue;
    regions.push({ x: Math.max(0, left), y: Math.max(0, top), width, height, source: 'pdf-image-object' });
  }

  // PDF creators sometimes split a single raster heading/logo into many overlapping image pieces.
  // Keep the outer image and discard its contained fragments; fragments are not useful Word assets.
  const unique = [];
  for (const region of regions.sort((a, b) => (b.width * b.height) - (a.width * a.height))) {
    const area = Math.max(1, region.width * region.height);
    const duplicate = unique.some((parent) => {
      const intersection = Math.max(0, Math.min(region.x + region.width, parent.x + parent.width) - Math.max(region.x, parent.x))
        * Math.max(0, Math.min(region.y + region.height, parent.y + parent.height) - Math.max(region.y, parent.y));
      return intersection / area > 0.92;
    });
    if (!duplicate) unique.push(region);
  }
  unique.sort((a, b) => a.y - b.y || a.x - b.x);

  // Exclude side logos from the crop of a wide banner image when their PDF object rectangles overlap.
  // The original PDF often layers transparent image objects this way; independent crops must not
  // accidentally bake the side logo into the centre image and then insert the logo twice.
  for (const region of unique) {
    const peers = unique.filter((other) => other !== region
      && Math.max(0, Math.min(region.y + region.height, other.y + other.height) - Math.max(region.y, other.y)) >= Math.min(region.height, other.height) * 0.42
      && region.width >= other.width * 1.45
      && other.width * other.height < region.width * region.height * 0.7);
    const leftPeers = peers.filter((other) => other.x + other.width <= region.x + region.width / 2 && other.x < region.x + region.width);
    const rightPeers = peers.filter((other) => other.x >= region.x + region.width / 2 && other.x < region.x + region.width);
    if (leftPeers.length) {
      const edge = Math.max(...leftPeers.map((other) => other.x + other.width));
      const originalRight = region.x + region.width;
      if (edge > region.x + 2 && edge < originalRight - 8) { region.x = edge; region.width = originalRight - edge; }
    }
    if (rightPeers.length) {
      const edge = Math.min(...rightPeers.map((other) => other.x));
      const originalRight = region.x + region.width;
      if (edge > region.x + 8 && edge < originalRight - 2) region.width = edge - region.x;
    }
  }
  return unique.filter((region) => region.width >= 6 && region.height >= 5).slice(0, 128).sort((a, b) => a.y - b.y || a.x - b.x);
}

/** Keeps placed image objects eligible for asset extraction even when native text overlaps them.
 * renderPageBackdrop chooses pixels per region: wide composite/header art is cropped from a text-free render,
 * while ordinary photos with real overlaid captions use the normal render. Excluding the entire banner here would
 * lose its rules/fills/logo fragments instead of preserving those graphics with the heading rebuilt as Word text. */
function filterSemanticImageRegions(regions, viewport, nativeItems, pdfjsLib) {
  return (regions || []).filter((region) => region.width >= 6 && region.height >= 5
    && Number.isFinite(region.x + region.y + region.width + region.height))
    .slice(0, 128)
    .sort((a, b) => a.y - b.y || a.x - b.x);
}

function getImageOverlayTextItems(region, textGeometry, minRatio = 0.3) {
  const left = Number(region?.x) || 0;
  const top = Number(region?.y) || 0;
  const right = left + Math.max(0, Number(region?.width) || 0);
  const bottom = top + Math.max(0, Number(region?.height) || 0);
  return (textGeometry || []).filter((item) => {
    if (!item || !item.text) return false;
    const itemLeft = Number(item.x);
    const itemTop = Number(item.top);
    const itemRight = itemLeft + Math.max(0, Number(item.width) || 0);
    const itemBottom = Number(item.bottom);
    if (![itemLeft, itemTop, itemRight, itemBottom].every(Number.isFinite)) return false;
    const intersection = Math.max(0, Math.min(right, itemRight) - Math.max(left, itemLeft))
      * Math.max(0, Math.min(bottom, itemBottom) - Math.max(top, itemTop));
    const itemArea = Math.max(1, (itemRight - itemLeft) * (itemBottom - itemTop));
    return intersection / itemArea >= minRatio;
  });
}

function imageRegionHasTextOverlay(region, textGeometry) {
  return getImageOverlayTextItems(region, textGeometry).length > 0;
}

// Text only counts as "burned into" a picture when it sits (almost) entirely inside it. A signature or logo that just
// grazes a caption/name must not swallow that text: it stays editable and the picture is cropped text-free.
const BAKED_TEXT_MIN_INSIDE = 0.8;

function shouldCropImageFromNormalRender(region, pageWidth, pageHeight, textGeometry) {
  const overlayItems = getImageOverlayTextItems(region, textGeometry, BAKED_TEXT_MIN_INSIDE);
  if (!overlayItems.length) return false;
  // Text that cannot safely be rebuilt as editable text must stay baked into its image region, even when
  // the region is a wide banner. For supported text, broad header composites are cropped text-free and rebuilt.
  if (overlayItems.some((item) => item.keepInArtwork)) return true;
  const aspectRatio = region.width / Math.max(1, region.height);
  const pageWidthRatio = region.width / Math.max(1, pageWidth);
  const pageHeightRatio = region.height / Math.max(1, pageHeight);
  // Text over an ordinary photo (a caption, label or date burned into the photo) belongs to that image.
  // Wide composite/header artwork is different: text layered over it is usually a separate PDF text object,
  // so it must be cropped from the text-free render to avoid duplicating the heading in Word.
  return aspectRatio < 2.75 && pageWidthRatio < 0.86 && pageHeightRatio < 0.68;
}

function cropPageImageRegions(canvas, regions, scale, options = {}) {
  const { textFreeCanvas = null, textGeometry = [], pageWidth = canvas.width / scale, pageHeight = canvas.height / scale } = options;
  return Promise.all((regions || []).map(async (region) => {
    const left = Math.round(clamp(region.x * scale, 0, canvas.width - 1));
    const top = Math.round(clamp(region.y * scale, 0, canvas.height - 1));
    const right = Math.round(clamp((region.x + region.width) * scale, left + 1, canvas.width));
    const bottom = Math.round(clamp((region.y + region.height) * scale, top + 1, canvas.height));
    const cropWidth = Math.max(1, right - left);
    const cropHeight = Math.max(1, bottom - top);
    const useNormalRender = !textFreeCanvas || shouldCropImageFromNormalRender(region, pageWidth, pageHeight, textGeometry);
    const sourceCanvas = useNormalRender ? canvas : textFreeCanvas;
    const sourceLeft = Math.round(clamp(region.x * scale, 0, sourceCanvas.width - 1));
    const sourceTop = Math.round(clamp(region.y * scale, 0, sourceCanvas.height - 1));
    const sourceRight = Math.round(clamp((region.x + region.width) * scale, sourceLeft + 1, sourceCanvas.width));
    const sourceBottom = Math.round(clamp((region.y + region.height) * scale, sourceTop + 1, sourceCanvas.height));
    const safeWidth = Math.min(cropWidth, Math.max(1, sourceRight - sourceLeft));
    const safeHeight = Math.min(cropHeight, Math.max(1, sourceBottom - sourceTop));
    const crop = document.createElement('canvas');
    crop.width = safeWidth;
    crop.height = safeHeight;
    const context = crop.getContext('2d', { alpha: false });
    if (!context) return null;
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, safeWidth, safeHeight);
    context.drawImage(sourceCanvas, sourceLeft, sourceTop, safeWidth, safeHeight, 0, 0, safeWidth, safeHeight);
    const data = await blobBytes(crop, 'image/jpeg', 0.94);
    crop.width = 0; crop.height = 0;
    return { ...region, data, type: 'jpg', pixelWidth: safeWidth, pixelHeight: safeHeight, cropSource: useNormalRender ? 'normal' : 'text-free' };
  })).then((items) => items.filter(Boolean));
}

function groupImageRegionsByRow(regions) {
  const groups = [];
  for (const image of [...(regions || [])].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const centerY = image.y + image.height / 2;
    let group = groups.find((candidate) => {
      const minTop = Math.min(...candidate.map((entry) => entry.y));
      const maxBottom = Math.max(...candidate.map((entry) => entry.y + entry.height));
      const overlap = Math.max(0, Math.min(maxBottom, image.y + image.height) - Math.max(minTop, image.y));
      return overlap >= Math.min(image.height, maxBottom - minTop) * 0.38
        || Math.abs(centerY - (minTop + maxBottom) / 2) <= Math.max(10, Math.min(image.height, maxBottom - minTop) * 0.38);
    });
    if (!group) { group = []; groups.push(group); }
    group.push(image);
  }
  return groups.map((group) => group.sort((a, b) => a.x - b.x)).sort((a, b) => Math.min(...a.map((image) => image.y)) - Math.min(...b.map((image) => image.y)));
}

function attachFlowImagesToTables(imageRegions, tables) {
  for (const image of imageRegions || []) {
    const centerX = image.x + image.width / 2;
    const centerY = image.y + image.height / 2;
    const table = (tables || []).find((candidate) => centerX >= candidate.left - 1 && centerX <= candidate.right + 1 && centerY >= candidate.top - 1 && centerY <= candidate.bottom + 1);
    if (!table) continue;
    const rowIndex = table.yEdges.findIndex((edge, index) => index < table.yEdges.length - 1 && centerY >= edge - 0.5 && centerY < table.yEdges[index + 1] + 0.5);
    const cells = table.cells[rowIndex] || [];
    const cell = cells.find((candidate) => centerX >= candidate.x - 1 && centerX <= candidate.right + 1);
    if (!cell) continue;
    cell.images.push(image);
    image.tableId = table.id;
    image.cellRow = rowIndex;
    image.cellCol = cell.colStart;
  }
}

function makeRun(item, TextRun, outputScale = 1) {
  return new TextRun({
    text: item.text,
    font: item.wordFont || 'Arial',
    size: Math.round(clamp(item.fontSize * outputScale || 10, 3, 160) * 2),
    bold: Boolean(item.bold),
    italics: Boolean(item.italic),
    color: item.textColor || '000000',
    characterSpacing: Math.round(clamp(Number(item.characterSpacingPt) || 0, -1.25, 1.25) * outputScale * 20),
    preserve: true,
  });
}

// PDF producers often split one word into several text fragments (kerning pairs, ligatures, "ref"+"er"). Joining
// them with tab stops breaks the word in Word (search, spell-check, copy/paste). Fragments with the same style whose
// gap is far smaller than a space are fused back into a single run; real gaps keep their exact tab position.
function fuseAdjacentFragments(items) {
  const fused = [];
  for (const item of items) {
    const previous = fused[fused.length - 1];
    if (previous && previous.source !== 'ocr' && item.source !== 'ocr') {
      const gap = item.x - (previous.x + previous.width);
      const size = Math.max(previous.fontSize || 0, item.fontSize || 0) || 10;
      const sameStyle = previous.wordFont === item.wordFont && Boolean(previous.bold) === Boolean(item.bold)
        && Boolean(previous.italic) === Boolean(item.italic) && Math.abs((previous.fontSize || 0) - (item.fontSize || 0)) < 0.6
        && (previous.textColor || '') === (item.textColor || '') && Math.abs((previous.baseline || 0) - (item.baseline || 0)) < size * 0.25;
      const tail = String(previous.text || '').slice(-1);
      const head = String(item.text || '').slice(0, 1);
      if (sameStyle && gap > -size * 0.35 && gap < size * 0.14 && /\S/.test(tail) && /\S/.test(head)) {
        fused[fused.length - 1] = { ...previous, text: `${previous.text}${item.text}`, width: Math.max(previous.width, item.x + item.width - previous.x), bottom: Math.max(previous.bottom, item.bottom), top: Math.min(previous.top, item.top) };
        continue;
      }
    }
    fused.push(item);
  }
  return fused;
}

function makeEditableLayout(row, pageWidth, outputScale = 1, { excludeTableItems = true } = {}) {
  const items = fuseAdjacentFragments(row.items.filter((item) => !item.keepInArtwork && (!excludeTableItems || !item.tableCellKey)).sort((a, b) => a.x - b.x));
  if (!items.length) return { runs: [], tabStops: [], items: [] };
  const tabStops = items.slice(1).map((item) => ({
    type: 'left', position: twips(clamp((item.x - row.minX) * outputScale, 0, Math.max(0, pageWidth - row.minX) * outputScale)),
  })).filter((tab, index, all) => tab.position > 0 && all.findIndex((other) => other.position === tab.position) === index).sort((a, b) => a.position - b.position);
  const runs = [];
  items.forEach((item, index) => {
    if (index > 0) runs.push({ text: '\t', isTab: true });
    runs.push(item);
  });
  return { runs, tabStops, items };
}

async function blobBytes(canvas, type, quality) {
  const blob = await new Promise((resolve, reject) => canvas.toBlob(
    (value) => value ? resolve(value) : reject(new Error('Could not encode a page image for the Word document.')),
    type,
    quality,
  ));
  return new Uint8Array(await blob.arrayBuffer());
}

async function runOcrOnCanvas(canvas, language, onProgress, pageIndex, pages) {
  if (typeof window === 'undefined' || typeof window.pdfStudio?.ocrImage !== 'function') {
    return { attempted: false, available: false, words: [], warning: 'OCR is only available in the PDF Studio desktop app.' };
  }
  try {
    onProgress({ phase: 'ocr', page: pageIndex, pages, profile: `Recognizing scanned text (${language})` });
    const bytes = await blobBytes(canvas, 'image/png');
    const result = await window.pdfStudio.ocrImage({ image: bytes, language, timeoutMs: 90000 });
    return { attempted: true, available: Boolean(result?.available), words: Array.isArray(result?.words) ? result.words : [], confidence: Number(result?.confidence) || 0, warning: result?.warning || '' };
  } catch (error) {
    return { attempted: true, available: false, words: [], warning: error?.message || 'OCR could not run.' };
  }
}

function drawTextForComparison(context, rows, scale) {
  context.save();
  context.textBaseline = 'alphabetic';
  for (const row of rows) {
    for (const item of row.items) {
      if (item.keepInArtwork) continue;
      context.font = `${item.italic ? 'italic ' : ''}${item.bold ? 'bold ' : ''}${Math.max(1, item.fontSize * scale)}px "${String(item.wordFont || 'Arial').replace(/"/g, '')}"`;
      context.fillStyle = `#${item.textColor || '000000'}`;
      try { context.letterSpacing = `${(Number(item.characterSpacingPt) || 0) * scale}px`; } catch { /* optional canvas property */ }
      context.fillText(item.text, item.x * scale, item.baseline * scale);
    }
  }
  context.restore();
}

function compareTextRegions(originalData, reconstructedData, width, masks) {
  let error = 0;
  let samples = 0;
  for (const mask of masks) {
    const left = Math.max(0, mask.left - 1);
    const top = Math.max(0, mask.top - 1);
    const right = Math.min(width, mask.left + mask.width + 1);
    const bottom = Math.min(Math.ceil(originalData.length / (width * 4)), mask.top + mask.height + 1);
    for (let y = top; y < bottom; y += 1) {
      for (let x = left; x < right; x += 1) {
        const offset = (y * width + x) * 4;
        error += Math.abs(originalData[offset] - reconstructedData[offset]);
        error += Math.abs(originalData[offset + 1] - reconstructedData[offset + 1]);
        error += Math.abs(originalData[offset + 2] - reconstructedData[offset + 2]);
        samples += 3;
      }
    }
  }
  if (!samples) return null;
  return Math.round((1 - error / (samples * 255)) * 1000) / 10;
}

const TEXT_SHOWING_OPERATORS = ['showText', 'showSpacedText', 'nextLineShowText', 'nextLineSetSpacingShowText'];

function makeTextFreeFilter(pdfjsLib) {
  const hidden = new Set(TEXT_SHOWING_OPERATORS.map((name) => pdfjsLib?.OPS?.[name]).filter((id) => Number.isInteger(id)));
  if (!hidden.size) return null;
  // pdf.js calls the filter with the operator list that is being executed, so the index always lines up.
  return (index, list) => !hidden.has(list?.fnArray?.[index]);
}

// Text pixels = pixels that differ between the full render and the text-free render. The true glyph colour is
// the colour of the pixels that differ the most (the solid glyph core), not an average with anti-aliased edges.
function sampleGlyphColorFromDifference(fullData, artData, width, height, item, scale, minDistance = 60, minSamples = 1) {
  const mask = item.mask;
  const left = Math.round(clamp(mask.x * scale, 0, width - 1));
  const top = Math.round(clamp(mask.y * scale, 0, height - 1));
  const right = Math.round(clamp((mask.x + mask.width) * scale, left + 1, width));
  const bottom = Math.round(clamp((mask.y + mask.height) * scale, top + 1, height));
  const samples = [];
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const offset = (y * width + x) * 4;
      const distance = Math.abs(fullData[offset] - artData[offset]) + Math.abs(fullData[offset + 1] - artData[offset + 1]) + Math.abs(fullData[offset + 2] - artData[offset + 2]);
      if (distance > minDistance) samples.push([distance, fullData[offset], fullData[offset + 1], fullData[offset + 2]]);
    }
  }
  if (samples.length < minSamples) return null;
  samples.sort((a, b) => b[0] - a[0]);
  const core = samples.slice(0, Math.max(3, Math.ceil(samples.length * 0.3)));
  return toHex([1, 2, 3].map((channel) => core.reduce((sum, sample) => sum + sample[channel], 0) / core.length));
}

async function renderPageBackdrop(page, baseViewport, nativeItems, options = {}) {
  const { editable = true, maxDimension = 2600, imageType = 'jpg', onProgress = () => {}, pageIndex = 1, pages = 1, pdfjsLib, ocrEnabled = false, ocrLanguage = 'eng', shouldOcr = false, detectTables = false, semanticTables = false, imageRegions: imageRegionCandidates = [], captureOriginalImage = false, maskEditableRegions = false } = options;
  const scale = Math.min(4.0, maxDimension / Math.max(baseViewport.width, baseViewport.height));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(viewport.width));
  canvas.height = Math.max(1, Math.round(viewport.height));
  const context = canvas.getContext('2d', { alpha: false, desynchronized: true, willReadFrequently: true });
  if (!context) throw new Error('Could not create a page image for Word conversion.');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: context, viewport, background: '#ffffff', intent: 'print' }).promise;
  const sourceImageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const originalBytes = captureOriginalImage
    ? await blobBytes(canvas, imageType === 'png' ? 'image/png' : 'image/jpeg', imageType === 'png' ? undefined : 0.96)
    : null;
  let ocr = { attempted: false, available: false, words: [], confidence: 0, warning: '' };
  if (editable && ocrEnabled && shouldOcr) ocr = await runOcrOnCanvas(canvas, ocrLanguage, onProgress, pageIndex, pages);

  const allDirectGeometry = (nativeItems || []).map((item) => getGeometry(item, baseViewport.transform, pdfjsLib)).filter(Boolean);
  // Choose the image crop policy before dropping image-contained text from the semantic stream. Photo captions
  // remain baked into a normal-render crop and should not be emitted twice; headings over wide banner art are
  // removed from the image crop and must remain as editable Word text.
  const cropTextGeometry = [...allDirectGeometry, ...ocr.words.map((word) => getOcrGeometry(word, scale))];
  const normalRenderImageRegions = semanticTables && imageRegionCandidates.length
    ? imageRegionCandidates.filter((image) => shouldCropImageFromNormalRender(image, baseViewport.width, baseViewport.height, cropTextGeometry))
    : imageRegionCandidates;
  const isInsideNormalRenderImage = (item) => normalRenderImageRegions.some((image) => (
    getImageOverlayTextItems(image, [item], BAKED_TEXT_MIN_INSIDE).length > 0
  ));
  // Only suppress text that remains visible in a photo crop. Text on a text-free banner crop is reconstructed
  // separately as editable content, so removing it from the text stream would make it disappear entirely.
  const directGeometry = semanticTables && imageRegionCandidates.length
    ? allDirectGeometry.filter((item) => !isInsideNormalRenderImage(item))
    : allDirectGeometry;
  const ocrWordsForDocument = semanticTables && imageRegionCandidates.length
    ? ocr.words.filter((word) => !isInsideNormalRenderImage(getOcrGeometry(word, scale)))
    : ocr.words;
  const hybrid = mergeHybridText(directGeometry, ocrWordsForDocument, scale);
  let geometryItems = hybrid.items;
  for (const item of geometryItems) item.characterSpacingPt = estimateCharacterSpacing(item);

  const textFreeFilter = makeTextFreeFilter(pdfjsLib);
  let textFreeCanvas = null;
  // Extract placed image assets from a second render with native text operators removed. The full render remains
  // available for ordinary photos that intentionally contain a caption/date, while broad header composites are
  // cropped from the text-free layer so the separate heading isn't baked into the image and duplicated in Word.
  if (editable && imageRegionCandidates.length && textFreeFilter) {
    try {
      textFreeCanvas = document.createElement('canvas');
      textFreeCanvas.width = canvas.width;
      textFreeCanvas.height = canvas.height;
      const textFreeContext = textFreeCanvas.getContext('2d', { alpha: false, desynchronized: true, willReadFrequently: true });
      if (!textFreeContext) throw new Error('Could not create a text-free image canvas.');
      textFreeContext.fillStyle = '#ffffff';
      textFreeContext.fillRect(0, 0, textFreeCanvas.width, textFreeCanvas.height);
      await page.render({ canvasContext: textFreeContext, viewport, background: '#ffffff', intent: 'print', operationsFilter: textFreeFilter }).promise;
    } catch {
      if (textFreeCanvas) { textFreeCanvas.width = 0; textFreeCanvas.height = 0; }
      textFreeCanvas = null;
    }
  }
  const imageAssets = editable && imageRegionCandidates.length
    ? await cropPageImageRegions(canvas, imageRegionCandidates, scale, {
      textFreeCanvas,
      // Use all page text geometry for crop-source decisions. `directGeometry`/`geometryItems` may
      // intentionally exclude text inside a photo because that text is not re-added as a duplicate Word run;
      // it still has to inform whether a caption must remain baked into that photo's image asset.
      textGeometry: cropTextGeometry,
      pageWidth: baseViewport.width,
      pageHeight: baseViewport.height,
    })
    : [];

  const tables = editable && detectTables
    ? (semanticTables ? detectFlowTables(sourceImageData, canvas.width, canvas.height, scale, geometryItems) : detectGridTables(sourceImageData, canvas.width, canvas.height, scale, geometryItems))
    : [];
  if (semanticTables && imageAssets.length && tables.length) attachFlowImagesToTables(imageAssets, tables);
  let grouped = groupTextIntoLines(geometryItems);
  let rows = grouped.rows;
  let hiddenTextSpans = 0;

  // Preferred path: draw the page again with the PDF's own text-drawing operators removed. The result is the exact
  // artwork (rules, fills, logos, signatures, photos) with no text, so nothing has to be painted over and no
  // background guess can erase a neighbouring cell. It needs every text span to be rebuilt as editable text and no OCR
  // words; otherwise the span-level masking path below is used.
  const canRemoveTextOperators = Boolean(editable && textFreeFilter && directGeometry.length && !ocr.words.length && geometryItems.every((item) => !item.keepInArtwork));
  let masks = [];
  let artworkData = null;
  if (canRemoveTextOperators) {
    try {
      onProgress({ phase: 'layout', page: pageIndex, pages, profile: 'Separating text from page artwork' });
      if (textFreeCanvas) {
        const textFreeContext = textFreeCanvas.getContext('2d', { willReadFrequently: true });
        artworkData = textFreeContext?.getImageData(0, 0, textFreeCanvas.width, textFreeCanvas.height) || null;
        if (!artworkData) throw new Error('The text-free image layer was not readable.');
      } else {
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: context, viewport, background: '#ffffff', intent: 'print', operationsFilter: textFreeFilter }).promise;
        artworkData = context.getImageData(0, 0, canvas.width, canvas.height);
      }
      // Text that leaves no pixels (white-on-white, clipped away, or covered by a later opaque shape) is invisible
      // in the PDF viewer and must not show up in Word. Acrobat drops it too; keeping it printed stray fragments such as
      // "(V01, 07/2017)" or "MEMBER 'S P" on top of the form.
      const visibleItems = [];
      for (const item of geometryItems) {
        const color = sampleGlyphColorFromDifference(sourceImageData.data, artworkData.data, canvas.width, canvas.height, item, scale, 24, 2);
        if (!color && !item.keepInArtwork && /\S/.test(item.text || '') && item.source !== 'ocr') { hiddenTextSpans += 1; continue; }
        visibleItems.push(item);
      }
      if (hiddenTextSpans) {
        geometryItems = visibleItems;
        for (const table of tables) for (const tableRow of table.cells || []) for (const cell of tableRow || []) cell.items = (cell.items || []).filter((item) => visibleItems.includes(item));
        grouped = groupTextIntoLines(geometryItems);
        rows = grouped.rows;
      }
      for (const item of geometryItems) {
        const color = sampleGlyphColorFromDifference(sourceImageData.data, artworkData.data, canvas.width, canvas.height, item, scale);
        if (color) item.textColor = color;
        const mask = item.mask;
        masks.push({
          left: Math.round(clamp(mask.x * scale, 0, canvas.width - 1)), top: Math.round(clamp(mask.y * scale, 0, canvas.height - 1)),
          width: Math.max(1, Math.round(mask.width * scale)), height: Math.max(1, Math.round(mask.height * scale)), item,
        });
      }
    } catch (error) {
      // Fall back to span masking if this pdf.js build cannot filter operators.
      artworkData = null; masks = [];
      context.putImageData(sourceImageData, 0, 0);
    }
  }
  if (!artworkData && editable && rows.length) {
    onProgress({ phase: 'layout', page: pageIndex, pages, profile: 'Rebuilding editable text layer' });
    masks = maskTextAreas(sourceImageData, canvas.width, canvas.height, rows, scale, context);
  }
  // Restore text-free artwork before quality comparison. Keep an unmodified copy because the comparison
  // pass draws editable text into the canvas and native table/photo regions must be masked only afterwards.
  if (artworkData) context.putImageData(artworkData, 0, 0);
  const cleanArtwork = context.getImageData(0, 0, canvas.width, canvas.height);
  let visualSimilarity = null;
  if (editable && masks.length) {
    drawTextForComparison(context, rows, scale);
    const reconstructed = context.getImageData(0, 0, canvas.width, canvas.height).data;
    visualSimilarity = compareTextRegions(sourceImageData.data, reconstructed, canvas.width, masks);
    context.putImageData(cleanArtwork, 0, 0);
  }

  // In layout-preserving Word mode the full-page image is only a carrier for complex vector art and
  // unrecognized decoration. Blank out any region that will be a real Word object, otherwise users see
  // an editable table/photo sitting directly on top of a duplicate raster copy of the same content.
  if (maskEditableRegions) {
    const safeTables = tables.length && !needsLayoutPreservingFallback(tables, baseViewport.width) ? tables : [];
    context.fillStyle = '#FFFFFF';
    for (const table of safeTables) {
      const pad = 1.0;
      const left = Math.round(clamp((table.left - pad) * scale, 0, canvas.width));
      const top = Math.round(clamp((table.top - pad) * scale, 0, canvas.height));
      const right = Math.round(clamp((table.right + pad) * scale, left, canvas.width));
      const bottom = Math.round(clamp((table.bottom + pad) * scale, top, canvas.height));
      if (right > left && bottom > top) context.fillRect(left, top, right - left, bottom - top);
    }
    for (const image of imageAssets) {
      const coveredByNativeTable = safeTables.some((table) => image.x >= table.left - 1 && image.y >= table.top - 1
        && image.x + image.width <= table.right + 1 && image.y + image.height <= table.bottom + 1);
      if (coveredByNativeTable) continue;
      const pad = 0.6;
      const left = Math.round(clamp((image.x - pad) * scale, 0, canvas.width));
      const top = Math.round(clamp((image.y - pad) * scale, 0, canvas.height));
      const right = Math.round(clamp((image.x + image.width + pad) * scale, left, canvas.width));
      const bottom = Math.round(clamp((image.y + image.height + pad) * scale, top, canvas.height));
      if (right > left && bottom > top) context.fillRect(left, top, right - left, bottom - top);
    }
  }
  const bytes = await blobBytes(canvas, imageType === 'png' ? 'image/png' : 'image/jpeg', imageType === 'png' ? undefined : 0.97);
  canvas.width = 0;
  canvas.height = 0;
  if (textFreeCanvas) { textFreeCanvas.width = 0; textFreeCanvas.height = 0; }
  return {
    bytes,
    originalBytes,
    type: imageType === 'png' ? 'png' : 'jpg',
    scale,
    rows,
    tables,
    imageRegions: imageAssets,
    ocr,
    columnSeparator: grouped.columnSeparator,
    visualSimilarity,
    nativeTextSpans: directGeometry.length,
    mergedTextSpans: geometryItems.length,
    rejectedOcrDuplicates: hybrid.rejectedDuplicates,
    unsupportedSpans: geometryItems.filter((item) => item.keepInArtwork || !item.orientationSupported).length,
    editableSpans: geometryItems.filter((item) => !item.keepInArtwork).length,
    imageObjectCount: 0,
    textOperatorsRemoved: Boolean(artworkData),
    hiddenTextSpans,
    sourceImageData,
    sourceText: geometryItems.map((item) => item.text).filter(Boolean).join('\n'),
  };
}

function makePageImageRun(pageImage, viewport, ImageRun, outputScale = 1) {
  return new ImageRun({
    data: pageImage.bytes,
    type: pageImage.type,
    transformation: { width: Math.max(1, Math.round(viewport.width * outputScale * 4 / 3)), height: Math.max(1, Math.round(viewport.height * outputScale * 4 / 3)) },
    floating: {
      horizontalPosition: { relative: 'page', offset: 0 },
      verticalPosition: { relative: 'page', offset: 0 },
      behindDocument: true,
      allowOverlap: true,
      lockAnchor: true,
      layoutInCell: true,
    },
  });
}

function makePlacedImageParagraph(image, docxApi, outputScale = 1) {
  const width = Math.max(1, Math.round(image.width * outputScale * 4 / 3));
  const height = Math.max(1, Math.round(image.height * outputScale * 4 / 3));
  const run = new docxApi.ImageRun({
    data: image.data,
    type: image.type || 'jpg',
    transformation: { width, height },
    floating: {
      horizontalPosition: { relative: 'page', offset: pointsToEmu(image.x * outputScale) },
      verticalPosition: { relative: 'page', offset: pointsToEmu(image.y * outputScale) },
      behindDocument: false,
      allowOverlap: true,
      lockAnchor: true,
      layoutInCell: true,
    },
  });
  return new docxApi.Paragraph({
    children: [run],
    spacing: { before: 0, after: 0, line: 1, lineRule: 'exact' },
    widowControl: false,
  });
}

function makeMarkerRun(marker, TextRun) {
  // This marker is removed from document.xml after Packer creates the DOCX; it identifies the
  // correct paragraph so we can add true page-relative WordprocessingML frame coordinates.
  return new TextRun({ text: marker, size: 2, color: 'FFFFFF', preserve: true });
}

function buildCellLineParagraphs(cell, Paragraph, TextRun, outputScale) {
  const supported = cell.items.filter((item) => !item.keepInArtwork).sort((a, b) => a.baseline - b.baseline || a.x - b.x);
  if (!supported.length) return [new Paragraph({ children: [], spacing: { before: 0, after: 0, line: 1, lineRule: 'exact' } })];
  const lines = [];
  for (const item of supported) {
    let line = lines.find((candidate) => Math.abs(candidate.baseline - item.baseline) <= Math.max(1.5, Math.min(4, Math.max(candidate.fontSize, item.fontSize) * 0.28)));
    if (!line) { line = { baseline: item.baseline, fontSize: item.fontSize, items: [] }; lines.push(line); }
    line.items.push(item);
    line.baseline = line.items.reduce((sum, entry) => sum + entry.baseline, 0) / line.items.length;
    line.fontSize = Math.max(line.fontSize, item.fontSize);
  }
  lines.sort((a, b) => a.baseline - b.baseline);
  return lines.map((line) => {
    const sorted = line.items.sort((a, b) => a.x - b.x);
    const children = [];
    const stops = [];
    for (let i = 0; i < sorted.length; i += 1) {
      if (i > 0) {
        children.push(new TextRun({ text: '\t', preserve: true }));
        stops.push({ type: 'left', position: twips(Math.max(0, sorted[i].x - sorted[0].x) * outputScale) });
      }
      children.push(makeRun(sorted[i], TextRun, outputScale));
    }
    return new Paragraph({
      children,
      tabStops: stops,
      spacing: { before: 0, after: 0, line: Math.max(40, twips(line.fontSize * 1.12 * outputScale)), lineRule: 'exact' },
      indent: { left: twips(Math.max(0, sorted[0].x - cell.x) * outputScale) },
      keepLines: true,
      widowControl: false,
    });
  });
}

function buildNativeTable(table, docxApi, outputScale, { visibleBorders = false, includeImages = true } = {}) {
  const { Table, TableRow, TableCell, Paragraph, TextRun } = docxApi;
  const noBorder = { style: 'none', size: 0, color: 'FFFFFF' };
  const visibleBorder = { style: 'single', size: 4, color: '777777' };
  const edge = visibleBorders ? visibleBorder : noBorder;
  const borders = { top: edge, bottom: edge, left: edge, right: edge, insideHorizontal: edge, insideVertical: edge };
  const columnWidths = table.xEdges.slice(1).map((edge, index) => Math.max(1, twips((edge - table.xEdges[index]) * outputScale)));
  const rows = table.cells.map((cellRow, rowIndex) => new TableRow({
    children: cellRow.map((cell, colIndex) => {
      const colStart = Number.isInteger(cell.colStart) ? cell.colStart : colIndex;
      const colSpan = Math.max(1, Number(cell.colSpan) || 1);
      const cellWidth = columnWidths.slice(colStart, colStart + colSpan).reduce((sum, value) => sum + value, 0) || columnWidths[colIndex] || 1;
      const textParagraphs = buildCellLineParagraphs(cell, Paragraph, TextRun, outputScale);
      const imageParagraphs = includeImages && Array.isArray(cell.images) && cell.images.length
        ? buildFlowImageParagraphGroups(cell.images, docxApi, outputScale, Math.max(12, cell.width - 4), { before: 0, after: 0 }).map((block) => block.paragraph)
        : [];
      // Keep signatures and other placed assets as independent Word drawings inside their corresponding table cells.
      const children = [...textParagraphs, ...imageParagraphs];
      if (!children.length) children.push(new Paragraph({ children: [], spacing: { before: 0, after: 0, line: 1, lineRule: 'exact' } }));
      return new TableCell({
        children,
        width: { size: cellWidth, type: 'dxa' },
        ...(colSpan > 1 ? { columnSpan: colSpan } : {}),
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
        verticalAlign: 'top',
        borders,
      });
    }),
    height: { value: Math.max(1, twips((table.yEdges[rowIndex + 1] - table.yEdges[rowIndex]) * outputScale)), rule: 'atLeast' },
  }));
  return new Table({
    rows,
    width: { size: columnWidths.reduce((sum, value) => sum + value, 0), type: 'dxa' },
    columnWidths,
    layout: 'fixed',
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
    borders,
    float: {
      horizontalAnchor: 'page',
      verticalAnchor: 'page',
      absoluteHorizontalPosition: twips(table.left * outputScale),
      absoluteVerticalPosition: twips(table.top * outputScale),
      overlap: 'overlap',
    },
  });
}


function createFlowImageRun(image, docxApi, widthPoints = image.width, heightPoints = image.height, outputScale = 1) {
  return new docxApi.ImageRun({
    data: image.data,
    type: image.type || 'jpg',
    transformation: {
      width: Math.max(1, Math.round(widthPoints * outputScale * 4 / 3)),
      height: Math.max(1, Math.round(heightPoints * outputScale * 4 / 3)),
    },
  });
}

function inferSourceLinePitch(rows, fallbackFontSize = 10) {
  const ordered = (rows || []).filter((row) => Number.isFinite(Number(row?.baseline)))
    .slice().sort((a, b) => Number(a.baseline) - Number(b.baseline));
  const pitches = [];
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    const pitch = Number(current.baseline) - Number(previous.baseline);
    const previousFont = Number(previous.maxFontSize || previous.fontSize) || fallbackFontSize;
    const currentFont = Number(current.maxFontSize || current.fontSize) || fallbackFontSize;
    const referenceFont = Math.max(3, previousFont, currentFont);
    // Exclude paragraph gaps and overlaps; those are represented by paragraph spacing, not line pitch.
    if (Number.isFinite(pitch) && pitch >= referenceFont * 0.68 && pitch <= referenceFont * 2.25) pitches.push(pitch);
  }
  pitches.sort((a, b) => a - b);
  const measured = pitches.length ? pitches[Math.floor(pitches.length / 2)] : (Number(fallbackFontSize) || 10) * 1.16;
  return Math.max((Number(fallbackFontSize) || 10) * 0.98, Math.min(160, measured));
}

function safeFiniteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function makeFlowTextParagraph(rows, docxApi, outputScale, {
  pageWidth = 595,
  centerTarget = pageWidth / 2,
  marginLeft = 24,
  marginRight = 24,
  allowCenter = true,
  before = 0,
  after = 0,
  symmetricCenter = false,
} = {}) {
  const { Paragraph, TextRun } = docxApi;
  const children = [];
  const allItems = [];
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    const items = [...(row.items || [])].filter((item) => !item.keepInArtwork).sort((a, b) => a.x - b.x);
    for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
      const item = items[itemIndex];
      const previous = items[itemIndex - 1];
      const previousText = previous?.text || '';
      const currentText = item.text || '';
      if (itemIndex > 0 && previous && !/\s$/.test(previousText) && !/^\s/.test(currentText)) {
        const gap = item.x - (previous.x + previous.width);
        if (gap > Math.max(0.6, Math.min(2.4, item.fontSize * 0.1)) && !/[-‐‑]$/.test(previousText)) {
          children.push(new TextRun({ text: ' ', preserve: true }));
        }
      }
      children.push(makeRun(item, TextRun, outputScale));
      allItems.push(item);
    }
    if (rowIndex < rows.length - 1) {
      const lastItem = items[items.length - 1];
      const nextItem = rows[rowIndex + 1]?.items?.filter((item) => !item.keepInArtwork).sort((a, b) => a.x - b.x)[0];
      if (lastItem && nextItem && !/[-‐‑]$/.test(lastItem.text || '') && !/^[,.;:!?)]/.test(nextItem.text || '')) {
        children.push(new TextRun({ text: ' ', preserve: true }));
      }
    }
  }
  if (!children.length) children.push(new TextRun({ text: '', preserve: true }));
  const safeMarginLeft = Math.max(0, safeFiniteNumber(marginLeft, 24));
  const safeMarginRight = Math.max(0, safeFiniteNumber(marginRight, 24));
  const safePageWidth = Math.max(safeMarginLeft + safeMarginRight + 1, safeFiniteNumber(pageWidth, 595));
  const safeCenterTarget = safeFiniteNumber(centerTarget, safePageWidth / 2);
  const minX = allItems.length ? Math.min(...allItems.map((item) => safeFiniteNumber(item.x, safeMarginLeft))) : safeMarginLeft;
  const maxX = allItems.length ? Math.max(...allItems.map((item) => safeFiniteNumber(item.x, safeMarginLeft) + Math.max(0, safeFiniteNumber(item.width, 0)))) : minX;
  const textWidth = Math.max(0, maxX - minX);
  const lineCenter = (minX + maxX) / 2;
  const leftGap = Math.max(0, minX - safeMarginLeft);
  const rightGap = Math.max(0, safePageWidth - safeMarginRight - maxX);
  // Inside table cells a line is only centred when the space on both sides is genuinely equal; otherwise a short
  // label such as "Activity 1:" in a narrow column would be mistaken for centred text. A multi-line block is always
  // left-aligned inside a cell, regardless of where its longest line happens to end.
  const centered = allowCenter && (symmetricCenter
    ? (rows.length === 1 && leftGap > 3 && Math.abs(leftGap - rightGap) <= Math.max(2.5, (safePageWidth - safeMarginLeft - safeMarginRight) * 0.025))
    : (textWidth < safePageWidth * 0.76 && Math.abs(lineCenter - safeCenterTarget) < safePageWidth * 0.13));
  const lineCount = rows.length;
  const avgFont = allItems.length ? allItems.reduce((sum, item) => sum + Math.max(3, safeFiniteNumber(item.fontSize, 10)), 0) / allItems.length : 10;
  const safeScale = Math.max(0.01, safeFiniteNumber(outputScale, 1));
  // A measured source baseline pitch is more faithful than Word's default line height and reduces cumulative drift.
  // The same pitch also applies to lines Word wraps naturally while preserving an editable paragraph.
  const linePitch = inferSourceLinePitch(rows, avgFont);
  // The right indent only preserves the original wrapping width. It must never be tighter than the text itself: Word and
  // Acrobat measure fonts slightly differently, and an exact-fit width wraps the last word of every line. A single line
  // therefore flows freely; multi-line paragraphs get a small safety slack of about one and a half characters.
  const rightIndentPoints = lineCount > 1 ? Math.max(0, rightGap - Math.max(3, avgFont * 0.75)) : 0;
  return new Paragraph({
    children,
    alignment: centered ? 'center' : 'left',
    spacing: {
      before: twips(clamp(safeFiniteNumber(before, 0), 0, 40) * safeScale),
      after: twips(clamp(safeFiniteNumber(after, 0), 0, 40) * safeScale),
      ...(lineCount > 1 ? { line: Math.max(40, twips(linePitch * safeScale)), lineRule: 'exact' } : {}),
    },
    indent: centered
      ? { left: 0, right: 0, firstLine: 0 }
      : { left: twips(leftGap * safeScale), right: twips(rightIndentPoints * safeScale), firstLine: 0 },
    keepLines: true,
    widowControl: true,
  });
}

function buildFlowTextBlocks(items, docxApi, outputScale, geometry = {}) {
  const cleanItems = (items || []).filter((item) => !item.keepInArtwork).map((item) => ({ ...item, tableCellKey: '' }));
  if (!cleanItems.length) return [];
  const grouped = groupTextIntoLines(cleanItems).rows.sort((a, b) => a.top - b.top || a.minX - b.minX);
  const blocks = [];
  let current = [];
  const flush = () => {
    if (!current.length) return;
    const first = current[0];
    const last = current[current.length - 1];
    const previousBlock = blocks[blocks.length - 1];
    // Spacing is measured against the neighbouring block in the same container (page, table cell or header cell).
    // The ordinary line gap is subtracted because Word already adds it between lines; what remains is the blank
    // space the PDF author left between paragraphs, so "blank line" paragraph separators survive conversion.
    const firstFont = Math.max(6, first.maxFontSize || first.fontSize || 10);
    let before = 0;
    if (previousBlock) before = Math.max(0, first.top - previousBlock.bottom - firstFont * 0.2);
    else if (geometry.previousBottom != null) before = Math.max(0, first.top - geometry.previousBottom) * 0.45;
    const trailingGap = geometry.nextTop != null && !previousBlock ? Math.max(0, geometry.nextTop - last.bottom) : 0;
    const blockRows = current;
    const make = (beforePoints) => makeFlowTextParagraph(blockRows, docxApi, outputScale, {
      pageWidth: geometry.pageWidth,
      centerTarget: geometry.centerTarget,
      marginLeft: geometry.marginLeft,
      marginRight: geometry.marginRight,
      allowCenter: geometry.allowCenter !== false,
      symmetricCenter: Boolean(geometry.symmetricCenter),
      before: Math.min(60, beforePoints),
      after: Math.min(9, trailingGap * 0.32),
    });
    blocks.push({
      y: first.top,
      top: first.top,
      bottom: last.bottom,
      fontSize: firstFont,
      make,
      paragraph: make(before),
    });
    current = [];
  };
  for (const row of grouped) {
    if (current.length && (row.paragraphStart || current[current.length - 1].paragraphEnd || row.column !== current[current.length - 1].column)) flush();
    current.push(row);
    if (row.paragraphEnd) flush();
  }
  flush();
  return blocks;
}

function buildFlowImageParagraphGroups(images, docxApi, outputScale, availableWidthPoints, { maxImageHeight = Number.POSITIVE_INFINITY, before = 2, after = 3 } = {}) {
  const blocks = [];
  for (const group of groupImageRegionsByRow(images)) {
    // The PDF operator rectangle is already in page points, i.e. the source image's intended physical
    // size in the PDF. Do not impose a global height cap: it silently shrank screenshots from 220 pt
    // tall to 150 pt (or less). Fit the row only when its complete natural width exceeds the cell/page.
    const naturalTotalWidth = group.length > 1
      ? Math.max(...group.map((image) => image.x + image.width)) - Math.min(...group.map((image) => image.x))
      : group[0].width;
    const naturalMaxHeight = Math.max(...group.map((image) => image.height));
    const widthScale = Math.min(1, Math.max(0.01, (availableWidthPoints - 6) / Math.max(1, naturalTotalWidth)));
    const heightScale = Number.isFinite(maxImageHeight) ? Math.min(1, maxImageHeight / Math.max(1, naturalMaxHeight)) : 1;
    const sizingScale = Math.min(widthScale, heightScale);
    const children = [];
    group.forEach((image, imageIndex) => {
      const previousImage = group[imageIndex - 1];
      if (previousImage) {
        // Preserve the visible gap between side-by-side pictures with non-breaking spaces (10 pt font, ~2.5 pt each).
        const gapPoints = (image.x - (previousImage.x + previousImage.width)) * sizingScale * outputScale;
        const spaces = clamp(Math.round(gapPoints / 2.5), 1, 14);
        children.push(new docxApi.TextRun({ text: '\u00A0'.repeat(spaces), size: 20 }));
      }
      children.push(createFlowImageRun(image, docxApi, image.width * sizingScale, image.height * sizingScale, outputScale));
    });
    blocks.push({
      y: Math.min(...group.map((image) => image.y)),
      top: Math.min(...group.map((image) => image.y)),
      bottom: Math.max(...group.map((image) => image.y + image.height)),
      paragraph: new docxApi.Paragraph({
        children,
        alignment: 'center',
        spacing: { before: twips(before), after: twips(after) },
        indent: { left: 0, right: 0, firstLine: 0 },
        keepLines: true,
        widowControl: false,
      }),
    });
  }
  return blocks;
}

function buildFlowTable(table, docxApi, outputScale, margins, pageWidth, centerTarget) {
  const { Table, TableRow, TableCell, Paragraph, TextRun } = docxApi;
  const visibleColumnWidths = table.xEdges.slice(1).map((edge, index) => Math.max(1, twips((edge - table.xEdges[index]) * outputScale)));
  const border = { style: 'single', size: 4, color: '4A4A4A' };
  const borders = { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border };
  const rows = table.cells.map((cellRow) => new TableRow({
    children: cellRow.map((cell) => {
      const marginLeft = 2.2;
      const marginRight = 2.2;
      const contentWidth = Math.max(8, cell.width - marginLeft - marginRight);
      const cellTextItems = (cell.items || []).map((item) => ({ ...item, x: item.x - cell.x, tableCellKey: '' }));
      // Word insets cell text by the cell margin on each side, so the indent maths must use the same padding.
      const textBlocks = buildFlowTextBlocks(cellTextItems, docxApi, outputScale, {
        pageWidth: cell.width,
        centerTarget: cell.width / 2,
        marginLeft,
        marginRight,
        allowCenter: true,
        symmetricCenter: true,
      });
      const imageBlocks = buildFlowImageParagraphGroups(cell.images || [], docxApi, outputScale, contentWidth, { before: 2, after: 2 });
      const cellBlocks = [...textBlocks, ...imageBlocks].sort((a, b) => a.y - b.y).map((block) => block.paragraph);
      if (!cellBlocks.length) cellBlocks.push(new Paragraph({ children: [new TextRun({ text: '', preserve: true })], spacing: { before: 0, after: 0 } }));
      const cellWidthTwips = visibleColumnWidths.slice(cell.colStart, cell.colStart + cell.colSpan).reduce((sum, width) => sum + width, 0);
      return new TableCell({
        children: cellBlocks,
        width: { size: cellWidthTwips, type: 'dxa' },
        ...(cell.colSpan > 1 ? { columnSpan: cell.colSpan } : {}),
        margins: { top: 35, bottom: 35, left: 45, right: 45 },
        verticalAlign: 'top',
        borders,
      });
    }),
  }));
  const tableWidth = visibleColumnWidths.reduce((sum, value) => sum + value, 0);
  return new Table({
    rows,
    width: { size: tableWidth, type: 'dxa' },
    columnWidths: visibleColumnWidths,
    layout: 'fixed',
    indent: { size: twips(Math.max(0, table.left - margins.left) * outputScale), type: 'dxa' },
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
    borders,
  });
}

function buildFlowImageGroupTable(group, docxApi, outputScale, pageWidth, margins) {
  const { Table, TableRow, TableCell, Paragraph } = docxApi;
  if (!group?.length) return null;
  const images = [...group].sort((a, b) => a.x - b.x);
  const availableWidth = Math.max(60, pageWidth - margins.left - margins.right);
  const firstX = Math.min(...images.map((image) => image.x));
  // A photo group is rendered as a borderless table so images stay side-by-side in Word. Include
  // spacer columns in the width calculation: paragraph whitespace in adjacent table cells has no effect.
  const sourceGaps = images.slice(1).map((image, index) => {
    const sourceGap = image.x - (images[index].x + images[index].width);
    return sourceGap > 0 ? Math.max(2.5, sourceGap) : 0;
  });
  const naturalWidth = images.reduce((sum, image) => sum + image.width, 0) + sourceGaps.reduce((sum, gap) => sum + gap, 0);
  const availableAtX = Math.max(60, pageWidth - margins.right - Math.max(margins.left, firstX));
  // Preserve original PDF image dimensions whenever they fit in the available page width. A previous
  // 92 pt height ceiling made full-resolution screenshots appear thumbnail-sized in Word, even when
  // there was plenty of page space. Width is the only automatic fit constraint here.
  const factor = Math.min(1, availableAtX / Math.max(1, naturalWidth));
  const widths = [];
  const cells = [];
  const noBorder = { style: 'none', size: 0, color: 'FFFFFF' };
  const borders = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder, insideHorizontal: noBorder, insideVertical: noBorder };
  const makeCell = (children, widthTwips) => new TableCell({
    children,
    width: { size: widthTwips, type: 'dxa' },
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
    verticalAlign: 'center',
    borders,
  });
  images.forEach((image, index) => {
    const imageWidth = Math.max(1, twips(image.width * factor * outputScale));
    widths.push(imageWidth);
    cells.push(makeCell([new Paragraph({
      children: [createFlowImageRun(image, docxApi, image.width * factor, image.height * factor, outputScale)],
      alignment: 'center',
      spacing: { before: 0, after: 0 },
    })], imageWidth));
    const gap = sourceGaps[index];
    if (gap > 0) {
      // Keep a tangible Word table grid column between pictures rather than relying on whitespace that
      // collapses at a cell boundary. At normal page scale this preserves the source gap; tiny gaps get 2 pt.
      const gapWidth = Math.max(1, twips(gap * factor * outputScale));
      widths.push(gapWidth);
      cells.push(makeCell([new Paragraph({ children: [new docxApi.TextRun({ text: '', preserve: true })], spacing: { before: 0, after: 0, line: 1, lineRule: 'exact' } })], gapWidth));
    }
  });
  const width = widths.reduce((sum, value) => sum + value, 0);
  return new Table({
    rows: [new TableRow({ children: cells })],
    width: { size: width, type: 'dxa' },
    columnWidths: widths,
    layout: 'fixed',
    indent: { size: twips(Math.max(0, Math.min(availableWidth - width / 20, firstX - margins.left) * outputScale)), type: 'dxa' },
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
    borders,
  });
}

/** Builds a borderless Word table for a horizontal band of pictures (logos + banner) and moves the text lines that sit
 * inside that band into the matching column. PDFs from Word place such headings in the gap between two logos; without
 * this the banner image would be emitted on its own row and the heading text would collide with it. */
function buildImageBandTable(group, bandRows, docxApi, outputScale, pageWidth, margins) {
  const { Table, TableRow, TableCell, Paragraph } = docxApi;
  const images = [...group].sort((a, b) => a.x - b.x);
  const bandTop = Math.min(...images.map((image) => image.y));
  const bandBottom = Math.max(...images.map((image) => image.y + image.height));
  const bandLeft = images[0].x;
  const pageRight = pageWidth - 3;
  const lastRight = Math.max(...images.map((image) => image.x + image.width));
  const rawRight = Math.max(lastRight, ...bandRows.flatMap((row) => row.items.map((item) => item.x + item.width)));
  const fit = Math.min(1, Math.max(0.5, (pageRight - bandLeft) / Math.max(1, rawRight - bandLeft)));
  const columns = images.map((image, index) => {
    const next = images[index + 1];
    const left = image.x;
    const right = next ? Math.max(left + 4, next.x) : Math.max(image.x + image.width, rawRight);
    return { image, left, right, width: right - left, items: [] };
  });
  for (const row of bandRows) {
    for (const item of row.items) {
      const centerX = item.x + item.width / 2;
      const column = columns.find((candidate) => centerX >= candidate.left - 0.5 && centerX < candidate.right) || columns[columns.length - 1];
      column.items.push({ ...item, x: item.x - column.left, tableCellKey: '' });
    }
  }
  const noBorder = { style: 'none', size: 0, color: 'FFFFFF' };
  const borders = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder, insideHorizontal: noBorder, insideVertical: noBorder };
  const widths = columns.map((column) => Math.max(1, twips(column.width * fit * outputScale)));
  const cells = columns.map((column, index) => {
    const segments = [];
    const scaleImage = Math.min(1, column.width / Math.max(1, column.image.width)) * fit;
    segments.push({ top: column.image.y, bottom: column.image.y + column.image.height * scaleImage, image: column.image, scale: scaleImage });
    const textBlocks = buildFlowTextBlocks(column.items, docxApi, outputScale, {
      pageWidth: column.width, centerTarget: column.width / 2, marginLeft: 0, marginRight: 0, allowCenter: true, symmetricCenter: true,
    });
    for (const block of textBlocks) segments.push({ top: block.top, bottom: block.bottom, block });
    segments.sort((a, b) => a.top - b.top);
    let cursor = bandTop;
    const paragraphs = segments.map((segment) => {
      const before = Math.max(0, segment.top - cursor);
      cursor = Math.max(cursor, segment.bottom);
      if (segment.block) return segment.block.make(before);
      return new Paragraph({
        children: [createFlowImageRun(segment.image, docxApi, segment.image.width * segment.scale, segment.image.height * segment.scale, outputScale)],
        alignment: 'left',
        spacing: { before: twips(clamp(before, 0, 120) * outputScale), after: 0 },
        indent: { left: 0, right: 0, firstLine: 0 },
        keepLines: true,
        widowControl: false,
      });
    });
    return new TableCell({
      children: paragraphs,
      width: { size: widths[index], type: 'dxa' },
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      verticalAlign: 'top',
      borders,
    });
  });
  return new Table({
    rows: [new TableRow({ children: cells, cantSplit: true })],
    width: { size: widths.reduce((sum, value) => sum + value, 0), type: 'dxa' },
    columnWidths: widths,
    layout: 'fixed',
    indent: { size: twips(Math.max(0, bandLeft - margins.left) * outputScale), type: 'dxa' },
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
    borders,
  });
}

function buildFlowPageContent(backdrop, docxApi, outputScale, pageWidth, pageHeight, margins) {
  const centerTarget = backdrop.tables.length
    ? backdrop.tables.reduce((sum, table) => sum + (table.left + table.right) / 2, 0) / backdrop.tables.length
    : pageWidth / 2;
  let footerText = '';
  let footerBottom = 0;
  let footerItem = null;
  const rows = [...backdrop.rows].sort((a, b) => a.top - b.top || a.minX - b.minX);
  const flowRows = [];
  for (const row of rows) {
    const rowItems = row.items.filter((item) => !item.keepInArtwork && !item.tableCellKey);
    const candidateText = rowItems.map((item) => item.text).join(' ').trim();
    const rowCenter = (row.minX + row.maxX) / 2;
    if (row.top >= pageHeight - 100 && /^\d{1,4}$/.test(candidateText) && Math.abs(rowCenter - centerTarget) < pageWidth * 0.2) {
      footerText = candidateText;
      footerBottom = row.bottom;
      footerItem = rowItems[0] || null;
      continue;
    }
    const rowTableIds = [...new Set(row.items.map((item) => String(item.tableCellKey || '').split(':')[0]).filter((id) => id.startsWith('flow-table-')))];
    flowRows.push({ ...row, items: rowItems, tableIds: rowTableIds });
  }

  const events = [];
  const emittedTableIds = new Set();
  let paragraphRows = [];

  // Picture bands (two or more images side by side on one row) swallow the text lines that sit inside their vertical span.
  const externalImages = (backdrop.imageRegions || []).filter((image) => !image.tableId);
  const imageGroups = groupImageRegionsByRow(externalImages);
  const bandGroups = imageGroups.filter((group) => group.length >= 2);
  const bandEvents = [];
  for (const group of bandGroups) {
    const bandTop = Math.min(...group.map((image) => image.y));
    const bandBottom = Math.max(...group.map((image) => image.y + image.height));
    const bandLeft = Math.min(...group.map((image) => image.x));
    const bandRight = Math.max(...group.map((image) => image.x + image.width));
    const consumed = flowRows.filter((row) => !row.tableIds?.length && row.items.length
      && (row.top + row.bottom) / 2 >= bandTop && (row.top + row.bottom) / 2 <= bandBottom
      && row.minX >= bandLeft - 2 && row.maxX <= bandRight + 2);
    for (const row of consumed) flowRows.splice(flowRows.indexOf(row), 1);
    bandEvents.push({ kind: 'image', y: bandTop, node: buildImageBandTable(group, consumed, docxApi, outputScale, pageWidth, margins) });
  }
  const bandedImages = new Set(bandGroups.flat());
  const flushParagraph = () => {
    if (!paragraphRows.length) return;
    const rowsToRender = paragraphRows;
    paragraphRows = [];
    const first = rowsToRender[0];
    const last = rowsToRender[rowsToRender.length - 1];
    events.push({
      kind: 'paragraph', y: first.top,
      node: makeFlowTextParagraph(rowsToRender, docxApi, outputScale, {
        pageWidth,
        centerTarget,
        marginLeft: margins.left,
        marginRight: margins.right,
        allowCenter: true,
        before: Math.min(8, Math.max(0, first.top - (rowsToRender.length > 1 ? rowsToRender[0].top : first.top)) * 0.2),
        after: Math.min(8, Math.max(0, first.spacingAfter || (last.bottom ? 2 : 0))),
      }),
    });
  };

  for (const row of flowRows) {
    const tableIds = row.tableIds || [];
    if (tableIds.length) {
      flushParagraph();
      for (const tableId of tableIds) {
        if (emittedTableIds.has(tableId)) continue;
        const table = backdrop.tables.find((candidate) => candidate.id === tableId);
        if (!table) continue;
        emittedTableIds.add(tableId);
        events.push({ kind: 'table', y: table.top, node: buildFlowTable(table, docxApi, outputScale, margins, pageWidth, centerTarget) });
      }
    }
    if (!row.items.length) {
      flushParagraph();
      continue;
    }
    if (paragraphRows.length && (row.paragraphStart || paragraphRows[paragraphRows.length - 1].paragraphEnd || row.column !== paragraphRows[paragraphRows.length - 1].column)) flushParagraph();
    paragraphRows.push(row);
    if (row.paragraphEnd) flushParagraph();
  }
  flushParagraph();

  for (const table of backdrop.tables) {
    if (emittedTableIds.has(table.id)) continue;
    emittedTableIds.add(table.id);
    events.push({ kind: 'table', y: table.top, node: buildFlowTable(table, docxApi, outputScale, margins, pageWidth, centerTarget) });
  }
  events.push(...bandEvents);
  for (const group of imageGroups) {
    if (group.length >= 2 && group.every((image) => bandedImages.has(image))) continue;
    const minY = Math.min(...group.map((image) => image.y));
    events.push({ kind: 'image', y: minY, node: buildFlowImageGroupTable(group, docxApi, outputScale, pageWidth, margins) });
  }

  const priority = { image: 0, paragraph: 1, table: 2 };
  events.sort((a, b) => a.y - b.y || (priority[a.kind] ?? 0) - (priority[b.kind] ?? 0));
  // Two Word tables with nothing between them are merged into one by Word, so keep a hairline paragraph between them.
  const children = [];
  let previousKind = '';
  for (const event of events) {
    if (!event.node) continue;
    const isTable = event.kind === 'table' || event.kind === 'image';
    if (isTable && previousKind === 'table-like') {
      children.push(new docxApi.Paragraph({ children: [], spacing: { before: 0, after: 0, line: 20, lineRule: 'exact' } }));
    }
    children.push(event.node);
    previousKind = isTable ? 'table-like' : '';
  }
  return { children, footerText, footerBottom, footerItem, eventCount: events.length };
}

function pointsToEmu(points) { return Math.max(1, Math.round((Number(points) || 0) * 12700)); }

function wrapParagraphInDrawingTextBox(paragraphXml, frame, drawingId) {
  const width = pointsToEmu(frame.width);
  const height = pointsToEmu(frame.height);
  const x = pointsToEmu(frame.x);
  const y = pointsToEmu(frame.y);
  const open = paragraphXml.match(/^<w:p(?:\s[^>]*)?>/);
  if (!open || !paragraphXml.endsWith('</w:p>')) throw new Error('A positioned Word text paragraph could not be reconstructed.');
  let content = paragraphXml.slice(open[0].length, -'</w:p>'.length);
  const pPrMatch = content.match(/<w:pPr(?:\s[^>]*)?>[\s\S]*?<\/w:pPr>/);
  let innerPPr = pPrMatch?.[0] || '<w:pPr><w:spacing w:before="0" w:after="0" w:line="1" w:lineRule="exact"/><w:ind w:left="0" w:right="0"/></w:pPr>';
  if (pPrMatch) content = content.replace(pPrMatch[0], '');
  // The docx library attaches a section's <w:sectPr> (page break + page size) to the last paragraph of that
  // section. If that paragraph becomes a text box, the sectPr would be trapped inside it and Word would merge
  // pages. Keep the section break on the outer, in-flow paragraph instead.
  let sectionBreak = '';
  innerPPr = innerPPr.replace(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/, (match) => { sectionBreak = match; return ''; });
  const textParagraph = `<w:p>${innerPPr}${content}</w:p>`;
  const anchor = `<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="${251658240 + drawingId}" behindDoc="0" locked="1" layoutInCell="1" allowOverlap="1">` +
    '<wp:simplePos x="0" y="0"/>' +
    `<wp:positionH relativeFrom="page"><wp:posOffset>${x}</wp:posOffset></wp:positionH>` +
    `<wp:positionV relativeFrom="page"><wp:posOffset>${y}</wp:posOffset></wp:positionV>` +
    `<wp:extent cx="${width}" cy="${height}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/>` +
    `<wp:docPr id="${100000 + drawingId}" name="PDF Studio Editable Text ${drawingId}" descr="Editable text extracted from the source PDF"/>` +
    '<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>' +
    '<a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:wsp>' +
    '<wps:cNvSpPr txBox="1"/><wps:spPr>' +
    `<a:xfrm><a:off x="0" y="0"/><a:ext cx="${width}" cy="${height}"/></a:xfrm>` +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln>' +
    '</wps:spPr>' +
    `<wps:txbx><w:txbxContent>${textParagraph}</w:txbxContent></wps:txbx>` +
    '<wps:bodyPr wrap="none" lIns="0" tIns="0" rIns="0" bIns="0" anchor="t"><a:noAutofit/></wps:bodyPr>' +
    '</wps:wsp></a:graphicData></a:graphic></wp:anchor>';
  // A 1-twip outer paragraph keeps the anchored textbox from adding a full line of document flow.
  // All editable characters remain inside WordprocessingML paragraphs/runs in the text box.
  return `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="1" w:lineRule="exact"/><w:ind w:left="0" w:right="0"/>${sectionBreak}</w:pPr><w:r><w:drawing>${anchor}</w:drawing></w:r></w:p>`;
}

const PPR_LATER_TAGS = ['widowControl', 'numPr', 'suppressLineNumbers', 'pBdr', 'shd', 'tabs', 'suppressAutoHyphens', 'kinsoku', 'wordWrap', 'overflowPunct', 'topLinePunct', 'autoSpaceDE', 'autoSpaceDN', 'bidi', 'adjustRightInd', 'snapToGrid', 'spacing', 'ind', 'contextualSpacing', 'mirrorIndents', 'suppressOverlap', 'jc', 'textDirection', 'textAlignment', 'textboxTightWrap', 'outlineLvl', 'divId', 'cnfStyle', 'rPr', 'sectPr', 'pPrChange'];

/**
 * Turns one generated paragraph into a page-positioned Word frame (<w:framePr>). A frame is ordinary, editable
 * paragraph text that Word and LibreOffice pin to an exact spot on the page, so it needs no floating-shape carrier
 * paragraph and cannot drift to the page corner or lose its page when many lines share one page.
 */
function wrapParagraphInFrame(paragraphXml, frame) {
  const open = paragraphXml.match(/^<w:p(?:\s[^>]*)?>/);
  if (!open || !paragraphXml.endsWith('</w:p>')) throw new Error('A positioned Word text paragraph could not be reconstructed.');
  let content = paragraphXml.slice(open[0].length, -'</w:p>'.length);
  const pPrMatch = content.match(/<w:pPr(?:\s[^>]*)?>[\s\S]*?<\/w:pPr>/);
  let pPr = pPrMatch?.[0] || '<w:pPr></w:pPr>';
  if (pPrMatch) content = content.replace(pPrMatch[0], '');
  // A section break must stay on an ordinary paragraph, never on a frame.
  let sectionBreak = '';
  pPr = pPr.replace(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/, (match) => { sectionBreak = match; return ''; });
  const framePr = `<w:framePr w:w="${Math.max(20, twips(frame.width))}" w:h="${Math.max(20, twips(frame.height))}" w:hRule="exact" w:wrap="around" w:vAnchor="page" w:hAnchor="page" w:x="${twips(frame.x)}" w:y="${twips(frame.y)}"/>`;
  // framePr has a fixed place in the paragraph-properties sequence: after keepNext/keepLines/pageBreakBefore and before the rest.
  const laterPattern = new RegExp(`<w:(?:${PPR_LATER_TAGS.join('|')})(?=[\\s/>])`);
  const later = pPr.match(laterPattern);
  pPr = later ? pPr.slice(0, later.index) + framePr + pPr.slice(later.index) : pPr.replace('</w:pPr>', `${framePr}</w:pPr>`);
  const framed = `<w:p>${pPr}${content}</w:p>`;
  return sectionBreak ? `${framed}<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="1" w:lineRule="exact"/>${sectionBreak}</w:pPr></w:p>` : framed;
}

function ensureDrawingNamespaces(documentXml) {
  const namespaces = {
    wps: 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape',
    wp: 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
    a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  };
  let xml = documentXml;
  const opening = xml.match(/<w:document\b[^>]*>/)?.[0];
  if (!opening) throw new Error('The generated Word document has no document root.');
  let updated = opening;
  for (const [prefix, uri] of Object.entries(namespaces)) {
    if (!new RegExp(`xmlns:${prefix}=`).test(updated)) updated = updated.replace(/>$/, ` xmlns:${prefix}="${uri}">`);
  }
  return xml.replace(opening, updated);
}

function decodeXml(value) {
  return String(value).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}
function extractWordText(xml) {
  const output = [];
  const pattern = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\s*\/>|<w:(?:br|cr)(?:\s[^>]*)?\s*\/>|<\/w:p>|<\/w:tc>/g;
  for (const match of String(xml).matchAll(pattern)) {
    if (match[1] !== undefined) output.push(decodeXml(match[1]));
    else if (match[0].startsWith('<w:tab')) output.push('\t');
    else if (match[0] === '</w:tc>') output.push('\t');
    else output.push('\n');
  }
  return output.join('');
}
function tokenCoverage(expectedText, actualText) {
  const expected = getWordTokens(expectedText);
  const actualCounts = new Map();
  for (const token of getWordTokens(actualText)) actualCounts.set(token, (actualCounts.get(token) || 0) + 1);
  let matched = 0;
  let missingWords = 0;
  for (const token of expected) {
    const count = actualCounts.get(token) || 0;
    if (count > 0) { matched += 1; actualCounts.set(token, count - 1); }
    else missingWords += 1;
  }
  let extraWords = 0;
  for (const count of actualCounts.values()) extraWords += count;
  return {
    expectedWords: expected.length,
    embeddedWords: getWordTokens(actualText).length,
    matchedWords: matched,
    missingWords,
    extraWords,
    percent: expected.length ? Math.round(matched / expected.length * 1000) / 10 : 100,
  };
}

function readingOrderCoverage(expectedText, actualText) {
  const expected = getWordTokens(expectedText);
  const actual = getWordTokens(actualText);
  if (expected.length < 2) return { expectedTransitions: 0, matchedTransitions: 0, percent: 100 };
  const actualPairs = new Map();
  for (let index = 0; index < actual.length - 1; index += 1) {
    const key = `${actual[index]}\u0000${actual[index + 1]}`;
    actualPairs.set(key, (actualPairs.get(key) || 0) + 1);
  }
  let matchedTransitions = 0;
  for (let index = 0; index < expected.length - 1; index += 1) {
    const key = `${expected[index]}\u0000${expected[index + 1]}`;
    const count = actualPairs.get(key) || 0;
    if (count > 0) { matchedTransitions += 1; actualPairs.set(key, count - 1); }
  }
  const expectedTransitions = expected.length - 1;
  return { expectedTransitions, matchedTransitions, percent: Math.round(matchedTransitions / expectedTransitions * 1000) / 10 };
}

function getEditableReadingOrderText(rows, tables) {
  const tableById = new Map((tables || []).map((table) => [table.id, table]));
  const emittedTables = new Set();
  const chunks = [];
  for (const row of rows || []) {
    const ids = [...new Set(row.items.map((item) => String(item.tableCellKey || '').split(':')[0]).filter(Boolean))];
    for (const id of ids) {
      if (emittedTables.has(id)) continue;
      emittedTables.add(id);
      const table = tableById.get(id);
      if (!table) continue;
      for (const cellRow of table.cells) {
        chunks.push(cellRow.map((cell) => cell.items.filter((item) => !item.keepInArtwork).sort((a, b) => a.baseline - b.baseline || a.x - b.x).map((item) => item.text).join(' ')).join('\t'));
      }
    }
    const normalText = row.items.filter((item) => !item.keepInArtwork && !item.tableCellKey).sort((a, b) => a.x - b.x).map((item) => item.text).join('\t');
    if (normalText) chunks.push(normalText);
  }
  for (const table of tables || []) {
    if (emittedTables.has(table.id)) continue;
    for (const cellRow of table.cells) chunks.push(cellRow.map((cell) => cell.items.filter((item) => !item.keepInArtwork).sort((a, b) => a.baseline - b.baseline || a.x - b.x).map((item) => item.text).join(' ')).join('\t'));
  }
  return chunks.join('\n');
}

function assertXmlWellFormed(xml, label) {
  if (typeof DOMParser !== 'undefined') {
    const parsed = new DOMParser().parseFromString(String(xml), 'application/xml');
    const errors = parsed.getElementsByTagName('parsererror');
    if (errors.length) throw new Error(`${label} is not valid XML: ${String(errors[0].textContent || '').slice(0, 240)}`);
  } else if (!String(xml).trim().startsWith('<?xml') && !String(xml).trim().startsWith('<')) {
    throw new Error(`${label} is empty or malformed XML.`);
  }
}

function getWordTableGridColumnCounts(documentXml) {
  return [...String(documentXml).matchAll(/<w:tblGrid\b[^>]*>([\s\S]*?)<\/w:tblGrid>/g)]
    .map((match) => (match[1].match(/<w:gridCol\b/g) || []).length);
}

function normalizePackagePath(value) {
  const stack = [];
  for (const segment of String(value || '').replace(/\\/g, '/').split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') stack.pop();
    else stack.push(segment);
  }
  return stack.join('/');
}

function parseXmlAttributes(xmlTag) {
  const attributes = {};
  for (const match of String(xmlTag).matchAll(/([A-Za-z_:][\w:.-]*)\s*=\s*(["'])(.*?)\2/g)) attributes[match[1]] = match[3];
  return attributes;
}

async function validateDocxPackageRelationships(zip) {
  let relationshipCount = 0;
  for (const entry of Object.values(zip.files).filter((file) => !file.dir && file.name.endsWith('.rels'))) {
    const xml = await entry.async('string');
    assertXmlWellFormed(xml, entry.name);
    const sourceDirectory = entry.name === '_rels/.rels' ? '' : (entry.name.match(/^(.*)\/_rels\/[^/]+\.rels$/)?.[1] || '');
    const seenIds = new Set();
    for (const match of xml.matchAll(/<Relationship\b[^>]*\/?\s*>/g)) {
      const relationship = parseXmlAttributes(match[0]);
      if (!relationship.Id || !relationship.Target || !relationship.Type) throw new Error(`The Word package contains an incomplete relationship in ${entry.name}.`);
      if (seenIds.has(relationship.Id)) throw new Error(`The Word package contains duplicate relationship ID ${relationship.Id} in ${entry.name}.`);
      seenIds.add(relationship.Id);
      relationshipCount += 1;
      if (relationship.TargetMode === 'External') continue;
      const target = relationship.Target.startsWith('/')
        ? normalizePackagePath(relationship.Target.slice(1))
        : normalizePackagePath([sourceDirectory, relationship.Target].filter(Boolean).join('/'));
      if (!zip.file(target)) throw new Error(`The Word package relationship in ${entry.name} points to missing part ${target}.`);
    }
  }
  return relationshipCount;
}

async function finalizeAndValidateDocx(bytes, frames, expectedText, sourceText = expectedText, expectedReadingOrder = expectedText) {
  const module = await import('jszip');
  const JSZip = module.default || module;
  const zip = await JSZip.loadAsync(bytes, { checkCRC32: true });
  const requiredParts = ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/styles.xml', 'word/_rels/document.xml.rels'];
  const missingParts = requiredParts.filter((file) => !zip.file(file));
  if (missingParts.length) throw new Error(`The generated Word file is missing required DOCX parts: ${missingParts.join(', ')}.`);
  let documentXml = await zip.file('word/document.xml').async('string');
  let insertedFrames = 0;
  for (const frame of frames) {
    const marker = frame.marker;
    const markerIndex = documentXml.indexOf(marker);
    if (markerIndex < 0) throw new Error('A positioned text block could not be verified in the Word file. Please retry the conversion.');
    const beforeMarker = documentXml.slice(0, markerIndex);
    const exactParagraphStart = beforeMarker.lastIndexOf('<w:p>');
    const attributedParagraphStart = beforeMarker.lastIndexOf('<w:p ');
    const paragraphStart = Math.max(exactParagraphStart, attributedParagraphStart);
    const paragraphEndIndex = documentXml.indexOf('</w:p>', markerIndex);
    if (paragraphStart < 0 || paragraphEndIndex < 0) throw new Error('The Word file contains a malformed text paragraph.');
    const paragraphEnd = paragraphEndIndex + '</w:p>'.length;
    let paragraph = documentXml.slice(paragraphStart, paragraphEnd);
    const markerLocalIndex = paragraph.indexOf(marker);
    const markerRuns = [...paragraph.slice(0, markerLocalIndex).matchAll(/<w:r(?=\s|>)[^>]*>/g)];
    const runStart = markerRuns.length ? markerRuns[markerRuns.length - 1].index : -1;
    const runEndIndex = paragraph.indexOf('</w:r>', markerLocalIndex);
    if (runStart >= 0 && runEndIndex >= 0) paragraph = paragraph.slice(0, runStart) + paragraph.slice(runEndIndex + '</w:r>'.length);
    const framedParagraph = wrapParagraphInFrame(paragraph, frame);
    documentXml = documentXml.slice(0, paragraphStart) + framedParagraph + documentXml.slice(paragraphEnd);
    insertedFrames += 1;
  }
  documentXml = ensureDrawingNamespaces(documentXml);
  zip.file('word/document.xml', documentXml);
  // Guard against the exact failure seen in form-heavy PDFs: a false-positive detector can emit a
  // table with well over a hundred grid columns. The adaptive layout path should prevent this; this
  // final safety net refuses to ship a DOCX with an oversized generated table grid to Microsoft Word.
  const tableGridColumnCounts = getWordTableGridColumnCounts(documentXml);
  const maxTableGridColumns = Math.max(0, ...tableGridColumnCounts);
  if (maxTableGridColumns > 64) {
    throw new Error(`The generated Word document contains an unsafe table grid (${maxTableGridColumns} columns). The converter should preserve this page's layout instead of emitting a giant table; please retry with the latest PDF Studio build.`);
  }
  const textAfterPatch = extractWordText(documentXml);
  const coverage = tokenCoverage(expectedText, textAfterPatch);
  const sourceCoverage = tokenCoverage(sourceText, textAfterPatch);
  const orderCoverage = readingOrderCoverage(expectedReadingOrder, textAfterPatch);
  // Validate every XML/relationship part in the package, not just a short required-part list.
  // Also verify internal relationship targets and content-type overrides, so a DOCX is not offered
  // for download if it would ask Word to open a missing XML, image, style or header/footer part.
  for (const entry of Object.values(zip.files).filter((file) => !file.dir && /\.(?:xml|rels)$/i.test(file.name))) {
    const xmlPart = await entry.async('string');
    assertXmlWellFormed(xmlPart, entry.name);
  }
  const relationshipCount = await validateDocxPackageRelationships(zip);
  const contentTypesXml = await zip.file('[Content_Types].xml').async('string');
  for (const match of contentTypesXml.matchAll(/<Override\b[^>]*\/>/g)) {
    const attributes = parseXmlAttributes(match[0]);
    const target = String(attributes.PartName || '').replace(/^\//, '');
    if (!target || !zip.file(target)) throw new Error(`The Word package declares a content type for missing part ${target || '(empty target)'}.`);
  }
  if (frames.length && insertedFrames !== frames.length) throw new Error('Not all editable text blocks were placed in the Word document.');
  if (!/<w:document\b/.test(documentXml) || !/<w:body\b/.test(documentXml) || !/<\/w:document>/.test(documentXml)) throw new Error('The Word document XML failed structural validation.');
  const relsXml = await zip.file('word/_rels/document.xml.rels').async('string');
  const relationshipIds = new Set([...relsXml.matchAll(/\bId="([^"]+)"/g)].map((match) => match[1]));
  const referencedIds = [...documentXml.matchAll(/\b(?:r:id|r:embed|r:link)="([^"]+)"/g)].map((match) => match[1]);
  const danglingRelationships = referencedIds.filter((id) => !relationshipIds.has(id));
  if (danglingRelationships.length) throw new Error(`The Word file has missing image or hyperlink relationships (${danglingRelationships.length}).`);
  // Report actual native object counts from the finished DOCX package, not only detector estimates.
  // This helps catch regressions where detected tables or pictures were never written into Word.
  const nativeWordTables = (documentXml.match(/<w:tbl(?=\s|>)/g) || []).length;
  const embeddedImageReferences = (documentXml.match(/\br:embed="[^"]+"/g) || []).length;
  const embeddedMediaFiles = Object.values(zip.files).filter((file) => !file.dir && file.name.startsWith('word/media/')).length;
  const finalBytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  // Re-open the written package after serialization to catch corrupted ZIP records before offering it to the user.
  const roundTrip = await JSZip.loadAsync(finalBytes, { checkCRC32: true });
  if (!roundTrip.file('word/document.xml') || !roundTrip.file('[Content_Types].xml')) throw new Error('The saved Word document failed its final package check.');
  return {
    bytes: finalBytes,
    validation: {
      validPackage: true,
      roundTripZipValid: true,
      requiredPartsPresent: true,
      xmlPartsWellFormed: true,
      relationshipsValidated: true,
      relationshipCount,
      maxTableGridColumns,
      nativeWordTables,
      embeddedImageReferences,
      embeddedMediaFiles,
      positionedTextFrames: insertedFrames,
      editableTextCoverage: coverage,
      sourceTextCoverage: sourceCoverage,
      readingOrderCoverage: orderCoverage,
      warning: coverage.percent < 98 ? 'Some text selected for editing was not found in the generated Word layer.' : '',
      sourceCoverageWarning: sourceCoverage.percent < 98 ? 'Some extracted source text remains only in the visual page artwork or was not confidently reconstructed.' : '',
    },
  };
}

function detectRepeatedHeadersFooters(pageReports) {
  if (pageReports.length < 2) return { headerCandidates: 0, footerCandidates: 0 };
  const headers = new Map();
  const footers = new Map();
  for (const page of pageReports) {
    for (const row of page.rows) {
      const signature = normalizeForMatch(row.semanticText);
      if (signature.length < 2) continue;
      if (row.top <= page.height * 0.12) headers.set(signature, (headers.get(signature) || 0) + 1);
      if (row.bottom >= page.height * 0.88) footers.set(signature, (footers.get(signature) || 0) + 1);
    }
  }
  const required = Math.max(2, Math.ceil(pageReports.length * 0.5));
  return {
    headerCandidates: [...headers.values()].filter((count) => count >= required).length,
    footerCandidates: [...footers.values()].filter((count) => count >= required).length,
  };
}

function countOperatorFeatures(operatorList, pdfjsLib) {
  const names = new Map(Object.entries(pdfjsLib.OPS || {}).map(([name, id]) => [id, name]));
  const features = { imageObjects: 0, vectorOperations: 0, textOperations: 0, paths: 0 };
  for (const fn of operatorList?.fnArray || []) {
    const name = names.get(fn) || '';
    if (/paint.*(?:Image|Mask)|paintJpegXObject/i.test(name)) features.imageObjects += 1;
    if (/stroke|fill|eoFill|constructPath|setLineWidth|setStrokeRGBColor|setFillRGBColor/i.test(name)) features.vectorOperations += 1;
    if (/showText|showSpacedText|nextLineShowText|nextLineSetSpacingShowText/i.test(name)) features.textOperations += 1;
    if (/constructPath/i.test(name)) features.paths += 1;
  }
  return features;
}

function summarizePageForPreflight(content, viewport, pageIndex) {
  const textItems = (content?.items || []).filter((item) => typeof item?.str === 'string' && item.str.trim());
  const text = textItems.map((item) => item.str).join(' ');
  return {
    page: pageIndex,
    width: Number(viewport?.width) || 0,
    height: Number(viewport?.height) || 0,
    nativeTextSpans: textItems.length,
    nativeTextCharacters: text.replace(/\s+/g, '').length,
    hasNativeText: textItems.length > 0,
  };
}

/**
 * Chooses the safest default conversion strategy for an individual page.
 * PDFs made from forms, reports, screenshots, signatures or many vector rules are very
 * sensitive to Word's reflow. For those pages we retain the original text-free artwork and
 * place extracted text at the PDF coordinates. Only simple text-first pages use normal-flow
 * Word paragraphs by default. An explicit user-selected mode always takes precedence.
 */
function chooseAutoPageMode({ requestedMode = 'auto', nativeTextSpans = 0, nativeTextCharacters = 0, operatorFeatures = {}, preflightPage = {} } = {}) {
  const supportedModes = ['auto', 'editable', 'layout', 'visual'];
  const chosen = supportedModes.includes(requestedMode) ? requestedMode : 'auto';
  if (chosen !== 'auto') return chosen;

  const spans = Math.max(0, Number(nativeTextSpans ?? preflightPage.nativeTextSpans) || 0);
  const characters = Math.max(0, Number(nativeTextCharacters ?? preflightPage.nativeTextCharacters) || 0);
  const images = Math.max(0, Number(operatorFeatures.imageObjects) || 0);
  const paths = Math.max(0, Number(operatorFeatures.paths) || 0);
  const vectors = Math.max(0, Number(operatorFeatures.vectorOperations) || 0);

  // These are strong signs that normal-flow reconstruction could move labels, signatures,
  // photos, page headers or cell contents away from their original positions.
  if (spans === 0 || images > 0 || paths >= 8 || vectors >= 90 || spans >= 48 || characters >= 650) return 'layout';
  return 'editable';
}

/** OCR is safest on scan-only (or effectively textless) pages. Running full-page OCR merely
 * because a page contains a screenshot can mistake UI text inside that screenshot for document
 * text, mask it out of the background artwork, and damage the screenshot. */
function shouldRunPageOcr({ enabled = true, engineUnavailable = false, nativeTextSpans = 0, nativeTextCharacters = 0 } = {}) {
  if (!enabled || engineUnavailable) return false;
  return Math.max(0, Number(nativeTextSpans) || 0) === 0 || Math.max(0, Number(nativeTextCharacters) || 0) < 24;
}

/**
 * Hybrid PDF → DOCX conversion. Conversion is deliberately split into a document-wide preflight
 * analysis and a reconstruction pass. The preflight reads page geometry and native text before Word
 * elements are emitted; the reconstruction pass then selects semantic tables/paragraphs where safe
 * and preserves original page artwork with editable text frames for unusually dense form grids.
 * OCR uses an optional local Tesseract installation. This is a local approximation, not Acrobat's
 * proprietary conversion engine.
 */
export async function pdfToDocx(pdfBytes, pdfSource, options = {}) {
  const docxApi = await import('docx');
  const { Document, Paragraph, TextRun, ImageRun, Table, TableRow, TableCell, Packer } = docxApi;
  const pdfjsLib = await getPdfJsLib();
  const pdf = pdfSource || await loadPdfSource(pdfBytes, options.password);
  const mode = ['auto', 'editable', 'layout', 'visual'].includes(options.mode) ? options.mode : 'auto';
  // Auto is the default: use fixed-position text over clean page artwork for complex pages, and
  // normal-flow paragraphs/tables only when the page looks safe to reflow in Word.
  const ocrEnabled = mode !== 'visual' && options.ocrEnabled !== false;
  const ocrLanguage = String(options.ocrLanguage || 'eng');
  const sections = [];
  const pageReports = [];
  const allExpectedText = [];
  const allSourceText = [];
  const allExpectedReadingOrder = [];
  const frameDescriptors = [];
  let textItems = 0;
  let ocrWords = 0;
  let rejectedOcrDuplicates = 0;
  let pagesWithoutText = 0;
  let pagesWithPartialText = 0;
  let pagesWithColumns = 0;
  let tablesReconstructed = 0;
  let imageObjectsDetected = 0;
  let vectorOperationsDetected = 0;
  let ocrEngineUnavailable = false;
  const warnings = [];
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
  // Declared outside the try block: the summary is built during pass 1 but is also returned in the
  // final result and quality report, which are assembled after the try/finally has closed.
  let preflightSummary = { pages: 0, pagesWithNativeText: 0, pagesLikelyScanned: 0, nativeTextSpans: 0, nativeTextCharacters: 0 };

  try {
    // Pass 1: read the complete document's page sizes and native text layer before constructing any
    // Word sections. The second pass uses the resulting document profile to report progress and then
    // performs detailed font/vector analysis, image extraction, table detection and DOCX generation.
    const preflightPages = [];
    for (let pageIndex = 1; pageIndex <= pdf.numPages; pageIndex += 1) {
      onProgress({ page: pageIndex, pages: pdf.numPages, phase: 'analysis', profile: `Analyzing source page ${pageIndex} of ${pdf.numPages}` });
      const page = await pdf.getPage(pageIndex);
      try {
        const viewport = page.getViewport({ scale: 1 });
        const content = await page.getTextContent({ includeMarkedContent: true, disableNormalization: true });
        preflightPages.push(summarizePageForPreflight(content, viewport, pageIndex));
      } finally {
        page.cleanup?.();
      }
    }
    preflightSummary = {
      pages: preflightPages.length,
      pagesWithNativeText: preflightPages.filter((page) => page.hasNativeText).length,
      pagesLikelyScanned: preflightPages.filter((page) => !page.hasNativeText).length,
      nativeTextSpans: preflightPages.reduce((sum, page) => sum + page.nativeTextSpans, 0),
      nativeTextCharacters: preflightPages.reduce((sum, page) => sum + page.nativeTextCharacters, 0),
    };
    onProgress({ page: pdf.numPages, pages: pdf.numPages, phase: 'analysis-complete', profile: 'PDF analysis complete; preparing Word reconstruction' });

    // Pass 2: each page is rebuilt using the preflight profile above. Operator-list loading precedes
    // styled text extraction so PDF.js has loaded the embedded fonts before bold/italic are inferred.
    for (let pageIndex = 1; pageIndex <= pdf.numPages; pageIndex += 1) {
      onProgress({ page: pageIndex, pages: pdf.numPages, phase: 'extracting', profile: `Reconstructing analyzed page ${pageIndex} of ${pdf.numPages}` });
      const page = await pdf.getPage(pageIndex);
      const viewport = page.getViewport({ scale: 1 });
      let operatorList = null;
      let operatorFeatures = { imageObjects: 0, vectorOperations: 0, textOperations: 0, paths: 0 };
      try {
        operatorList = await page.getOperatorList({ intent: 'print' });
        operatorFeatures = countOperatorFeatures(operatorList, pdfjsLib);
      } catch (error) {
        warnings.push(`Page ${pageIndex}: graphical objects could not be analyzed (${String(error?.message || error).slice(0, 120)}).`);
      }
      const content = await page.getTextContent({ includeMarkedContent: true, disableNormalization: true });
      const normalizedItems = [];
      let rawTextSpanCount = 0;
      for (const item of content.items || []) {
        if (typeof item.str !== 'string' || !item.str.trim()) continue;
        rawTextSpanCount += 1;
        const style = content.styles?.[item.fontName] || {};
        const textMetadata = getTextMetadata(page, item, style);
        normalizedItems.push({ ...item, textMetadata, fontFamily: textMetadata.fontFamily, fontWeight: textMetadata.fontWeight, italic: textMetadata.italic });
      }
      textItems += rawTextSpanCount;
      imageObjectsDetected += operatorFeatures.imageObjects;
      vectorOperationsDetected += operatorFeatures.vectorOperations;
      const nativeCharacterCount = normalizedItems.reduce((sum, item) => sum + item.str.length, 0);
      const preflightPage = preflightPages[pageIndex - 1] || {};
      const pageMode = chooseAutoPageMode({
        requestedMode: mode,
        nativeTextSpans: rawTextSpanCount,
        nativeTextCharacters: nativeCharacterCount,
        operatorFeatures,
        preflightPage,
      });
      const shouldOcr = shouldRunPageOcr({
        enabled: ocrEnabled,
        engineUnavailable: ocrEngineUnavailable,
        nativeTextSpans: rawTextSpanCount,
        nativeTextCharacters: nativeCharacterCount,
      });
      const maxDimension = Number.isFinite(options.maxImageDimension)
        ? clamp(options.maxImageDimension, 1400, 3600)
        : (pageMode === 'visual' ? 3600 : pageMode === 'layout' ? 3300 : 2800);
      // PNG keeps thin form rules, small logos, signatures and screenshot UI text crisp in fidelity-first paths.
      const pageImageType = ['visual', 'layout'].includes(pageMode) ? 'png' : 'jpg';
      const imageRegionCandidates = pageMode !== 'visual' ? collectPageImageRegions(operatorList, viewport, pdfjsLib) : [];
      const semanticImageRegions = pageMode !== 'visual'
        ? filterSemanticImageRegions(imageRegionCandidates, viewport, normalizedItems, pdfjsLib)
        : [];
      const backdrop = await renderPageBackdrop(page, viewport, normalizedItems, {
        editable: pageMode !== 'visual', maxDimension, imageType: pageImageType,
        onProgress, pageIndex, pages: pdf.numPages, pdfjsLib, ocrEnabled, ocrLanguage, shouldOcr,
        // Analyze tables/images for every editable strategy, including layout-preserving pages. Layout mode
        // still uses a positioned artwork layer for complex vector decoration, but recognized tables become
        // native floating Word tables and placed image objects are emitted separately after their art regions
        // are removed from the backdrop.
        detectTables: pageMode !== 'visual' && (normalizedItems.length >= 4 || (shouldOcr && ocrEnabled)),
        semanticTables: pageMode !== 'visual', imageRegions: semanticImageRegions,
        maskEditableRegions: pageMode !== 'visual',
        captureOriginalImage: pageMode === 'editable' && normalizedItems.length === 0,
      });
      const detectedTableCandidates = backdrop.tables.length;
      const adaptiveLayoutFallback = pageMode !== 'visual' && needsLayoutPreservingFallback(backdrop.tables, viewport.width);
      if (adaptiveLayoutFallback) {
        const denseProfiles = backdrop.tables.map((table) => tableComplexityProfile(table, viewport.width)).filter((profile) => profile.suspicious);
        // Do not let independent short box dividers become hundreds of columns in one giant Word table.
        // The text spans remain editable, while the clean text-free PDF artwork supplies the original
        // rules, logos, checkbox boxes and page geometry. This is safer and materially closer to Acrobat
        // for official forms than a falsely reconstructed table grid.
        for (const row of backdrop.rows) for (const item of row.items || []) item.tableCellKey = '';
        for (const table of backdrop.tables) for (const row of table.cells || []) for (const cell of row || []) {
          for (const item of cell.items || []) item.tableCellKey = '';
        }
        backdrop.tables = [];
        for (const image of backdrop.imageRegions || []) {
          image.tableId = '';
          delete image.cellRow;
          delete image.cellCol;
        }
        const widestGrid = Math.max(0, ...denseProfiles.map((profile) => profile.columns));
        warnings.push(`Page ${pageIndex} contained an ambiguous form grid (${widestGrid} inferred columns); used a layout-preserving page-artwork and editable-text reconstruction instead of generating a fragile Word table.`);
        onProgress({ page: pageIndex, pages: pdf.numPages, phase: 'analysis', profile: `Complex form grid detected on page ${pageIndex}; preserving layout with editable text` });
      }
      ocrWords += backdrop.ocr.words.length;
      allSourceText.push(backdrop.sourceText || '');
      rejectedOcrDuplicates += backdrop.rejectedOcrDuplicates;
      if (backdrop.ocr.attempted && !backdrop.ocr.available) {
        ocrEngineUnavailable = true;
        // Pages that already have a real text layer do not need OCR, so a missing OCR engine is only worth a warning
        // when the page has no readable text at all.
        if (!rawTextSpanCount && backdrop.ocr.warning && !warnings.includes(backdrop.ocr.warning)) warnings.push(backdrop.ocr.warning);
      } else if (!rawTextSpanCount && backdrop.ocr.warning && !warnings.includes(backdrop.ocr.warning)) warnings.push(backdrop.ocr.warning);
      if (backdrop.columnSeparator != null) pagesWithColumns += 1;
      tablesReconstructed += backdrop.tables.length;

      const outputScale = Math.min(1, 1584 / Math.max(1, viewport.width), 1584 / Math.max(1, viewport.height));
      const children = [];
      const bodyRows = backdrop.rows.filter((row) => row.items.some((item) => !item.keepInArtwork && !item.tableCellKey));
      const editableText = bodyRows.map((row) => {
        const layout = makeEditableLayout(row, viewport.width, outputScale, { excludeTableItems: true });
        return layout.items.map((item) => item.text).join('\t');
      }).join('\n');
      const tableText = backdrop.tables.flatMap((table) => table.cells.flatMap((cellRow) => cellRow.flatMap((cell) => cell.items.filter((item) => !item.keepInArtwork).map((item) => item.text)))).join('\t');
      const scanOnlyPage = pageMode === 'editable' && normalizedItems.length === 0 && Boolean(backdrop.originalBytes);
      const scanOcrOverlayFallback = scanOnlyPage && backdrop.editableSpans > 0;
      const semanticScanFallback = scanOnlyPage && !scanOcrOverlayFallback;
      allExpectedText.push(semanticScanFallback ? '' : editableText, semanticScanFallback ? '' : tableText);
      allExpectedReadingOrder.push(semanticScanFallback ? '' : getEditableReadingOrderText(backdrop.rows, backdrop.tables));

      let sectionFooters;
      let footerDistance = 14;
      let useZeroMargins = pageMode !== 'editable' || semanticScanFallback || adaptiveLayoutFallback;
      if (pageMode === 'visual') {
        const pageImageRun = makePageImageRun(backdrop, viewport, ImageRun, outputScale);
        children.push(new Paragraph({ children: [pageImageRun], spacing: { before: 0, after: 0, line: 1, lineRule: 'exact' }, widowControl: false }));
      } else if (pageMode === 'layout' || adaptiveLayoutFallback) {
        // Layout-preserving reconstruction: retain the text-free page artwork and pin supported text lines
        // to their source coordinates. Dense/ambiguous form grids automatically take this branch even
        // when the user selected editable mode, keeping the document readable and the text selectable.
        const pageImageRun = makePageImageRun(backdrop, viewport, ImageRun, outputScale);
        children.push(new Paragraph({ children: [pageImageRun], spacing: { before: 0, after: 0, line: 1, lineRule: 'exact' }, widowControl: false }));
        const emittedTables = new Set();
        for (const row of backdrop.rows) {
          const rowTableIds = [...new Set(row.items.map((item) => String(item.tableCellKey || '').split(':')[0]).filter(Boolean))];
          for (const tableId of rowTableIds) {
            if (emittedTables.has(tableId)) continue;
            const table = backdrop.tables.find((candidate) => candidate.id === tableId);
            if (table) { children.push(buildNativeTable(table, docxApi, outputScale, { visibleBorders: true, includeImages: true })); emittedTables.add(tableId); }
          }
          if (!bodyRows.includes(row)) continue;
          const layout = makeEditableLayout(row, viewport.width, outputScale, { excludeTableItems: true });
          if (!layout.items.length) continue;
          const marker = `${MARKER_PREFIX}${pageIndex.toString().padStart(4, '0')}${frameDescriptors.length.toString().padStart(7, '0')}END`;
          const runs = [makeMarkerRun(marker, TextRun)];
          for (const run of layout.runs) runs.push(run.isTab ? new TextRun({ text: '\t', preserve: true }) : makeRun(run, TextRun, outputScale));
          children.push(new Paragraph({
            children: runs,
            tabStops: layout.tabStops,
            spacing: { before: 0, after: 0, line: Math.max(40, twips(row.lineHeight * outputScale)), lineRule: 'exact' },
            indent: { left: 0, right: 0, firstLine: 0 },
            keepLines: true,
            widowControl: false,
          }));
          frameDescriptors.push({
            marker,
            page: pageIndex,
            x: Math.max(0, row.minX * outputScale),
            y: Math.max(0, row.top * outputScale),
            width: Math.max(12, Math.min((viewport.width - row.minX) * outputScale, ((row.maxX - row.minX) * 1.12 + row.maxFontSize * 4) * outputScale)),
            height: Math.max(6, row.lineHeight * 1.45 * outputScale),
          });
        }
        for (const table of backdrop.tables) if (!emittedTables.has(table.id)) children.push(buildNativeTable(table, docxApi, outputScale, { visibleBorders: true, includeImages: true }));
        // Images outside recognized tables are real Word image objects with their own page coordinates,
        // not a flattened part of the full-page artwork. Images within tables are inserted in their native cells.
        for (const image of backdrop.imageRegions || []) {
          if (image.tableId) continue;
          children.push(makePlacedImageParagraph(image, docxApi, outputScale));
        }
        useZeroMargins = true;
        if (adaptiveLayoutFallback) warnings.push(`Page ${pageIndex} used automatic layout preservation because its detected grid was too dense for a reliable native Word table.`);
        if (!bodyRows.length && !backdrop.tables.length && backdrop.ocr.warning) warnings.push(`Page ${pageIndex}: ${backdrop.ocr.warning}`);
      } else if (scanOcrOverlayFallback) {
        // A scan-only page with successful OCR keeps its page artwork (with safe text areas masked) and places
        // OCR-recognized lines in editable page-positioned Word frames. This avoids throwing away the scan's rules,
        // photos, and logos while still making the recognized text selectable/editable.
        const pageImageRun = makePageImageRun(backdrop, viewport, ImageRun, outputScale);
        children.push(new Paragraph({ children: [pageImageRun], spacing: { before: 0, after: 0, line: 1, lineRule: 'exact' }, widowControl: false }));
        for (const row of backdrop.rows) {
          const layout = makeEditableLayout(row, viewport.width, outputScale, { excludeTableItems: false });
          if (!layout.items.length) continue;
          const marker = `${MARKER_PREFIX}${pageIndex.toString().padStart(4, '0')}${frameDescriptors.length.toString().padStart(7, '0')}END`;
          const runs = [makeMarkerRun(marker, TextRun)];
          for (const run of layout.runs) runs.push(run.isTab ? new TextRun({ text: '\t', preserve: true }) : makeRun(run, TextRun, outputScale));
          children.push(new Paragraph({
            children: runs,
            tabStops: layout.tabStops,
            spacing: { before: 0, after: 0, line: Math.max(40, twips(row.lineHeight * outputScale)), lineRule: 'exact' },
            indent: { left: 0, right: 0, firstLine: 0 },
            keepLines: true,
            widowControl: false,
          }));
          frameDescriptors.push({
            marker,
            page: pageIndex,
            x: Math.max(0, row.minX * outputScale),
            y: Math.max(0, row.top * outputScale),
            width: Math.max(12, Math.min((viewport.width - row.minX) * outputScale, ((row.maxX - row.minX) * 1.12 + row.maxFontSize * 4) * outputScale)),
            height: Math.max(6, row.lineHeight * 1.45 * outputScale),
          });
        }
        useZeroMargins = true;
        warnings.push(`Page ${pageIndex} is scan-only. OCR text was placed in editable text frames over the preserved page artwork; verify OCR spelling and positioning.`);
      } else if (semanticScanFallback) {
        // When OCR is unavailable or could not recognize usable text, retain the original scan intact rather than
        // creating a blank/garbled Word page. Successful OCR pages take the editable-frame branch above.
        const pageImageRun = makePageImageRun({ ...backdrop, bytes: backdrop.originalBytes, type: backdrop.type }, viewport, ImageRun, outputScale);
        children.push(new Paragraph({ children: [pageImageRun], spacing: { before: 0, after: 0, line: 1, lineRule: 'exact' }, widowControl: false }));
        warnings.push(`Page ${pageIndex} is scan-only and was retained as a page image because OCR produced no usable editable text. Install the supported OCR language data or use the Visual Replica mode for scan-first documents.`);
      } else {
        // Normal Word structure: page artwork is not used as a full-page background. Text flows as
        // paragraphs and real tables, while detected PDF image objects are inserted as separate images.
        const margins = { top: 18, right: 24, bottom: 30, left: 24, header: 8, footer: 14 };
        const flow = buildFlowPageContent(backdrop, docxApi, outputScale, viewport.width, viewport.height, margins);
        children.push(...flow.children);
        if (flow.footerText && flow.footerBottom) footerDistance = clamp((viewport.height - flow.footerBottom) * outputScale - 2, 8, 120);
        if (flow.footerText && docxApi.Footer) {
          sectionFooters = {
            default: new docxApi.Footer({
              children: [new Paragraph({
                children: [new TextRun({
                  ...(flow.footerText === String(pageIndex) && docxApi.PageNumber ? { children: [docxApi.PageNumber.CURRENT] } : { text: flow.footerText }),
                  font: flow.footerItem?.wordFont || 'Times New Roman',
                  size: Math.max(12, Math.round((flow.footerItem?.fontSize || 10) * outputScale * 2)),
                })],
                alignment: 'center',
                spacing: { before: 0, after: 0 },
              })],
            }),
          };
        }
        if (!children.length) {
          if (backdrop.originalBytes) {
            const fallbackRun = makePageImageRun({ ...backdrop, bytes: backdrop.originalBytes }, viewport, ImageRun, outputScale);
            children.push(new Paragraph({ children: [fallbackRun], spacing: { before: 0, after: 0, line: 1, lineRule: 'exact' }, widowControl: false }));
            useZeroMargins = true;
            warnings.push(`Page ${pageIndex} had no safe text blocks and was retained as page artwork.`);
          } else children.push(new Paragraph({ children: [], spacing: { before: 0, after: 0 } }));
        }
      }

      const visibleNativeItems = normalizedItems.length;
      const visibleEditableSpans = backdrop.editableSpans;
      if (!visibleNativeItems && !backdrop.ocr.words.length) pagesWithoutText += 1;
      if (backdrop.unsupportedSpans > 0 || (shouldOcr && !backdrop.ocr.available && !visibleNativeItems)) pagesWithPartialText += 1;
      const pageReport = {
        page: pageIndex,
        conversionStrategy: pageMode,
        width: viewport.width,
        height: viewport.height,
        nativeTextSpans: visibleNativeItems,
        mergedTextSpans: backdrop.mergedTextSpans,
        editableTextSpans: visibleEditableSpans,
        unsupportedTextSpans: backdrop.unsupportedSpans,
        ocrWords: backdrop.ocr.words.length,
        ocrConfidence: backdrop.ocr.confidence || 0,
        imageObjects: operatorFeatures.imageObjects,
        separateImageAssets: backdrop.imageRegions?.length || 0,
        vectorOperations: operatorFeatures.vectorOperations,
        tableCandidates: detectedTableCandidates,
        adaptiveLayoutFallback,
        paragraphCandidates: backdrop.rows.filter((row) => row.paragraphStart).length,
        listCandidates: backdrop.rows.filter((row) => row.listType && row.listType !== 'none').length,
        columnsDetected: backdrop.columnSeparator != null,
        visualSimilarity: backdrop.visualSimilarity,
        rows: backdrop.rows,
      };
      pageReports.push(pageReport);
      // Keep section properties outside a table or floating text frame; the closing paragraph also
      // protects page breaks between source PDF pages when a Word table ends the page.
      children.push(new Paragraph({ children: [], spacing: { before: 0, after: 0, line: 1, lineRule: 'exact' }, widowControl: false }));
      const pageMargins = useZeroMargins
        ? { top: 0, right: 0, bottom: 0, left: 0, header: 0, footer: 0, gutter: 0 }
        : { top: twips(18), right: twips(24), bottom: twips(30), left: twips(24), header: twips(8), footer: twips(footerDistance), gutter: 0 };
      sections.push({
        properties: {
          ...(docxApi.SectionType?.NEXT_PAGE ? { type: docxApi.SectionType.NEXT_PAGE } : {}),
          page: {
            size: { width: Math.round(clamp(viewport.width * outputScale, 72, 1584) * 20), height: Math.round(clamp(viewport.height * outputScale, 72, 1584) * 20) },
            margin: pageMargins,
          },
        },
        ...(sectionFooters ? { footers: sectionFooters } : {}),
        children,
      });
      onProgress({ phase: 'verified-page', page: pageIndex, pages: pdf.numPages, profile: `Extracted ${visibleNativeItems} spans; ${backdrop.ocr.words.length} OCR words; ${backdrop.tables.length} tables` });
      page.cleanup?.();
    }
  } finally {
    if (!pdfSource) await pdf.destroy?.();
  }

  if (!sections.length) throw new Error('The PDF did not contain any pages to convert.');
  const repeatedRegions = detectRepeatedHeadersFooters(pageReports);
  const document = new Document({
    creator: 'PDF Studio',
    title: 'Converted from PDF',
    subject: 'PDF to Word conversion',
    description: mode === 'visual'
      ? 'Visual replica exported by PDF Studio. Page contents are represented as high-resolution page images.'
      : mode === 'layout'
        ? 'Layout-preserving conversion by PDF Studio. Page artwork remains in place and recognized text is reconstructed as editable positioned Word content.'
        : mode === 'auto'
          ? 'Automatic hybrid PDF-to-Word conversion by PDF Studio. Each page is analyzed before reconstruction; complex layouts preserve page artwork with editable text, while simpler text-first pages use normal Word paragraphs and tables.'
          : 'Editable Word conversion by PDF Studio. Text is reconstructed as normal Word paragraphs and native tables where ruled table structure can be inferred. Dense form grids automatically use a layout-preserving page-artwork layer with editable positioned text. Detected raster images are inserted as separate image assets.',
    sections,
  });
  const layoutPageCount = pageReports.filter((report) => report.conversionStrategy === 'layout' || report.adaptiveLayoutFallback).length;
  const editablePageCount = pageReports.filter((report) => report.conversionStrategy === 'editable').length;
  const buildProfile = mode === 'auto'
    ? `Building adaptive DOCX (${layoutPageCount} layout-preserving page${layoutPageCount === 1 ? '' : 's'}, ${editablePageCount} reflowable page${editablePageCount === 1 ? '' : 's'})`
    : mode === 'editable'
      ? 'Building Word paragraphs and native tables'
      : mode === 'layout'
        ? 'Building the layout-preserving Word document'
        : 'Building high-resolution visual-replica pages';
  onProgress({ page: pdf.numPages, pages: pdf.numPages, phase: 'building', profile: buildProfile });
  const blob = await Packer.toBlob(document);
  const rawBytes = new Uint8Array(await blob.arrayBuffer());
  const expectedText = mode === 'visual' ? '' : allExpectedText.join('\n');
  let packaged;
  try {
    packaged = await finalizeAndValidateDocx(rawBytes, frameDescriptors, expectedText, mode === 'visual' ? '' : allSourceText.join('\n'), mode === 'visual' ? '' : allExpectedReadingOrder.join('\n'));
  } catch (error) {
    // A final package-level guard protects Word against rare grids missed by page detection.
    // Retry once using fixed-position layout mode, which does not build semantic tables from a page.
    if (mode !== 'visual' && !options._safeLayoutRetry && /unsafe table grid|oversized generated table grid/i.test(String(error?.message || error))) {
      onProgress({ phase: 'analysis', page: pdf.numPages, pages: pdf.numPages, profile: 'An unsafe table grid was caught; retrying with layout-preserving reconstruction' });
      return pdfToDocx(pdfBytes, pdfSource, { ...options, mode: 'layout', _safeLayoutRetry: true });
    }
    throw error;
  }
  const totalNativeSpans = pageReports.reduce((sum, report) => sum + report.nativeTextSpans, 0);
  const totalMergedSpans = pageReports.reduce((sum, report) => sum + report.mergedTextSpans, 0);
  const totalEditableSpans = pageReports.reduce((sum, report) => sum + report.editableTextSpans, 0);
  const totalUnsupportedSpans = pageReports.reduce((sum, report) => sum + report.unsupportedTextSpans, 0);
  const similarityScores = pageReports.map((report) => report.visualSimilarity).filter((score) => Number.isFinite(score));
  const quality = {
    mode,
    preflight: preflightSummary,
    adaptiveLayoutFallbackPages: pageReports.filter((report) => report.adaptiveLayoutFallback).map((report) => report.page),
    automaticLayoutPages: pageReports.filter((report) => report.conversionStrategy === 'layout' || report.adaptiveLayoutFallback).map((report) => report.page),
    automaticEditablePages: pageReports.filter((report) => report.conversionStrategy === 'editable').map((report) => report.page),
    pageStrategies: pageReports.map(({ page, conversionStrategy, imageObjects, vectorOperations, tableCandidates, adaptiveLayoutFallback }) => ({ page, conversionStrategy, imageObjects, vectorOperations, tableCandidates, adaptiveLayoutFallback })),
    validDocxPackage: packaged.validation.validPackage,
    editableTextCoveragePercent: packaged.validation.editableTextCoverage.percent,
    sourceTextCoveragePercent: packaged.validation.sourceTextCoverage.percent,
    readingOrderContinuityPercent: packaged.validation.readingOrderCoverage.percent,
    missingEditableWords: packaged.validation.editableTextCoverage.missingWords,
    extraEditableWords: packaged.validation.editableTextCoverage.extraWords,
    missingSourceWords: packaged.validation.sourceTextCoverage.missingWords,
    extraSourceWords: packaged.validation.sourceTextCoverage.extraWords,
    nativeTextSpans: totalNativeSpans,
    mergedTextSpans: totalMergedSpans,
    editableTextSpans: totalEditableSpans,
    unsupportedTextSpans: totalUnsupportedSpans,
    ocrEnabled,
    ocrLanguage,
    ocrWords,
    rejectedOcrDuplicates,
    ocrEngineUnavailable,
    tablesReconstructed,
    paragraphCandidates: pageReports.reduce((sum, report) => sum + report.paragraphCandidates, 0),
    listCandidates: pageReports.reduce((sum, report) => sum + report.listCandidates, 0),
    pagesWithColumns,
    imageObjectsDetectedFromPdf: imageObjectsDetected,
    separateWordImageAssets: pageReports.reduce((sum, report) => sum + (report.separateImageAssets || 0), 0),
    nativeWordTablesVerified: packaged.validation.nativeWordTables,
    embeddedImageReferencesVerified: packaged.validation.embeddedImageReferences,
    embeddedMediaFilesVerified: packaged.validation.embeddedMediaFiles,
    vectorOperationsRetainedInArtwork: vectorOperationsDetected,
    repeatedHeadersDetected: repeatedRegions.headerCandidates,
    repeatedFootersDetected: repeatedRegions.footerCandidates,
    approximateTextRegionSimilarity: similarityScores.length ? Math.round(similarityScores.reduce((sum, value) => sum + value, 0) / similarityScores.length * 10) / 10 : null,
    warnings: [...new Set(warnings)],
    pageReports: pageReports.map(({ rows, ...report }) => report),
  };
  if (mode !== 'visual' && totalNativeSpans && quality.editableTextCoveragePercent < 98) {
    quality.warnings.push(`Editable text coverage check was ${quality.editableTextCoveragePercent}%; inspect missing words in the DOCX.`);
  }
  if (mode !== 'visual' && allSourceText.join('').trim() && quality.sourceTextCoveragePercent < 98) {
    quality.warnings.push(`Only ${quality.sourceTextCoveragePercent}% of extracted native/OCR words appear as editable Word text; some content may remain only in the background artwork or have been omitted.`);
  }
  if (mode !== 'visual' && quality.readingOrderContinuityPercent < 90) {
    quality.warnings.push(`Reading-order continuity check was ${quality.readingOrderContinuityPercent}%; review column/table order in Word.`);
  }
  if (mode !== 'visual' && quality.approximateTextRegionSimilarity !== null && quality.approximateTextRegionSimilarity < 82) {
    quality.warnings.push(`Approximate reconstructed text-region similarity is ${quality.approximateTextRegionSimilarity}%; some fonts, spacing, or text colors may need review.`);
  }
  onProgress({ phase: 'validation', page: pdf.numPages, pages: pdf.numPages, profile: 'DOCX package and editable-text checks passed' });
  return {
    bytes: packaged.bytes,
    pages: pdf.numPages,
    textItems,
    pagesWithoutText,
    pagesWithPartialText,
    mode,
    visualPages: pdf.numPages,
    quality,
    validation: packaged.validation,
    preflight: preflightSummary,
  };
}

export const __docxInternals = {
  getWordTokens,
  normalizeForMatch,
  tokenCoverage,
  inferColumnSeparator,
  orderReadingRows,
  detectListType,
  mergeHybridText,
  getOcrGeometry,
  readingOrderCoverage,
  getEditableReadingOrderText,
  wrapParagraphInDrawingTextBox,
  wrapParagraphInFrame,
  ensureDrawingNamespaces,
  makePlacedImageParagraph,
  buildNativeTable,
  countOperatorFeatures,
  detectGridTables,
  detectFlowTables,
  tableComplexityProfile,
  needsLayoutPreservingFallback,
  summarizePageForPreflight,
  chooseAutoPageMode,
  shouldRunPageOcr,
  getWordTableGridColumnCounts,
  normalizePackagePath,
  buildFlowTable,
  collectPageImageRegions,
  filterSemanticImageRegions,
  groupImageRegionsByRow,
  cropPageImageRegions,
  imageRegionHasTextOverlay,
  getImageOverlayTextItems,
  shouldCropImageFromNormalRender,
  inferSourceLinePitch,
  makeFlowTextParagraph,
  buildFlowTextBlocks,
  buildFlowImageParagraphGroups,
  buildFlowImageGroupTable,
  buildFlowPageContent,
  makeTextFreeFilter,
  groupTextIntoLines,
  findHorizontalRules,
  findVerticalRules,
  parseXmlText: extractWordText,
};
