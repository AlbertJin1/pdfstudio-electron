// Minimal, standards-conformant WordprocessingML writer for the PDF → Word engine.
// Generates the XML parts directly so every paragraph/table/drawing property is under precise control.

const NS = [
  'xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas"',
  'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"',
  'xmlns:o="urn:schemas-microsoft-com:office:office"',
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"',
  'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"',
  'xmlns:v="urn:schemas-microsoft-com:vml"',
  'xmlns:wp14="http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing"',
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"',
  'xmlns:w10="urn:schemas-microsoft-com:office:word"',
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"',
  'xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"',
  'xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup"',
  'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"',
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"',
  'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"',
  'mc:Ignorable="w14 wp14"',
].join(' ');

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export const tw = (points) => Math.round((Number(points) || 0) * 20);
export const emu = (points) => Math.max(0, Math.round((Number(points) || 0) * 12700));

// Characters not allowed in XML 1.0 are dropped; private-use glyph codes from symbol fonts survive as-is.
const INVALID_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;
export const esc = (value) => String(value ?? '').replace(INVALID_XML, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---------------------------------------------------------------------------------------------------------------
// Fonts
// ---------------------------------------------------------------------------------------------------------------

const FONT_MAP = [
  [/^(arial|helvetica|arimo|liberation ?sans|nimbus ?sans|freesans|tex ?gyre ?heros|swiss|helv)(?! ?narrow)/i, 'Arial'],
  [/^(arial ?narrow|helvetica ?narrow|liberation ?sans ?narrow|nimbus ?sans ?narrow)/i, 'Arial Narrow'],
  [/^(times|tinos|liberation ?serif|nimbus ?rom|tex ?gyre ?termes|timesnewroman|times ?new ?roman)/i, 'Times New Roman'],
  [/^(courier|cousine|liberation ?mono|nimbus ?mono|tex ?gyre ?cursor)/i, 'Courier New'],
  [/^(calibri|carlito)/i, 'Calibri'],
  [/^(cambria|caladea)/i, 'Cambria'],
  [/^(georgia|gelasio)/i, 'Georgia'],
  [/^(segoe ?ui ?emoji|noto ?color ?emoji|apple ?color ?emoji|emoji)/i, 'Segoe UI Emoji'],
  [/^(segoe ?ui ?symbol|symbol|zapf ?dingbats|dingbats|wingdings)/i, 'Segoe UI Symbol'],
  [/^(dejavu ?sans ?mono)/i, 'Consolas'],
  [/^(dejavu ?sans|bitstream ?vera ?sans|verdana)/i, 'Verdana'],
  [/^(dejavu ?serif)/i, 'Cambria'],
  [/^(open ?sans)/i, 'Open Sans'],
  [/^(source ?sans)/i, 'Source Sans Pro'],
  [/^(noto ?sans|roboto)/i, 'Arial'],
  [/^(noto ?serif)/i, 'Times New Roman'],
  [/^(book ?antiqua|palatino|urw ?palladio|p052)/i, 'Book Antiqua'],
  [/^(century ?gothic|urw ?gothic)/i, 'Century Gothic'],
  [/^(tahoma)/i, 'Tahoma'],
  [/^(trebuchet)/i, 'Trebuchet MS'],
  [/^(garamond|eb ?garamond)/i, 'Garamond'],
  [/^(consolas|inconsolata)/i, 'Consolas'],
  [/^(lucida ?console)/i, 'Lucida Console'],
  [/^(comic)/i, 'Comic Sans MS'],
  [/^(impact)/i, 'Impact'],
  [/^(franklin ?gothic)/i, 'Franklin Gothic Book'],
  [/^(century ?schoolbook|c059)/i, 'Century Schoolbook'],
  [/^(aptos)/i, 'Aptos'],
];

/** Map a PDF font name (e.g. "ABCDEF+Calibri-BoldItalic") to the family Word should use. */
export function wordFontFamily(pdfName = '', hints = {}) {
  let name = String(pdfName || '').replace(/^[A-Z]{6}\+/, '');
  name = name.replace(/[,-](Bold|Italic|Oblique|BoldItalic|BoldOblique|Regular|Roman|Medium|Light|Black|Semibold|SemiBold|Demi|DemiBold|Heavy|Book|Normal|Condensed|Narrow)*$/i, '')
    .replace(/(PSMT|PS|MT|Std|Pro|LT|W\d+)$/g, '')
    .replace(/(Bold|Italic|Oblique|Regular|Semibold|Medium|Light)+$/g, '')
    .replace(/[_-]+$/g, '');
  const spaced = name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  for (const [pattern, family] of FONT_MAP) if (pattern.test(spaced) || pattern.test(name)) return family;
  if (!spaced || /^(g_d\d+_f\d+|f\d+|font\d+|t\d+|tt\d+|c\d+|unknown)$/i.test(spaced)) {
    if (hints.monospace) return 'Courier New';
    if (hints.serif) return 'Times New Roman';
    return 'Arial';
  }
  return spaced.slice(0, 31);
}

// ---------------------------------------------------------------------------------------------------------------
// Runs and paragraphs
// ---------------------------------------------------------------------------------------------------------------

function runProps(run, opts = {}) {
  const family = run.wordFont || 'Arial';
  const half = clamp(Math.round((run.size || 11) * 2), 2, 3276);
  const parts = [`<w:rFonts w:ascii="${esc(family)}" w:hAnsi="${esc(family)}" w:eastAsia="${esc(family)}" w:cs="${esc(family)}"/>`];
  if (run.bold) parts.push('<w:b/><w:bCs/>');
  if (run.italic) parts.push('<w:i/><w:iCs/>');
  if (run.strike) parts.push('<w:strike/>');
  if (run.color && run.color !== '000000') parts.push(`<w:color w:val="${run.color}"/>`);
  if (run.spacingPt) parts.push(`<w:spacing w:val="${Math.round(run.spacingPt * 20)}"/>`);
  if (run.scale && Math.abs(run.scale - 100) >= 1) parts.push(`<w:w w:val="${clamp(Math.round(run.scale), 1, 600)}"/>`);
  parts.push(`<w:sz w:val="${half}"/><w:szCs w:val="${half}"/>`);
  if (run.underline) parts.push('<w:u w:val="single"/>');
  if (run.vert) parts.push(`<w:vertAlign w:val="${run.vert}"/>`);
  if (opts.extra) parts.push(opts.extra);
  return `<w:rPr>${parts.join('')}</w:rPr>`;
}

export function textRun(run) {
  const text = String(run.text ?? '');
  if (!text) return '';
  return `<w:r>${runProps(run)}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
}

export function tabRun(run) { return `<w:r>${runProps(run || {})}<w:tab/></w:r>`; }

function paragraphProps(p, extraTail = '') {
  const parts = ['<w:widowControl w:val="0"/>'];
  if (p.keepNext) parts.splice(0, 0, '<w:keepNext/>');
  if (p.tabs?.length) {
    const stops = [...p.tabs].sort((a, b) => a.pos - b.pos).filter((t, i, list) => i === 0 || Math.abs(t.pos - list[i - 1].pos) > 1)
      .map((t) => `<w:tab w:val="${t.type === 'right' ? 'right' : t.type === 'center' ? 'center' : 'left'}" w:pos="${Math.max(0, tw(t.pos))}"/>`);
    parts.push(`<w:tabs>${stops.join('')}</w:tabs>`);
  }
  parts.push('<w:snapToGrid w:val="0"/>');
  const spacing = [`w:before="${Math.max(0, tw(p.spaceBefore || 0))}"`, `w:after="${Math.max(0, tw(p.spaceAfter || 0))}"`];
  if (p.lineHeight) spacing.push(`w:line="${Math.max(20, tw(p.lineHeight))}"`, `w:lineRule="${p.lineRule || 'exact'}"`);
  else spacing.push('w:line="240"', 'w:lineRule="auto"');
  parts.push(`<w:spacing ${spacing.join(' ')}/>`);
  const ind = [];
  if (p.indLeft) ind.push(`w:left="${tw(p.indLeft)}"`);
  if (p.indRight) ind.push(`w:right="${tw(p.indRight)}"`);
  if (p.firstLine > 0.4) ind.push(`w:firstLine="${tw(p.firstLine)}"`);
  else if (p.firstLine < -0.4) ind.push(`w:hanging="${tw(-p.firstLine)}"`);
  if (ind.length) parts.push(`<w:ind ${ind.join(' ')}/>`);
  if (p.align && p.align !== 'left') parts.push(`<w:jc w:val="${p.align}"/>`);
  if (p.markRunSize) parts.push(`<w:rPr><w:sz w:val="${p.markRunSize}"/><w:szCs w:val="${p.markRunSize}"/></w:rPr>`);
  if (extraTail) parts.push(extraTail);
  return `<w:pPr>${parts.join('')}</w:pPr>`;
}

export function paragraphXml(p, content, extraTail = '') {
  return `<w:p>${paragraphProps(p, extraTail)}${content}</w:p>`;
}

// ---------------------------------------------------------------------------------------------------------------
// Drawings
// ---------------------------------------------------------------------------------------------------------------

let drawingId = 1;
export function resetDrawingIds() { drawingId = 1; }

function picXml(relId, cx, cy, id, name) {
  return `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${id}" name="${esc(name)}"/><pic:cNvPicPr><a:picLocks noChangeAspect="1"/></pic:cNvPicPr></pic:nvPicPr><pic:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic>`;
}

export function inlinePicture(relId, widthPt, heightPt, name = 'Picture') {
  const id = drawingId++;
  const cx = Math.max(1, emu(widthPt)); const cy = Math.max(1, emu(heightPt));
  return `<w:r><w:rPr><w:noProof/><w:sz w:val="2"/><w:szCs w:val="2"/></w:rPr><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="${id}" name="${esc(name)} ${id}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>${picXml(relId, cx, cy, id, name)}</wp:inline></w:drawing></w:r>`;
}

function anchorOpen({ x, y, w, h, behind, z }) {
  const id = drawingId++;
  return {
    id,
    xml: `<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="${251658240 + (z || id)}" behindDoc="${behind ? 1 : 0}" locked="0" layoutInCell="0" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:posOffset>${Math.round(x * 12700)}</wp:posOffset></wp:positionH><wp:positionV relativeFrom="page"><wp:posOffset>${Math.round(y * 12700)}</wp:posOffset></wp:positionV><wp:extent cx="${Math.max(1, emu(w))}" cy="${Math.max(1, emu(h))}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/>`,
  };
}

export function anchoredPicture(relId, box, { behind = false, name = 'Picture', z } = {}) {
  const w = box.x1 - box.x0; const h = box.y1 - box.y0;
  const open = anchorOpen({ x: box.x0, y: box.y0, w, h, behind, z });
  return `<w:r><w:rPr><w:noProof/></w:rPr><w:drawing>${open.xml}<wp:docPr id="${open.id}" name="${esc(name)} ${open.id}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>${picXml(relId, Math.max(1, emu(w)), Math.max(1, emu(h)), open.id, name)}</wp:anchor></w:drawing></w:r>`;
}

/** Rectangle or line drawn as a native Word shape. */
export function anchoredShape(shape, { z } = {}) {
  const { box } = shape;
  const isLine = shape.kind === 'line';
  const w = Math.max(isLine ? 0 : 0.1, box.x1 - box.x0); const h = Math.max(isLine ? 0 : 0.1, box.y1 - box.y0);
  const open = anchorOpen({ x: box.x0, y: box.y0, w, h, behind: shape.behind !== false, z });
  const fill = !isLine && shape.fill ? `<a:solidFill><a:srgbClr val="${shape.fill}"/></a:solidFill>` : '<a:noFill/>';
  const line = shape.stroke ? `<a:ln w="${Math.max(3175, emu(shape.lineWidth || 0.75))}"><a:solidFill><a:srgbClr val="${shape.stroke}"/></a:solidFill></a:ln>` : '<a:ln><a:noFill/></a:ln>';
  return `<w:r><w:rPr><w:noProof/></w:rPr><w:drawing>${open.xml}<wp:docPr id="${open.id}" name="Shape ${open.id}"/><wp:cNvGraphicFramePr/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:wsp><wps:cNvSpPr/><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${emu(w)}" cy="${emu(h)}"/></a:xfrm><a:prstGeom prst="${isLine ? 'line' : 'rect'}"><a:avLst/></a:prstGeom>${fill}${line}</wps:spPr><wps:bodyPr/></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>`;
}

// ---------------------------------------------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------------------------------------------

function borderXml(side, border) {
  if (!border) return `<w:${side} w:val="nil"/>`;
  const sz = clamp(Math.round((border.width || 0.5) * 8), 2, 96);
  return `<w:${side} w:val="single" w:sz="${sz}" w:space="0" w:color="${border.color || '000000'}"/>`;
}

/**
 * @param table {xs, ys, cells:[{r0,r1,c0,c1,borders,shade,content(xml string)}], indent}
 */
export function tableXml(table) {
  const { xs, ys } = table;
  const cols = xs.length - 1; const rows = ys.length - 1;
  const widths = Array.from({ length: cols }, (_, c) => Math.max(1, tw(xs[c + 1] - xs[c])));
  const total = widths.reduce((s, w) => s + w, 0);
  const at = new Map();
  for (const cell of table.cells) for (let r = cell.r0; r <= cell.r1; r += 1) for (let c = cell.c0; c <= cell.c1; c += 1) at.set(`${r}:${c}`, cell);
  const rowsXml = [];
  for (let r = 0; r < rows; r += 1) {
    const cellsXml = [];
    for (let c = 0; c < cols;) {
      const cell = at.get(`${r}:${c}`);
      if (!cell) { cellsXml.push(`<w:tc><w:tcPr><w:tcW w:w="${widths[c]}" w:type="dxa"/></w:tcPr><w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/></w:pPr></w:p></w:tc>`); c += 1; continue; }
      const span = cell.c1 - cell.c0 + 1;
      const width = widths.slice(cell.c0, cell.c1 + 1).reduce((s, w) => s + w, 0);
      const props = [`<w:tcW w:w="${width}" w:type="dxa"/>`];
      if (span > 1) props.push(`<w:gridSpan w:val="${span}"/>`);
      if (cell.r1 > cell.r0) props.push(r === cell.r0 ? '<w:vMerge w:val="restart"/>' : '<w:vMerge/>');
      props.push(`<w:tcBorders>${borderXml('top', cell.borders?.top)}${borderXml('left', cell.borders?.left)}${borderXml('bottom', cell.borders?.bottom)}${borderXml('right', cell.borders?.right)}</w:tcBorders>`);
      if (cell.shade) props.push(`<w:shd w:val="clear" w:color="auto" w:fill="${cell.shade}"/>`);
      props.push('<w:tcMar><w:top w:w="0" w:type="dxa"/><w:left w:w="0" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tcMar>');
      props.push('<w:noWrap w:val="0"/>');
      const content = r === cell.r0 && cell.content ? cell.content : '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/><w:rPr><w:sz w:val="2"/></w:rPr></w:pPr></w:p>';
      cellsXml.push(`<w:tc><w:tcPr>${props.join('')}</w:tcPr>${content}</w:tc>`);
      c += span;
    }
    const height = Math.max(1, tw(ys[r + 1] - ys[r]));
    rowsXml.push(`<w:tr><w:trPr><w:cantSplit/><w:trHeight w:val="${height}" w:hRule="${table.exactRows ? 'exact' : 'atLeast'}"/></w:trPr>${cellsXml.join('')}</w:tr>`);
  }
  const indent = tw(table.indent || 0);
  return `<w:tbl><w:tblPr><w:tblW w:w="${total}" w:type="dxa"/><w:tblInd w:w="${indent}" w:type="dxa"/><w:tblBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="0" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar><w:tblLook w:val="0000" w:firstRow="0" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="1" w:noVBand="1"/></w:tblPr><w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>${rowsXml.join('')}</w:tbl>`;
}

// ---------------------------------------------------------------------------------------------------------------
// Sections and package parts
// ---------------------------------------------------------------------------------------------------------------

export function sectPrXml(section) {
  const w = clamp(tw(section.width), 2880, 31680); const h = clamp(tw(section.height), 2880, 31680);
  const m = section.margins;
  const refs = (section.headerRel ? `<w:headerReference w:type="default" r:id="${section.headerRel}"/>` : '') + (section.footerRel ? `<w:footerReference w:type="default" r:id="${section.footerRel}"/>` : '');
  let cols = '<w:cols w:space="720"/>';
  if (section.columns?.length > 1) {
    const colXml = section.columns.map((col, i) => `<w:col w:w="${Math.max(144, tw(col.width))}"${i < section.columns.length - 1 ? ` w:space="${Math.max(0, tw(col.space || 0))}"` : ''}/>`).join('');
    cols = `<w:cols w:num="${section.columns.length}" w:equalWidth="0"${section.separator ? ' w:sep="1"' : ''}>${colXml}</w:cols>`;
  }
  return `<w:sectPr>${refs}<w:type w:val="${section.type || 'nextPage'}"/><w:pgSz w:w="${w}" w:h="${h}"${w > h ? ' w:orient="landscape"' : ''}/><w:pgMar w:top="${tw(m.top)}" w:right="${tw(m.right)}" w:bottom="${tw(m.bottom)}" w:left="${tw(m.left)}" w:header="${tw(m.header ?? 0)}" w:footer="${tw(m.footer ?? 0)}" w:gutter="0"/>${cols}</w:sectPr>`;
}

export function documentXml(bodyXml) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document ${NS}><w:body>${bodyXml}</w:body></w:document>`;
}

export function headerFooterXml(kind, bodyXml) {
  const tag = kind === 'header' ? 'w:hdr' : 'w:ftr';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<${tag} ${NS}>${bodyXml || '<w:p/>'}</${tag}>`;
}

