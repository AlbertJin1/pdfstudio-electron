import { getPdfJsLib, loadPdfSource } from './pdfjs.js';

export const COMPRESSION_PRESETS = Object.freeze({
  lossless: { label: 'Lossless only', maxDimension: 2600, quality: 0.88, dpi: 300, goal: null, ladderStart: 0, description: 'Repack PDF streams/resources without intentional image quality loss or page rasterization. Keeps native text, vectors, links and forms where supported.' },
  high: { label: 'High quality', maxDimension: 4800, quality: 0.85, dpi: 250, goal: 0.8, ladderStart: 0, description: 'Re-encodes every image (no pass-through) at up to 250 DPI. Visually near-identical; typically 20-50% smaller on image-heavy PDFs.' },
  balanced: { label: 'Recommended', maxDimension: 2400, quality: 0.7, dpi: 150, goal: 0.55, ladderStart: 1, description: 'Auto-escalating: re-encodes all images at up to 150 DPI and keeps tightening until the file is about half its size (or the quality floor is reached).' },
  small: { label: 'Smaller file', maxDimension: 1800, quality: 0.55, dpi: 110, goal: 0.38, ladderStart: 2, description: 'Strong compression: 110 DPI image cap, forced JPEG re-encoding, duplicate removal and font subsetting. Auto-escalates toward ~40% of the original size.' },
  smallest: { label: 'Smallest file', maxDimension: 1200, quality: 0.42, dpi: 85, goal: 0.25, ladderStart: 3, description: 'Very aggressive: 85 DPI images, low JPEG quality and chroma subsampling. Auto-escalates toward ~25% of the original size.' },
  ultra: { label: 'Ultra compressed', maxDimension: 900, quality: 0.32, dpi: 66, goal: 0.15, ladderStart: 4, description: 'Maximum shrink: 66 DPI images and very low JPEG quality, escalating down to 50 DPI until about 15% of the original size. Ideal for email/upload limits (5 MB to under 1 MB). Fine print inside photos may soften.' },
});

// Ordered mild-to-strong ladder shared by every non-lossless preset and by target-size mode.
const SMART_LADDER = [
  { dpi: 250, quality: 85, imageFilterMode: 'jpeg', label: 'High quality (smart)' },
  { dpi: 150, quality: 70, imageFilterMode: 'jpeg', label: 'Recommended (smart)' },
  { dpi: 110, quality: 55, imageFilterMode: 'jpeg', label: 'Smaller (smart)' },
  { dpi: 85, quality: 42, imageFilterMode: 'jpeg', label: 'Smallest (smart)' },
  { dpi: 66, quality: 32, imageFilterMode: 'jpeg', label: 'Ultra (smart)' },
  { dpi: 56, quality: 26, imageFilterMode: 'jpeg', label: 'Ultra+ (smart)' },
  { dpi: 50, quality: 20, imageFilterMode: 'jpeg', label: 'Extreme (smart)' },
];

const TARGET_PROFILES = [
  { maxDimension: 3600, quality: 0.88, label: 'High quality' },
  { maxDimension: 3200, quality: 0.83, label: 'Very good quality' },
  { maxDimension: 2800, quality: 0.77, label: 'Balanced quality' },
  { maxDimension: 2400, quality: 0.71, label: 'Compact' },
  { maxDimension: 2000, quality: 0.65, label: 'Smaller' },
  { maxDimension: 1650, quality: 0.58, label: 'Strong compression' },
  { maxDimension: 1350, quality: 0.51, label: 'Very strong compression' },
  { maxDimension: 1050, quality: 0.44, label: 'Maximum compression' },
  { maxDimension: 800, quality: 0.36, label: 'Extreme compression' },
];

const asBytes = (value) => value instanceof Uint8Array ? value : new Uint8Array(value);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const roundKb = (bytes) => Math.round(bytes / 1024);

export function validatePdfBytes(inputBytes) {
  // Accept the PDF header within the first 1024 bytes. Although well-formed files normally start
  // with %PDF-, several real-world generators prepend a short binary comment or transport prefix.
  const input = asBytes(inputBytes);
  const scanEnd = Math.min(input.length - 5, 1023);
  if (scanEnd < 0) return false;
  for (let index = 0; index <= scanEnd; index += 1) {
    if (input[index] === 0x25 && input[index + 1] === 0x50 && input[index + 2] === 0x44 && input[index + 3] === 0x46 && input[index + 4] === 0x2d) return true;
  }
  return false;
}

export function normalizeCompressionOptions(options = {}) {
  const preset = COMPRESSION_PRESETS[options.preset] ? options.preset : 'balanced';
  const defaults = COMPRESSION_PRESETS[preset];
  const resolutionDpi = clamp(Math.round(Number(options.resolutionDpi) || defaults.dpi), 50, 400);
  const quality = clamp(Number(options.quality) || Math.round(defaults.quality * 100), 15, 95);
  const colorMode = ['color', 'grayscale', 'monochrome'].includes(options.colorMode) ? options.colorMode : 'color';
  const targetBytes = Number.isFinite(Number(options.targetBytes)) && Number(options.targetBytes) > 0
    ? Math.floor(Number(options.targetBytes)) : null;
  return {
    preset,
    targetBytes,
    resolutionDpi,
    quality: quality / 100,
    colorMode,
    preserveMetadata: options.preserveMetadata !== false,
    includeAnnotations: options.includeAnnotations !== false,
    password: String(options.password || ''),
    onProgress: typeof options.onProgress === 'function' ? options.onProgress : () => {},
  };
}

function parsePdfDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value !== 'string') return null;
  const match = value.match(/D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?/);
  if (!match) return null;
  const parts = match.slice(1).map((part, index) => part ? Number(part) : [0, 1, 1, 0, 0, 0][index]);
  const date = new Date(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]);
  return Number.isNaN(date.getTime()) ? null : date;
}

