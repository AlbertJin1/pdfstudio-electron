import fs from 'node:fs';
globalThis.window = { location: { href: 'file:///tmp/t/' } };
const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
const { extractPageContent, detectFont } = await import('./src/services/pdf/pageContent.js');
const { exportEditedPdf } = await import('./src/services/pdf/edit.js');
const { getPdfJsLib } = await import('./src/services/pdf/pdfjs.js');

// build a sample PDF
const doc = await PDFDocument.create();
const page = doc.addPage([612, 792]);
const helv = await doc.embedFont(StandardFonts.Helvetica);
const bold = await doc.embedFont(StandardFonts.TimesRomanBold);
page.drawText('Invoice Number 12345', { x: 72, y: 700, size: 20, font: bold, color: rgb(0.8, 0.1, 0.1) });
page.drawText('Line one of a paragraph that is here', { x: 72, y: 650, size: 12, font: helv });
page.drawText('Line two continues the paragraph', { x: 72, y: 636, size: 12, font: helv });
page.drawText('Underlined', { x: 72, y: 600, size: 12, font: helv });
page.drawLine({ start: { x: 72, y: 598 }, end: { x: 72 + helv.widthOfTextAtSize('Underlined', 12), y: 598 }, thickness: 0.8 });
const bytes = await doc.save();

const pdfjs = await getPdfJsLib();
const pdf = await pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: false, isEvalSupported: false }).promise;
const p = await pdf.getPage(1);
const viewport = p.getViewport({ scale: 1, rotation: 0 });
const content = await extractPageContent(p, viewport, 0);
console.log('blocks', content.blocks.map((b) => ({ text: b.text, x: +b.x.toFixed(1), y: +b.y.toFixed(1), w: +b.w.toFixed(1), size: b.size, font: b.font, align: b.align, lh: b.lineHeight })));

// simulate edits
const b0 = content.blocks[0];
const ann = { 0: [
  { id: 'a', type: 'textedit', src: { x: b0.x, y: b0.y, w: b0.w, h: b0.h }, cover: '#ffffff', x: b0.x, y: b0.firstBaseline - 20 * 0.5 - 0.3375 * 20 * 1, w: b0.w, h: 24, text: 'Invoice Number 99999', size: 20, font: 'times', bold: true, color: '#cc1a1a', underline: true, pad: 0, lineHeight: 1.2 },
  { id: 'b', type: 'text', x: 100, y: 300, w: 200, h: 20, text: 'New “text” € ✓ 日本', size: 14, font: 'helvetica', fontName: 'Arial', italic: true, strike: true, color: '#0000ff', reflow: false },
] };
const out = await exportEditedPdf(bytes, pdf, ann, { title: 'x', findFont: async () => null });
fs.writeFileSync('/tmp/t/out.pdf', out);
const check = await pdfjs.getDocument({ data: new Uint8Array(out), isEvalSupported: false }).promise;
const tc = await (await check.getPage(1)).getTextContent();
console.log('exported text:', tc.items.map((i) => i.str).filter(Boolean));
