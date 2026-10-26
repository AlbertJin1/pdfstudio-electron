// Snapping engine: page edges and centre, margins, user guides, grid and other objects (smart guides).
import { clamp } from './geometry.js';

/** Collect every vertical (x) and horizontal (y) line the cursor or an object edge may snap to. */
export function buildSnapLines({ pageW, pageH, margins, guides, objects, flags }) {
  const v = [];
  const h = [];
  if (flags.page) {
    v.push({ pos: 0, kind: 'page' }, { pos: pageW / 2, kind: 'page' }, { pos: pageW, kind: 'page' });
    h.push({ pos: 0, kind: 'page' }, { pos: pageH / 2, kind: 'page' }, { pos: pageH, kind: 'page' });
  }
  if (flags.margins && margins) {
    v.push({ pos: margins.left, kind: 'margin' }, { pos: pageW - margins.right, kind: 'margin' });
    h.push({ pos: margins.top, kind: 'margin' }, { pos: pageH - margins.bottom, kind: 'margin' });
  }
  if (flags.guides && guides) {
    for (const pos of guides.v || []) v.push({ pos, kind: 'guide' });
    for (const pos of guides.h || []) h.push({ pos, kind: 'guide' });
  }
  if (flags.objects) {
    for (const o of objects) {
      const ext = { from: o.y, to: o.y + o.h };
      v.push({ pos: o.x, kind: 'object', ...ext }, { pos: o.x + o.w / 2, kind: 'object', ...ext }, { pos: o.x + o.w, kind: 'object', ...ext });
      const extX = { from: o.x, to: o.x + o.w };
      h.push({ pos: o.y, kind: 'object', ...extX }, { pos: o.y + o.h / 2, kind: 'object', ...extX }, { pos: o.y + o.h, kind: 'object', ...extX });
    }
  }
  return { v, h, gridSize: flags.grid ? flags.gridSize : 0 };
}

function bestSnap(values, lines, threshold) {
  let best = null;
  for (const value of values) {
    for (const line of lines) {
      const delta = line.pos - value;
      if (Math.abs(delta) <= threshold && (!best || Math.abs(delta) < Math.abs(best.delta) - 1e-6)) best = { delta, line };
    }
  }
  return best;
}

function gridSnap(values, size, threshold) {
  if (!size) return null;
  let best = null;
  for (const value of values) {
    const delta = Math.round(value / size) * size - value;
    if (Math.abs(delta) <= threshold && (!best || Math.abs(delta) < Math.abs(best.delta))) best = { delta, line: { pos: value + delta, kind: 'grid' } };
  }
  return best;
}

function collectHits(axis, values, shift, lines, rect, hits) {
  for (const value of values) {
    for (const line of lines) {
      if (Math.abs(line.pos - (value + shift)) > 0.01) continue;
      const own = axis === 'v' ? { from: rect.y, to: rect.y + rect.h } : { from: rect.x, to: rect.x + rect.w };
      const entry = { axis, pos: line.pos, kind: line.kind };
      if (line.kind === 'object') { entry.from = Math.min(own.from, line.from); entry.to = Math.max(own.to, line.to); }
      if (!hits.some((h) => h.axis === axis && Math.abs(h.pos - entry.pos) < 0.01)) hits.push(entry);
    }
  }
}

/** Snap a moving rectangle (left/centre/right and top/middle/bottom edges). */
export function snapMove(rect, set, threshold) {
  const xs = [rect.x, rect.x + rect.w / 2, rect.x + rect.w];
  const ys = [rect.y, rect.y + rect.h / 2, rect.y + rect.h];
  const sx = bestSnap(xs, set.v, threshold) || gridSnap([rect.x], set.gridSize, threshold);
  const sy = bestSnap(ys, set.h, threshold) || gridSnap([rect.y], set.gridSize, threshold);
  const dx = sx?.delta || 0;
  const dy = sy?.delta || 0;
  const hits = [];
  if (sx) collectHits('v', xs, dx, set.v, { ...rect, x: rect.x + dx, y: rect.y + dy }, hits);
  if (sy) collectHits('h', ys, dy, set.h, { ...rect, x: rect.x + dx, y: rect.y + dy }, hits);
  if (sx && sx.line.kind === 'grid') hits.push({ axis: 'v', pos: sx.line.pos, kind: 'grid' });
  if (sy && sy.line.kind === 'grid') hits.push({ axis: 'h', pos: sy.line.pos, kind: 'grid' });
  return { dx, dy, hits };
}

/** Snap a single pointer position (used by drawing tools and guide creation). */
export function snapPoint(point, set, threshold) {
  const sx = bestSnap([point.x], set.v, threshold) || gridSnap([point.x], set.gridSize, threshold);
  const sy = bestSnap([point.y], set.h, threshold) || gridSnap([point.y], set.gridSize, threshold);
  const hits = [];
  if (sx) hits.push({ axis: 'v', pos: sx.line.pos, kind: sx.line.kind });
  if (sy) hits.push({ axis: 'h', pos: sy.line.pos, kind: sy.line.kind });
  return { x: point.x + (sx?.delta || 0), y: point.y + (sy?.delta || 0), hits };
}

/** Snap only the edges a resize handle is dragging. Returns an adjusted rectangle. */
export function snapResize(rect, handle, set, threshold, minSize = 2) {
  let { x, y, w, h } = rect;
  const hits = [];
  const edge = (axis, value, lines) => {
    const snap = bestSnap([value], lines, threshold) || gridSnap([value], axis === 'v' ? set.gridSize : set.gridSize, threshold);
    if (snap) hits.push({ axis, pos: snap.line.pos, kind: snap.line.kind, ...(snap.line.kind === 'object' ? { from: snap.line.from, to: snap.line.to } : {}) });
    return snap ? snap.delta : 0;
  };
  if (handle.includes('w')) { const d = edge('v', x, set.v); x += d; w -= d; }
  if (handle.includes('e')) { const d = edge('v', x + w, set.v); w += d; }
  if (handle.includes('n')) { const d = edge('h', y, set.h); y += d; h -= d; }
  if (handle.includes('s')) { const d = edge('h', y + h, set.h); h += d; }
  return { rect: { x, y, w: Math.max(minSize, w), h: Math.max(minSize, h) }, hits };
}

export const snapThreshold = (scale) => clamp(6 / Math.max(scale, 0.05), 1.5, 24);
