/**
 * Image-to-text helpers (renderer side). Pre-processing runs on a canvas so the OCR engine receives a clean,
 * well-scaled bitmap; recognition itself runs offline in the Electron main process (see image-text-extractor.cjs).
 */
export const ENHANCE_MODES = [
  { value: 'auto', label: 'Auto enhance', hint: 'Best for photos & screenshots' },
  { value: 'document', label: 'Document / scan', hint: 'Black & white, fixes shadows' },
  { value: 'none', label: 'None', hint: 'Original pixels' },
];
export const LAYOUT_MODES = [
  { value: 'auto', label: 'Automatic layout' },
  { value: 'block', label: 'Single text block' },
  { value: 'column', label: 'Single column' },
  { value: 'sparse', label: 'Sparse text (signs, labels)' },
  { value: 'line', label: 'Single line' },
];
import { detectAndEraseEmoji, mergeEmoji } from './emoji.js';

export const IMAGE_EXTENSIONS = /\.(png|jpe?g|webp|bmp|gif)$/i;

const MAX_SIDE_ENHANCED = 4200;
const MAX_SIDE_DOCUMENT = 3200;
const TARGET_MIN_LONG_SIDE = 1800;

export async function decodeImage(blob) {
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(blob, { imageOrientation: 'from-image' }); } catch { /* fall back below */ }
  }
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.decoding = 'async';
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error('This image format could not be decoded. Use PNG, JPG, WebP, BMP or GIF.')); image.src = url; });
    return image;
  } finally { setTimeout(() => URL.revokeObjectURL(url), 0); }
}

