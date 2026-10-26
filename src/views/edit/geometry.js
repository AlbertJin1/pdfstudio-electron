// Pure geometry helpers shared by the editor: bounding boxes, transforms, align and distribute.
// Every coordinate is in PDF points, measured from the top-left of the displayed (rotated) page.
export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export const itemBox = (item) => ({ x: item.x, y: item.y, w: item.w, h: item.h });

export function boundsOf(items) {
  if (!items.length) return null;
  let x1 = Infinity; let y1 = Infinity; let x2 = -Infinity; let y2 = -Infinity;
  for (const item of items) {
    x1 = Math.min(x1, item.x); y1 = Math.min(y1, item.y);
    x2 = Math.max(x2, item.x + item.w); y2 = Math.max(y2, item.y + item.h);
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

export const rectsIntersect = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
export const rectContains = (outer, inner) => inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;

const mapPoint = (p, fn) => ({ ...p, x: fn.x(p.x), y: fn.y(p.y) });

export function translateItem(item, dx, dy) {
  const next = { ...item, x: item.x + dx, y: item.y + dy };
  if (item.points) next.points = item.points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
  if (item.startPoint) next.startPoint = { x: item.startPoint.x + dx, y: item.startPoint.y + dy };
  if (item.endPoint) next.endPoint = { x: item.endPoint.x + dx, y: item.endPoint.y + dy };
  return next;
}

/** Map an item from one box to another (used for resizing). Point lists scale with the box. */
export function transformItem(item, from, to) {
  const sx = from.w > 0 ? to.w / from.w : 1;
  const sy = from.h > 0 ? to.h / from.h : 1;
  const fn = { x: (v) => to.x + (v - from.x) * sx, y: (v) => to.y + (v - from.y) * sy };
  const next = { ...item, x: to.x, y: to.y, w: to.w, h: to.h };
  if (item.points) next.points = item.points.map((p) => mapPoint(p, fn));
  if (item.startPoint) next.startPoint = mapPoint(item.startPoint, fn);
  if (item.endPoint) next.endPoint = mapPoint(item.endPoint, fn);
  return next;
}

export function alignItems(items, mode, target) {
  return items.map((item) => {
    let dx = 0; let dy = 0;
    if (mode === 'left') dx = target.x - item.x;
    else if (mode === 'center') dx = target.x + target.w / 2 - (item.x + item.w / 2);
    else if (mode === 'right') dx = target.x + target.w - (item.x + item.w);
    else if (mode === 'top') dy = target.y - item.y;
    else if (mode === 'middle') dy = target.y + target.h / 2 - (item.y + item.h / 2);
    else if (mode === 'bottom') dy = target.y + target.h - (item.y + item.h);
    return translateItem(item, dx, dy);
  });
}

/** Equal gaps between items along one axis; the outermost two stay where they are. */
export function distributeItems(items, axis) {
  if (items.length < 3) return items;
  const pos = axis === 'h' ? 'x' : 'y';
  const size = axis === 'h' ? 'w' : 'h';
  const sorted = [...items].sort((a, b) => a[pos] - b[pos]);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const span = last[pos] + last[size] - first[pos];
  const total = sorted.reduce((sum, item) => sum + item[size], 0);
  const gap = (span - total) / (sorted.length - 1);
  let cursor = first[pos];
  const moved = new Map();
  for (const item of sorted) {
    const delta = cursor - item[pos];
    moved.set(item.id, axis === 'h' ? translateItem(item, delta, 0) : translateItem(item, 0, delta));
    cursor += item[size] + gap;
  }
  return items.map((item) => moved.get(item.id) || item);
}
