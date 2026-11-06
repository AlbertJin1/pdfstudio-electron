// End-to-end test of the default (flowing) PDF → Word engine on a generated PDF.
// Runs the real engine through the Node shim in tools/shim.mjs (Node 22+). Skips if @napi-rs/canvas is missing:
//     npm i --no-save @napi-rs/canvas
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
try { require.resolve('@napi-rs/canvas'); } catch { console.log('SKIPPED pdf-to-word flow e2e: @napi-rs/canvas is not installed.'); process.exit(0); }
await import('../tools/shim.mjs');
const { PDFDocument, StandardFonts, rgb, PDFName, PDFString } = require('pdf-lib');
const JSZip = require('jszip');
const { pdfToWordFlow } = await import('../src/services/pdf/word/index.js');

// ---- Build a test PDF ----------------------------------------------------------------------------------------
const pdf = await PDFDocument.create();
const helv = await pdf.embedFont(StandardFonts.Helvetica);
const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
const page = pdf.addPage([612, 792]);
const top = (y) => 792 - y; // write in top-down coordinates
const title = 'Quarterly Store Systems Review';
page.drawText(title, { x: (612 - bold.widthOfTextAtSize(title, 18)) / 2, y: top(80), size: 18, font: bold });
// Justified-looking paragraph: three lines that fill the measure, last line short.
const words = 'The checkout lane printers at the branch stopped cutting receipts after the latest firmware update and a technician replaced the cutter assemblies on three lanes during the morning shift without any further downtime reported by the store'.split(' ');
const measure = 612 - 144;
let line = []; let y = 120; const lines = [];
for (const word of words) {
  const next = [...line, word].join(' ');
  if (helv.widthOfTextAtSize(next, 11) > measure) { lines.push(line); line = [word]; } else line.push(word);
}
lines.push(line);
for (const [index, list] of lines.entries()) {
  if (index < lines.length - 1) {
    // Justify by spreading the gaps.
    const natural = list.reduce((s, w) => s + helv.widthOfTextAtSize(w, 11), 0);
    const gap = (measure - natural) / (list.length - 1);
    let x = 72;
    for (const word of list) { page.drawText(word, { x, y: top(y), size: 11, font: helv }); x += helv.widthOfTextAtSize(word, 11) + gap; }
  } else page.drawText(list.join(' '), { x: 72, y: top(y), size: 11, font: helv });
  y += 14;
}
page.drawText('Important:', { x: 72, y: top(y + 10), size: 11, font: bold, color: rgb(0.8, 0, 0) });
// Ruled 3×3 table with a shaded header and right-aligned numbers.
const tx = [72, 272, 372, 540]; const ty = [220, 240, 260, 280];
page.drawRectangle({ x: 72, y: top(240), width: 468, height: 20, color: rgb(0.12, 0.3, 0.47) });
for (const yy of ty) page.drawLine({ start: { x: 72, y: top(yy) }, end: { x: 540, y: top(yy) }, thickness: 0.7 });
for (const xx of tx) page.drawLine({ start: { x: xx, y: top(220) }, end: { x: xx, y: top(280) }, thickness: 0.7 });
const cells = [['Item', 'Qty', 'Amount'], ['Thermal printer', '3', '14,550.00'], ['Barcode scanner', '4', '13,000.00']];
cells.forEach((row, r) => row.forEach((text, c) => {
  const font = r === 0 ? bold : helv;
  const width = font.widthOfTextAtSize(text, 10);
  const x = c === 0 || r === 0 ? tx[c] + 5 : tx[c + 1] - 5 - width;
  page.drawText(text, { x, y: top(ty[r] + 14), size: 10, font, color: r === 0 ? rgb(1, 1, 1) : rgb(0, 0, 0) });
}));
// A link.
const linkText = 'https://example.com/help';
page.drawText(linkText, { x: 72, y: top(320), size: 10, font: helv, color: rgb(0, 0, 0.8) });
const link = pdf.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [72, top(322), 72 + helv.widthOfTextAtSize(linkText, 10), top(310)], Border: [0, 0, 0], A: { Type: 'Action', S: 'URI', URI: PDFString.of('https://example.com/help') } });
page.node.set(PDFName.of('Annots'), pdf.context.obj([pdf.context.register(link)]));
// A picture (red square PNG).
const png = await pdf.embedPng(Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP4z8CAFWEXHbQSACj/P8Fu7N9hAAAAAElFTkSuQmCC', 'base64')));
page.drawImage(png, { x: 250, y: top(460), width: 100, height: 100 });
// Second page, landscape.
const page2 = pdf.addPage([792, 612]);
page2.drawText('Second page in landscape', { x: 72, y: 540, size: 14, font: bold });
const bytes = await pdf.save();

// ---- Convert -------------------------------------------------------------------------------------------------
const result = await pdfToWordFlow(bytes, null, { ocrEnabled: false });
assert.equal(result.pages, 2, 'every PDF page is converted');
assert.equal(result.mode, 'flow');
assert.ok(result.validation.valid, 'the package validates');
const zip = await JSZip.loadAsync(result.bytes);
const xml = await zip.file('word/document.xml').async('string');
const text = (xml.match(/<w:t[^>]*>[^<]*<\/w:t>/g) || []).map((t) => t.replace(/<[^>]+>/g, '')).join('');

for (const word of ['Quarterly', 'checkout', 'cutter', 'downtime', 'Thermal', 'scanner', '14,550.00', 'Second']) assert.ok(text.includes(word), `text "${word}" is present`);
assert.ok(text.indexOf('Quarterly') < text.indexOf('checkout') && text.indexOf('checkout') < text.indexOf('Thermal'), 'reading order follows the page');
assert.match(xml, /<w:jc w:val="center"\/>[\s\S]*Quarterly Store Systems Review/, 'the centred title stays centred');
assert.match(xml, /<w:jc w:val="both"\/>/, 'the justified paragraph is justified');
assert.equal((xml.match(/<w:p>(?:(?!<\/w:p>).)*checkout(?:(?!<\/w:p>).)*downtime/gs) || []).length, 1, 'wrapped lines are joined into one flowing paragraph');
assert.match(xml, /<w:color w:val="CC0000"\/>/, 'text colour comes from the PDF');
assert.match(xml, /w:ascii="Arial"/, 'Helvetica maps to Arial');
assert.equal((xml.match(/<w:tbl>/g) || []).length, 1, 'the ruled grid becomes one Word table');
assert.equal((xml.match(/<w:gridCol /g) || []).length, 3, 'the table keeps its three columns');
assert.match(xml, /<w:shd w:val="clear" w:color="auto" w:fill="1F4C78"\/>/, 'header shading is preserved');
assert.match(xml, /<w:jc w:val="right"\/>(?:(?!<\/w:p>).)*14,550\.00/s, 'numbers stay right-aligned in their cells');
assert.match(xml, /<w:hyperlink r:id="rId\d+"/, 'links become Word hyperlinks');
assert.equal((xml.match(/<pic:pic /g) || []).length, 1, 'the picture is a separate Word image');
assert.equal((xml.match(/<w:sectPr>/g) || []).length, 2, 'each PDF page is its own Word section');
assert.match(xml, /<w:pgSz w:w="15840" w:h="12240" w:orient="landscape"\/>/, 'the landscape page keeps its size');
const rels = await zip.file('word/_rels/document.xml.rels').async('string');
assert.match(rels, /https:\/\/example\.com\/help/, 'hyperlink target is stored');
console.log('PDF-to-Word flowing engine end-to-end checks passed.');
