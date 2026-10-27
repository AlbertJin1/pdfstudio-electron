// Persistent signature presets. Every signature that is drawn, typed or uploaded is saved here once and can be
// picked again from the dialog forever. Stored in localStorage as small PNG data URLs (max 600px wide).
const KEY = 'pdfstudio.signatures.v1';
const MAX_ITEMS = 40;
const MAX_WIDTH = 600;

const uid = () => `sig-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export function loadSignatures() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(list) ? list.filter((s) => s && typeof s.data === 'string' && s.data.startsWith('data:image/')) : [];
  } catch { return []; }
}

function persist(list) {
  // If storage is full, drop the oldest presets until the list fits.
  let next = list;
  while (next.length) {
    try { localStorage.setItem(KEY, JSON.stringify(next)); return next; } catch { next = next.slice(0, -1); }
  }
  try { localStorage.removeItem(KEY); } catch { /* storage unavailable */ }
  return next;
}

/** Add a signature (or move an identical one to the front). Returns the updated list. */
export function saveSignature(list, sig) {
  const existing = list.find((s) => s.data === sig.data);
  const entry = existing || { id: uid(), data: sig.data, width: sig.width, height: sig.height, name: sig.name || '', createdAt: Date.now() };
  const rest = list.filter((s) => s.id !== entry.id);
  return persist([entry, ...rest].slice(0, MAX_ITEMS));
}

export function removeSignature(list, id) { return persist(list.filter((s) => s.id !== id)); }

const loadImage = (src) => new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error('This image could not be opened.')); img.src = src; });

/** Crop a canvas to its non-transparent pixels (with a small margin) and cap the width so presets stay light. */
export function trimCanvas(source, pad = 6) {
  const { width, height } = source;
  const data = source.getContext('2d').getImageData(0, 0, width, height).data;
  let x1 = width; let y1 = height; let x2 = -1; let y2 = -1;
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    if (data[(y * width + x) * 4 + 3] > 8) { if (x < x1) x1 = x; if (x > x2) x2 = x; if (y < y1) y1 = y; if (y > y2) y2 = y; }
  }
  if (x2 < 0) return null;
  x1 = Math.max(0, x1 - pad); y1 = Math.max(0, y1 - pad); x2 = Math.min(width - 1, x2 + pad); y2 = Math.min(height - 1, y2 + pad);
  const w = x2 - x1 + 1; const h = y2 - y1 + 1; const k = Math.min(1, MAX_WIDTH / w);
  const out = document.createElement('canvas'); out.width = Math.max(1, Math.round(w * k)); out.height = Math.max(1, Math.round(h * k));
  out.getContext('2d').drawImage(source, x1, y1, w, h, 0, 0, out.width, out.height);
  return out;
}

/** Turn a canvas (drawn / typed / uploaded) into a trimmed preset payload. */
export function canvasToSignature(canvas, extra = {}) {
  const out = trimCanvas(canvas);
  if (!out) return null;
  return { data: out.toDataURL('image/png'), width: out.width, height: out.height, ...extra };
}

/** Read an image file as a signature. `removeBackground` turns white / light paper into transparency. */
export async function signatureFromFile(file, { removeBackground = true } = {}) {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas'); canvas.width = Math.round(img.naturalWidth * k); canvas.height = Math.round(img.naturalHeight * k);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    if (removeBackground) {
      const frame = ctx.getImageData(0, 0, canvas.width, canvas.height); const px = frame.data;
      for (let i = 0; i < px.length; i += 4) {
        if (px[i + 3] === 0) continue;
        // Luminance → alpha: white paper becomes clear, dark ink stays solid, soft edges stay smooth.
        const lum = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
        const a = lum >= 235 ? 0 : lum <= 150 ? 255 : Math.round(((235 - lum) / 85) * 255);
        px[i + 3] = Math.min(px[i + 3], a);
      }
      ctx.putImageData(frame, 0, 0);
    }
    const sig = canvasToSignature(canvas, { name: file.name.replace(/\.[^.]+$/, '') });
    if (!sig) throw new Error('No signature was found in this image. Try a clearer photo or turn off "Remove white background".');
    return sig;
  } finally { URL.revokeObjectURL(url); }
}