function applyMetadata(output, info, preserveMetadata) {
  output.setCreator('PDF Studio PDF Compressor');
  output.setProducer('PDF Studio');
  if (!preserveMetadata) {
    output.setTitle('Compressed PDF');
    return;
  }
  if (info?.Title) output.setTitle(String(info.Title));
  else output.setTitle('Compressed PDF');
  if (info?.Author) output.setAuthor(String(info.Author));
  if (info?.Subject) output.setSubject(String(info.Subject));
  if (info?.Keywords) {
    const keywords = Array.isArray(info.Keywords) ? info.Keywords : String(info.Keywords).split(/[;,]/);
    output.setKeywords(keywords.map((value) => String(value).trim()).filter(Boolean));
  }
  const created = parsePdfDate(info?.CreationDate);
  const modified = parsePdfDate(info?.ModDate);
  if (created) output.setCreationDate(created);
  if (modified) output.setModificationDate(modified);
}

function applyColorMode(canvas, context, colorMode) {
  if (colorMode === 'color') return;
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = imageData.data;
  if (colorMode === 'grayscale') {
    for (let index = 0; index < pixels.length; index += 4) {
      const gray = Math.round(pixels[index] * 0.2126 + pixels[index + 1] * 0.7152 + pixels[index + 2] * 0.0722);
      pixels[index] = gray;
      pixels[index + 1] = gray;
      pixels[index + 2] = gray;
    }
  } else if (colorMode === 'monochrome') {
    // Adaptive global threshold chosen conservatively to preserve ordinary printed text.
    for (let index = 0; index < pixels.length; index += 4) {
      const gray = pixels[index] * 0.2126 + pixels[index + 1] * 0.7152 + pixels[index + 2] * 0.0722;
      const value = gray >= 184 ? 255 : 0;
      pixels[index] = value;
      pixels[index + 1] = value;
      pixels[index + 2] = value;
    }
  }
  context.putImageData(imageData, 0, 0);
}

async function rasterizeWithProfile(input, profile, options = {}) {
  const { PDFDocument } = await import('pdf-lib');
  const source = await loadPdfSource(input, options.password || undefined);
  const output = await PDFDocument.create();
  const { info } = await source.getMetadata().catch(() => ({ info: {} }));
  applyMetadata(output, info, options.preserveMetadata !== false);
  const pages = source.numPages;
  const pdfjsLib = await getPdfJsLib();
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
  const resolutionDpi = clamp(Number(options.resolutionDpi) || 300, 50, 400);
  const colorMode = ['color', 'grayscale', 'monochrome'].includes(options.colorMode) ? options.colorMode : 'color';
  const maxDimension = clamp(Number(profile.maxDimension) || 2400, 500, 4800);
  const quality = clamp(Number(profile.quality) || 0.76, 0.15, 0.95);

  try {
    for (let index = 1; index <= pages; index += 1) {
      onProgress({ phase: 'rendering', attempt: options.attempt || 1, attempts: options.attempts || 1, page: index, pages, profile: profile.label, resolutionDpi, colorMode });
      const pdfPage = await source.getPage(index);
      const baseViewport = pdfPage.getViewport({ scale: 1 });
      const dpiScale = resolutionDpi / 72;
      const dimensionScale = maxDimension / Math.max(baseViewport.width, baseViewport.height);
      const scale = Math.max(0.1, Math.min(dpiScale, dimensionScale, 6.5));
      const viewport = pdfPage.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(viewport.width));
      canvas.height = Math.max(1, Math.round(viewport.height));
      const context = canvas.getContext('2d', { alpha: false, desynchronized: true, willReadFrequently: colorMode !== 'color' });
      if (!context) throw new Error('Could not create an image canvas for PDF compression.');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      await pdfPage.render({
        canvasContext: context,
        viewport,
        background: '#ffffff',
        intent: 'print',
        annotationMode: options.includeAnnotations === false ? (pdfjsLib.AnnotationMode?.DISABLE ?? 0) : (pdfjsLib.AnnotationMode?.ENABLE ?? 1),
      }).promise;
      applyColorMode(canvas, context, colorMode);

      const usePng = colorMode === 'monochrome';
      const mime = usePng ? 'image/png' : 'image/jpeg';
      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob((value) => value ? resolve(value) : reject(new Error('Could not encode a compressed PDF page.')), mime, usePng ? undefined : quality);
      });
      const imageBytes = new Uint8Array(await blob.arrayBuffer());
      const target = output.addPage([baseViewport.width, baseViewport.height]);
      const image = usePng ? await output.embedPng(imageBytes) : await output.embedJpg(imageBytes);
      target.drawImage(image, { x: 0, y: 0, width: baseViewport.width, height: baseViewport.height });
      canvas.width = 0;
      canvas.height = 0;
      pdfPage.cleanup?.();
      onProgress({ phase: 'rendered', attempt: options.attempt || 1, attempts: options.attempts || 1, page: index, pages, profile: profile.label, pageBytes: imageBytes.length });
    }
  } finally {
    await source.destroy?.();
  }
  const bytes = await output.save({ useObjectStreams: true, addDefaultPage: false, objectsPerTick: 50 });
  return asBytes(bytes);
}

function asciiContains(input, text) {
  const bytes = asBytes(input);
  const target = new TextEncoder().encode(text);
  outer: for (let index = 0; index <= bytes.length - target.length; index += 1) {
    for (let offset = 0; offset < target.length; offset += 1) if (bytes[index + offset] !== target[offset]) continue outer;
    return true;
  }
  return false;
}

export function detectPdfSignatures(inputBytes) {
  // Signatures commonly declare ByteRange and a signature field in the uncompressed object data.
  // False positives are safer than silently invalidating a signed document.
  return asciiContains(inputBytes, '/ByteRange') || asciiContains(inputBytes, '/FT /Sig') || asciiContains(inputBytes, '/Type /Sig');
}

function normalizeTextForCompare(value) {
  return String(value || '').normalize('NFKC').toLocaleLowerCase('en-US').replace(/[\u00ad\u2010-\u2015]/g, '-').replace(/\s+/g, ' ').trim();
}

function flattenOutline(outline = []) {
  let count = 0;
  for (const item of outline || []) { count += 1; count += flattenOutline(item.items); }
  return count;
}

