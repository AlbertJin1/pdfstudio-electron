/**
 * Image format converter (renderer side). Decoding: the browser engine handles PNG, JPG, WebP, GIF, BMP, AVIF, ICO and
 * SVG; HEIC/HEIF is decoded by libheif (WebAssembly) and TIFF by UTIF, both loaded on demand. Encoding uses the canvas
 * (JPG, PNG, WebP) plus a small BMP writer. All of it is offline; nothing is uploaded.
 */
import { injectExif, prepareExifForJpeg } from './imageMetadata.js';

export const INPUT_EXTENSIONS = /\.(heic|heif|hif|avif|webp|png|jpe?g|jfif|gif|bmp|tiff?|svg|ico|cur)$/i;
export const MAX_INPUT_BYTES = 80 * 1024 * 1024;

export const OUTPUT_FORMATS = [
  { value: 'jpg', label: 'JPG', hint: 'Photos · smallest', mime: 'image/jpeg', ext: 'jpg', lossy: true, alpha: false },
  { value: 'png', label: 'PNG', hint: 'Lossless · transparency', mime: 'image/png', ext: 'png', lossy: false, alpha: true },
  { value: 'webp', label: 'WebP', hint: 'Modern · small', mime: 'image/webp', ext: 'webp', lossy: true, alpha: true },
  { value: 'bmp', label: 'BMP', hint: 'Uncompressed', mime: 'image/bmp', ext: 'bmp', lossy: false, alpha: false },
];
export const SIZE_LIMITS = [
  { value: 0, label: 'Original size' },
  { value: 4096, label: 'Up to 4096 px', hint: 'Longest side' },
  { value: 2560, label: 'Up to 2560 px', hint: 'Longest side' },
  { value: 1920, label: 'Up to 1920 px', hint: 'Full HD' },
  { value: 1280, label: 'Up to 1280 px', hint: 'Longest side' },
  { value: 800, label: 'Up to 800 px', hint: 'Longest side' },
];
export const TARGET_SIZES = [
  { value: 0, label: 'No limit' },
  { value: 100 * 1024, label: 'Under 100 KB' },
  { value: 250 * 1024, label: 'Under 250 KB' },
  { value: 500 * 1024, label: 'Under 500 KB' },
  { value: 1024 * 1024, label: 'Under 1 MB' },
  { value: 2 * 1024 * 1024, label: 'Under 2 MB' },
  { value: 5 * 1024 * 1024, label: 'Under 5 MB' },
];

const MAX_SIDE = 16384;
const MAX_PIXELS = 120_000_000;
const MIN_QUALITY = 0.3;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const ascii = (b, at, text) => text.split('').every((char, i) => b[at + i] === char.charCodeAt(0));

/** Detects the real format from the file's first bytes (file extensions lie, e.g. a .jpg that is really HEIC). */
export function sniffKind(bytes, name = '') {
  const b = bytes;
  if (b.length > 12) {
    if (b[0] === 0xff && b[1] === 0xd8) return 'jpeg';
    if (b[0] === 0x89 && ascii(b, 1, 'PNG')) return 'png';
    if (ascii(b, 0, 'GIF8')) return 'gif';
    if (ascii(b, 0, 'RIFF') && ascii(b, 8, 'WEBP')) return 'webp';
    if (b[0] === 0x42 && b[1] === 0x4d) return 'bmp';
    if ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a && b[3] === 0) || (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0 && b[3] === 0x2a)) return 'tiff';
    if (b[0] === 0 && b[1] === 0 && (b[2] === 1 || b[2] === 2) && b[3] === 0) return 'ico';
    if (ascii(b, 4, 'ftyp')) {
      const head = new TextDecoder('latin1').decode(b.subarray(8, Math.min(b.length, 64)));
      return /avif|avis/.test(head) ? 'avif' : 'heic';
    }
    const start = new TextDecoder().decode(b.subarray(0, Math.min(b.length, 1024))).toLowerCase();
    if (start.includes('<svg') || (start.includes('<?xml') && start.includes('svg'))) return 'svg';
  }
  const ext = (/\.([a-z0-9]+)$/i.exec(name) || [])[1]?.toLowerCase();
  const byExt = { jpg: 'jpeg', jpeg: 'jpeg', jfif: 'jpeg', png: 'png', gif: 'gif', webp: 'webp', bmp: 'bmp', tif: 'tiff', tiff: 'tiff', ico: 'ico', cur: 'ico', svg: 'svg', avif: 'avif', heic: 'heic', heif: 'heic', hif: 'heic' };
  return byExt[ext] || 'unknown';
}

