// Layout analysis for the PDF → Word engine.
//
// Input: the raw page content from extract.js (glyphs, vector paths, images) in top-left point space.
// Output: a page model of Word-native building blocks — flowing paragraphs (with alignment, indents, tab stops,
// exact line pitch and spacing), real tables (with merged cells, per-side borders and cell shading), multi-column
// sections, inline pictures, and page-anchored pictures/shapes for artwork that cannot flow.

export const BASELINE_RATIO = 0.8; // Word/LibreOffice put the baseline at 80% of an exact line height.

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const median = (values) => {
  const list = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!list.length) return 0;
  const mid = Math.floor(list.length / 2);
  return list.length % 2 ? list[mid] : (list[mid - 1] + list[mid]) / 2;
};
const mode = (values, step = 1) => {
  const counts = new Map();
  let best = null; let bestCount = 0;
  for (const value of values) {
    const key = Math.round(value / step) * step;
    const count = (counts.get(key) || 0) + 1;
    counts.set(key, count);
    if (count > bestCount) { best = key; bestCount = count; }
  }
  return best;
};
const overlap1d = (a0, a1, b0, b1) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
const boxArea = (b) => Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0);
const inside = (inner, outer, tol = 0.5) => inner.x0 >= outer.x0 - tol && inner.x1 <= outer.x1 + tol && inner.y0 >= outer.y0 - tol && inner.y1 <= outer.y1 + tol;
const intersects = (a, b, pad = 0) => a.x0 < b.x1 + pad && a.x1 > b.x0 - pad && a.y0 < b.y1 + pad && a.y1 > b.y0 - pad;
const unionBox = (a, b) => (a ? { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) } : { ...b });
const isWhite = (hex) => typeof hex === 'string' && /^[0-9A-F]{6}$/.test(hex) && hex.match(/../g).every((part) => parseInt(part, 16) >= 245);
const isColor = (hex) => typeof hex === 'string' && /^[0-9A-F]{6}$/.test(hex);
const BULLET_RE = /^[•●▪◦‣⁃∙·○■□◆◇►▸➢➤✓✔-]$/u;
const LIST_MARKER_RE = /^(?:[•●▪◦‣⁃∙·○■□◆◇►▸➢➤✓✔❖❑➔⇨–—-]|\(?\d{1,3}[.)]|\(?[a-zA-Z][.)]|\(?[ivxlcdmIVXLCDM]{1,6}[.)]|\d{1,2}(?:\.\d{1,2}){1,3}\.?)$/u;
const isMarker = (segment) => Boolean(segment) && LIST_MARKER_RE.test(segment.text.trim());
const LIST_START_RE = /^(?:[•●▪◦‣⁃∙·○■□◆◇►▸➢➤✓✔]|-\s|\(?\d{1,3}[.)]\s|\(?[a-zA-Z][.)]\s|\(?[ivxlcdmIVXLCDM]{1,6}[.)]\s)/u;

// Symbol/Wingdings fonts store bullets in the private-use area (U+F0xx). Map the common ones to Unicode.
const PUA_SYMBOLS = new Map([
  [0xF0B7, '\u2022'], [0xF0A7, '\u25AA'], [0xF0FC, '\u2713'], [0xF0FB, '\u2717'], [0xF0D8, '\u27A2'], [0xF06E, '\u25A0'],
  [0xF071, '\u2751'], [0xF076, '\u2756'], [0xF0A8, '\u25A1'], [0xF0E8, '\u2794'], [0xF0F0, '\u21E8'], [0xF06C, '\u25CF'],
  [0xF0A1, '\u25CB'], [0xF0FE, '\u2611'], [0xF0D2, '\u00AE'], [0xF0D3, '\u00A9'], [0xF0D4, '\u2122'], [0xF0AE, '\u2192'],
  [0xF0E0, '\u2192'], [0xF02D, '\u2212'], [0xF0B0, '\u00B0'], [0xF0B4, '\u00D7'], [0xF0B8, '\u00F7'], [0xF0A3, '\u2264'], [0xF0B3, '\u2265'],
]);
export function mapPrivateUse(text) {
  return String(text).replace(/[\uF000-\uF0FF]/g, (ch) => PUA_SYMBOLS.get(ch.codePointAt(0)) || ch);
}

function glyphBox(glyph) {
  return { x0: glyph.x0, x1: Math.max(glyph.x1, glyph.x0 + 0.1), y0: glyph.baseline - glyph.size * 0.78, y1: glyph.baseline + glyph.size * 0.22 };
}

// ---------------------------------------------------------------------------------------------------------------
// Glyph clean-up
// ---------------------------------------------------------------------------------------------------------------

/** Remove duplicated glyphs (fake-bold / shadow text) and split rotated text from horizontal text. */
export function prepareGlyphs(glyphs, { useInvisible = false } = {}) {
  const visible = glyphs.filter((glyph) => (useInvisible || !glyph.invisible) && glyph.alpha !== 0 && glyph.ch);
  const horizontal = [];
  const rotated = [];
  const seen = new Map();
  for (const glyph of visible) {
    if (Math.abs(glyph.angle) > 0.02) { rotated.push(glyph); continue; }
    if (!glyph.isSpace) {
      const key = `${glyph.ch}|${Math.round(glyph.baseline)}`;
      const list = seen.get(key) || [];
      const duplicate = list.find((other) => Math.abs(other.x0 - glyph.x0) < Math.max(0.6, glyph.size * 0.08) && Math.abs(other.baseline - glyph.baseline) < 0.8);
      if (duplicate) {
        // Text painted twice with a small offset is a "poor man's bold".
        if (Math.abs(duplicate.x0 - glyph.x0) > 0.05) duplicate.fakeBold = true;
        continue;
      }
      list.push(glyph); seen.set(key, list);
    }
    horizontal.push(glyph);
  }
  return { horizontal, rotated };
}

// ---------------------------------------------------------------------------------------------------------------
// Vector classification
// ---------------------------------------------------------------------------------------------------------------

/** Split vector paths into ruling lines, filled areas, and free-form artwork. */
export function classifyPaths(paths, pageWidth, pageHeight) {
  const hRules = []; const vRules = []; const fills = []; const art = []; const rings = [];
  const pageArea = pageWidth * pageHeight;
  for (const path of paths) {
    const { box } = path;
    const w = box.x1 - box.x0; const h = box.y1 - box.y0;
    if (w < 0.05 && h < 0.05) continue;
    if (path.hasCurves && isColor(path.fill) && path.fillAlpha !== 0 && w * h >= 300 && w * h < pageArea * 0.6) {
      // Rounded panel (CSS card, call-out): a single closed shape is treated like a filled rectangle.
      if (path.subpaths === 1) { fills.push({ x0: box.x0, y0: box.y0, x1: box.x1, y1: box.y1, color: path.fill, op: path.opIndex, alpha: path.fillAlpha, rounded: true, stroke: path.stroke ? { color: path.stroke, width: path.lineWidth } : null }); continue; }
      // Border ring: outer + inner outline filled with even-odd → a border of uniform width.
      if (path.subpaths === 2 && path.subBoxes?.length === 2) {
        const [a, b] = path.subBoxes;
        const [outer, inner] = boxArea(a) >= boxArea(b) ? [a, b] : [b, a];
        const insets = [inner.x0 - outer.x0, inner.y0 - outer.y0, outer.x1 - inner.x1, outer.y1 - inner.y1];
        if (insets.every((v) => v >= 0.2 && v <= 4) && Math.max(...insets) - Math.min(...insets) < 0.8) {
          rings.push({ box: outer, width: median(insets), color: path.fill, op: path.opIndex });
          continue;
        }
      }
    }
    if (path.fill === 'shading' || path.fill === 'pattern' || path.hasCurves) { if (path.fill !== null || path.stroke) art.push(path); continue; }
    let consumed = false;
    if (path.fill && path.rects && path.fillAlpha !== 0) {
      for (const rect of path.rects) {
        const rw = rect.x1 - rect.x0; const rh = rect.y1 - rect.y0;
        if (rh <= 2.6 && rw >= 2) hRules.push({ x0: rect.x0, x1: rect.x1, y: (rect.y0 + rect.y1) / 2, width: Math.max(0.25, rh), color: path.fill, op: path.opIndex });
        else if (rw <= 2.6 && rh >= 2) vRules.push({ y0: rect.y0, y1: rect.y1, x: (rect.x0 + rect.x1) / 2, width: Math.max(0.25, rw), color: path.fill, op: path.opIndex });
        else if (rw > 2.6 && rh > 2.6 && boxArea(rect) < pageArea * 0.97) fills.push({ ...rect, color: path.fill, op: path.opIndex, alpha: path.fillAlpha });
      }
      consumed = true;
    }
    if (path.stroke && path.segments.length && path.strokeAlpha !== 0) {
      const lw = path.lineWidth;
      let straight = true;
      const local = [];
      for (const [x0, y0, x1, y1] of path.segments) {
        const len = Math.hypot(x1 - x0, y1 - y0);
        if (len < 0.3) continue;
        if (Math.abs(y1 - y0) < 0.6) local.push({ kind: 'h', x0: Math.min(x0, x1), x1: Math.max(x0, x1), y: (y0 + y1) / 2 });
        else if (Math.abs(x1 - x0) < 0.6) local.push({ kind: 'v', y0: Math.min(y0, y1), y1: Math.max(y0, y1), x: (x0 + x1) / 2 });
        else { straight = false; break; }
      }
      if (straight && lw <= 4) {
        for (const segment of local) {
          if (segment.kind === 'h') hRules.push({ x0: segment.x0, x1: segment.x1, y: segment.y, width: lw, color: path.stroke, op: path.opIndex });
          else vRules.push({ y0: segment.y0, y1: segment.y1, x: segment.x, width: lw, color: path.stroke, op: path.opIndex });
        }
        consumed = true;
      } else if (!straight || lw > 4) {
        art.push(path); continue;
      }
    }
    if (!consumed && (path.fill || path.stroke)) art.push(path);
  }
  return { hRules: mergeRules(hRules, 'h'), vRules: mergeRules(vRules, 'v'), fills, art, rings };
}