export function stylesXml({ font = 'Calibri', size = 11 } = {}) {
  const half = clamp(Math.round(size * 2), 8, 144);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${esc(font)}" w:hAnsi="${esc(font)}" w:eastAsia="${esc(font)}" w:cs="${esc(font)}"/><w:sz w:val="${half}"/><w:szCs w:val="${half}"/><w:lang w:val="en-US" w:eastAsia="en-US" w:bidi="ar-SA"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:widowControl w:val="0"/><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style><w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/><w:uiPriority w:val="1"/><w:semiHidden/><w:unhideWhenUsed/></w:style><w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:uiPriority w:val="99"/><w:semiHidden/><w:unhideWhenUsed/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="0" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style><w:style w:type="numbering" w:default="1" w:styleId="NoList"><w:name w:val="No List"/><w:uiPriority w:val="99"/><w:semiHidden/><w:unhideWhenUsed/></w:style><w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:basedOn w:val="DefaultParagraphFont"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/></w:style></w:styles>`;
}

export function settingsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:zoom w:percent="100"/><w:defaultTabStop w:val="720"/><w:autoHyphenation w:val="false"/><w:characterSpacingControl w:val="doNotCompress"/><w:compat><w:doNotExpandShiftReturn/><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/><w:compatSetting w:name="overrideTableStyleFontSizeAndJustification" w:uri="http://schemas.microsoft.com/office/word" w:val="1"/><w:compatSetting w:name="enableOpenTypeFeatures" w:uri="http://schemas.microsoft.com/office/word" w:val="1"/><w:compatSetting w:name="doNotFlipMirrorIndents" w:uri="http://schemas.microsoft.com/office/word" w:val="1"/></w:compat></w:settings>`;
}

export function fontTableXml(families) {
  const list = [...new Set(families)].filter(Boolean).map((name) => `<w:font w:name="${esc(name)}"/>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:fonts xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${list}</w:fonts>`;
}

export function contentTypesXml(parts, mediaExtensions) {
  const defaults = [['rels', 'application/vnd.openxmlformats-package.relationships+xml'], ['xml', 'application/xml'], ...[...new Set(mediaExtensions)].map((ext) => [ext, ext === 'png' ? 'image/png' : 'image/jpeg'])];
  const overrides = parts.map(([path, type]) => `<Override PartName="/${path}" ContentType="${type}"/>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${defaults.map(([ext, type]) => `<Default Extension="${ext}" ContentType="${type}"/>`).join('')}${overrides}</Types>`;
}

export function relsXml(relationships) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationships.map((rel) => `<Relationship Id="${rel.id}" Type="${rel.type}" Target="${esc(rel.target)}"${rel.external ? ' TargetMode="External"' : ''}/>`).join('')}</Relationships>`;
}

export function corePropsXml({ title = '', creator = 'PDF Studio' } = {}) {
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(title)}</dc:title><dc:creator>${esc(creator)}</dc:creator><cp:lastModifiedBy>${esc(creator)}</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`;
}

export function appPropsXml(pages) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>PDF Studio</Application><Pages>${pages}</Pages></Properties>`;
}

export const REL = {
  officeDocument: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument',
  core: 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties',
  app: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties',
  styles: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles',
  settings: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings',
  fontTable: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable',
  image: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image',
  hyperlink: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink',
  header: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/header',
  footer: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer',
};

export const CT = {
  document: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  styles: 'application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml',
  settings: 'application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml',
  fontTable: 'application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml',
  header: 'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml',
  footer: 'application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml',
  core: 'application/vnd.openxmlformats-package.core-properties+xml',
  app: 'application/vnd.openxmlformats-officedocument.extended-properties+xml',
};
