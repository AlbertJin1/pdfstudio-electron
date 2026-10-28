'use strict';
const assert = require('node:assert/strict');
const { buildResult, normalizeLanguage, listLanguages, recognizeImage, shutdown } = require('../electron/services/image-text-extractor.cjs');

assert.deepEqual(normalizeLanguage('eng+fil'), ['eng', 'fil']);
assert.deepEqual(normalizeLanguage(''), ['eng']);
assert.throws(() => normalizeLanguage('../../etc/passwd'), /supported OCR language/);
assert.throws(() => normalizeLanguage('eng+fil+ceb+spa+fra'), /supported OCR language/);

const built = buildResult({ blocks: [{ paragraphs: [{ confidence: 90, lines: [
  { text: 'Hello world\n', words: [{ text: 'Hello', confidence: 95, bbox: { x0: 1, y0: 2, x1: 41, y1: 22 } }, { text: 'world', confidence: 40, bbox: { x0: 50, y0: 2, x1: 90, y1: 22 } }] },
  { text: 'second line', words: [{ text: 'second', confidence: 88, bbox: { x0: 1, y0: 30, x1: 60, y1: 50 } }, { text: 'bad', confidence: 90, bbox: { x0: NaN, y0: 0, x1: 1, y1: 1 } }] },
] }] }] }, ['eng']);
assert.equal(built.text, 'Hello world\nsecond line');
assert.equal(built.wordCount, 3, 'words with invalid boxes are dropped');
assert.equal(built.lowConfidenceWords, 1);
assert.equal(built.words[0].width, 40);

(async () => {
  await assert.rejects(() => recognizeImage(Buffer.alloc(0)), /between 1 byte and 25 MB/);
  const languages = listLanguages({});
  // The live OCR check only runs where the bundled models are installed (npm install).
  if (languages.some((l) => l.code === 'eng')) {
    const { deflateSync } = require('node:zlib');
    void deflateSync; // a blank PNG is enough to prove the engine starts and reports "no text" cleanly
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAIAAAD/gAIDAAAAOUlEQVR4nO3BAQ0AAADCoPdPbQ8HFAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPwZgAAB2hQe5wAAAABJRU5ErkJggg==', 'base64');
    const result = await recognizeImage(png, { language: 'eng' });
    assert.equal(result.available, true);
    assert.equal(result.wordCount, 0);
    assert.ok(result.warning);
  }
  await shutdown();
  console.log('Image-to-text extractor checks passed. Models installed:', languages.map((l) => l.code).join(', ') || 'none');
})().catch((error) => { console.error(error); process.exit(1); });