function mergeRules(rules, kind) {
  const pos = kind === 'h' ? 'y' : 'x';
  const a0 = kind === 'h' ? 'x0' : 'y0';
  const a1 = kind === 'h' ? 'x1' : 'y1';
  const sorted = [...rules].sort((p, q) => p[pos] - q[pos] || p[a0] - q[a0]);
  const merged = [];
  for (const rule of sorted) {
    const last = merged.find((other) => Math.abs(other[pos] - rule[pos]) <= 0.9 && rule[a0] <= other[a1] + 1.2 && rule[a1] >= other[a0] - 1.2);
    if (last) {
      last[a0] = Math.min(last[a0], rule[a0]); last[a1] = Math.max(last[a1], rule[a1]);
      last.width = Math.max(last.width, rule.width);
    } else merged.push({ ...rule });
  }
  // A second pass catches chains that only became adjacent after the first merge.
  if (merged.length !== rules.length && merged.length > 1) {
    const again = mergeRulesOnce(merged, pos, a0, a1);
    return again;
  }
  return merged;
}
function mergeRulesOnce(rules, pos, a0, a1) {
  const out = [];
  for (const rule of [...rules].sort((p, q) => p[pos] - q[pos] || p[a0] - q[a0])) {
    const last = out[out.length - 1];
    if (last && Math.abs(last[pos] - rule[pos]) <= 0.9 && rule[a0] <= last[a1] + 1.2) {
      last[a1] = Math.max(last[a1], rule[a1]); last.width = Math.max(last.width, rule.width);
    } else out.push({ ...rule });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------------------------------------------

function clusterValues(values, tolerance) {
  const sorted = [...values].sort((a, b) => a - b);
  const clusters = [];
  for (const value of sorted) {
    const last = clusters[clusters.length - 1];
    if (last && value - last.max <= tolerance) { last.values.push(value); last.max = value; }
    else clusters.push({ values: [value], max: value });
  }
  return clusters.map((cluster) => cluster.values.reduce((sum, v) => sum + v, 0) / cluster.values.length);
}

/** Group rules into connected networks; each network with a 2-D grid becomes a table. */
export function detectTables(hRules, vRules, fills, glyphs, pageWidth, pageHeight) {
  const tol = 2.2;
  const nodes = [...hRules.map((rule) => ({ kind: 'h', rule })), ...vRules.map((rule) => ({ kind: 'v', rule }))];
  const parent = nodes.map((_, index) => index);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const unite = (a, b) => { const ra = find(a); const rb = find(b); if (ra !== rb) parent[ra] = rb; };
  const hCount = hRules.length;
  for (let i = 0; i < hCount; i += 1) {
    const h = hRules[i];
    for (let j = 0; j < vRules.length; j += 1) {
      const v = vRules[j];
      if (v.x >= h.x0 - tol && v.x <= h.x1 + tol && h.y >= v.y0 - tol && h.y <= v.y1 + tol) unite(i, hCount + j);
    }
  }
  const groups = new Map();
  nodes.forEach((node, index) => {
    const root = find(index);
    if (!groups.has(root)) groups.set(root, { h: [], v: [] });
    groups.get(root)[node.kind].push(node.rule);
  });
  const tables = [];
  const drawings = [];
  for (const group of groups.values()) {
    if (group.h.length < 2 || group.v.length < 2) continue;
    const table = buildGrid(group.h, group.v, fills, glyphs, pageWidth, pageHeight);
    if (!table) continue;
    if (looksLikeDrawing(table, fills, group)) { drawings.push({ box: table.box, rules: group }); continue; }
    tables.push(table);
  }
  tables.drawings = drawings;
  return tables;
}

/**
 * Charts and diagrams also have rectangular frames. A real table's fills line up with its cells (row/cell
 * shading); fills that only partly cover cells (bars, legend swatches) or many tiny dangling rule stubs (tick
 * marks) mean the frame belongs to a drawing.
 */
function looksLikeDrawing(table, fills, group) {
  const area = boxArea(table.box);
  let partial = 0;
  for (const fill of fills) {
    if (!intersects(fill, table.box, -1)) continue;
    const fa = boxArea(fill);
    if (fa < area * 0.004) continue;
    // Row/column/cell shading starts and ends on grid lines; chart bars and swatches do not.
    const onGrid = (value, grid) => grid.some((g) => Math.abs(g - value) <= 2.2);
    const aligned = onGrid(fill.x0, table.xs) && onGrid(fill.x1, table.xs) && onGrid(fill.y0, table.ys) && onGrid(fill.y1, table.ys);
    if (!aligned) partial += 1;
  }
  if (partial >= 1 && table.cells.length <= 4) return true;
  if (partial >= 3) return true;
  // Tick marks: many short rules sticking out of the frame.
  const stubs = [...group.h.filter((r) => r.x1 - r.x0 < 8), ...group.v.filter((r) => r.y1 - r.y0 < 8)].length;
  return stubs >= 4 && stubs >= (group.h.length + group.v.length) * 0.4;
}

function coverage(rules, pos, at, from, to, tol = 1.6) {
  // Fraction of [from, to] covered by rules located at `at`.
  const a0 = pos === 'y' ? 'x0' : 'y0'; const a1 = pos === 'y' ? 'x1' : 'y1';
  const spans = rules.filter((rule) => Math.abs(rule[pos] - at) <= tol).map((rule) => [Math.max(from, rule[a0]), Math.min(to, rule[a1]), rule]).filter(([s, e]) => e > s).sort((p, q) => p[0] - q[0]);
  let covered = 0; let cursor = from; let best = null;
  for (const [s, e, rule] of spans) {
    if (e <= cursor) continue;
    covered += e - Math.max(s, cursor); cursor = e;
    if (!best || rule.width > best.width) best = rule;
  }
  return { ratio: (to - from) > 0 ? covered / (to - from) : 0, rule: best };
}

function buildGrid(hRules, vRules, fills, glyphs, pageWidth, pageHeight) {
  const x0 = Math.min(...hRules.map((r) => r.x0), ...vRules.map((r) => r.x));
  const x1 = Math.max(...hRules.map((r) => r.x1), ...vRules.map((r) => r.x));
  const y0 = Math.min(...vRules.map((r) => r.y0), ...hRules.map((r) => r.y));
  const y1 = Math.max(...vRules.map((r) => r.y1), ...hRules.map((r) => r.y));
  if (x1 - x0 < 12 || y1 - y0 < 6) return null;
  let xs = clusterValues([x0, x1, ...vRules.map((r) => r.x)], 2.5);
  let ys = clusterValues([y0, y1, ...hRules.map((r) => r.y)], 2.0);
  // Drop slivers (double borders drawn as two close lines become one boundary).
  xs = xs.filter((x, i) => i === 0 || x - xs[i - 1] >= 3.5);
  ys = ys.filter((y, i) => i === 0 || y - ys[i - 1] >= 3.0);
  const cols = xs.length - 1; const rows = ys.length - 1;
  if (cols < 1 || rows < 1 || cols > 40 || rows > 300) return null;
  const box = { x0: xs[0], x1: xs[cols], y0: ys[0], y1: ys[rows] };
  // A big frame around (nearly) the whole page is a page border, not a table.
  if (cols === 1 && rows === 1 && boxArea(box) > pageWidth * pageHeight * 0.45) return null;

  // Boundary presence between grid cells.
  const vEdge = (c, r) => coverage(vRules, 'x', xs[c], ys[r], ys[r + 1]); // vertical boundary at xs[c] for row r
  const hEdge = (r, c) => coverage(hRules, 'y', ys[r], xs[c], xs[c + 1]); // horizontal boundary at ys[r] for col c

  const parent = new Array(rows * cols).fill(0).map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const unite = (a, b) => { const ra = find(a); const rb = find(b); if (ra !== rb) parent[ra] = rb; };
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      if (c + 1 < cols && vEdge(c + 1, r).ratio < 0.5) unite(r * cols + c, r * cols + c + 1);
      if (r + 1 < rows && hEdge(r + 1, c).ratio < 0.5) unite(r * cols + c, (r + 1) * cols + c);
    }
  }
  // Each merged group must be a rectangle in grid space; otherwise split it back into individual cells.
  const groups = new Map();
  for (let r = 0; r < rows; r += 1) for (let c = 0; c < cols; c += 1) {
    const root = find(r * cols + c);
    const g = groups.get(root) || { r0: r, r1: r, c0: c, c1: c, count: 0 };
    g.r0 = Math.min(g.r0, r); g.r1 = Math.max(g.r1, r); g.c0 = Math.min(g.c0, c); g.c1 = Math.max(g.c1, c); g.count += 1;
    groups.set(root, g);
  }
  const owner = new Array(rows * cols).fill(null);
  for (const g of groups.values()) {
    const rect = (g.r1 - g.r0 + 1) * (g.c1 - g.c0 + 1) === g.count;
    if (rect) { for (let r = g.r0; r <= g.r1; r += 1) for (let c = g.c0; c <= g.c1; c += 1) owner[r * cols + c] = g; }
  }
  for (let r = 0; r < rows; r += 1) for (let c = 0; c < cols; c += 1) {
    if (!owner[r * cols + c]) owner[r * cols + c] = { r0: r, r1: r, c0: c, c1: c, count: 1 };
  }
  const cells = [];
  const seen = new Set();
  for (let r = 0; r < rows; r += 1) for (let c = 0; c < cols; c += 1) {
    const g = owner[r * cols + c];
    if (seen.has(g)) continue;
    seen.add(g);
    const cellBox = { x0: xs[g.c0], x1: xs[g.c1 + 1], y0: ys[g.r0], y1: ys[g.r1 + 1] };
    const side = (fn, a, b, list) => { const result = list.map(fn); const ratio = result.reduce((s, x) => s + x.ratio, 0) / Math.max(1, result.length); const rule = result.map((x) => x.rule).find(Boolean); return ratio >= 0.5 && rule ? { width: rule.width, color: rule.color } : null; };
    const colsRange = Array.from({ length: g.c1 - g.c0 + 1 }, (_, k) => g.c0 + k);
    const rowsRange = Array.from({ length: g.r1 - g.r0 + 1 }, (_, k) => g.r0 + k);
    const borders = {
      top: side((c) => hEdge(g.r0, c), 0, 0, colsRange),
      bottom: side((c) => hEdge(g.r1 + 1, c), 0, 0, colsRange),
      left: side((r) => vEdge(g.c0, r), 0, 0, rowsRange),
      right: side((r) => vEdge(g.c1 + 1, r), 0, 0, rowsRange),
    };
    // Shading: the last-painted non-white fill covering most of the cell.
    let shade = null; let shadeOp = -1;
    for (const fill of fills) {
      if (!isColor(fill.color)) continue;
      const covered = overlap1d(fill.x0, fill.x1, cellBox.x0, cellBox.x1) * overlap1d(fill.y0, fill.y1, cellBox.y0, cellBox.y1);
      if (covered >= boxArea(cellBox) * 0.7 && fill.op > shadeOp) { shade = fill.color; shadeOp = fill.op; }
    }
    if (shade && isWhite(shade)) shade = null;
    cells.push({ r0: g.r0, r1: g.r1, c0: g.c0, c1: g.c1, box: cellBox, borders, shade, glyphs: [], images: [] });
  }
  return { kind: 'table', xs, ys, rows, cols, box, cells, ruled: true };
}

