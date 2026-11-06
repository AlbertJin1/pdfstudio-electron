// Edit PDF: editing existing text must REMOVE the original glyphs from the content stream (not hide them under a
// white box), keep every other glyph exactly in place, and deleting an image must remove its drawing operator.
// Runs through the Node shim in tools/shim.mjs. Skips if @napi-rs/canvas is missing.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
try { require.resolve('@napi-rs/canvas'); } catch { console.log('SKIPPED pdf edit content test: @napi-rs/canvas is not installed.'); process.exit(0); }
await import('../tools/shim.mjs');
const { PDFDocument, StandardFonts } = require('pdf-lib');
const { loadPdfSource } = await import('../src/services/pdf/pdfjs.js');
const { extractPageContent } = await import('../src/services/pdf/pageContent.js');
const { exportEditedPdf } = await import('../src/services/pdf/edit.js');

const pdf = await PDFDocument.create();
const font = await pdf.embedFont(StandardFonts.Helvetica);
const page = pdf.addPage([612, 792]);
page.drawText('Keep this heading', { x: 72, y: 700, size: 16, font });
page.drawText('Old price: 1,250.00', { x: 72, y: 660, size: 11, font });
page.drawText('Footer stays here', { x: 72, y: 100, size: 9, font });
const png = await pdf.embedPng(Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP4z8CAFWEXHbQSACj/P8Fu7N9hAAAAAElFTkSuQmCC', 'base64')));
page.drawImage(png, { x: 300, y: 400, width: 120, height: 120 });
const bytes = await pdf.save();

const doc = await loadPdfSource(bytes.slice());
const pdfPage = await doc.getPage(1);
const viewport = pdfPage.getViewport({ scale: 1 });
const { blocks, images } = await extractPageContent(pdfPage, viewport, 0);
const target = blocks.find((b) => b.text.includes('Old price'));
assert.ok(target, 'the editable text block is detected');
assert.equal(images.length, 1, 'the image is detected');
const items = [
  { id: 't1', type: 'textedit', src: { x: target.x, y: target.y, w: target.w, h: target.h }, cover: '#ffffff', text: 'New price: 990.00', size: 11, font: 'helvetica', x: target.x, y: target.y, w: target.w + 40, h: target.h, color: '#000000', align: 'left', lineHeight: 1.2 },
  { id: 'i1', type: 'imageedit', src: { x: images[0].x, y: images[0].y, w: images[0].w, h: images[0].h }, deleted: true, x: images[0].x, y: images[0].y, w: images[0].w, h: images[0].h },
];
let report = null;
const out = await exportEditedPdf(bytes, doc, { 0: items }, { onReport: (r) => { report = r; } });
assert.deepEqual(report, { removedText: 1, removedImages: 1, coveredText: 0, coveredImages: 0 }, 'original text and image were removed, not covered');

const edited = await loadPdfSource(out.slice());
const editedPage = await edited.getPage(1);
const text = (await editedPage.getTextContent()).items.map((i) => i.str).join(' ');
assert.ok(!text.includes('Old price') && !text.includes('1,250.00'), 'the old text is gone from the file');
assert.ok(text.includes('New price: 990.00'), 'the new text is present');
assert.ok(text.includes('Keep this heading') && text.includes('Footer stays here'), 'other text is untouched');
const content = await extractPageContent(editedPage, editedPage.getViewport({ scale: 1 }), 0);
assert.equal(content.images.length, 0, 'the deleted image is gone from the page');
const heading = content.blocks.find((b) => b.text.includes('Keep this heading'));
const original = blocks.find((b) => b.text.includes('Keep this heading'));
assert.ok(Math.abs(heading.x - original.x) < 0.05 && Math.abs(heading.firstBaseline - original.firstBaseline) < 0.05, 'untouched text keeps its exact position');
console.log('Edit PDF content removal checks passed.');