function stretchContrast(data) {
  const histogram = new Uint32Array(256);
  const total = data.length / 4;
  for (let i = 0; i < data.length; i += 4) {
    const gray = (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8;
    data[i] = data[i + 1] = data[i + 2] = gray;
    histogram[gray] += 1;
  }
  let low = 0; let high = 255; let acc = 0;
  for (let v = 0; v < 256; v += 1) { acc += histogram[v]; if (acc >= total * 0.005) { low = v; break; } }
  acc = 0;
  for (let v = 255; v >= 0; v -= 1) { acc += histogram[v]; if (acc >= total * 0.005) { high = v; break; } }
  if (high - low < 24) return; // already flat/very low contrast; avoid amplifying noise
  const scale = 255 / (high - low);
  for (let i = 0; i < data.length; i += 4) {
    const v = Math.max(0, Math.min(255, Math.round((data[i] - low) * scale)));
    data[i] = data[i + 1] = data[i + 2] = v;
  }
}

function adaptiveThreshold(data, width, height) {
  const gray = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) gray[p] = (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8;
  const stride = width + 1;
  const integral = new Float64Array(stride * (height + 1));
  for (let y = 1; y <= height; y += 1) {
    let row = 0;
    for (let x = 1; x <= width; x += 1) {
      row += gray[(y - 1) * width + (x - 1)];
      integral[y * stride + x] = integral[(y - 1) * stride + x] + row;
    }
  }
  const radius = Math.max(8, Math.round(Math.min(width, height) / 24));
  for (let y = 0; y < height; y += 1) {
    const y0 = Math.max(0, y - radius); const y1 = Math.min(height - 1, y + radius);
    for (let x = 0; x < width; x += 1) {
      const x0 = Math.max(0, x - radius); const x1 = Math.min(width - 1, x + radius);
      const area = (x1 - x0 + 1) * (y1 - y0 + 1);
      const sum = integral[(y1 + 1) * stride + (x1 + 1)] - integral[y0 * stride + (x1 + 1)] - integral[(y1 + 1) * stride + x0] + integral[y0 * stride + x0];
      const value = gray[y * width + x] < (sum / area) * 0.88 ? 0 : 255;
      const i = (y * width + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = value;
    }
  }
}

/** Rotate (0/90/180/270), rescale to a size OCR likes, optionally enhance, and return PNG (or JPEG if huge) bytes. */
export async function preprocessImage(bitmap, { mode = 'auto', rotate = 0, emoji = false } = {}) {
  const quarter = ((Math.round(rotate / 90) % 4) + 4) % 4;
  const srcW = bitmap.width; const srcH = bitmap.height;
  const long = Math.max(srcW, srcH);
  const maxSide = mode === 'document' ? MAX_SIDE_DOCUMENT : MAX_SIDE_ENHANCED;
  let scale = 1;
  if (mode !== 'none' && long < TARGET_MIN_LONG_SIDE) scale = Math.min(3, TARGET_MIN_LONG_SIDE / long);
  if (long * scale > maxSide) scale = maxSide / long;
  const drawW = Math.max(1, Math.round(srcW * scale)); const drawH = Math.max(1, Math.round(srcH * scale));
  const outW = quarter % 2 ? drawH : drawW; const outH = quarter % 2 ? drawW : drawH;
  const canvas = document.createElement('canvas');
  canvas.width = outW; canvas.height = outH;
  const context = canvas.getContext('2d', { willReadFrequently: mode !== 'none' || emoji });
  if (!context) throw new Error('Could not create an image canvas.');
  context.fillStyle = '#ffffff'; context.fillRect(0, 0, outW, outH);
  context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
  context.translate(outW / 2, outH / 2); context.rotate(quarter * Math.PI / 2);
  context.drawImage(bitmap, -drawW / 2, -drawH / 2, drawW, drawH);
  context.setTransform(1, 0, 0, 1, 0, 0);
  // Emoji are located on the colour image, matched, then painted out so OCR does not turn them into junk characters.
  const found = emoji ? await detectAndEraseEmoji(canvas, context) : { emojis: [], skipped: 0 };
  if (mode !== 'none') {
    const imageData = context.getImageData(0, 0, outW, outH);
    if (mode === 'document') adaptiveThreshold(imageData.data, outW, outH); else stretchContrast(imageData.data);
    context.putImageData(imageData, 0, 0);
  }
  let blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob || blob.size > 24 * 1024 * 1024) blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
  canvas.width = 0; canvas.height = 0;
  if (!blob) throw new Error('Could not prepare the image for text extraction.');
  return { bytes: new Uint8Array(await blob.arrayBuffer()), width: outW, height: outH, emojis: found.emojis, emojiSkipped: found.skipped };
}

const score = (result) => (result?.available ? (result.confidence || 0) * Math.log(1 + (result.wordCount || 0)) : -1);

/** Runs OCR, and when the first pass looks wrong (sideways phone photo) tries the other orientations. */
export async function extractImageText(bitmap, { language = 'eng', enhance = 'auto', layout = 'auto', autoRotate = true, emoji = true } = {}, onStep = () => {}) {
  if (typeof window === 'undefined' || typeof window.pdfStudio?.extractImageText !== 'function') {
    throw new Error('Image to text runs in the PDF Studio desktop app.');
  }
  const attempt = async (rotation) => {
    onStep(rotation ? `Trying ${rotation}° rotation` : 'Reading text');
    const prepared = await preprocessImage(bitmap, { mode: enhance, rotate: rotation, emoji });
    const raw = await window.pdfStudio.extractImageText({ image: prepared.bytes, language, psm: layout });
    // Merge even when OCR found no words: an image that is only emoji is still a valid result.
    return { ...mergeEmoji({ ...raw, available: raw.available !== false }, prepared.emojis, prepared.emojiSkipped), rotation };
  };
  let best = await attempt(0);
  if (!best.available) return best;
  const good = (best.confidence >= 78 && best.wordCount >= 4) || (best.confidence >= 70 && best.wordCount >= 25) || (best.wordCount === 0 && best.emojiCount > 0);
  if (autoRotate && !good) {
    for (const rotation of [90, 270, 180]) {
      const next = await attempt(rotation);
      if (score(next) > score(best) * 1.15) best = next;
      if (best.confidence >= 78 && best.wordCount >= 4) break;
    }
  }
  return best;
}

/** Plain text from a result. `reflow` joins hard-wrapped lines into paragraphs and repairs end-of-line hyphenation. */
export function buildText(result, { reflow = false } = {}) {
  if (!result?.available) return '';
  if (!reflow) return result.text || '';
  return (result.paragraphs || []).map((paragraph) => paragraph.lines.reduce((text, line) => {
    if (!text) return line;
    if (/[A-Za-z\u00C0-\u024F]-$/.test(text) && /^[a-z\u00E0-\u024F]/.test(line)) return text.slice(0, -1) + line;
    return `${text} ${line}`;
  }, '')).join('\n\n');
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* legacy path */ }
  const area = document.createElement('textarea');
  area.value = text; area.style.position = 'fixed'; area.style.opacity = '0';
  document.body.appendChild(area); area.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  area.remove();
  return ok;
}