/** Text-bearing filled rectangles (title bars, call-outs) become single-cell shaded tables. */
export function detectBoxes(fills, glyphs, tables, pageWidth, pageHeight, rings = []) {
  const boxes = [];
  const pageArea = pageWidth * pageHeight;
  const candidates = fills
    .filter((fill) => isColor(fill.color) && !isWhite(fill.color) && fill.alpha !== 0 && boxArea(fill) >= 300 && boxArea(fill) < pageArea * 0.6)
    .filter((fill) => !tables.some((table) => intersects(table.box, fill, -1)))
    .sort((a, b) => boxArea(b) - boxArea(a));
  for (const fill of candidates) {
    if (boxes.some((box) => inside(fill, box.box, 1) || intersects(fill, box.box, -0.5))) continue;
    const contained = glyphs.filter((g) => !g.isSpace && inside(glyphBox(g), fill, 1.5));
    if (!contained.length) continue;
    const straddling = glyphs.some((g) => !g.isSpace && intersects(glyphBox(g), fill, -0.5) && !inside(glyphBox(g), fill, 1.5));
    if (straddling) continue;
    const box = { x0: fill.x0, x1: fill.x1, y0: fill.y0, y1: fill.y1 };
    // A border ring (or the panel's own stroke) around the panel becomes the cell border.
    const ring = rings.find((r) => !r.used && Math.abs(r.box.x0 - box.x0) < 2 && Math.abs(r.box.y0 - box.y0) < 2 && Math.abs(r.box.x1 - box.x1) < 2 && Math.abs(r.box.y1 - box.y1) < 2);
    let border = null;
    if (ring) { ring.used = true; border = { width: ring.width, color: ring.color }; box.x0 = Math.min(box.x0, ring.box.x0); box.y0 = Math.min(box.y0, ring.box.y0); box.x1 = Math.max(box.x1, ring.box.x1); box.y1 = Math.max(box.y1, ring.box.y1); }
    else if (fill.stroke && isColor(fill.stroke.color)) border = { width: fill.stroke.width, color: fill.stroke.color };
    boxes.push({
      kind: 'table', box, xs: [box.x0, box.x1], ys: [box.y0, box.y1], rows: 1, cols: 1, ruled: false, fromFill: true,
      cells: [{ r0: 0, r1: 0, c0: 0, c1: 0, box, borders: { top: border, bottom: border, left: border, right: border }, shade: fill.color, glyphs: [], images: [] }],
    });
  }
  return boxes;
}

// ---------------------------------------------------------------------------------------------------------------
// Underline / strikeout detection
// ---------------------------------------------------------------------------------------------------------------

export function detectTextDecorations(hRules, glyphs) {
  const used = new Set();
  for (const rule of hRules) {
    if (rule.width > 2.2) continue;
    const near = glyphs.filter((g) => !g.isSpace && g.x1 > rule.x0 - 0.5 && g.x0 < rule.x1 + 0.5);
    if (!near.length) continue;
    const under = near.filter((g) => rule.y - g.baseline >= -0.2 && rule.y - g.baseline <= g.size * 0.33);
    const strike = near.filter((g) => g.baseline - rule.y >= g.size * 0.15 && g.baseline - rule.y <= g.size * 0.45);
    const pick = under.length >= strike.length ? under : strike;
    if (!pick.length) continue;
    const textSpan = Math.max(...pick.map((g) => g.x1)) - Math.min(...pick.map((g) => g.x0));
    const ruleLen = rule.x1 - rule.x0;
    // The rule has to be about as long as the text above it; long rules under short labels are form fields.
    if (ruleLen > textSpan + Math.max(6, pick[0].size * 0.9) || textSpan < ruleLen * 0.6) continue;
    for (const g of pick) { if (pick === under) g.underline = true; else g.strike = true; }
    // Spaces between underlined words are underlined too.
    for (const g of glyphs) if (g.isSpace && g.x0 >= rule.x0 - 0.5 && g.x1 <= rule.x1 + 0.5 && Math.abs(g.baseline - pick[0].baseline) < 1) { if (pick === under) g.underline = true; else g.strike = true; }
    used.add(rule);
  }
  return { remaining: hRules.filter((rule) => !used.has(rule)) };
}

