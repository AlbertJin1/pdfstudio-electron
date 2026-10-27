const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildArgs, getGhostscriptInfo, resolveImageFilterMode } = require('../electron/services/ghostscript-compression.cjs');

const args = buildArgs({
  inputPath: '/tmp/source.pdf',
  outputPath: '/tmp/output.pdf',
  preset: 'balanced',
  resolutionDpi: 180,
  quality: 72,
  colorMode: 'color',
  preserveMetadata: true,
  includeAnnotations: true,
});
for (const required of [
  '-dSAFER', '-sDEVICE=pdfwrite', '-dDetectDuplicateImages=true',
  '-dCompressFonts=true', '-dSubsetFonts=true', '-dCompressStreams=true',
  '-dDownsampleColorImages=true', '-dDownsampleGrayImages=true',
  '-dColorImageResolution=180', '-dGrayImageResolution=180',
  '-dColorImageFilter=/DCTEncode', '-sOutputFile=/tmp/output.pdf',
]) assert.ok(args.includes(required), `missing Ghostscript option ${required}`);
assert.ok(args.includes('-dPreserveAnnots=true'), 'annotations should remain in the smart rewrite path');
assert.equal(args.includes('-sColorConversionStrategy=Gray'), false);
assert.equal(args.includes('-c'), true);
assert.equal(args.includes('-f'), true);

const grayArgs = buildArgs({ inputPath: 'in.pdf', outputPath: 'out.pdf', colorMode: 'grayscale' });
assert.ok(grayArgs.includes('-sColorConversionStrategy=Gray'));
const passwordArgs = buildArgs({ inputPath: 'in.pdf', outputPath: 'out.pdf', password: 'source-secret' });
assert.ok(passwordArgs.includes('-sPDFPassword=source-secret'));
const adaptiveArgs = buildArgs({ inputPath: 'in.pdf', outputPath: 'out.pdf', imageObjectCount: 801, duplicateImageEstimate: 0 });
assert.ok(adaptiveArgs.includes('-dDetectDuplicateImages=false'), 'very image-heavy documents without duplicate estimates should avoid a costly duplicate scan');
const duplicateAwareArgs = buildArgs({ inputPath: 'in.pdf', outputPath: 'out.pdf', imageObjectCount: 801, duplicateImageEstimate: 3 });
assert.ok(duplicateAwareArgs.includes('-dDetectDuplicateImages=true'), 'known duplicate images should keep deduplication enabled');
const metadataArgs = buildArgs({ inputPath: 'in.pdf', outputPath: 'out.pdf', preserveMetadata: false, metadataCleanupPath: '/tmp/clear-metadata.ps' });
assert.ok(metadataArgs.includes('-dOmitXMP=true'));
assert.ok(metadataArgs.includes('-dOmitInfoDate=true'));
assert.ok(metadataArgs.at(-1) === '/tmp/clear-metadata.ps', 'metadata cleanup program must execute after PDF input');

// The process must not invoke a command shell; this prevents PDF content or file names from
// being interpolated into a shell command line.
const source = fs.readFileSync(path.join(__dirname, '..', 'electron', 'services', 'ghostscript-compression.cjs'), 'utf8');
assert.match(source, /spawn\(executable, args, \{[^}]*shell:\s*false/s);

getGhostscriptInfo().then((info) => {
  assert.equal(typeof info.available, 'boolean');
  if (info.available) {
    assert.equal(info.engine, 'Ghostscript pdfwrite');
    assert.ok(info.version);
  } else {
    assert.ok(info.reason);
  }
  console.log(`Ghostscript compression contract checks passed. Engine available: ${info.available}.`);
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