export const KIND_LABEL = { jpeg: 'JPG', png: 'PNG', gif: 'GIF', webp: 'WebP', bmp: 'BMP', tiff: 'TIFF', ico: 'ICO', avif: 'AVIF', heic: 'HEIC', svg: 'SVG', unknown: 'Image' };
const MIME = { jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', ico: 'image/x-icon', avif: 'image/avif', svg: 'image/svg+xml', tiff: 'image/tiff' };

/* ---------- decoding ---------- */

let heifPromise = null;
const loadHeif = () => {
  if (!heifPromise) heifPromise = import('libheif-js/libheif-wasm/libheif-bundle.mjs').then((mod) => (mod.default || mod)()).catch((error) => { heifPromise = null; throw error; });
  return heifPromise;
};

async function decodeHeic(bytes) {
  const libheif = await loadHeif();
  const images = new libheif.HeifDecoder().decode(bytes);
  if (!images || !images.length) throw new Error('This HEIC file has no readable image.');
  // Pick the largest top-level image: it is the main photo (the others are previews or burst frames).
  let main = images[0];
  for (const image of images) if (image.get_width() * image.get_height() > main.get_width() * main.get_height()) main = image;
  const width = main.get_width(); const height = main.get_height();
  if (!width || !height || width * height > MAX_PIXELS * 1.5) throw new Error('This HEIC image is too large to convert.');
  const pixels = new ImageData(width, height);
  try {
    await new Promise((resolve, reject) => main.display(pixels, (result) => (result ? resolve() : reject(new Error('This HEIC file could not be decoded. It may use an unsupported codec or be damaged.')))));
  } finally { for (const image of images) image.free?.(); }
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  canvas.getContext('2d').putImageData(pixels, 0, 0);
  return { source: canvas, width, height, close: () => { canvas.width = 0; canvas.height = 0; } };
}

async function decodeTiff(bytes) {
  const mod = await import('utif');
  const UTIF = mod.default || mod;
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const pages = UTIF.decode(buffer);
  if (!pages.length) throw new Error('This TIFF file has no readable image.');
  const page = pages.reduce((best, current) => ((current.width || 0) * (current.height || 0) > (best.width || 0) * (best.height || 0) ? current : best), pages[0]);
  UTIF.decodeImage(buffer, page);
  const width = page.width; const height = page.height;
  if (!width || !height) throw new Error('This TIFF file could not be decoded.');
  const rgba = UTIF.toRGBA8(page);
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.byteLength), width, height), 0, 0);
  return { source: canvas, width, height, close: () => { canvas.width = 0; canvas.height = 0; } };
}

async function decodeWithImageElement(blob, kind) {
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.decoding = 'async';
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error('This image could not be decoded.')); image.src = url; });
    let width = image.naturalWidth; let height = image.naturalHeight;
    if (kind === 'svg') { // vector: pick a crisp raster size
      if (!width || !height) { width = 1024; height = 1024; }
      const grow = Math.max(1, 1600 / Math.max(width, height));
      width = Math.round(width * grow); height = Math.round(height * grow);
    }
    if (!width || !height) throw new Error('This image has no size.');
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    canvas.getContext('2d').drawImage(image, 0, 0, width, height);
    return { source: canvas, width, height, close: () => { canvas.width = 0; canvas.height = 0; } };
  } finally { URL.revokeObjectURL(url); }
}