// ---------------------------------------------------------------------------------------------------------------
// Figures (images and vector artwork that cannot be expressed as Word text/table structure)
// ---------------------------------------------------------------------------------------------------------------

export function detectFigures(images, art, pageWidth, pageHeight) {
  const items = [
    ...images.map((image) => ({ box: { ...image.box }, ops: [image.opIndex], image: true, pixelWidth: image.pixelWidth, pixelHeight: image.pixelHeight, mask: image.mask })),
    ...art.map((path) => ({ box: { ...path.box }, ops: [path.opIndex], image: false, color: isColor(path.fill) ? path.fill : (isColor(path.stroke) ? path.stroke : null), curves: Boolean(path.hasCurves) })),
  ].filter((item) => item.box.x1 - item.box.x0 >= 0.8 && item.box.y1 - item.box.y0 >= 0.8)
    .map((item) => ({ ...item, box: { x0: Math.max(0, item.box.x0), y0: Math.max(0, item.box.y0), x1: Math.min(pageWidth, item.box.x1), y1: Math.min(pageHeight, item.box.y1) } }))
    .filter((item) => item.box.x1 > item.box.x0 && item.box.y1 > item.box.y0);
  // Cluster touching/overlapping pieces into figures.
  const figures = [];
  for (const item of items.sort((a, b) => a.box.y0 - b.box.y0)) {
    const pad = item.image ? 0.5 : 2.5;
    const hits = figures.filter((figure) => intersects(figure.box, item.box, figure.hasArt || !item.image ? pad : -0.5));
    if (!hits.length) { figures.push({ box: { ...item.box }, ops: [...item.ops], color: item.color || null, curves: Boolean(item.curves), images: item.image ? 1 : 0, hasArt: !item.image, pixelWidth: item.pixelWidth || 0, pixelHeight: item.pixelHeight || 0, maskOnly: Boolean(item.mask) }); continue; }
    const target = hits[0];
    for (const other of hits.slice(1)) {
      target.box = unionBox(target.box, other.box); target.ops.push(...other.ops); target.images += other.images; target.hasArt ||= other.hasArt;
      target.pixelWidth = Math.max(target.pixelWidth, other.pixelWidth); target.pixelHeight = Math.max(target.pixelHeight, other.pixelHeight);
      target.maskOnly &&= other.maskOnly;
      figures.splice(figures.indexOf(other), 1);
    }
    target.box = unionBox(target.box, item.box); target.ops.push(...item.ops);
    if (item.image) target.images += 1; else target.hasArt = true;
    target.pixelWidth = Math.max(target.pixelWidth, item.pixelWidth || 0); target.pixelHeight = Math.max(target.pixelHeight, item.pixelHeight || 0);
    target.maskOnly &&= Boolean(item.mask);
  }
  // Repeat merging until stable (clusters can grow into each other).
  let changed = true;
  while (changed) {
    changed = false;
    outer: for (let i = 0; i < figures.length; i += 1) {
      for (let j = i + 1; j < figures.length; j += 1) {
        if (intersects(figures[i].box, figures[j].box, figures[i].hasArt && figures[j].hasArt ? 2.5 : -0.5)) {
          const a = figures[i]; const b = figures[j];
          a.box = unionBox(a.box, b.box); a.ops.push(...b.ops); a.images += b.images; a.hasArt ||= b.hasArt; a.maskOnly &&= b.maskOnly;
          a.pixelWidth = Math.max(a.pixelWidth, b.pixelWidth); a.pixelHeight = Math.max(a.pixelHeight, b.pixelHeight);
          figures.splice(j, 1); changed = true; break outer;
        }
      }
    }
  }
  return figures.filter((figure) => (figure.box.x1 - figure.box.x0) * (figure.box.y1 - figure.box.y0) >= 4);
}

// ---------------------------------------------------------------------------------------------------------------
// Text lines and segments
// ---------------------------------------------------------------------------------------------------------------

/**
 * Build text lines from glyphs. Each line is split into segments wherever a gap is too wide to be a word space;
 * segments later become tab stops. Super/subscripts are folded into their parent line.
 */
export function buildLines(glyphs) {
  const sorted = [...glyphs].sort((a, b) => a.baseline - b.baseline || a.x0 - b.x0);
  const bands = [];
  for (const glyph of sorted) {
    let target = null;
    for (let i = bands.length - 1; i >= 0 && i >= bands.length - 6; i -= 1) {
      const band = bands[i];
      const tol = Math.max(1.0, Math.min(band.size, glyph.size) * 0.3);
      if (Math.abs(band.baseline - glyph.baseline) <= tol) { target = band; break; }
    }
    if (!target) { target = { baseline: glyph.baseline, size: glyph.size, glyphs: [] }; bands.push(target); }
    target.glyphs.push(glyph);
    if (!glyph.isSpace) {
      const weights = target.glyphs.filter((g) => !g.isSpace);
      target.size = Math.max(...weights.map((g) => g.size));
      // Baseline follows the dominant (largest) text so small superscripts do not drag it.
      const main = weights.filter((g) => g.size >= target.size * 0.85);
      target.baseline = main.reduce((s, g) => s + g.baseline, 0) / main.length;
    }
  }
  // Fold small raised/lowered glyph groups into the neighbouring line as super/subscripts.
  const lines = bands.filter((band) => band.glyphs.some((g) => !g.isSpace));
  for (const band of [...lines]) {
    const ink = band.glyphs.filter((g) => !g.isSpace);
    if (ink.length > 6) continue;
    const parent = lines.find((other) => other !== band && other.size > band.size * 1.2
      && Math.abs(other.baseline - band.baseline) < other.size * 0.6
      && ink.every((g) => g.x0 < Math.max(...other.glyphs.map((o) => o.x1)) + other.size * 1.5 && g.x1 > Math.min(...other.glyphs.map((o) => o.x0)) - other.size * 1.5));
    if (!parent) continue;
    for (const g of band.glyphs) g.vert = g.baseline < parent.baseline ? 'superscript' : 'subscript';
    parent.glyphs.push(...band.glyphs);
    lines.splice(lines.indexOf(band), 1);
  }
  return lines.map((band) => makeLine(band.glyphs)).sort((a, b) => a.baseline - b.baseline || a.x0 - b.x0);
}

function makeLine(glyphs) {
  const sorted = [...glyphs].sort((a, b) => a.x0 - b.x0);
  const ink = sorted.filter((g) => !g.isSpace);
  const size = Math.max(...ink.filter((g) => !g.vert).map((g) => g.size), ...ink.map((g) => g.size * 0.5));
  const main = ink.filter((g) => !g.vert);
  const baseline = (main.length ? main : ink).reduce((s, g) => s + g.baseline, 0) / (main.length || ink.length);
  // Segment split: a run of whitespace (or empty gap) wider than ~1.1 em between ink glyphs.
  const segments = [];
  let current = [];
  let lastInk = null;
  for (const glyph of sorted) {
    if (glyph.isSpace) { if (current.length) current.push(glyph); continue; }
    if (lastInk) {
      const gap = glyph.x0 - lastInk.x1;
      const em = Math.max(glyph.size, lastInk.size);
      // A leading list marker ("1.", "a)", "•") followed by more than a word space is a marker + tab.
      const markerGap = !segments.length && gap > em * 0.42
        && LIST_MARKER_RE.test(current.filter((g) => !g.isSpace).map((g) => g.ch).join(''));
      if (gap > Math.max(em * 1.15, 5.5) || markerGap) {
        segments.push(current); current = [];
      }
    }
    current.push(glyph);
    lastInk = glyph;
  }
  if (current.length) segments.push(current);
  const segs = segments.map((list) => makeSegment(list)).filter(Boolean);
  return {
    baseline, size,
    x0: Math.min(...segs.map((s) => s.x0)), x1: Math.max(...segs.map((s) => s.x1)),
    top: baseline - size * 0.8, bottom: baseline + size * 0.22,
    segments: segs,
    text: segs.map((s) => s.text).join('\t'),
  };
}

/** Re-create a line object from a subset of another line's segments (used when splitting columns). */
export function lineFromSegments(segments, template) {
  const segs = [...segments].sort((a, b) => a.x0 - b.x0);
  const size = Math.max(...segs.map((s) => s.size));
  const baseline = template?.baseline ?? segs[0].baseline;
  return {
    baseline, size,
    x0: Math.min(...segs.map((s) => s.x0)), x1: Math.max(...segs.map((s) => s.x1)),
    top: baseline - size * 0.8, bottom: baseline + size * 0.22,
    segments: segs,
    text: segs.map((s) => s.text).join('\t'),
  };
}

