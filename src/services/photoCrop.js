/** Pure crop geometry helpers. Coordinates are normalized to the displayed image bounds. */
export const MIN_CROP_SIZE = 0.005;
const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));

/** Returns crop width/height in normalized coordinates for the requested output aspect. */
export function normalizedCropAspect(aspect, imageAspect = 1) {
  if (!aspect || aspect === 'free') return null;
  const normalizedImageAspect = Math.max(0.0001, Number(imageAspect) || 1);
  const requested = aspect === 'original'
    ? normalizedImageAspect
    : (() => {
        const [width, height] = String(aspect).split(':').map(Number);
        return width > 0 && height > 0 ? width / height : null;
      })();
  return requested ? requested / normalizedImageAspect : null;
}

export function normalizeCropRect(rect) {
  let w = clamp(Number(rect?.w) || MIN_CROP_SIZE, MIN_CROP_SIZE, 1);
  let h = clamp(Number(rect?.h) || MIN_CROP_SIZE, MIN_CROP_SIZE, 1);
  w = Math.min(w, 1);
  h = Math.min(h, 1);
  const x = clamp(Number(rect?.x) || 0, 0, 1 - w);
  const y = clamp(Number(rect?.y) || 0, 0, 1 - h);
  return { x, y, w, h };
}

/** Draws a new selection from any starting corner, respecting an optional aspect ratio. */
export function cropFromDrag(start, current, aspect = 'free', imageAspect = 1) {
  const dx = current.x - start.x;
  const dy = current.y - start.y;
  const signX = dx < 0 ? -1 : 1;
  const signY = dy < 0 ? -1 : 1;
  let width = Math.abs(dx);
  let height = Math.abs(dy);
  const ratio = normalizedCropAspect(aspect, imageAspect);

  if (ratio) {
    width = Math.max(width, height * ratio, MIN_CROP_SIZE);
    height = width / ratio;
    const availableWidth = signX > 0 ? 1 - start.x : start.x;
    const availableHeight = signY > 0 ? 1 - start.y : start.y;
    const scale = Math.min(1, availableWidth / Math.max(width, MIN_CROP_SIZE), availableHeight / Math.max(height, MIN_CROP_SIZE));
    width *= scale;
    height *= scale;
  } else {
    width = Math.min(width, signX > 0 ? 1 - start.x : start.x);
    height = Math.min(height, signY > 0 ? 1 - start.y : start.y);
  }

  width = clamp(width, MIN_CROP_SIZE, signX > 0 ? Math.max(MIN_CROP_SIZE, 1 - start.x) : Math.max(MIN_CROP_SIZE, start.x));
  height = clamp(height, MIN_CROP_SIZE, signY > 0 ? Math.max(MIN_CROP_SIZE, 1 - start.y) : Math.max(MIN_CROP_SIZE, start.y));
  const endX = start.x + signX * width;
  const endY = start.y + signY * height;
  return normalizeCropRect({ x: Math.min(start.x, endX), y: Math.min(start.y, endY), w: Math.abs(endX - start.x), h: Math.abs(endY - start.y) });
}

/** Fits the largest requested-aspect selection inside the current rectangle, centered. */
export function fitCropRectToAspect(rect, aspect, imageAspect = 1) {
  const base = normalizeCropRect(rect);
  const ratio = normalizedCropAspect(aspect, imageAspect);
  if (!ratio) return base;
  let w = base.w;
  let h = base.h;
  if (w / h > ratio) w = h * ratio;
  else h = w / ratio;
  const centerX = base.x + base.w / 2;
  const centerY = base.y + base.h / 2;
  return normalizeCropRect({ x: centerX - w / 2, y: centerY - h / 2, w, h });
}

export function moveCropRect(rect, dx, dy) {
  const base = normalizeCropRect(rect);
  return {
    ...base,
    x: clamp(base.x + dx, 0, 1 - base.w),
    y: clamp(base.y + dy, 0, 1 - base.h),
  };
}