/** Returns { source, width, height, kind, close() } where `source` can be drawn on a canvas. */
export async function decodeSource(bytes, name = '') {
  const kind = sniffKind(bytes, name);
  if (kind === 'unknown') throw new Error('This file is not a supported image.');
  let decoded;
  if (kind === 'heic') decoded = await decodeHeic(bytes);
  else if (kind === 'tiff') decoded = await decodeTiff(bytes);
  else {
    const blob = new Blob([bytes], { type: MIME[kind] || '' });
    if (kind === 'svg' || kind === 'ico') decoded = await decodeWithImageElement(blob, kind);
    else {
      try {
        const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
        decoded = { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close?.() };
      } catch { decoded = await decodeWithImageElement(blob, kind); }
    }
  }
  return { ...decoded, kind };
}

/** Small preview + size for the file list. */
export async function inspectImage(bytes, name) {
  const decoded = await decodeSource(bytes, name);
  try {
    const box = 96; const scale = Math.max(box / decoded.width, box / decoded.height);
    const canvas = document.createElement('canvas'); canvas.width = box; canvas.height = box;
    const context = canvas.getContext('2d');
    context.fillStyle = '#e9ecf3'; context.fillRect(0, 0, box, box);
    context.imageSmoothingQuality = 'high';
    const w = decoded.width * scale; const h = decoded.height * scale;
    context.drawImage(decoded.source, (box - w) / 2, (box - h) / 2, w, h);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.78));
    return { kind: decoded.kind, width: decoded.width, height: decoded.height, thumb: blob ? URL.createObjectURL(blob) : '' };
  } finally { decoded.close(); }
}

/* ---------- encoding ---------- */

function encodeBmp(canvas) {
  const { width, height } = canvas;
  const pixels = canvas.getContext('2d').getImageData(0, 0, width, height).data;
  const stride = (width * 3 + 3) & ~3;
  const out = new Uint8Array(54 + stride * height);
  const dv = new DataView(out.buffer);
  out[0] = 0x42; out[1] = 0x4d;
  dv.setUint32(2, out.length, true); dv.setUint32(10, 54, true);
  dv.setUint32(14, 40, true); dv.setInt32(18, width, true); dv.setInt32(22, height, true);
  dv.setUint16(26, 1, true); dv.setUint16(28, 24, true); dv.setUint32(34, stride * height, true);
  dv.setInt32(38, 2835, true); dv.setInt32(42, 2835, true);
  for (let y = 0; y < height; y += 1) {
    let o = 54 + (height - 1 - y) * stride;
    for (let x = 0, i = y * width * 4; x < width; x += 1, i += 4) { out[o++] = pixels[i + 2]; out[o++] = pixels[i + 1]; out[o++] = pixels[i]; }
  }
  return out;
}

const toBlob = (canvas, mime, quality) => new Promise((resolve) => canvas.toBlob(resolve, mime, quality));

