import { loadPdfSource } from './pdfjs.js';

export async function pdfToDocx(pdfBytes, pdfSource) {
  const { Document, Paragraph, TextRun, PageBreak, Packer } = await import('docx');
  const pdf = pdfSource || await loadPdfSource(pdfBytes);
  const children = [];
  for (let pageIndex = 1; pageIndex <= pdf.numPages; pageIndex += 1) {
    const page = await pdf.getPage(pageIndex);
    const content = await page.getTextContent();
    const lines = new Map();
    for (const item of content.items || []) {
      if (!item.str || !item.str.trim()) continue;
      const y = Math.round((item.transform?.[5] || 0) / 2) * 2;
      const list = lines.get(y) || [];
      list.push({ x: item.transform?.[4] || 0, text: item.str, font: item.fontName || '' });
      lines.set(y, list);
    }
    const ordered = [...lines.entries()].sort((a, b) => b[0] - a[0]);
    if (!ordered.length) children.push(new Paragraph({ children: [new TextRun({ text: '(No selectable text found on this page)', italics: true, color: '888888' })], spacing: { after: 160 } }));
    for (const [, items] of ordered) {
      items.sort((a, b) => a.x - b.x);
      const text = items.map((item) => item.text).join(' ').replace(/[ \t]+/g, ' ').trim();
      if (text) children.push(new Paragraph({ children: [new TextRun(text)], spacing: { after: 100 } }));
    }
    if (pageIndex < pdf.numPages) children.push(new Paragraph({ children: [new PageBreak()] }));
  }
  const document = new Document({
    creator: 'PDF Studio', title: 'Converted from PDF',
    sections: [{ properties: { page: { margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 } } }, children }],
  });
  const blob = await Packer.toBlob(document);
  return new Uint8Array(await blob.arrayBuffer());
}