function runStyle(glyph, fonts) {
  const font = fonts.get(glyph.font) || {};
  return {
    font: glyph.font,
    family: font.name || '',
    bold: Boolean(font.bold || glyph.fakeBold),
    italic: Boolean(font.italic),
    size: Math.round((glyph.vert ? glyph.size : glyph.size) * 2) / 2,
    color: glyph.color || '000000',
    underline: Boolean(glyph.underline),
    strike: Boolean(glyph.strike),
    vert: glyph.vert || '',
    link: glyph.link || '',
  };
}

let currentFonts = new Map();
export function setFontTable(fonts) { currentFonts = fonts || new Map(); }

function makeSegment(glyphs) {
  // Trim trailing spaces.
  while (glyphs.length && glyphs[glyphs.length - 1].isSpace) glyphs.pop();
  if (!glyphs.length) return null;
  const runs = [];
  let previous = null;
  for (const glyph of glyphs) {
    let text = glyph.ch;
    // Insert a space where the PDF positioned words apart without a space glyph.
    if (previous && !previous.isSpace && !glyph.isSpace) {
      const gap = glyph.x0 - previous.x1;
      const em = Math.min(glyph.size, previous.size);
      if (gap > em * 0.16) text = ` ${text}`;
    }
    if (glyph.isSpace) text = ' ';
    const style = runStyle(glyph, currentFonts);
    const last = runs[runs.length - 1];
    const sameStyle = last && last.family === style.family && last.bold === style.bold && last.italic === style.italic
      && Math.abs(last.size - style.size) < 0.6 && last.color === style.color && last.underline === style.underline
      && last.strike === style.strike && last.vert === style.vert && last.link === style.link;
    if (sameStyle) { last.text += text; last.x1 = glyph.x1; }
    else if (text === ' ' && last) { last.text += ' '; }
    else runs.push({ ...style, text, x0: glyph.x0, x1: glyph.x1 });
    previous = glyph;
  }
  // Collapse duplicate spaces and normalise compatibility characters (ligatures, etc.).
  for (const run of runs) {
    run.text = mapPrivateUse(run.text).normalize('NFKC');
    // Anything still in the private-use area needs the original symbol font to display.
    if (/[\uF000-\uF0FF]/.test(run.text) && !/symbol|wingding|dingbat/i.test(run.family)) run.family = 'Symbol';
    else if (/[\u2022\u25AA\u2713\u27A2\u25A0\u2751\u2756\u25A1\u2794\u21E8\u25CF\u25CB\u2611]/.test(run.text) && /symbol|wingding|dingbat/i.test(run.family) && run.text.trim().length <= 2) run.family = '';
  }
  const ink = glyphs.filter((g) => !g.isSpace);
  const text = runs.map((r) => r.text).join('');
  if (!text.trim()) return null;
  const mainInk = ink.filter((g) => !g.vert);
  return {
    x0: Math.min(...ink.map((g) => g.x0)),
    x1: Math.max(...ink.map((g) => g.x1)),
    baseline: (mainInk.length ? mainInk : ink).reduce((sum, g) => sum + g.baseline, 0) / (mainInk.length || ink.length),
    glyphs: [...glyphs],
    runs,
    text,
    size: Math.max(...ink.map((g) => g.size)),
    firstWordWidth: firstWordWidth(ink),
  };
}

function firstWordWidth(ink) {
  if (!ink.length) return 0;
  let end = ink[0].x1;
  for (let i = 1; i < ink.length; i += 1) {
    if (ink[i].x0 - ink[i - 1].x1 > Math.min(ink[i].size, ink[i - 1].size) * 0.16) break;
    end = ink[i].x1;
  }
  return end - ink[0].x0;
}

// ---------------------------------------------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------------------------------------------

/**
 * Find vertical regions laid out in two or three text columns. Returns regions with their column boxes so the
 * writer can emit a multi-column Word section.
 */
export function detectColumnRegions(lines, left, right) {
  const width = right - left;
  if (lines.length < 8 || width < 200) return [];
  const regions = [];
  // Candidate gutters: x-intervals free of ink in many consecutive lines.
  const step = 2;
  const bins = Math.ceil(width / step);
  const sorted = [...lines].sort((a, b) => a.baseline - b.baseline);
  let i = 0;
  while (i < sorted.length) {
    // Grow a window of lines and track which bins stay free.
    let free = new Array(bins).fill(true);
    let j = i;
    let best = null;
    while (j < sorted.length) {
      const next = free.slice();
      for (const seg of sorted[j].segments) {
        const a = Math.max(0, Math.floor((seg.x0 - left) / step)); const b = Math.min(bins - 1, Math.ceil((seg.x1 - left) / step));
        for (let k = a; k <= b; k += 1) next[k] = false;
      }
      const gutters = findGutters(next, step, left, width);
      if (!gutters.length) break;
      free = next;
      j += 1;
      if (j - i >= 6) best = { end: j, gutters };
    }
    if (best) {
      const windowLines = sorted.slice(i, best.end);
      const gutters = best.gutters;
      const bounds = [-Infinity, ...gutters.map((g) => (g.x0 + g.x1) / 2), Infinity];
      const columns = bounds.slice(0, -1).map(() => []);
      for (const line of windowLines) {
        for (let k = 0; k < columns.length; k += 1) {
          const segs = line.segments.filter((seg) => (seg.x0 + seg.x1) / 2 >= bounds[k] && (seg.x0 + seg.x1) / 2 < bounds[k + 1]);
          if (segs.length) columns[k].push(segs.length === line.segments.length ? line : lineFromSegments(segs, line));
        }
      }
      const prose = columns.every((col) => col.length >= 3 && col.filter((line) => line.segments.length === 1).length >= col.length * 0.7);
      const textWidths = columns.map((col) => Math.max(...col.map((l) => l.x1)) - Math.min(...col.map((l) => l.x0)));
      const balanced = textWidths.every((w) => w >= width * 0.22);
      const lefts = columns.map((col) => mode(col.map((l) => l.x0), 1));
      const alignedLefts = columns.every((col, k) => col.filter((l) => Math.abs(l.x0 - lefts[k]) <= 2).length >= col.length * 0.5);
      if (prose && balanced && alignedLefts) {
        regions.push({
          y0: Math.min(...windowLines.map((l) => l.top)), y1: Math.max(...windowLines.map((l) => l.bottom)),
          lines: windowLines,
          columns: columns.map((col) => ({ x0: Math.min(...col.map((l) => l.x0)), x1: Math.max(...col.map((l) => l.x1)), lines: col })),
        });
        i = best.end;
        continue;
      }
    }
    i += 1;
  }
  return regions;
}

function findGutters(free, step, left, width) {
  const gutters = [];
  let start = -1;
  for (let k = 0; k <= free.length; k += 1) {
    if (k < free.length && free[k]) { if (start < 0) start = k; }
    else if (start >= 0) {
      const x0 = left + start * step; const x1 = left + k * step;
      // Gutters must be interior and reasonably wide; free space that reaches the page edge is clipped to the
      // interior so a column that has not started yet (or already ended) does not hide the gutter.
      const g0 = Math.max(x0, left + width * 0.2); const g1 = Math.min(x1, left + width * 0.8);
      if (g1 - g0 >= 9) gutters.push({ x0: g0, x1: g1, open: x0 <= left + 1 || x1 >= left + width - 1 });
      start = -1;
    }
  }
  // A window where one side is completely empty is not (yet) a multi-column region.
  const closed = gutters.filter((g) => !g.open);
  return closed.length && closed.length <= 2 ? closed : (gutters.length === 1 ? gutters : []);
}

// ---------------------------------------------------------------------------------------------------------------
// Paragraphs
// ---------------------------------------------------------------------------------------------------------------

/**
 * Turn the lines of one container (page body, column, or table cell) into paragraphs.
 * @param {Array} lines lines sorted top-down
 * @param {{left:number,right:number}} box container text area
 */
