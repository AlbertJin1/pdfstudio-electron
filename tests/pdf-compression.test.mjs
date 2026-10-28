import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  COMPRESSION_PRESETS,
  compressPdf,
  compressionSummary,
  detectPdfSignatures,
  normalizeCompressionOptions,
  validatePdfBytes,
} from '../src/services/pdf/compress.js';

assert.deepEqual(Object.keys(COMPRESSION_PRESETS), ['lossless', 'high', 'balanced', 'small', 'smallest', 'ultra']);
const packageManifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const lockManifest = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'));
assert.ok(packageManifest.dependencies?.['compress-pdf-lib'], 'built-in object optimizer must be a production dependency');
assert.equal(lockManifest.packages?.['node_modules/compress-pdf-lib']?.version, '1.0.5', 'lockfile must pin the tested image-object optimizer version');
assert.equal(COMPRESSION_PRESETS.lossless.maxDimension, 2600);
assert.equal(COMPRESSION_PRESETS.high.dpi, 250);
assert.equal(COMPRESSION_PRESETS.smallest.quality, 0.42);
assert.equal(detectPdfSignatures(new Uint8Array(Buffer.from('%PDF-1.7\n<< /ByteRange [0 1 2 3] >>'))), true);
assert.equal(detectPdfSignatures(new Uint8Array(Buffer.from('%PDF-1.7\nordinary document'))), false);

assert.equal(validatePdfBytes(new Uint8Array(Buffer.from('%PDF-1.7'))), true);
assert.equal(validatePdfBytes(new Uint8Array(Buffer.from('\u0000\u0001\u0002%PDF-1.7'))), true);
assert.equal(validatePdfBytes(new Uint8Array([1, 2, 3, 4, 5])), false);
assert.deepEqual(
  (({ preset, resolutionDpi, quality, colorMode, preserveMetadata, includeAnnotations }) => ({ preset, resolutionDpi, quality, colorMode, preserveMetadata, includeAnnotations }))(normalizeCompressionOptions({})),
  { preset: 'balanced', resolutionDpi: 150, quality: 0.7, colorMode: 'color', preserveMetadata: true, includeAnnotations: true },
);
const normalized = normalizeCompressionOptions({ preset: 'high', resolutionDpi: 900, quality: 15, colorMode: 'invalid', preserveMetadata: false, includeAnnotations: false });
assert.equal(normalized.resolutionDpi, 400);
assert.equal(normalized.quality, 0.15);
assert.equal(normalized.colorMode, 'color');
assert.equal(normalized.preserveMetadata, false);
assert.equal(normalized.includeAnnotations, false);

await assert.rejects(() => compressPdf(new Uint8Array([1, 2, 3, 4, 5])), /valid PDF/i);

const original = new Uint8Array(Buffer.from('%PDF-1.7\n' + 'x'.repeat(2048), 'utf8'));
const optimized = new Uint8Array(Buffer.from('%PDF-1.7\noptimized content', 'utf8'));
const lossless = await compressPdf(original, {
  preset: 'lossless',
  losslessOptimize: async () => optimized,
});
assert.equal(lossless.profile, 'Lossless optimization');
assert.equal(lossless.outputSize, optimized.byteLength);
assert.equal(lossless.originalSize, original.byteLength);
assert.equal(lossless.unchanged, false);
assert.equal(lossless.colorMode, 'preserved');

const unavailableLossless = await compressPdf(original, {
  preset: 'lossless',
  losslessOptimize: async () => { throw new Error('Optimizer cannot open this protected PDF.'); },
});
assert.equal(unavailableLossless.outputSize, original.byteLength);
assert.equal(unavailableLossless.unchanged, true);
assert.match(unavailableLossless.warning, /protected PDF/);

const smart = await compressPdf(original, {
  preset: 'high',
  smartOptimize: async () => ({ bytes: optimized, engine: 'Ghostscript pdfwrite', warnings: ['test warning'] }),
  validateIntegrity: async () => ({ valid: true, errors: [], warnings: [], pageCountPreserved: true, linksPreserved: true, formsPreserved: true }),
});
assert.equal(smart.engine, 'Ghostscript pdfwrite');
assert.equal(smart.outputSize, optimized.byteLength);
assert.equal(smart.unchanged, false);
assert.match(smart.warnings.join(' '), /test warning/);

