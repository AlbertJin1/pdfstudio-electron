'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { prepareBundleResources, parseLanguages } = require('../scripts/prepare-bundled-resources.cjs');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfstudio-size-policy-'));
const write = (relative, content = 'fixture') => {
  const full = path.join(root, relative);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  return full;
};
try {
  write('resources/ocr/tesseract.exe', 'tesseract');
  write('resources/ocr/libtesseract.dll', 'dll');
  write('resources/ocr/LICENSE.txt', 'license');
  write('resources/ocr/tessdata/eng.traineddata', 'eng-model');
  write('resources/ocr/tessdata/chi_tra.traineddata', 'chi-model');
  write('resources/ocr/tessdata/jpn.traineddata', 'jpn-model');
  write('resources/ocr/tessdata/configs/tsv', 'tsv-config');
  write('resources/ghostscript/bin/gswin64c.exe', 'native-gs');

  const normal = prepareBundleResources(root, {});
  const ocr = normal.stageOcr;
  const gs = normal.stageGs;
  assert.equal(fs.existsSync(path.join(ocr, 'tesseract.exe')), true);
  assert.equal(fs.existsSync(path.join(ocr, 'libtesseract.dll')), true);
  assert.equal(fs.existsSync(path.join(ocr, 'tessdata/eng.traineddata')), true);
  assert.equal(fs.existsSync(path.join(ocr, 'tessdata/chi_tra.traineddata')), true);
  assert.equal(fs.existsSync(path.join(ocr, 'tessdata/jpn.traineddata')), false, 'default slim build excludes unselected language models');
  assert.equal(fs.existsSync(path.join(ocr, 'tessdata/configs/tsv')), true, 'small Tesseract configs are retained');
  assert.equal(fs.existsSync(path.join(gs, 'bin/gswin64c.exe')), false, 'native Ghostscript is not duplicated by default');

  prepareBundleResources(root, { PDFSTUDIO_OCR_LANGS: 'all', PDFSTUDIO_BUNDLE_NATIVE_GHOSTSCRIPT: '1' });
  assert.equal(fs.existsSync(path.join(ocr, 'tessdata/jpn.traineddata')), true, 'all model mode preserves every staged language');
  assert.equal(fs.existsSync(path.join(gs, 'bin/gswin64c.exe')), true, 'native Ghostscript can be explicitly enabled');

  prepareBundleResources(root, { PDFSTUDIO_BUNDLE_OCR: '0' });
  assert.equal(fs.existsSync(path.join(ocr, 'tesseract.exe')), false, 'OCR can be disabled explicitly');
  assert.deepEqual(parseLanguages('eng, chi_tra'), ['eng', 'chi_tra']);
  assert.equal(parseLanguages('all'), 'all');
  assert.throws(() => parseLanguages('../eng'), /Invalid OCR language code/);

  const packageJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf8'));
  assert.equal(packageJson.build.win.compression, 'maximum', 'portable EXE uses maximum compression');
  assert(packageJson.build.extraResources.some((entry) => entry.from === 'build-resources/ocr'), 'OCR is staged through size policy');
  assert(packageJson.build.extraResources.some((entry) => entry.from === 'build-resources/ghostscript'), 'native Ghostscript is staged through size policy');
  console.log('Portable EXE size policy tests passed.');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