function hashBytes(bytes) {
  // Fast non-cryptographic checksum is sufficient for a duplicate estimate/report.
  let hash = 2166136261;
  for (let index = 0; index < bytes.length; index += 1) hash = Math.imul(hash ^ bytes[index], 16777619);
  return (hash >>> 0).toString(16);
}

async function analyzeRawObjects(inputBytes) {
  const stats = { objectCount: 0, streamCount: 0, streamBytes: 0, imageObjects: 0, imageBytes: 0, largestImageBytes: 0, duplicateImageObjects: 0, fontObjects: 0, embeddedFontStreams: 0, metadataStreams: 0, embeddedFileStreams: 0 };
  try {
    const { PDFDocument, PDFName } = await import('pdf-lib');
    const doc = await PDFDocument.load(asBytes(inputBytes), { updateMetadata: false });
    const objects = doc.context.enumerateIndirectObjects();
    const fontFileRefs = new Set();
    const imageHashes = new Set();
    const name = (dict, key) => dict?.get?.(PDFName.of(key))?.toString() || '';
    stats.objectCount = objects.length;
    for (const [, object] of objects) {
      const dict = object?.dict;
      if (name(dict, 'Type') === '/FontDescriptor') {
        for (const key of ['FontFile', 'FontFile2', 'FontFile3']) {
          const value = dict?.get?.(PDFName.of(key));
          if (value) fontFileRefs.add(value.toString());
        }
      }
    }
    for (const [ref, object] of objects) {
      const dict = object?.dict;
      if (!dict || typeof dict.get !== 'function') continue;
      const type = name(dict, 'Type');
      const subtype = name(dict, 'Subtype');
      if (type === '/Font') stats.fontObjects += 1;
      if (object.contents instanceof Uint8Array) {
        stats.streamCount += 1;
        stats.streamBytes += object.contents.byteLength;
        if (subtype === '/Image') {
          stats.imageObjects += 1;
          stats.imageBytes += object.contents.byteLength;
          stats.largestImageBytes = Math.max(stats.largestImageBytes, object.contents.byteLength);
          const hash = `${object.contents.byteLength}:${hashBytes(object.contents)}`;
          if (imageHashes.has(hash)) stats.duplicateImageObjects += 1;
          else imageHashes.add(hash);
        }
        if (type === '/Metadata' || subtype === '/XML') stats.metadataStreams += 1;
        if (type === '/EmbeddedFile') stats.embeddedFileStreams += 1;
        if (fontFileRefs.has(ref.toString())) stats.embeddedFontStreams += 1;
      }
    }
    return { ...stats, available: true };
  } catch (error) {
    return { ...stats, available: false, warning: /password|encrypt/i.test(error?.message || '') ? 'Raw object analysis is unavailable for this encrypted PDF.' : 'Raw object analysis was unavailable; page analysis is still available.' };
  }
}

/** Analyze the PDF without modifying it. The resource byte totals are approximate where PDF objects are encrypted/compressed. */
export async function analyzePdf(inputBytes, options = {}) {
  const input = asBytes(inputBytes);
  if (!validatePdfBytes(input)) throw new Error('Choose a valid PDF file to analyze.');
  const pdf = await loadPdfSource(input, options.password || undefined);
  const pdfjsLib = await getPdfJsLib();
  const info = await pdf.getMetadata().catch(() => ({ info: {}, metadata: null }));
  const pageSizes = [];
  let textItems = 0;
  let textCharacters = 0;
  let imagePaintOperations = 0;
  let linkCount = 0;
  let widgetCount = 0;
  let hasSignatureWidget = false;
  let annotationCount = 0;
  const pageText = [];
  try {
    const imageOps = new Set(Object.entries(pdfjsLib.OPS || {}).filter(([name]) => /paint.*image|paintImage/i.test(name)).map(([, value]) => value));
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      options.onProgress?.({ phase: 'analysis', page: pageNumber, pages: pdf.numPages });
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      pageSizes.push({ width: viewport.width, height: viewport.height, rotation: viewport.rotation || 0 });
      const textContent = await page.getTextContent({ includeMarkedContent: true });
      const strings = [];
      for (const item of textContent.items || []) {
        if (typeof item.str !== 'string') continue;
        textItems += 1;
        textCharacters += item.str.length;
        if (item.str) strings.push(item.str);
      }
      pageText.push(strings.join(' '));
      const operatorList = await page.getOperatorList();
      for (const op of operatorList.fnArray || []) if (imageOps.has(op)) imagePaintOperations += 1;
      const annotations = await page.getAnnotations({ intent: 'display' }).catch(() => []);
      annotationCount += annotations.length;
      for (const annotation of annotations) {
        const subtype = String(annotation.subtype || annotation.annotationType || '').toLowerCase();
        if (subtype.includes('link') || annotation.url || annotation.unsafeUrl) linkCount += 1;
        if (subtype.includes('widget') || annotation.fieldName || annotation.fieldType) widgetCount += 1;
        if (String(annotation.fieldType || '').toLowerCase() === 'sig') hasSignatureWidget = true;
      }
      page.cleanup?.();
    }
    const outline = await pdf.getOutline().catch(() => null);
    const attachments = pdf.getAttachments?.() || null;
    const rawObjects = await analyzeRawObjects(input);
    return {
      fileSize: input.byteLength,
      pageCount: pdf.numPages,
      pageSizes,
      textItems,
      textCharacters,
      wordCount: normalizeTextForCompare(pageText.join(' ')).split(/\s+/).filter(Boolean).length,
      imagePaintOperations,
      annotationCount,
      linkCount,
      widgetCount,
      outlineEntries: flattenOutline(outline || []),
      attachmentCount: attachments ? Object.keys(attachments).length : 0,
      hasDigitalSignatures: detectPdfSignatures(input) || hasSignatureWidget,
      metadata: {
        title: info?.info?.Title || '', author: info?.info?.Author || '', subject: info?.info?.Subject || '',
        creator: info?.info?.Creator || '', producer: info?.info?.Producer || '',
      },
      resources: rawObjects,
      text: pageText,
    };
  } finally {
    await pdf.destroy?.();
  }
}