const smartSmallerWithRasterFallbackEnabled = await compressPdf(original, {
  preset: 'balanced',
  allowRasterFallback: true,
  smartOptimize: async () => ({ bytes: optimized, engine: 'Ghostscript pdfwrite', warnings: [] }),
  validateIntegrity: async () => ({ valid: true, errors: [], warnings: [], pageCountPreserved: true, linksPreserved: true, formsPreserved: true, attachmentsPreserved: true, geometryPreserved: true }),
});
assert.equal(smartSmallerWithRasterFallbackEnabled.outputSize, optimized.byteLength);
assert.equal(smartSmallerWithRasterFallbackEnabled.engine, 'Ghostscript pdfwrite');
assert.equal(smartSmallerWithRasterFallbackEnabled.warnings.some((warning) => /rasterized/i.test(warning)), false, 'an already-smaller smart result must not be rasterized in preset mode');

// When the desktop Ghostscript IPC is unavailable, the built-in image-object optimizer must
// still be attempted and can meet a target without the destructive page-raster fallback.
let imageFallbackCalls = 0;
const imageFallback = await compressPdf(original, {
  preset: 'balanced',
  targetBytes: Math.floor(original.byteLength * 0.60),
  smartOptimize: async () => { throw new Error('Ghostscript was not found.'); },
  imageObjectOptimize: async (input, profile) => {
    imageFallbackCalls += 1;
    const ratio = profile.scale <= 0.72 ? 0.52 : profile.scale <= 0.82 ? 0.70 : 0.82;
    return {
      bytes: new Uint8Array(Buffer.from('%PDF-1.7\n' + 'compressed'.repeat(Math.max(1, Math.floor(input.byteLength * ratio / 10))))),
      stats: { imagesFound: 3, imagesCompressed: 2, imagesSkipped: 1, savedBytes: 400 },
    };
  },
  validateIntegrity: async () => ({ valid: true, errors: [], warnings: [], pageCountPreserved: true, linksPreserved: true, formsPreserved: true, attachmentsPreserved: true, geometryPreserved: true }),
});
assert.equal(imageFallback.engine, 'Built-in PDF image-object optimizer');
assert.equal(imageFallback.reachedTarget, true);
assert.ok(imageFallback.outputSize < original.byteLength);
assert.ok(imageFallbackCalls >= 1 && imageFallbackCalls <= 4, 'target search must be bounded to at most four image-object passes');
assert.match(imageFallback.warnings.join(' '), /re-encoded/i);
assert.doesNotMatch(imageFallback.warnings.join(' '), /Ghostscript was not found/i);
assert.equal(imageFallback.integrity.valid, true);
assert.equal(imageFallback.imageObjectStats.imagesCompressed, 2);

let grayscaleImageFallbackCalls = 0;
const grayscaleFallback = await compressPdf(original, {
  preset: 'balanced',
  colorMode: 'grayscale',
  targetBytes: Math.floor(original.byteLength * 0.60),
  smartOptimize: async () => { throw new Error('Ghostscript was not found.'); },
  imageObjectOptimize: async () => { grayscaleImageFallbackCalls += 1; return optimized; },
});
assert.equal(grayscaleImageFallbackCalls, 0, 'built-in color-preserving optimizer must not silently ignore a grayscale request');
assert.match(grayscaleFallback.warnings.join(' '), /grayscale or monochrome conversion requires Ghostscript/i);

const signed = await compressPdf(new Uint8Array(Buffer.from('%PDF-1.7\n/ByteRange [0 20 40 60]')), {
  preset: 'balanced',
  smartOptimize: async () => { throw new Error('Must not run on signed PDFs.'); },
});
assert.equal(signed.unchanged, true);
assert.match(signed.warning, /digital signature/i);

const target = await compressPdf(original, {
  preset: 'balanced',
  targetBytes: original.byteLength,
  losslessOptimize: async () => optimized,
});
assert.equal(target.reachedTarget, true);
assert.equal(target.outputSize, optimized.byteLength);
assert.equal(target.profile, 'Lossless optimization');

const withinTarget = await compressPdf(original, {
  preset: 'balanced',
  targetBytes: original.byteLength + 100,
});
assert.equal(withinTarget.reachedTarget, true);
assert.equal(withinTarget.unchanged, true);

assert.deepEqual(compressionSummary({ originalSize: 1000, outputSize: 700, reachedTarget: true }), {
  original: 1000,
  output: 700,
  saved: 300,
  savedPercent: 30,
  targetReached: true,
  outputKb: 1,
  engine: 'Unknown',
  profile: 'Unknown',
  warnings: [],
  integrity: null,
});

console.log('PDF compression unit checks passed.');