async function encodeCanvas(canvas, format, quality) {
  if (format.value === 'bmp') return encodeBmp(canvas);
  const blob = await toBlob(canvas, format.mime, format.lossy ? quality : undefined);
  if (!blob) throw new Error('The image is too large to encode. Choose a smaller size and try again.');
  if (blob.type !== format.mime) throw new Error(`${format.label} encoding is not available on this computer.`);
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * Converts one image.
 * options: { format, quality 0.3–1, maxSide (0 = original), targetBytes (0 = off), background '#rrggbb', metadata 'strip'|'safe'|'keep' }
 * Returns { data, width, height, quality, fits, fitShrunk, metadata } where `metadata` is what the file really contains.
 */
export async function convertImage({ bytes, name }, options, onStep = () => {}) {
  const format = OUTPUT_FORMATS.find((entry) => entry.value === options.format) || OUTPUT_FORMATS[0];
  const background = /^#[0-9a-f]{6}$/i.test(options.background) ? options.background : '#ffffff';
  onStep('Decoding');
  const decoded = await decodeSource(bytes, name);
  try {
    await tick();
    let scale = options.maxSide ? Math.min(1, options.maxSide / Math.max(decoded.width, decoded.height)) : 1;
    scale = Math.min(scale, MAX_SIDE / Math.max(decoded.width, decoded.height), Math.sqrt(MAX_PIXELS / (decoded.width * decoded.height)), 1);
    const startScale = scale;
    const quality = Math.min(1, Math.max(MIN_QUALITY, Number(options.quality) || 0.9));
    const exif = format.value === 'jpg' ? prepareExifForJpeg(bytes, options.metadata) : null;
    const reserve = exif ? exif.length + 12 : 0;
    const target = format.lossy && options.targetBytes > 0 ? options.targetBytes : 0;
    // Lossless PNG has no quality knob: a size limit is met by reducing the pixel dimensions instead.
    const losslessTarget = !format.lossy && format.value === 'png' && options.targetBytes > 0 ? options.targetBytes : 0;

    const render = (factor) => {
      const width = Math.max(1, Math.round(decoded.width * factor)); const height = Math.max(1, Math.round(decoded.height * factor));
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      const context = canvas.getContext('2d', { willReadFrequently: format.value === 'bmp' });
      if (!context) throw new Error('Could not create an image canvas.');
      if (!format.alpha) { context.fillStyle = background; context.fillRect(0, 0, width, height); }
      context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
      context.drawImage(decoded.source, 0, 0, width, height);
      return canvas;
    };

    onStep('Encoding');
    let data; let width; let height; let used = quality; let fits = true;
    if (losslessTarget) {
      fits = false;
      for (let attempt = 0; attempt < 12 && !fits; attempt += 1) {
        const canvas = render(scale);
        width = canvas.width; height = canvas.height;
        data = await encodeCanvas(canvas, format, quality);
        canvas.width = 0; canvas.height = 0;
        if (data.length <= losslessTarget) fits = true;
        else {
          // PNG size scales roughly with pixel count: jump close to the needed scale, then refine.
          scale *= Math.max(0.5, Math.min(0.9, Math.sqrt(losslessTarget / data.length) * 0.97));
          onStep('Shrinking to fit'); await tick();
        }
      }
    } else if (!target) {
      const canvas = render(scale);
      width = canvas.width; height = canvas.height;
      data = await encodeCanvas(canvas, format, quality);
      canvas.width = 0; canvas.height = 0;
    } else {
      // Largest quality that fits; if even the lowest quality is too big, shrink the picture a little and repeat.
      fits = false;
      for (let attempt = 0; attempt < 8 && !fits; attempt += 1) {
        const canvas = render(scale);
        width = canvas.width; height = canvas.height;
        let best = await encodeCanvas(canvas, format, quality); used = quality;
        if (best.length + reserve <= target) fits = true;
        else {
          const lowest = await encodeCanvas(canvas, format, MIN_QUALITY);
          if (lowest.length + reserve <= target) {
            let low = MIN_QUALITY; let high = quality; best = lowest; used = MIN_QUALITY;
            for (let step = 0; step < 6; step += 1) {
              const mid = (low + high) / 2;
              const trial = await encodeCanvas(canvas, format, mid);
              if (trial.length + reserve <= target) { low = mid; best = trial; used = mid; } else high = mid;
            }
            fits = true;
          } else { best = lowest; used = MIN_QUALITY; }
        }
        data = best;
        canvas.width = 0; canvas.height = 0;
        if (!fits) { scale *= 0.82; onStep('Shrinking to fit'); await tick(); }
      }
    }
    if (exif && data) data = injectExif(data, exif);
    return { data, width, height, quality: format.lossy ? used : null, fits, fitShrunk: scale < startScale - 1e-9, metadata: exif ? options.metadata : 'strip' };
  } finally { decoded.close(); }
}

/** "photo.heic" -> "photo.jpg", adding " (2)" when the name is already taken in this batch. */
export function outputName(sourceName, ext, used) {
  const stem = String(sourceName || 'image').replace(/\.[^.]+$/, '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/[. ]+$/, '').slice(0, 100) || 'image';
  let candidate = `${stem}.${ext}`; let n = 2;
  while (used.has(candidate.toLowerCase())) candidate = `${stem} (${n++}).${ext}`;
  used.add(candidate.toLowerCase());
  return candidate;
}