/** Verify key structural properties after a smart object rewrite. Raster outputs must be explicitly opted into and are reported as destructive instead. */
export async function validateCompressionIntegrity(inputBytes, outputBytes, options = {}) {
  const original = await analyzePdf(inputBytes, { password: options.password });
  const output = await analyzePdf(outputBytes, { password: options.outputPassword });
  const warnings = [];
  const errors = [];
  if (original.hasDigitalSignatures) errors.push('The source contains a digital signature; any rewritten PDF would invalidate its signature.');
  if (original.pageCount !== output.pageCount) errors.push(`Page count changed from ${original.pageCount} to ${output.pageCount}.`);
  if (original.pageCount === output.pageCount) {
    for (let i = 0; i < original.pageSizes.length; i += 1) {
      const a = original.pageSizes[i]; const b = output.pageSizes[i];
      if (Math.abs(a.width - b.width) > 0.75 || Math.abs(a.height - b.height) > 0.75 || (a.rotation || 0) !== (b.rotation || 0)) {
        errors.push(`Page ${i + 1} geometry changed.`);
        break;
      }
    }
  }
  const sourceText = normalizeTextForCompare(original.text.join(' '));
  const outputText = normalizeTextForCompare(output.text.join(' '));
  const sourceTokens = sourceText.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) || [];
  const outputTokens = outputText.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) || [];
  const tokenPool = new Map();
  for (const token of outputTokens) tokenPool.set(token, (tokenPool.get(token) || 0) + 1);
  let matchedTokens = 0;
  for (const token of sourceTokens) {
    const count = tokenPool.get(token) || 0;
    if (count > 0) { matchedTokens += 1; tokenPool.set(token, count - 1); }
  }
  const textCoveragePercent = sourceTokens.length ? matchedTokens / sourceTokens.length * 100 : (outputTokens.length ? 0 : 100);
  if (sourceTokens.length >= 8 && textCoveragePercent < 97) errors.push(`Selectable text coverage is only ${textCoveragePercent.toFixed(1)}%.`);
  else if (sourceTokens.length > 0 && textCoveragePercent < 100) warnings.push(`Some extracted words changed or could not be matched (${textCoveragePercent.toFixed(1)}% token coverage).`);
  if (original.linkCount !== output.linkCount) errors.push(`Link count changed from ${original.linkCount} to ${output.linkCount}.`);
  if (original.widgetCount !== output.widgetCount) errors.push(`Form widget count changed from ${original.widgetCount} to ${output.widgetCount}.`);
  if (original.outlineEntries !== output.outlineEntries) warnings.push(`Bookmark count changed from ${original.outlineEntries} to ${output.outlineEntries}.`);
  if (original.attachmentCount !== output.attachmentCount) errors.push(`Embedded attachment count changed from ${original.attachmentCount} to ${output.attachmentCount}.`);
  if (original.annotationCount !== output.annotationCount) warnings.push(`Annotation count changed from ${original.annotationCount} to ${output.annotationCount}.`);
  if (options.preserveMetadata !== false) {
    for (const key of ['title', 'author', 'subject']) {
      if (original.metadata?.[key] && original.metadata[key] !== output.metadata?.[key]) warnings.push(`Document ${key} metadata changed.`);
    }
  }
  const summary = (item) => ({
    pageCount: item.pageCount, textCharacters: item.textCharacters, wordCount: item.wordCount,
    imagePaintOperations: item.imagePaintOperations, annotationCount: item.annotationCount,
    linkCount: item.linkCount, widgetCount: item.widgetCount, outlineEntries: item.outlineEntries,
    attachmentCount: item.attachmentCount, pageSizes: item.pageSizes, resources: item.resources,
  });
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    original: summary(original),
    output: summary(output),
    textCoveragePercent: Number(textCoveragePercent.toFixed(2)),
    pageCountPreserved: original.pageCount === output.pageCount,
    linksPreserved: original.linkCount === output.linkCount,
    formsPreserved: original.widgetCount === output.widgetCount,
    attachmentsPreserved: original.attachmentCount === output.attachmentCount,
    geometryPreserved: !errors.some((error) => /geometry changed/i.test(error)),
  };
}

export async function renderPdfPreview(inputBytes, options = {}) {
  const input = asBytes(inputBytes);
  const pdf = await loadPdfSource(input, options.password || undefined);
  try {
    const pageNumber = clamp(Math.round(Number(options.pageNumber) || 1), 1, pdf.numPages);
    const page = await pdf.getPage(pageNumber);
    const baseViewport = page.getViewport({ scale: 1 });
    const maxDimension = clamp(Number(options.maxDimension) || 560, 240, 1000);
    const viewport = page.getViewport({ scale: Math.min(maxDimension / Math.max(baseViewport.width, baseViewport.height), 2) });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('Could not create a canvas for the compression preview.');
    context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: context, viewport, background: '#ffffff' }).promise;
    const dataUrl = canvas.toDataURL('image/jpeg', 0.78);
    canvas.width = 0; canvas.height = 0;
    page.cleanup?.();
    return { dataUrl, pageNumber, pageCount: pdf.numPages, width: viewport.width, height: viewport.height };
  } finally { await pdf.destroy?.(); }
}


// Ghostscript is an optional accelerator, not a hard requirement for image-heavy documents.
// This built-in local path re-encodes supported embedded image XObjects in place using
// browser-native image decoding/encoding while retaining PDF text, vector paths, links and forms.
// It is deliberately limited to four target-size passes to keep preview latency bounded.
const IMAGE_OBJECT_TARGET_PROFILES = [
  { quality: 90, scale: 1.00, label: 'High quality (embedded images)' },
  { quality: 82, scale: 0.92, label: 'Very good quality (embedded images)' },
  { quality: 72, scale: 0.82, label: 'Recommended (embedded images)' },
  { quality: 62, scale: 0.72, label: 'Compact (embedded images)' },
  { quality: 52, scale: 0.60, label: 'Strong compression (embedded images)' },
  { quality: 42, scale: 0.48, label: 'Maximum compression (embedded images)' },
  { quality: 34, scale: 0.38, label: 'Ultra compression (embedded images)' },
  { quality: 26, scale: 0.28, label: 'Extreme compression (embedded images)' },
];

