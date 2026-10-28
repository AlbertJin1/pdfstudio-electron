// End-to-end regression test: runs the REAL pdfToDocx() on a generated PDF in every conversion mode.
//
// Why this exists: a block-scoped `const preflightSummary` inside pdfToDocx's try{} was read after the
// block closed, throwing "ReferenceError: preflightSummary is not defined" on every conversion. The
// unit tests only exercised helper functions, so nothing caught it before release.
//
// Needs a canvas implementation outside the browser and a Node with modern JS built-ins (Node 24+,
// matching the Chromium inside Electron). If either is missing the test SKIPS (exit 0) with a notice:
//     npm i --no-save --legacy-peer-deps @napi-rs/canvas   # then run on Node 24+
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skip = (why) => { console.log(`SKIPPED pdf-to-docx e2e: ${why}`); process.exit(0); };

if (typeof Promise.try !== 'function') skip('requires Node 24+ (pdfjs-dist 6 uses Promise.try).');
let napi;
try { napi = require('@napi-rs/canvas'); } catch { skip('@napi-rs/canvas is not installed.'); }

// Polyfills for built-ins that Electron's Chromium ships natively but Node 24 may lack.
Uint8Array.prototype.toHex ||= function () { return Array.from(this, (b) => b.toString(16).padStart(2, '0')).join(''); };
Uint8Array.prototype.toBase64 ||= function () { return Buffer.from(this).toString('base64'); };
Uint8Array.fromBase64 ||= (s) => new Uint8Array(Buffer.from(s, 'base64'));
Uint8Array.fromHex ||= (s) => new Uint8Array(Buffer.from(s, 'hex'));
for (const C of [Map, WeakMap]) {
  C.prototype.getOrInsertComputed ||= function (k, fn) { if (!this.has(k)) this.set(k, fn(k)); return this.get(k); };
  C.prototype.getOrInsert ||= function (k, v) { if (!this.has(k)) this.set(k, v); return this.get(k); };
}
for (const k of ['Path2D', 'DOMMatrix', 'ImageData', 'Image']) if (napi[k] && !globalThis[k]) globalThis[k] = napi[k];

// Minimal browser shims used by services/pdf/pdfjs.js and docx.js.
globalThis.window = globalThis;
globalThis.window.location = { href: pathToFileURL(path.join(root, 'public') + path.sep).href };
globalThis.document = { createElement: (tag) => { assert.equal(tag, 'canvas'); return napi.createCanvas(1, 1); } };

const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const JSZip = require('jszip');

const doc = await PDFDocument.create();
const font = await doc.embedFont(StandardFonts.Helvetica);
const bold = await doc.embedFont(StandardFonts.HelveticaBold);
const page = doc.addPage([612, 792]);
page.drawText('JUAN DELA CRUZ', { x: 50, y: 740, size: 22, font: bold });
page.drawText('EXPERIENCE', { x: 50, y: 680, size: 13, font: bold, color: rgb(0.2, 0.2, 0.7) });
for (let i = 0; i < 6; i += 1) page.drawText(`Managed POS terminals, servers and internal tools - item ${i + 1}.`, { x: 60, y: 660 - i * 16, size: 10.5, font });
for (let r = 0; r <= 3; r += 1) page.drawLine({ start: { x: 50, y: 500 - r * 22 }, end: { x: 400, y: 500 - r * 22 }, thickness: 0.8 });
for (let c = 0; c <= 3; c += 1) page.drawLine({ start: { x: 50 + c * 116, y: 500 }, end: { x: 50 + c * 116, y: 434 }, thickness: 0.8 });
['Store', 'Terminals', 'Status'].forEach((t, i) => page.drawText(t, { x: 56 + i * 116, y: 486, size: 10, font: bold }));
// Regression fixtures for the Acrobat-parity fixes:
//  1. text covered by a later opaque shape is invisible in a viewer and must NOT appear in Word;
//  2. one word split into kerning fragments must stay a single run (no tab inside the word);
//  3. a name that merely grazes a picture must stay editable text.
page.drawText('COVEREDSECRET', { x: 300, y: 740, size: 12, font });
page.drawRectangle({ x: 295, y: 735, width: 140, height: 20, color: rgb(1, 1, 1) });
page.drawText('ref', { x: 300, y: 600, size: 11, font });
page.drawText('er', { x: 300 + font.widthOfTextAtSize('ref', 11), y: 600, size: 11, font });
page.drawRectangle({ x: 420, y: 560, width: 80, height: 40, color: rgb(0.8, 0.85, 0.95) });
page.drawText('SIGNER NAME', { x: 420, y: 552, size: 10, font: bold });
const pdfBytes = await doc.save();

const { pdfToDocx } = await import(pathToFileURL(path.join(root, 'src/services/pdf/docx.js')).href);

for (const mode of ['auto', 'editable', 'layout', 'visual']) {
  const result = await pdfToDocx(pdfBytes, null, { mode, ocrEnabled: false });
  assert.ok(result.bytes?.length > 1000, `${mode}: produced a DOCX`);
  assert.equal(result.pages, 1, `${mode}: page count`);
  assert.ok(result.preflight, `${mode}: result.preflight is returned`);
  assert.equal(result.preflight.pages, 1, `${mode}: preflight page count`);
  assert.equal(result.preflight.pagesWithNativeText, 1, `${mode}: preflight sees the native text layer`);
  assert.ok(result.preflight.nativeTextSpans > 0, `${mode}: preflight counted text spans`);
  assert.equal(result.quality.preflight, result.preflight, `${mode}: quality report carries the preflight summary`);
  const xml = await (await JSZip.loadAsync(result.bytes)).file('word/document.xml').async('string');
  if (mode !== 'visual') assert.match(xml, /Managed POS terminals/, `${mode}: text stays editable in Word`);
  if (mode !== 'visual') {
    assert.doesNotMatch(xml, /COVEREDSECRET/, `${mode}: covered/invisible PDF text is not exported`);
    assert.match(xml, /JUAN DELA CRUZ/, `${mode}: visible heading still exported`);
    assert.match(xml, /SIGNER NAME/, `${mode}: text grazing a picture stays editable`);
    if (mode !== 'layout') assert.match(xml, /<w:t[^>]*>refer<\/w:t>/, `${mode}: split word is fused into one run`);
  }
}
console.log('PDF -> DOCX end-to-end conversion passed in auto, editable, layout and visual modes.');