export function buildParagraphs(lines, box) {
  const { left: L, right: R } = box;
  const width = Math.max(1, R - L);
  const mid = (L + R) / 2;
  const paragraphs = [];
  let current = null;
  const isCentered = (line) => Math.abs((line.x0 + line.x1) / 2 - mid) <= Math.max(2.5, width * 0.012) && line.x0 > L + 6;
  const startsList = (line) => LIST_START_RE.test(line.segments[0].text) || (line.segments.length > 1 && isMarker(line.segments[0]));
  const finish = () => { if (current) paragraphs.push(current); current = null; };

  for (const line of lines) {
    const single = line.segments.length === 1;
    if (current && canJoin(current, line)) { current.lines.push(line); continue; }
    finish();
    current = { lines: [line] };
  }
  finish();

  function canJoin(paragraph, line) {
    const prev = paragraph.lines[paragraph.lines.length - 1];
    if (line.segments.length !== 1 || prev.segments.length !== 1) {
      // A bullet + text line (two segments) can start a paragraph whose continuation lines are single segments.
      if (!(paragraph.lines.length >= 1 && prev === paragraph.lines[0] && prev.segments.length === 2 && isMarker(prev.segments[0]) && line.segments.length === 1)) return false;
    }
    if (Math.abs(line.size - prev.size) > Math.max(0.6, prev.size * 0.08)) return false;
    const pitch = line.baseline - prev.baseline;
    if (pitch < prev.size * 0.95 || pitch > prev.size * 1.75) return false;
    if (paragraph.lines.length >= 2) {
      const pp = paragraph.lines[paragraph.lines.length - 1].baseline - paragraph.lines[paragraph.lines.length - 2].baseline;
      if (Math.abs(pp - pitch) > Math.max(1.0, prev.size * 0.12)) return false;
    }
    if (startsList(line)) return false;
    const seg = line.segments[0];
    // Wrap test: the first word of this line would have fitted on the previous line → the previous line ended
    // on purpose (hard break), so this is a new paragraph. Right-aligned and centred text grows towards the
    // left as well, so for those the whole measure is available.
    const space = prev.size * 0.28;
    const bothRight = Math.abs(prev.x1 - R) <= 2.5 && Math.abs(line.x1 - R) <= 2.5 && prev.x0 > L + 4 && line.x0 > L + 4;
    const bothCentered = isCentered(prev) && isCentered(line);
    if (bothRight || bothCentered) {
      if ((prev.x1 - prev.x0) + space + seg.firstWordWidth < (R - L) - Math.max(2, prev.size * 0.4)) return false;
    } else if (prev.x1 + space + seg.firstWordWidth < R - Math.max(2, prev.size * 0.4)) return false;
    // Left edge must follow the paragraph body (first line may be indented or outdented).
    const bodyLeft = paragraph.lines.length >= 2 ? paragraph.lines[1].x0 : null;
    const textStart = prev.segments.length === 2 && isMarker(prev.segments[0]) ? prev.segments[1].x0 : prev.x0;
    if (bodyLeft !== null) { if (Math.abs(line.x0 - bodyLeft) > 1.8 && !(isCentered(prev) && isCentered(line))) return false; }
    else if (line.x0 > prev.x0 + 1.8 && Math.abs(line.x0 - textStart) > 1.8 && !(isCentered(prev) && isCentered(line))) return false;
    else if (line.x0 < prev.x0 - width * 0.25) return false;
    return true;
  }

  // Formatting per paragraph.
  for (const paragraph of paragraphs) {
    const ls = paragraph.lines;
    const first = ls[0];
    const multi = ls.length > 1;
    paragraph.size = median(ls.map((l) => l.size));
    paragraph.pitch = multi ? median(ls.slice(1).map((l, k) => l.baseline - ls[k].baseline)) : 0;
    const bodyLeft = multi ? Math.min(...ls.slice(1).map((l) => l.x0)) : first.x0;
    const nonLast = multi ? ls.slice(0, -1) : ls;
    const pRight = Math.max(...nonLast.map((l) => l.x1));
    const allCentered = ls.every(isCentered) && !(multi && nonLast.every((l) => Math.abs(l.x1 - R) < 2 && Math.abs(l.x0 - L) < 2));
    const rightAligned = ls.every((l) => Math.abs(l.x1 - R) <= 2.5) && ls.some((l) => l.x0 > L + 4) && !allCentered;
    const tabbed = first.segments.length > 1 && !(first.segments.length === 2 && isMarker(first.segments[0]));
    let align = 'left';
    if (!tabbed && allCentered) align = 'center';
    else if (!tabbed && rightAligned) align = 'right';
    else if (multi && nonLast.length >= 1 && nonLast.every((l) => Math.abs(l.x1 - pRight) <= 1.6) && pRight >= R - Math.max(6, width * 0.04)) align = 'both';
    paragraph.align = align;
    // Indents (relative to the container text area).
    if (align === 'center') {
      const c = median(ls.map((l) => (l.x0 + l.x1) / 2));
      paragraph.indLeft = c > mid ? 2 * c - L - R : 0;
      paragraph.indRight = c < mid ? R + L - 2 * c : 0;
      paragraph.firstLine = 0;
    } else if (align === 'right') {
      paragraph.indLeft = 0;
      paragraph.indRight = Math.max(0, R - Math.max(...ls.map((l) => l.x1)));
      paragraph.firstLine = 0;
    } else {
      // Bullet with a text segment → hanging indent; text aligned to the second segment.
      const bulletLine = first.segments.length === 2 && isMarker(first.segments[0]);
      const hangLeft = bulletLine ? first.segments[1].x0 : bodyLeft;
      paragraph.indLeft = hangLeft - L;
      paragraph.firstLine = first.x0 - hangLeft;
      paragraph.bulletTab = bulletLine ? first.segments[1].x0 - L : null;
      // Wrapping width for multi-line paragraphs follows the source; single lines may not wrap at all.
      // Lines that filled the source measure get ~2pt of slack so Word's rounding never pushes the last word
      // onto a new line (a word that wrapped in the PDF is always wider than this slack).
      if (multi) paragraph.indRight = R - pRight - clamp(width * 0.003, 0.8, 1.5);
      else paragraph.indRight = Math.min(0, R - first.x1 - 1);
    }
    // Tab stops for tabbed lines (multi-segment). Positions are relative to the container's left edge.
    paragraph.tabs = [];
    if (tabbed && !paragraph.bulletTab) {
      const segs = first.segments;
      for (let k = 1; k < segs.length; k += 1) {
        const seg = segs[k];
        const isLast = k === segs.length - 1;
        if (isLast && Math.abs(seg.x1 - R) <= 3 && seg.x0 > mid) paragraph.tabs.push({ type: 'right', pos: seg.x1 - L });
        else paragraph.tabs.push({ type: 'left', pos: seg.x0 - L });
      }
      paragraph.indLeft = first.x0 - L; paragraph.firstLine = 0;
      paragraph.indRight = Math.min(0, R - first.x1 - 1);
    } else if (paragraph.bulletTab != null) {
      paragraph.tabs.push({ type: 'left', pos: paragraph.bulletTab });
    }
    paragraph.top = first.baseline - first.size * 0.8;
    paragraph.firstBaseline = first.baseline;
    paragraph.lastBaseline = ls[ls.length - 1].baseline;
    paragraph.bottom = paragraph.lastBaseline + first.size * 0.25;
    paragraph.x0 = Math.min(...ls.map((l) => l.x0));
    paragraph.x1 = Math.max(...ls.map((l) => l.x1));
  }
  return paragraphs;
}

// ---------------------------------------------------------------------------------------------------------------
// Tables without a full grid: aligned columns, optionally with horizontal rules and/or row stripes
// ---------------------------------------------------------------------------------------------------------------

/**
 * Rows of text whose pieces line up in the same columns over several consecutive lines are a table even when
 * no vertical lines are drawn (book-style rules, zebra stripes, or no decoration at all). Horizontal rules between
 * rows become row borders and stripes become cell shading, so the result is a real Word table.
 */
export function detectAlignedTables(lines, hRules, fills) {
  const sorted = [...lines].sort((a, b) => a.baseline - b.baseline);
  const tables = []; const usedLines = new Set(); const usedRules = new Set(); const usedFills = new Set();
  let i = 0;
  while (i < sorted.length) {
    if (sorted[i].segments.length < 2) { i += 1; continue; }
    let j = i + 1;
    while (j < sorted.length && sorted[j].segments.length >= 2) {
      const prev = sorted[j - 1]; const next = sorted[j];
      if (next.top - prev.bottom > Math.max(prev.size * 1.9, 9) || Math.abs(next.size - prev.size) > prev.size * 0.35) break;
      j += 1;
    }
    const run = sorted.slice(i, j);
    const table = run.length >= 3 ? alignedTable(run, hRules, fills) : null;
    if (table) {
      tables.push(table);
      for (const line of run) usedLines.add(line);
      for (const rule of table.usedRules) usedRules.add(rule);
      for (const fill of table.usedFills) usedFills.add(fill);
      i = j;
    } else i += 1;
  }
  return { tables, usedLines, usedRules, usedFills };
}