function imageObjectProfiles({ targetBytes, originalSize, preset, quality, resolutionDpi }) {
  const qualityCap = Math.max(25, Math.min(95, Math.round(Number(quality) * 100)));
  const dpiScale = Math.max(0.16, Math.min(1, Number(resolutionDpi || 300) / 300));
  if (targetBytes) {
    const ratio = targetBytes / Math.max(1, originalSize);
    const start = ratio >= 0.85 ? 0 : ratio >= 0.65 ? 1 : ratio >= 0.45 ? 2 : ratio >= 0.3 ? 3 : ratio >= 0.2 ? 4 : 5;
    return IMAGE_OBJECT_TARGET_PROFILES.slice(start, start + 5).map((profile) => ({
      ...profile,
      quality: Math.min(profile.quality, qualityCap),
      scale: Math.min(profile.scale, dpiScale),
    }));
  }
  const presets = {
    high: { quality: 85, scale: 0.9, label: 'High quality (embedded images)' },
    balanced: { quality: 70, scale: 0.7, label: 'Recommended (embedded images)' },
    small: { quality: 55, scale: 0.55, label: 'Smaller file (embedded images)' },
    smallest: { quality: 42, scale: 0.42, label: 'Smallest file (embedded images)' },
    ultra: { quality: 30, scale: 0.3, label: 'Ultra compressed (embedded images)' },
  };
  const profile = presets[preset] || presets.balanced;
  return [{ ...profile, quality: Math.min(profile.quality, qualityCap), scale: Math.min(profile.scale, dpiScale) }];
}

async function runEmbeddedImageOptimizer(input, profile, options = {}) {
  if (typeof options.imageObjectOptimize === 'function') {
    return options.imageObjectOptimize(input, profile, options);
  }
  // The MIT-licensed helper re-encodes supported embedded image XObjects in their original
  // object slots; it does not rasterize whole pages or rewrite native text/vector content.
  const { compressPDF } = await import('compress-pdf-lib');
  const result = await compressPDF(input, {
    quality: profile.quality,
    scale: profile.scale,
    minImageBytes: 1536,
    onlyIfSmaller: true,
    workers: 1,
    onProgress: (update) => options.onProgress?.({
      phase: 'images',
      attempt: options.attempt || 1,
      attempts: options.attempts || 1,
      profile: profile.label,
      imageIndex: update?.imageIndex,
      totalImages: update?.totalImages,
      progress: update?.progress,
      detail: update?.stage,
    }),
  });
  const file = result?.file;
  if (!file?.arrayBuffer) throw new Error('The built-in image optimizer returned no PDF data.');
  return { bytes: new Uint8Array(await file.arrayBuffer()), stats: result.stats || null };
}

function bestSafeBytes(input, losslessBytes) {
  return losslessBytes && losslessBytes.byteLength < input.byteLength
    ? { bytes: losslessBytes, outputSize: losslessBytes.byteLength, profile: 'Lossless optimization', engine: 'PDF toolkit', warnings: [] }
    : { bytes: input, outputSize: input.byteLength, profile: 'Original (smallest safe result)', engine: 'None', warnings: [] };
}

/**
 * Smart compression tries non-rasterizing pdfwrite before any raster fallback. Raster fallback is
 * deliberately opt-in because it destroys semantic/vector content. The original input is never mutated.
 */