/** Resizes a crop selection from one of its eight handles. */
export function resizeCropRect(rect, handle, point, aspect = 'free', imageAspect = 1) {
  const base = normalizeCropRect(rect);
  const left0 = base.x;
  const right0 = base.x + base.w;
  const top0 = base.y;
  const bottom0 = base.y + base.h;
  const ratio = normalizedCropAspect(aspect, imageAspect);
  const west = handle.includes('w');
  const east = handle.includes('e');
  const north = handle.includes('n');
  const south = handle.includes('s');

  if (ratio && (west || east) && (north || south)) {
    const anchorX = west ? right0 : left0;
    const anchorY = north ? bottom0 : top0;
    const signX = east ? 1 : -1;
    const signY = south ? 1 : -1;
    let w = Math.max(Math.abs(point.x - anchorX), Math.abs(point.y - anchorY) * ratio, MIN_CROP_SIZE);
    let h = w / ratio;
    const availableW = signX > 0 ? 1 - anchorX : anchorX;
    const availableH = signY > 0 ? 1 - anchorY : anchorY;
    const scale = Math.min(1, availableW / w, availableH / h);
    w *= scale;
    h *= scale;
    return normalizeCropRect({ x: signX > 0 ? anchorX : anchorX - w, y: signY > 0 ? anchorY : anchorY - h, w, h });
  }

  if (ratio && (west || east)) {
    const anchorX = west ? right0 : left0;
    const centerY = (top0 + bottom0) / 2;
    const signX = east ? 1 : -1;
    const maxW = Math.min(signX > 0 ? 1 - anchorX : anchorX, ratio * 2 * Math.min(centerY, 1 - centerY));
    const w = clamp(Math.abs(point.x - anchorX), MIN_CROP_SIZE, Math.max(MIN_CROP_SIZE, maxW));
    const h = w / ratio;
    return normalizeCropRect({ x: signX > 0 ? anchorX : anchorX - w, y: centerY - h / 2, w, h });
  }

  if (ratio && (north || south)) {
    const anchorY = north ? bottom0 : top0;
    const centerX = (left0 + right0) / 2;
    const signY = south ? 1 : -1;
    const maxH = Math.min(signY > 0 ? 1 - anchorY : anchorY, (2 * Math.min(centerX, 1 - centerX)) / ratio);
    const h = clamp(Math.abs(point.y - anchorY), MIN_CROP_SIZE, Math.max(MIN_CROP_SIZE, maxH));
    const w = h * ratio;
    return normalizeCropRect({ x: centerX - w / 2, y: signY > 0 ? anchorY : anchorY - h, w, h });
  }

  let left = left0;
  let right = right0;
  let top = top0;
  let bottom = bottom0;
  if (west) left = clamp(point.x, 0, right - MIN_CROP_SIZE);
  if (east) right = clamp(point.x, left + MIN_CROP_SIZE, 1);
  if (north) top = clamp(point.y, 0, bottom - MIN_CROP_SIZE);
  if (south) bottom = clamp(point.y, top + MIN_CROP_SIZE, 1);
  return normalizeCropRect({ x: left, y: top, w: right - left, h: bottom - top });
}

/** Sets crop dimensions in source pixels; preserves center and locked aspect when selected. */
export function resizeCropDimension(rect, axis, pixelValue, sourceWidth, sourceHeight, aspect = 'free', imageAspect = 1) {
  const base = normalizeCropRect(rect);
  const total = axis === 'w' ? Number(sourceWidth) : Number(sourceHeight);
  if (!Number.isFinite(Number(pixelValue)) || Number(pixelValue) <= 0 || total <= 0) return base;
  const ratio = normalizedCropAspect(aspect, imageAspect);
  let w = axis === 'w' ? clamp(Number(pixelValue) / total, MIN_CROP_SIZE, 1) : base.w;
  let h = axis === 'h' ? clamp(Number(pixelValue) / total, MIN_CROP_SIZE, 1) : base.h;
  if (ratio) {
    if (axis === 'w') h = w / ratio;
    else w = h * ratio;
  }
  const scale = Math.min(1, 1 / w, 1 / h);
  w *= scale;
  h *= scale;
  const centerX = base.x + base.w / 2;
  const centerY = base.y + base.h / 2;
  return normalizeCropRect({ x: centerX - w / 2, y: centerY - h / 2, w, h });
}