function alignedTable(run, hRules, fills) {
  const spans = run.flatMap((l) => l.segments.map((s) => [s.x0, s.x1])).sort((a, b) => a[0] - b[0]);
  const splits = [];
  let reach = spans[0][1];
  for (const [x0, x1] of spans.slice(1)) {
    if (x0 - reach >= 6) splits.push((x0 + reach) / 2);
    reach = Math.max(reach, x1);
  }
  const cols = splits.length + 1;
  if (cols < 2 || cols > 25 || (cols === 2 && run.length < 4)) return null;
  const colOf = (seg) => splits.filter((x) => (seg.x0 + seg.x1) / 2 > x).length;
  // Every row must use at least two columns, and no row may put two pieces in one column.
  for (const line of run) {
    const used = line.segments.map(colOf);
    if (new Set(used).size !== used.length || used.length < 2) return null;
  }
  const filled = run.reduce((sum, l) => sum + l.segments.length, 0);
  if (filled < run.length * cols * 0.55) return null;
  // Prose set in columns is not a table: table cells are short (few words) compared with the table width.
  const segs = run.flatMap((l) => l.segments);
  const runWidth = Math.max(...run.map((l) => l.x1)) - Math.min(...run.map((l) => l.x0));
  const wordy = segs.filter((seg) => (seg.text.trim().match(/\s+/g) || []).length >= 5).length;
  if (wordy > segs.length * 0.3) return null;
  if (median(segs.map((seg) => seg.x1 - seg.x0)) > runWidth * 0.38 && cols <= 2) return null;
  const minX = Math.min(...run.map((l) => l.x0)); const maxX = Math.max(...run.map((l) => l.x1));
  const width = maxX - minX;
  const spanning = (x0, x1) => x0 <= minX + width * 0.08 && x1 >= maxX - width * 0.08;
  const rules = hRules.filter((r) => spanning(r.x0, r.x1) && r.y >= run[0].top - run[0].size * 1.2 && r.y <= run[run.length - 1].bottom + run[0].size * 1.2);
  const stripes = fills.filter((f) => isColor(f.color) && spanning(f.x0, f.x1) && f.y1 > run[0].top - run[0].size && f.y0 < run[run.length - 1].bottom + run[0].size && (f.y1 - f.y0) < run[0].size * 4);
  let x0 = minX - 4; let x1 = maxX + 4;
  for (const r of [...rules, ...stripes]) { x0 = Math.min(x0, r.x0); x1 = Math.max(x1, r.x1); }
  // Row boundaries: a rule or stripe edge between two rows wins; otherwise the midpoint of the gap.
  const near = (lo, hi) => {
    const rule = rules.filter((r) => r.y >= lo - 1 && r.y <= hi + 1).sort((a, b) => b.width - a.width)[0];
    if (rule) return rule.y;
    const edge = stripes.flatMap((f) => [f.y0, f.y1]).filter((y) => y >= lo - 1 && y <= hi + 1).sort((a, b) => Math.abs(a - (lo + hi) / 2) - Math.abs(b - (lo + hi) / 2))[0];
    return edge ?? (lo + hi) / 2;
  };
  const ys = [near(run[0].top - run[0].size * 0.9, run[0].top)];
  for (let k = 0; k + 1 < run.length; k += 1) ys.push(near(run[k].bottom, run[k + 1].top));
  ys.push(near(run[run.length - 1].bottom, run[run.length - 1].bottom + run[0].size * 0.9));
  for (let k = 1; k < ys.length; k += 1) if (ys[k] <= ys[k - 1] + 1) return null;
  const xs = [x0, ...splits, x1];
  const ruleAt = (y) => { const r = rules.find((rule) => Math.abs(rule.y - y) <= 1.2); return r ? { width: r.width, color: r.color } : null; };
  const cells = [];
  run.forEach((line, r) => {
    for (let c = 0; c < cols; c += 1) {
      const segs = line.segments.filter((seg) => colOf(seg) === c);
      const box = { x0: xs[c], x1: xs[c + 1], y0: ys[r], y1: ys[r + 1] };
      let shade = null; let shadeOp = -1;
      for (const f of stripes) {
        const covered = overlap1d(f.x0, f.x1, box.x0, box.x1) * overlap1d(f.y0, f.y1, box.y0, box.y1);
        if (covered >= boxArea(box) * 0.6 && f.op > shadeOp) { shade = f.color; shadeOp = f.op; }
      }
      if (shade && isWhite(shade)) shade = null;
      cells.push({ r0: r, r1: r, c0: c, c1: c, box, borders: { top: ruleAt(ys[r]), bottom: ruleAt(ys[r + 1]), left: null, right: null }, shade, lines: segs.length ? [lineFromSegments(segs, line)] : [], glyphs: [], images: [] });
    }
  });
  return {
    kind: 'table', xs, ys, rows: run.length, cols, box: { x0, x1, y0: ys[0], y1: ys[ys.length - 1] }, cells, ruled: false, aligned: true,
    usedRules: rules.filter((r) => ys.some((y) => Math.abs(r.y - y) <= 1.2)), usedFills: stripes,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Side-by-side text (letterheads, "label | details" headers) → borderless tables
// ---------------------------------------------------------------------------------------------------------------

function sideBySideBand(lines, start, container) {
  const first = lines[start];
  const look = lines.slice(start + 1, start + 8);
  const disjoint = (a, b) => b.x0 > a.x1 + 4 || b.x1 < a.x0 - 4;
  const partner = look.find((other) => other.top < first.bottom - 0.5 && disjoint(first, other));
  if (!partner) return null;
  let end = start + 1;
  let bandTop = first.top; let bandBottom = first.bottom;
  while (end < lines.length && lines[end].top < bandBottom - 0.5) { bandBottom = Math.max(bandBottom, lines[end].bottom); end += 1; }
  const band = lines.slice(start, end);
  // Free vertical gaps across the band.
  const spans = band.flatMap((l) => l.segments.map((s) => [s.x0, s.x1])).sort((a, b) => a[0] - b[0]);
  const splits = [];
  let reach = spans[0][1];
  for (const [x0, x1] of spans.slice(1)) {
    if (x0 - reach >= 8) splits.push((x0 + reach) / 2);
    reach = Math.max(reach, x1);
  }
  if (!splits.length || splits.length > 3) return null;
  const colOf = (seg) => splits.filter((x) => (seg.x0 + seg.x1) / 2 > x).length;
  const fits = (line) => line.segments.every((seg) => !splits.some((x) => seg.x0 < x && seg.x1 > x));
  // Continuation lines directly below that stay inside one column belong to the band as well.
  while (end < lines.length) {
    const next = lines[end];
    const gap = next.top - bandBottom;
    if (gap > Math.max(next.size * 0.9, 5) || !fits(next)) break;
    const cols = new Set(next.segments.map(colOf));
    if (cols.size !== 1) break;
    band.push(next); bandBottom = Math.max(bandBottom, next.bottom); end += 1;
  }
  const columns = Array.from({ length: splits.length + 1 }, () => []);
  for (const line of band) {
    const groups = new Map();
    for (const seg of line.segments) { const k = colOf(seg); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(seg); }
    for (const [k, segs] of groups) columns[k].push(segs.length === line.segments.length ? line : lineFromSegments(segs, line));
  }
  if (columns.filter((c) => c.length).length < 2) return null;
  const minX = Math.min(...band.map((l) => l.x0)); const maxX = Math.max(...band.map((l) => l.x1));
  const xs = [Math.min(container.left, minX - 1.5), ...splits, Math.max(container.right, maxX + 1.5)];
  const y0 = Math.min(...band.map((l) => l.baseline - l.size * 0.95)) - 0.5;
  const y1 = Math.max(...band.map((l) => l.baseline + l.size * 0.3));
  const cells = columns.map((colLines, k) => ({
    r0: 0, r1: 0, c0: k, c1: k, box: { x0: xs[k], x1: xs[k + 1], y0, y1 },
    borders: { top: null, bottom: null, left: null, right: null }, shade: null, lines: colLines.sort((a, b) => a.baseline - b.baseline), glyphs: [], images: [],
  }));
  return { end, table: { kind: 'table', box: { x0: xs[0], x1: xs[xs.length - 1], y0, y1 }, xs, ys: [y0, y1], rows: 1, cols: xs.length - 1, cells, ruled: false, sideBySide: true } };
}

/** Lines of one container → paragraphs and (for side-by-side bands) borderless tables. */
export function layoutLines(lines, container, { allowSideBySide = true } = {}) {
  const sorted = [...lines].sort((a, b) => a.baseline - b.baseline || a.x0 - b.x0);
  const blocks = [];
  let pending = [];
  const flush = () => { if (pending.length) blocks.push(...buildParagraphs(pending, container).map((p) => ({ type: 'paragraph', ...p }))); pending = []; };
  for (let i = 0; i < sorted.length;) {
    const band = allowSideBySide ? sideBySideBand(sorted, i, container) : null;
    if (band) { flush(); blocks.push(buildTableBlock(band.table, container.left, { nested: !allowSideBySide })); i = band.end; continue; }
    pending.push(sorted[i]); i += 1;
  }
  flush();
  return blocks;
}

/** Build the Word-ready block for a detected table: cell paragraphs, cell pictures and vertical spacing. */
export function buildTableBlock(table, containerLeft, { nested = false } = {}) {
  for (const cell of table.cells) {
    const cellLines = [...(cell.lines || []), ...(cell.glyphs?.length ? buildLines(cell.glyphs) : [])];
    const box = { left: cell.box.x0 + 1.5, right: cell.box.x1 - 1.5 };
    // Nested side-by-side detection is allowed one level deep (e.g. a title bar with left/right text).
    const blocks = layoutLines(cellLines, box, { allowSideBySide: !nested && !table.sideBySide });
    // Paragraph geometry was measured from the padded text box; Word measures from the cell edge (cell margins
    // are zero), so shift indents, tab stops and nested tables by the padding.
    for (const p of blocks) {
      if (p.type === 'table') { p.indent += 1.5; continue; }
      if (p.type !== 'paragraph') continue;
      p.indLeft = (p.indLeft || 0) + 1.5;
      p.indRight = (p.indRight || 0) + 1.5;
      if (p.tabs) for (const tab of p.tabs) tab.pos += 1.5;
      // Cells cannot borrow width from neighbours; never use negative indents there.
      p.indRight = Math.max(0, p.indRight);
      p.indLeft = Math.max(0, p.indLeft);
      if ((p.firstLine || 0) < -p.indLeft) p.firstLine = -p.indLeft;
    }
    cell.paragraphs = blocks.filter((b) => b.type === 'paragraph');
    const images = (cell.images || []).map((figure) => ({ type: 'image', box: figure.box, figure, align: 'left', indLeft: Math.max(0, figure.box.x0 - cell.box.x0) }));
    const all = [...blocks, ...images].sort((a, b) => blockTop(a) - blockTop(b));
    // Content starts below the top border; if content + borders would exceed the row, Word/LibreOffice grow the
    // row and push everything below down, so trim the leading space instead.
    const topB = cell.borders?.top?.width || 0; const botB = cell.borders?.bottom?.width || 0;
    const end = assignVerticalSpacing(all, cell.box.y0 + topB);
    const overflow = end + botB - cell.box.y1;
    if (overflow > 0 && all[0] && all[0].spaceBefore) all[0].spaceBefore = Math.max(0, all[0].spaceBefore - overflow);
    cell.blocks = all;
  }
  alignTableColumns(table);
  return { type: 'table', box: table.box, xs: table.xs, ys: table.ys, cells: table.cells, indent: table.box.x0 - containerLeft, fromFill: Boolean(table.fromFill), sideBySide: Boolean(table.sideBySide) };
}

/**
 * Text alignment inside table cells is decided per grid column: numbers that share a right edge across rows are
 * right-aligned, text sharing a centre is centred. Single cells fall back to their padding balance.
 */
function alignTableColumns(table) {
  const singleLine = (cell) => cell.paragraphs?.length === 1 && cell.paragraphs[0].lines.length === 1 && cell.paragraphs[0].lines[0].segments.length === 1 ? cell.paragraphs[0] : null;
  const apply = (cell, p, align) => {
    const line = p.lines[0];
    const left = cell.box.x0; const right = cell.box.x1;
    if (align === 'right') { p.align = 'right'; p.indLeft = 0; p.firstLine = 0; p.indRight = Math.max(0, right - line.x1); }
    else if (align === 'center') {
      p.align = 'center'; p.firstLine = 0;
      const c = (line.x0 + line.x1) / 2; const mid = (left + right) / 2;
      p.indLeft = c > mid ? 2 * c - left - right : 0; p.indRight = c < mid ? right + left - 2 * c : 0;
    }
  };
  for (let c = 0; c < (table.cols || table.xs.length - 1); c += 1) {
    const column = table.cells.filter((cell) => cell.c0 === c && cell.c1 === c).map((cell) => ({ cell, p: singleLine(cell) })).filter((e) => e.p);
    if (column.length >= 2) {
      const x0s = column.map((e) => e.p.lines[0].x0 - e.cell.box.x0);
      const x1s = column.map((e) => e.cell.box.x1 - e.p.lines[0].x1);
      const spread = (v) => Math.max(...v) - Math.min(...v);
      // Header cells often differ from the data below; judge on the rows that agree.
      const right = x1s.filter((v) => Math.abs(v - median(x1s)) <= 1.2).length;
      const leftAgree = x0s.filter((v) => Math.abs(v - median(x0s)) <= 1.2).length;
      if (right >= column.length * 0.6 && right > leftAgree && spread(x0s) > 3) {
        for (const e of column) if (Math.abs(e.cell.box.x1 - e.p.lines[0].x1 - median(x1s)) <= 1.2) apply(e.cell, e.p, 'right');
        continue;
      }
      const centers = column.map((e) => (e.p.lines[0].x0 + e.p.lines[0].x1) / 2 - (e.cell.box.x0 + e.cell.box.x1) / 2);
      if (spread(centers.filter((v) => Math.abs(v - median(centers)) <= 1.2)) <= 1.2 && centers.filter((v) => Math.abs(v - median(centers)) <= 1.2).length >= column.length * 0.6 && spread(x0s) > 3 && Math.abs(median(centers)) < 2) {
        for (const e of column) if (Math.abs((e.p.lines[0].x0 + e.p.lines[0].x1) / 2 - (e.cell.box.x0 + e.cell.box.x1) / 2 - median(centers)) <= 1.2) apply(e.cell, e.p, 'center');
        continue;
      }
    }
    for (const e of column.length ? column : []) {
      if (e.p.align !== 'left') continue;
      const line = e.p.lines[0];
      const leftGap = line.x0 - e.cell.box.x0; const rightGap = e.cell.box.x1 - line.x1;
      if (rightGap <= 7 && leftGap > rightGap + 10) apply(e.cell, e.p, 'right');
      else if (Math.abs(leftGap - rightGap) <= 1.5 && leftGap > 8) apply(e.cell, e.p, 'center');
    }
  }
  // Spanning cells (e.g. a merged title row) are centred when balanced.
  for (const cell of table.cells) {
    if (cell.c0 === cell.c1) continue;
    const p = singleLine(cell);
    if (!p || p.align !== 'left') continue;
    const line = p.lines[0];
    const leftGap = line.x0 - cell.box.x0; const rightGap = cell.box.x1 - line.x1;
    if (Math.abs(leftGap - rightGap) <= 2 && leftGap > 8) apply(cell, p, 'center');
  }
}

const blockTop = (block) => (block.type === 'paragraph' ? block.top : block.box ? block.box.y0 : block.y0 ?? 0);

/** Choose exact line heights and the space before each block so baselines land where the PDF had them. */
export function assignVerticalSpacing(blocks, startY) {
  let cursor = startY; // y of the bottom of the previous block's last line box
  for (const block of blocks) {
    if (block.type === 'paragraph') {
      const size = block.size || 10;
      const natural = Math.max(size * 1.15, size + 1);
      let h = block.pitch && block.pitch > size * 0.95 ? block.pitch : natural;
      // The first line box top must sit at firstBaseline - 0.8h.
      let top = block.firstBaseline - BASELINE_RATIO * h;
      let before = top - cursor;
      if (before < 0) {
        // Not enough room (tight line pitch or overlapping blocks): shrink this line height for single lines.
        if (!block.pitch) { h = Math.max(size * 0.9, h + before / BASELINE_RATIO); top = block.firstBaseline - BASELINE_RATIO * h; before = Math.max(0, top - cursor); }
        else before = 0;
      }
      block.lineHeight = h;
      block.spaceBefore = before;
      const lineCount = block.lineCount || block.lines.length;
      cursor = Math.max(cursor + before, top) + h * lineCount;
    } else if (block.type === 'table' || block.type === 'image') {
      block.spaceBefore = Math.max(0, block.box.y0 - cursor);
      cursor = Math.max(cursor, block.box.y1);
    } else if (block.type === 'columns') {
      const start = cursor;
      const ends = block.columns.map((column) => assignVerticalSpacing(column.blocks, start));
      cursor = Math.max(start, ...ends);
    }
  }
  return cursor;
}

export const __layoutInternals = { median, mode, intersects, inside, unionBox, glyphBox, boxArea, isWhite, isColor, clusterValues };