async function compressPdfCore(inputBytes, options = {}) {
  const input = asBytes(inputBytes).slice();
  if (!validatePdfBytes(input)) throw new Error('Choose a valid PDF file to compress.');
  const normalized = normalizeCompressionOptions(options);
  const { preset, targetBytes, resolutionDpi, quality, colorMode, preserveMetadata, includeAnnotations, password, onProgress } = normalized;
  const originalSize = input.byteLength;
  // Scan-like PDFs (images, almost no real text) lose nothing by rasterizing, so the fallback is allowed automatically for them.
  const allowRasterFallback = options.allowRasterFallback === true || (options.scanLike === true && normalized.preset !== 'lossless' && normalized.preset !== 'high');
  const smartOptimize = typeof options.smartOptimize === 'function' ? options.smartOptimize : null;
  let losslessBytes = null;
  let losslessWarning = '';
  const signed = Boolean(options.hasDigitalSignatures) || detectPdfSignatures(input);

  if (signed) {
    const warning = 'This PDF appears to contain a digital signature. Compression was skipped to avoid invalidating it.';
    return { bytes: input, originalSize, outputSize: originalSize, targetBytes, reachedTarget: targetBytes ? originalSize <= targetBytes : true, unchanged: true, profile: 'Original (signed PDF preserved)', reductionPercent: 0, colorMode: 'preserved', engine: 'None', warning, warnings: [warning], integrity: { valid: true, warnings: [warning], errors: [], skipped: true } };
  }

  if (typeof options.losslessOptimize === 'function') {
    onProgress({ phase: 'lossless', attempt: 1, attempts: 1, originalSize, targetBytes, profile: 'Lossless optimization' });
    try {
      const optimized = asBytes(await options.losslessOptimize(input));
      if (validatePdfBytes(optimized) && optimized.byteLength < originalSize) losslessBytes = optimized;
    } catch (error) {
      losslessWarning = String(error?.message || 'The lossless optimizer could not process this PDF.');
    }
  }

  if (preset === 'lossless' && !targetBytes) {
    const bytes = losslessBytes || input;
    return { bytes, originalSize, outputSize: bytes.byteLength, targetBytes: null, reachedTarget: true, unchanged: bytes.byteLength >= originalSize, profile: losslessBytes ? 'Lossless optimization' : 'Original (lossless pass unavailable or no savings)', reductionPercent: Math.max(0, (1 - bytes.byteLength / originalSize) * 100), colorMode: 'preserved', engine: losslessBytes ? 'PDF toolkit' : 'None', warning: losslessWarning || (!losslessBytes ? 'No smaller lossless output was produced; the original PDF was preserved.' : ''), warnings: losslessWarning ? [losslessWarning] : (!losslessBytes ? ['No smaller lossless output was produced; the original PDF was preserved.'] : []) };
  }
  if (targetBytes && losslessBytes && losslessBytes.byteLength <= targetBytes) {
    return { bytes: losslessBytes, originalSize, outputSize: losslessBytes.byteLength, targetBytes, reachedTarget: true, unchanged: false, profile: 'Lossless optimization', reductionPercent: Math.max(0, (1 - losslessBytes.byteLength / originalSize) * 100), targetDifferenceBytes: losslessBytes.byteLength - targetBytes, colorMode: 'preserved', engine: 'PDF toolkit', warnings: [] };
  }
  if (targetBytes && originalSize <= targetBytes) {
    return { bytes: input, originalSize, outputSize: originalSize, targetBytes, reachedTarget: true, unchanged: true, profile: 'Already within target', reductionPercent: 0, targetDifferenceBytes: originalSize - targetBytes, colorMode: 'preserved', engine: 'None', warnings: [] };
  }

  let best = bestSafeBytes(input, losslessBytes);
  let smartWarning = '';
  let integrity = null;
  let smartTried = false;
  const canSmart = smartOptimize && colorMode !== 'monochrome';
  const hasTarget = Boolean(targetBytes);

  const trySmart = async (profile, attempt, attempts) => {
    smartTried = true;
    onProgress({ phase: 'smart', attempt, attempts, originalSize, targetBytes, profile: profile.label || 'Smart object optimization' });
    try {
      const result = await smartOptimize(losslessBytes || input, {
        preset: profile.preset || preset,
        resolutionDpi: Math.min(Number(profile.dpi ?? resolutionDpi), resolutionDpi),
        quality: Math.min(Number(profile.quality ?? quality * 100), quality * 100),
        colorMode,
        preserveMetadata,
        includeAnnotations,
        password,
        imageObjectCount: options.imageObjectCount,
        duplicateImageEstimate: options.duplicateImageEstimate,
        detectDuplicateImages: options.detectDuplicateImages,
        imageFilterMode: profile.imageFilterMode || (['small', 'smallest'].includes(preset) || quality < 0.65 ? 'jpeg' : 'auto'),
      });
      const candidateBytes = asBytes(result?.bytes || result);
      if (!validatePdfBytes(candidateBytes)) throw new Error('The smart optimizer returned an invalid PDF.');
      return { bytes: candidateBytes, outputSize: candidateBytes.byteLength, profile: profile.label || 'Smart object optimization', engine: result?.engine || 'Smart PDF optimizer', warnings: Array.isArray(result?.warnings) ? result.warnings : [] };
    } catch (error) {
      smartWarning = String(error?.message || 'The smart optimizer could not process this PDF.');
      return null;
    }
  };

  if (canSmart) {
    const presetInfo = COMPRESSION_PRESETS[preset] || COMPRESSION_PRESETS.balanced;
    const startIndex = options.ladderStart != null ? Number(options.ladderStart) : (targetBytes ? (() => {
      const ratio = targetBytes / originalSize;
      return ratio >= 0.8 ? 0 : ratio >= 0.55 ? 1 : ratio >= 0.35 ? 2 : ratio >= 0.22 ? 3 : ratio >= 0.12 ? 4 : 5;
    })() : (presetInfo.ladderStart || 0));
    const smartProfiles = (() => {
      const seen = new Set();
      return SMART_LADDER.slice(Math.max(0, Math.min(SMART_LADDER.length - 1, startIndex))).map((profile) => ({
        ...profile,
        preset: 'target',
        dpi: Math.min(Number(profile.dpi), resolutionDpi),
        quality: Math.min(Number(profile.quality), quality * 100),
      })).filter((profile) => {
        const key = `${profile.dpi}|${profile.quality}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    })();
    for (let index = 0; index < smartProfiles.length; index += 1) {
      const candidate = await trySmart(smartProfiles[index], index + 1, smartProfiles.length);
      if (!candidate) break;
      if (candidate.outputSize < best.outputSize) best = candidate;
      if (targetBytes && candidate.outputSize <= targetBytes) break;
      if (!targetBytes && !hasTarget) break;
    }
    const candidateToValidate = best.engine === 'Ghostscript pdfwrite' && best.outputSize < originalSize ? best : null;
    if (candidateToValidate && candidateToValidate.outputSize < originalSize) {
      try {
        const validateIntegrity = typeof options.validateIntegrity === 'function' ? options.validateIntegrity : validateCompressionIntegrity;
        integrity = await validateIntegrity(input, candidateToValidate.bytes, { password, preserveMetadata });
        if (integrity.valid && candidateToValidate.outputSize < best.outputSize) best = candidateToValidate;
        else if (!integrity.valid) {
          smartWarning = `Smart compression was rejected by integrity checks: ${integrity.errors.join(' ')}`;
          if (best.engine === 'Ghostscript pdfwrite') best = bestSafeBytes(input, losslessBytes);
          integrity = null;
        }
        candidateToValidate.warnings = [...candidateToValidate.warnings, ...(integrity.warnings || [])];
      } catch (error) {
        smartWarning = `Smart compression output could not be fully validated: ${error?.message || error}`;
        if (best.engine === 'Ghostscript pdfwrite') best = bestSafeBytes(input, losslessBytes);
        integrity = null;
      }
    }
  } else if (smartOptimize && colorMode === 'monochrome') {
    smartWarning = 'The smart vector-preserving engine does not convert whole pages to monochrome. Enable raster fallback to create a black-and-white image PDF.';
  } else if (!smartOptimize) {
    smartWarning = 'Ghostscript is unavailable; trying the built-in embedded-image optimizer next. This fallback preserves native text and vectors but supports fewer image encodings than Ghostscript.';
  }

  // If Ghostscript is missing or the native rewrite could not meet the requested target, run
  // a second, in-process image-object optimizer. It edits eligible embedded image XObjects only;
  // text, vectors, page content, links and forms are not flattened. Every profile starts from the
  // same clean input so a later, stronger profile cannot accumulate JPEG damage from an earlier one.
  const sourceLooksEncrypted = asciiContains(input, '/Encrypt');
  const builtInImagePathSupported = preset !== 'lossless'
    && colorMode === 'color'
    && preserveMetadata
    && !password
    && !sourceLooksEncrypted;
  const shouldTryImageObjectOptimizer = builtInImagePathSupported
    && (!smartOptimize || best.engine !== 'Ghostscript pdfwrite' || (targetBytes && best.outputSize > targetBytes))
    && (!targetBytes || best.outputSize > targetBytes || best.outputSize >= originalSize);
  let imageObjectStats = null;
  let imageObjectAttempted = false;
  let imageObjectWarning = '';
  if (!builtInImagePathSupported && preset !== 'lossless' && (!targetBytes || best.outputSize > targetBytes)) {
    if (password || sourceLooksEncrypted) imageObjectWarning = 'The built-in image-object fallback is skipped for encrypted PDFs because it cannot safely decrypt/re-encrypt source streams.';
    else if (colorMode !== 'color') imageObjectWarning = 'The built-in image-object fallback currently preserves color; grayscale or monochrome conversion requires Ghostscript or the explicitly enabled raster fallback.';
    else if (!preserveMetadata) imageObjectWarning = 'The built-in image-object fallback cannot guarantee complete metadata/XMP removal; the selected metadata-removal setting requires Ghostscript.';
  }
  if (shouldTryImageObjectOptimizer) {
    const profiles = imageObjectProfiles({ targetBytes, originalSize, preset, quality, resolutionDpi });
    const baseInput = (best.engine === 'Ghostscript pdfwrite' && best.outputSize < originalSize ? best.bytes : null) || losslessBytes || input;
    const attempts = profiles.length;
    let acceptedImageCandidate = null;
    for (let index = 0; index < profiles.length; index += 1) {
      const profile = profiles[index];
      imageObjectAttempted = true;
      onProgress({ phase: 'images', attempt: index + 1, attempts, originalSize, targetBytes, profile: profile.label });
      try {
        const result = await runEmbeddedImageOptimizer(baseInput, profile, {
          password,
          onProgress,
          attempt: index + 1,
          attempts,
          imageObjectOptimize: options.imageObjectOptimize,
        });
        const candidateBytes = asBytes(result?.bytes || result);
        if (!validatePdfBytes(candidateBytes)) throw new Error('The built-in image optimizer returned an invalid PDF.');
        const candidate = {
          bytes: candidateBytes,
          outputSize: candidateBytes.byteLength,
          profile: profile.label,
          engine: 'Built-in PDF image-object optimizer',
          stats: result?.stats || null,
          warnings: [
            'Embedded raster images were re-encoded; fine detail in photos or scans may change. Native text and vector content were not intentionally rasterized.',
          ],
        };
        if (candidate.outputSize < best.outputSize && candidate.outputSize < originalSize) {
          const validateIntegrity = typeof options.validateIntegrity === 'function' ? options.validateIntegrity : validateCompressionIntegrity;
          const candidateIntegrity = await validateIntegrity(input, candidate.bytes, { password, preserveMetadata });
          if (!candidateIntegrity?.valid) {
            imageObjectWarning = `The built-in image optimization candidate was rejected by integrity checks${candidateIntegrity?.errors?.length ? `: ${candidateIntegrity.errors.join(' ')}` : '.'}`;
            continue;
          }
          candidate.warnings.push(...(candidateIntegrity.warnings || []));
          candidate.integrity = candidateIntegrity;
          acceptedImageCandidate = candidate;
          imageObjectStats = candidate.stats;
          best = candidate;
        } else if (result?.stats) {
          imageObjectStats = result.stats;
        }
        if (targetBytes && best.outputSize <= targetBytes) break;
        if (!targetBytes) break;
      } catch (error) {
        imageObjectWarning = String(error?.message || 'The built-in image optimizer could not process this PDF.');
        // Common case: encrypted PDFs cannot be rewritten through pdf-lib. Keep the existing
        // lossless result and let the user know rather than silently rasterizing protected pages.
        break;
      }
    }
    if (acceptedImageCandidate) {
      // Engine/profile and the image-quality warning are shown in the report; don't expose the
      // expected optional-Ghostscript miss as an error after the built-in path succeeds.
      smartWarning = '';
      integrity = acceptedImageCandidate.integrity || integrity;
    } else if (imageObjectWarning) {
      smartWarning = `${smartWarning ? `${smartWarning} ` : ''}Built-in image optimization could not improve this PDF: ${imageObjectWarning}`;
    } else if (imageObjectAttempted && best.outputSize >= originalSize) {
      smartWarning = `${smartWarning ? `${smartWarning} ` : ''}No supported embedded images could be recompressed to a smaller size. The original encoding was preserved.`;
    }
  }
  if (!shouldTryImageObjectOptimizer && imageObjectWarning) {
    smartWarning = `${smartWarning ? `${smartWarning} ` : ''}${imageObjectWarning}`;
  }

  if (targetBytes && best.outputSize <= targetBytes) {
    return { ...best, originalSize, outputSize: best.outputSize, targetBytes, reachedTarget: true, unchanged: best.outputSize >= originalSize, reductionPercent: Math.max(0, (1 - best.outputSize / originalSize) * 100), targetDifferenceBytes: best.outputSize - targetBytes, colorMode: best.engine === 'Ghostscript pdfwrite' ? colorMode : 'preserved', warning: smartWarning || losslessWarning, warnings: [...(best.warnings || []), ...(smartWarning ? [smartWarning] : []), ...(losslessWarning ? [losslessWarning] : [])], integrity, smartTried, imageObjectAttempted: typeof imageObjectAttempted === 'boolean' ? imageObjectAttempted : false, imageObjectStats: imageObjectStats || best.stats || null };
  }

  const shouldRasterize = allowRasterFallback && preset !== 'lossless' && (colorMode === 'monochrome' || (targetBytes ? best.outputSize > targetBytes : best.outputSize >= originalSize));
  if (shouldRasterize) {
    let rasterProfiles;
    if (targetBytes) {
      const ratio = targetBytes / originalSize;
      const startIndex = ratio >= 0.82 ? 0 : ratio >= 0.68 ? 1 : ratio >= 0.52 ? 2 : ratio >= 0.40 ? 3 : ratio >= 0.30 ? 4 : ratio >= 0.20 ? 5 : ratio >= 0.12 ? 6 : 7;
      rasterProfiles = TARGET_PROFILES.slice(startIndex).map((profile) => ({ ...profile, preset: 'target' }));
    } else {
      const presetProfile = COMPRESSION_PRESETS[preset];
      rasterProfiles = [{ ...presetProfile, quality, label: `${presetProfile.label} (raster fallback)` }];
    }
    let rasterSelected = null;
    for (let index = 0; index < rasterProfiles.length; index += 1) {
      const profile = rasterProfiles[index];
      onProgress({ phase: 'raster', attempt: index + 1, attempts: rasterProfiles.length, originalSize, targetBytes, profile: profile.label });
      const bytes = await rasterizeWithProfile(best.bytes || input, profile, { password, resolutionDpi: Math.min(resolutionDpi, profile.dpi || resolutionDpi), colorMode, preserveMetadata, includeAnnotations, onProgress, attempt: index + 1, attempts: rasterProfiles.length });
      const candidate = { bytes, outputSize: bytes.byteLength, profile: profile.label, engine: 'PDF.js + JPEG/PNG rasterization', warnings: ['LOSSY: page content was rasterized. Selectable text, vector objects, links, forms, and other interactive structures are not preserved.'] };
      if (candidate.outputSize < best.outputSize) best = candidate;
      if (targetBytes && candidate.outputSize <= targetBytes) { rasterSelected = candidate; break; }
      if (!targetBytes) { rasterSelected = candidate; break; }
    }
    if (rasterSelected && rasterSelected.outputSize < originalSize && (!targetBytes || rasterSelected.outputSize <= targetBytes || rasterSelected.outputSize < best.outputSize)) best = rasterSelected;
    integrity = { valid: false, skipped: true, warnings: ['Structural integrity comparison is intentionally not considered successful for a rasterized output; verify visual quality and interactive-content loss.'], errors: [] };
  }

  // Final lossless repack (object streams, stream recompression) of whatever won; free extra savings.
  if (typeof options.losslessOptimize === 'function' && best.bytes && best.outputSize < originalSize && best.engine !== 'None') {
    try {
      onProgress({ phase: 'lossless', attempt: 1, attempts: 1, originalSize, targetBytes, profile: 'Final lossless repack' });
      const repacked = asBytes(await options.losslessOptimize(best.bytes));
      if (validatePdfBytes(repacked) && repacked.byteLength < best.outputSize) best = { ...best, bytes: repacked, outputSize: repacked.byteLength };
    } catch { /* keep the existing result */ }
  }

  const outputSize = best.outputSize;
  const unchanged = outputSize >= originalSize;
  const warnings = [...(best.warnings || [])];
  if (smartWarning) warnings.push(smartWarning);
  if (losslessWarning) warnings.push(losslessWarning);
  if (unchanged && !warnings.length) warnings.push('No smaller safe output was produced; the original PDF was preserved.');
  return {
    ...best,
    originalSize,
    outputSize,
    targetBytes,
    reachedTarget: targetBytes ? outputSize <= targetBytes : true,
    unchanged,
    reductionPercent: Math.max(0, (1 - outputSize / originalSize) * 100),
    targetDifferenceBytes: targetBytes ? outputSize - targetBytes : undefined,
    colorMode: ['None', 'PDF toolkit'].includes(best.engine) ? 'preserved' : colorMode,
    warning: warnings.join(' '),
    warnings,
    integrity,
    smartTried,
    imageObjectAttempted,
    imageObjectStats,
  };
}

/**
 * Public entry point. Every non-lossless preset carries an internal size goal (a fraction of the original)
 * so the engine keeps escalating through stronger profiles instead of stopping after one mild pass.
 * The goal is best-effort: it never surfaces as a failed "user target" and the smallest safe output wins.
 */
export async function compressPdf(inputBytes, options = {}) {
  const input = asBytes(inputBytes);
  const normalized = normalizeCompressionOptions(options);
  const info = COMPRESSION_PRESETS[normalized.preset];
  const autoGoal = !normalized.targetBytes && info?.goal && normalized.preset !== 'lossless' && input.byteLength > 0;
  if (!autoGoal) return compressPdfCore(inputBytes, options);
  const goalBytes = Math.max(1024, Math.floor(input.byteLength * info.goal));
  const result = await compressPdfCore(inputBytes, { ...options, targetBytes: goalBytes, ladderStart: info.ladderStart, __autoGoal: true });
  const { targetDifferenceBytes, ...rest } = result;
  const warnings = (rest.warnings || []).filter((w) => !/requested .* target/i.test(w));
  return { ...rest, targetBytes: null, reachedTarget: true, warnings, warning: warnings.join(' '), goalReached: result.outputSize <= goalBytes, goalBytes };
}

export function compressionSummary(result) {
  const savedBytes = Math.max(0, result.originalSize - result.outputSize);
  const reduction = result.originalSize ? (savedBytes / result.originalSize) * 100 : 0;
  return {
    original: result.originalSize,
    output: result.outputSize,
    saved: savedBytes,
    savedPercent: clamp(reduction, 0, 100),
    targetReached: result.reachedTarget,
    outputKb: roundKb(result.outputSize),
    engine: result.engine || 'Unknown',
    profile: result.profile || 'Unknown',
    warnings: result.warnings || (result.warning ? [result.warning] : []),
    integrity: result.integrity || null,
  };
}
