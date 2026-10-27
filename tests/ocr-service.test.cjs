'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { parseTesseractTsv, candidates, recognizeImage } = require('../electron/ocr-service.cjs');

const sampleTsv = [
  'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext',
  '5\t1\t1\t1\t1\t1\t12\t24\t50\t18\t93.4\tHello',
  '5\t1\t1\t1\t1\t2\t70\t24\t48\t18\t88.1\tworld again',
  '4\t1\t1\t1\t0\t0\t12\t24\t120\t18\t-1\t',
  '5\t1\t1\t1\t1\t3\t1\t2\t0\t18\t88\tbad-width',
].join('\n');
const words = parseTesseractTsv(sampleTsv);
assert.equal(words.length, 2, 'only valid word-level rows are returned');
assert.deepEqual(words[0], { text: 'Hello', left: 12, top: 24, width: 50, height: 18, confidence: 93.4, block: 1, paragraph: 1, line: 1 });
assert.equal(words[1].text, 'world again', 'the TSV text field may contain spaces');
assert.equal(words[1].width, 48);

const candidatesList = candidates({ resourcesPath: 'C:/App/resources', projectRoot: 'C:/Project', env: { PDFSTUDIO_TESSERACT_PATH: 'C:/OCR/tesseract.exe' }, platform: 'win32' });
assert.equal(candidatesList[0], 'C:/OCR/tesseract.exe');
assert.ok(candidatesList.includes(path.join('C:/App/resources', 'ocr', 'tesseract.exe')));
assert.ok(candidatesList.includes('tesseract.exe'));

(async () => {
  await assert.rejects(() => recognizeImage(Buffer.from('not-an-image'), { language: 'eng' }), /PNG, JPEG, or WebP/);
  // Validate language codes before creating temporary files or launching a process.
  const minimalPngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  await assert.rejects(() => recognizeImage(minimalPngSignature, { language: 'eng+not-a-language' }), /language combination/);
  console.log('OCR service parsing, configuration, input validation, and language validation passed.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
