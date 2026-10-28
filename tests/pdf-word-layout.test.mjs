import assert from 'node:assert/strict';
import { __docxInternals } from '../src/services/pdf/docx.js';

const {
  mergeHybridText,
  getOcrGeometry,
  tokenCoverage,
  readingOrderCoverage,
  getEditableReadingOrderText,
  wrapParagraphInDrawingTextBox,
  ensureDrawingNamespaces,
  parseXmlText,
  detectGridTables,
  detectFlowTables,
  tableComplexityProfile,
  needsLayoutPreservingFallback,
  summarizePageForPreflight,
  chooseAutoPageMode,
  shouldRunPageOcr,
  getWordTableGridColumnCounts,
  normalizePackagePath,
  collectPageImageRegions,
  filterSemanticImageRegions,
  groupImageRegionsByRow,
  buildFlowTable,
  buildNativeTable,
  makePlacedImageParagraph,
  imageRegionHasTextOverlay,
  shouldCropImageFromNormalRender,
  inferSourceLinePitch,
  makeFlowTextParagraph,
  buildFlowImageParagraphGroups,
  buildFlowImageGroupTable,
  buildFlowPageContent,
} = __docxInternals;

const native = {
  __geometry: true, text: 'Invoice Total', x: 10, top: 20, bottom: 34, baseline: 32,
  fontSize: 12, width: 76, orientationSupported: true, keepInArtwork: false,
};
const hybrid = mergeHybridText([native], [
  { text: 'Invoice', left: 10, top: 20, width: 42, height: 10, confidence: 98 },
  { text: 'Scanned', left: 12, top: 20, width: 40, height: 10, confidence: 92 },
], 1);
assert.equal(hybrid.rejectedDuplicates, 1, 'same positioned text is deduplicated');
assert.equal(hybrid.items.length, 2, 'overlap by itself must not discard OCR text that differs from the native text layer');
assert.equal(hybrid.items[1].text, 'Scanned');
assert.ok(getOcrGeometry({ text: 'abc', left: 0, top: 0, width: 30, height: 18, confidence: 90 }, 3).fontSize > 7, 'OCR font size is inferred from glyph height');

// Regression for form PDFs where many digit-box dividers were incorrectly combined into one giant Word table.
const pathologicalFormGrid = {
  left: 16, right: 596,
  xEdges: Array.from({ length: 146 }, (_, index) => 16 + index * 4),
  yEdges: Array.from({ length: 24 }, (_, index) => 20 + index * 8),
  cells: Array.from({ length: 23 }, () => Array.from({ length: 145 }, () => ({ items: [] }))),
};
const gridProfile = tableComplexityProfile(pathologicalFormGrid, 612);
assert.equal(gridProfile.columns, 145);
assert.equal(gridProfile.suspicious, true, 'page-wide grids with hundreds of narrow columns are treated as unsafe Word tables');
assert.equal(needsLayoutPreservingFallback([pathologicalFormGrid], 612), true, 'dense form grid chooses the editable layout-preserving fallback');
const ordinaryTable = {
  xEdges: [20, 120, 300, 592], yEdges: [20, 45, 70, 95],
  cells: Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => ({ items: [] }))),
};
assert.equal(needsLayoutPreservingFallback([ordinaryTable], 612), false, 'ordinary small tables remain native editable Word tables');
assert.equal(summarizePageForPreflight({ items: [{ str: 'Form ' }, { str: 'Application' }, { str: '' }] }, { width: 612, height: 936 }, 1).nativeTextSpans, 2);
assert.equal(summarizePageForPreflight({ items: [] }, { width: 612, height: 936 }, 2).hasNativeText, false, 'preflight distinguishes scan-only pages');
// Benchmark-derived strategy checks: image-heavy procedures, vector-rich forms, and dense reports
// use fixed-coordinate page artwork by default; simple text-first pages still become reflowable.
assert.equal(chooseAutoPageMode({ requestedMode: 'auto', nativeTextSpans: 28, nativeTextCharacters: 410, operatorFeatures: { imageObjects: 3, vectorOperations: 6, paths: 2 } }), 'layout', 'screenshots/logos/signatures make automatic conversion preserve page geometry');
assert.equal(chooseAutoPageMode({ requestedMode: 'auto', nativeTextSpans: 24, nativeTextCharacters: 480, operatorFeatures: { imageObjects: 0, vectorOperations: 150, paths: 12 } }), 'layout', 'vector-heavy forms and tables avoid lossy reflow');
assert.equal(chooseAutoPageMode({ requestedMode: 'auto', nativeTextSpans: 80, nativeTextCharacters: 1200, operatorFeatures: {} }), 'layout', 'dense multi-block documents preserve page placement');
assert.equal(chooseAutoPageMode({ requestedMode: 'auto', nativeTextSpans: 12, nativeTextCharacters: 140, operatorFeatures: { imageObjects: 0, vectorOperations: 10, paths: 1 } }), 'editable', 'simple text-first pages remain normally editable');
assert.equal(chooseAutoPageMode({ requestedMode: 'editable', nativeTextSpans: 80, nativeTextCharacters: 1200, operatorFeatures: { imageObjects: 3 } }), 'editable', 'an explicit user-selected mode takes precedence over automatic heuristics');
assert.equal(chooseAutoPageMode({ requestedMode: 'auto', nativeTextSpans: 0, nativeTextCharacters: 0, operatorFeatures: {} }), 'layout', 'scan-only pages preserve their full-page artwork for OCR overlay');
assert.equal(shouldRunPageOcr({ enabled: true, engineUnavailable: false, nativeTextSpans: 0, nativeTextCharacters: 0 }), true, 'scan-only pages can use OCR');
assert.equal(shouldRunPageOcr({ enabled: true, engineUnavailable: false, nativeTextSpans: 30, nativeTextCharacters: 800 }), false, 'screenshots on text-rich pages are not indiscriminately OCRed and masked');
assert.equal(shouldRunPageOcr({ enabled: true, engineUnavailable: false, nativeTextSpans: 1, nativeTextCharacters: 12 }), true, 'nearly textless pages can still use OCR');
assert.equal(shouldRunPageOcr({ enabled: false, engineUnavailable: false, nativeTextSpans: 0, nativeTextCharacters: 0 }), false, 'disabling OCR is respected');
assert.deepEqual(getWordTableGridColumnCounts('<w:tbl><w:tblGrid><w:gridCol/><w:gridCol/></w:tblGrid></w:tbl><w:tblGrid><w:gridCol/><w:gridCol/><w:gridCol/></w:tblGrid>'), [2, 3]);
assert.equal(getWordTableGridColumnCounts(`<w:tblGrid>${'<w:gridCol/>'.repeat(145)}</w:tblGrid>`)[0], 145, 'package validation sees the 145-column grid shape from the reported failed DOCX');
assert.equal(normalizePackagePath('word/_rels/../styles.xml'), 'word/styles.xml');

const tokens = tokenCoverage('one two one', 'one two one extra');
assert.equal(tokens.percent, 100);
assert.equal(tokens.missingWords, 0);
assert.equal(tokens.extraWords, 1, 'content verification detects surplus words, not just missing words');
assert.equal(readingOrderCoverage('one two three', 'one two three').percent, 100);
assert.equal(readingOrderCoverage('one two three', 'one three two').percent, 0, 'reading-order continuity catches reorderings');

const table = {
  id: 'grid-1',
  cells: [[
    { items: [{ text: 'Name', x: 20, baseline: 30, keepInArtwork: false }] },
    { items: [{ text: 'Score', x: 100, baseline: 30, keepInArtwork: false }] },
  ]],
};
const rows = [
  { items: [{ text: 'Intro', x: 5, keepInArtwork: false, tableCellKey: '' }] },
  { items: [{ text: 'Name', x: 20, keepInArtwork: false, tableCellKey: 'grid-1:0:0' }] },
  { items: [{ text: 'Outro', x: 5, keepInArtwork: false, tableCellKey: '' }] },
];
assert.match(getEditableReadingOrderText(rows, [table]), /Intro[\s\S]*Name[\s\S]*Score[\s\S]*Outro/);

const sourceParagraph = '<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="200"/></w:tabs><w:spacing w:before="0" w:after="0"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>Hello</w:t></w:r></w:p>';
const shape = wrapParagraphInDrawingTextBox(sourceParagraph, { x: 10, y: 20, width: 120, height: 14 }, 1);
assert.match(shape, /<wp:anchor/);
assert.match(shape, /<wp:positionH relativeFrom="page"><wp:posOffset>127000<\/wp:posOffset><\/wp:positionH>/);
assert.match(shape, /<wp:positionV relativeFrom="page"><wp:posOffset>254000<\/wp:posOffset><\/wp:positionV>/);
assert.match(shape, /<wps:txbx><w:txbxContent>/);
assert.match(shape, /<w:b\/>/);
assert.match(shape, /<w:t>Hello<\/w:t>/);
const root = ensureDrawingNamespaces(`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${shape}</w:body></w:document>`);
assert.match(root, /xmlns:wps="http:\/\/schemas\.microsoft\.com\/office\/word\/2010\/wordprocessingShape"/);
assert.match(parseXmlText('<w:document><w:body><w:p><w:r><w:t>hello</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>world</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>'), /hello[\s\S]*world/);



function makeGrid({ gapInMiddleRule = false } = {}) {
  const width = 180;
  const height = 120;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 255; data[i + 1] = 255; data[i + 2] = 255; data[i + 3] = 255;
  }
  const ink = (x, y) => {
    if (gapInMiddleRule && y === 60 && x >= 78 && x <= 84) return;
    const offset = (y * width + x) * 4;
    data[offset] = 0; data[offset + 1] = 0; data[offset + 2] = 0; data[offset + 3] = 255;
  };
  for (const y of [20, 60, 100]) for (let x = 20; x <= 140; x += 1) ink(x, y);
  for (const x of [20, 80, 140]) for (let y = 20; y <= 100; y += 1) ink(x, y);
  const items = [
    { text: 'Name', x: 30, top: 30, bottom: 40, width: 22, baseline: 38, keepInArtwork: false },
    { text: 'Score', x: 90, top: 30, bottom: 40, width: 24, baseline: 38, keepInArtwork: false },
    { text: 'Eva', x: 30, top: 70, bottom: 80, width: 17, baseline: 78, keepInArtwork: false },
    { text: '100', x: 90, top: 70, bottom: 80, width: 18, baseline: 78, keepInArtwork: false },
  ];
  return { width, height, data, items };
}
const syntheticGrid = makeGrid();
const reconstructedTables = detectGridTables({ data: syntheticGrid.data }, syntheticGrid.width, syntheticGrid.height, 1, syntheticGrid.items);
assert.equal(reconstructedTables.length, 1, 'a fully ruled rectangular grid is recognized as a table');
assert.equal(reconstructedTables[0].cells.length, 2);
assert.equal(reconstructedTables[0].cells[0].length, 2);
assert.ok(syntheticGrid.items.every((item) => item.tableCellKey), 'cell ownership is assigned only after the grid is accepted');
const brokenGrid = makeGrid({ gapInMiddleRule: true });
const ignoredBrokenGrid = detectGridTables({ data: brokenGrid.data }, brokenGrid.width, brokenGrid.height, 1, brokenGrid.items);
assert.equal(ignoredBrokenGrid.length, 0, 'a grid with a broken/missing rule is not guessed as a simple rectangular table');
assert.ok(brokenGrid.items.every((item) => !item.tableCellKey), 'rejected grids do not leave stale table-cell ownership behind');



function makeMergedFlowGrid() {
  const width = 180;
  const height = 120;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 255; data[i + 1] = 255; data[i + 2] = 255; data[i + 3] = 255;
  }
  const ink = (x, y) => {
    const offset = (y * width + x) * 4;
    data[offset] = 0; data[offset + 1] = 0; data[offset + 2] = 0; data[offset + 3] = 255;
  };
  for (const y of [20, 60, 100]) for (let x = 20; x <= 140; x += 1) ink(x, y);
  for (let y = 20; y <= 100; y += 1) { ink(20, y); ink(140, y); }
  // The internal rule only spans the first row, making the second row a merged cell.
  for (let y = 20; y <= 60; y += 1) ink(80, y);
  const items = [
    { __geometry: true, orientationSupported: true, fontSize: 10, wordFont: 'Arial', textColor: '000000', text: 'Label', x: 28, top: 28, bottom: 38, width: 25, baseline: 36, keepInArtwork: false },
    { __geometry: true, orientationSupported: true, fontSize: 10, wordFont: 'Arial', textColor: '000000', text: 'Value', x: 88, top: 28, bottom: 38, width: 25, baseline: 36, keepInArtwork: false },
    { __geometry: true, orientationSupported: true, fontSize: 10, wordFont: 'Arial', textColor: '000000', text: 'Merged row', x: 28, top: 70, bottom: 80, width: 55, baseline: 78, keepInArtwork: false },
    { __geometry: true, orientationSupported: true, fontSize: 10, wordFont: 'Arial', textColor: '000000', text: 'continues', x: 90, top: 70, bottom: 80, width: 40, baseline: 78, keepInArtwork: false },
  ];
  return { width, height, data, items };
}
const mergedGrid = makeMergedFlowGrid();
const flowTables = detectFlowTables({ data: mergedGrid.data }, mergedGrid.width, mergedGrid.height, 1, mergedGrid.items);
assert.equal(flowTables.length, 1, 'semantic table detection recognizes a table with a merged row');
assert.equal(flowTables[0].cells[0].length, 2, 'the first row contains two cells');
assert.equal(flowTables[0].cells[1].length, 1, 'the second row contains one spanning cell');
assert.equal(flowTables[0].cells[1][0].colSpan, 2, 'merged-cell width is represented as a Word grid span');
assert.ok(mergedGrid.items.every((item) => item.tableCellKey), 'flow-table cell ownership is assigned after table acceptance');
class FakeDocxNode { constructor(options = {}) { this.options = options; Object.assign(this, options); } }
const fakeDocxApi = { Table: FakeDocxNode, TableRow: FakeDocxNode, TableCell: FakeDocxNode, Paragraph: FakeDocxNode, TextRun: FakeDocxNode, ImageRun: FakeDocxNode };
const fakeWordTable = buildFlowTable(flowTables[0], fakeDocxApi, 1, { left: 24, right: 24 }, 180, 80);
assert.equal(fakeWordTable.options.rows[1].options.children[0].options.columnSpan, 2, 'the generated Word table preserves merged-cell span');
const firstCellParagraph = fakeWordTable.options.rows[0].options.children[0].options.children[0];
assert.ok(firstCellParagraph.options.indent.left < 300, 'text within table cells is positioned relative to the cell rather than the whole PDF page');

const sampleSignature = { x: 55, y: 28, width: 12, height: 7, data: new Uint8Array([1, 2, 3]), type: 'png' };
const nativeLayoutTable = buildNativeTable({
  id: 'native-layout-table', left: 20, top: 20, right: 110, bottom: 50,
  xEdges: [20, 50, 80, 110], yEdges: [20, 50],
  cells: [[
    { row: 0, colStart: 0, colSpan: 2, x: 20, y: 20, width: 60, height: 30, items: [], images: [sampleSignature] },
    { row: 0, colStart: 2, colSpan: 1, x: 80, y: 20, width: 30, height: 30, items: [{ text: 'Name', x: 84, top: 25, bottom: 34, baseline: 32, fontSize: 9, wordFont: 'Arial', textColor: '000000', keepInArtwork: false }], images: [] },
  ]],
}, fakeDocxApi, 1, { visibleBorders: true, includeImages: true });
assert.equal(nativeLayoutTable.options.rows[0].options.children[0].options.columnSpan, 2, 'layout-preserving native Word tables support merged cells');
assert.equal(nativeLayoutTable.options.borders.top.style, 'single', 'masked table artwork is replaced with editable Word table borders');
assert.ok(nativeLayoutTable.options.rows[0].options.children[0].options.children.some((child) => child.options?.children?.some((run) => run instanceof FakeDocxNode && run.options?.data === sampleSignature.data)), 'small signatures are embedded as separate image runs inside native table cells');
const positionedSignature = makePlacedImageParagraph(sampleSignature, fakeDocxApi, 1);
assert.equal(positionedSignature.options.children[0].options.floating.horizontalPosition.offset, Math.round(55 * 12700), 'standalone images preserve their page-relative x-coordinate');
assert.equal(positionedSignature.options.children[0].options.floating.verticalPosition.offset, Math.round(28 * 12700), 'standalone images preserve their page-relative y-coordinate');

const fakePdfJs = {
  OPS: { save: 1, restore: 2, transform: 3, paintImageXObject: 4 },
  Util: { transform: (m1, m2) => [
    m1[0] * m2[0] + m1[2] * m2[1], m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3], m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4], m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ] },
};
const imageOperatorList = {
  fnArray: [1, 3, 4, 2, 1, 3, 4, 2, 1, 3, 4, 2],
  argsArray: [[], [100, 0, 0, 100, 50, 200], ['photo-a', 100, 100], [], [], [80, 0, 0, 80, 300, 400], ['photo-b', 80, 80], [], [], [8, 0, 0, 7, 450, 500], ['small-signature', 8, 7], []],
};
const imageRegions = collectPageImageRegions(imageOperatorList, { width: 600, height: 800, transform: [1, 0, 0, -1, 0, 800] }, fakePdfJs);
assert.equal(imageRegions.length, 3, 'placed PDF image objects, including small signatures, are recognized as separate regions');
assert.ok(imageRegions.some((image) => image.width === 8 && image.height === 7), 'small signature-sized image objects survive the crop-size filter');
assert.ok(imageRegions.filter((image) => image.width >= 75).length === 2, 'normal image regions retain page-point dimensions');
const compositeBanner = { x: 100, y: 20, width: 400, height: 55, source: 'pdf-image-object' };
const standalonePhoto = { x: 100, y: 220, width: 130, height: 110, source: 'pdf-image-object' };
const bannerText = [
  { __geometry: true, text: 'University of Science and Technology', x: 180, top: 28, bottom: 38, width: 200, orientationSupported: true, keepInArtwork: false },
  { __geometry: true, text: 'College of Engineering', x: 200, top: 42, bottom: 52, width: 150, orientationSupported: true, keepInArtwork: false },
  { __geometry: true, text: 'Civil Engineering Department', x: 220, top: 55, bottom: 65, width: 120, orientationSupported: true, keepInArtwork: false },
];
const filteredImageRegions = filterSemanticImageRegions([compositeBanner, standalonePhoto], { width: 600, height: 800 }, bannerText);
assert.deepEqual(filteredImageRegions, [compositeBanner, standalonePhoto], 'composite header art remains available as a separate asset because its crop removes the native heading');

const groupedImages = groupImageRegionsByRow([
  { x: 20, y: 30, width: 40, height: 50 },
  { x: 70, y: 32, width: 45, height: 48 },
  { x: 22, y: 140, width: 40, height: 50 },
]);
assert.equal(groupedImages.length, 2, 'images on a common row group together without merging lower-row photos');
assert.equal(groupedImages[0].length, 2);



// Regression: a multi-line cell paragraph (for example, Learning Experience in an OJT report) must stay
// left-aligned even when a short/long last line could fool a page-centering heuristic. Also verify safe indents.
const multilineCellRows = [
  { baseline: 30, top: 20, bottom: 32, fontSize: 10, maxFontSize: 10, items: [{ text: 'Learning Experience paragraph starts here', x: 18, width: 188, fontSize: 10, wordFont: 'Arial', textColor: '000000' }] },
  { baseline: 44, top: 34, bottom: 46, fontSize: 10, maxFontSize: 10, items: [{ text: 'and wraps on the next source line', x: 18, width: 150, fontSize: 10, wordFont: 'Arial', textColor: '000000' }] },
  { baseline: 58, top: 48, bottom: 60, fontSize: 10, maxFontSize: 10, items: [{ text: 'then ends with a shorter line.', x: 18, width: 118, fontSize: 10, wordFont: 'Arial', textColor: '000000' }] },
];
const flowingCellParagraph = makeFlowTextParagraph(multilineCellRows, fakeDocxApi, 1, {
  pageWidth: 440, centerTarget: 220, marginLeft: 2.2, marginRight: 2.2, symmetricCenter: true,
});
assert.equal(flowingCellParagraph.options.alignment, 'left', 'multi-line table-cell content is left-aligned');
assert.equal(flowingCellParagraph.options.spacing.lineRule, 'exact', 'multi-line flow uses exact measured source line pitch');
assert.equal(flowingCellParagraph.options.spacing.line, 280, 'the baseline pitch of 14 pt is retained as 280 twips');
assert.ok(Number.isFinite(flowingCellParagraph.options.indent.left) && flowingCellParagraph.options.indent.left >= 0, 'paragraph left indent is finite and non-negative');
assert.ok(Number.isFinite(flowingCellParagraph.options.indent.right) && flowingCellParagraph.options.indent.right >= 0, 'paragraph right indent is finite and non-negative');
assert.equal(inferSourceLinePitch([{ baseline: 10, fontSize: 10 }, { baseline: 24, fontSize: 10 }], 10), 14);
const malformedIndentParagraph = makeFlowTextParagraph([
  { baseline: NaN, top: 0, bottom: 8, items: [{ text: 'defensive indent', x: NaN, width: NaN, fontSize: 10, wordFont: 'Arial' }] },
], fakeDocxApi, 1, { pageWidth: NaN, centerTarget: NaN, marginLeft: NaN, marginRight: NaN });
assert.ok(Number.isFinite(malformedIndentParagraph.options.indent.left), 'invalid/missing PDF coordinates cannot crash Word indent generation');
assert.ok(Number.isFinite(malformedIndentParagraph.options.indent.right), 'invalid/missing PDF coordinates cannot emit a non-finite right indent');

// Regression: no-table pages still yield normal-flow content, and page-local builders preserve content per source page.
function makeFlowRow(text, top, x = 36) {
  const width = text.length * 5;
  const item = { __geometry: true, orientationSupported: true, keepInArtwork: false, tableCellKey: '', text, x, top, bottom: top + 10, baseline: top + 8, width, fontSize: 10, wordFont: 'Arial', textColor: '000000', characterSpacingPt: 0 };
  return { items: [item], top, bottom: top + 10, baseline: top + 8, minX: x, maxX: x + width, fontSize: 10, maxFontSize: 10, lineHeight: 12, column: 0, paragraphStart: true, paragraphEnd: true, semanticText: text, spacingAfter: 0 };
}
const flowMargins = { top: 18, right: 24, bottom: 30, left: 24, header: 8, footer: 14 };
const noTablePageOne = buildFlowPageContent({ rows: [makeFlowRow('Page one has plain paragraphs and no table.', 45)], tables: [], imageRegions: [] }, fakeDocxApi, 1, 595, 842, flowMargins);
const noTablePageTwo = buildFlowPageContent({ rows: [makeFlowRow('Page two content must not be dropped.', 45)], tables: [], imageRegions: [] }, fakeDocxApi, 1, 595, 842, flowMargins);
const contentOf = (built) => built.children.map((node) => (node.options?.children || []).map((child) => child.options?.text || '').join('')).join('\n');
assert.match(contentOf(noTablePageOne), /Page one has plain paragraphs and no table/);
assert.match(contentOf(noTablePageTwo), /Page two content must not be dropped/);
assert.equal(noTablePageOne.children.length > 0, true, 'a source page without tables still creates body content');
assert.equal(noTablePageTwo.children.length > 0, true, 'later pages without tables still create body content');

// Regression: crop strategy uses text-free pixels for broad banners (no duplicated heading) but keeps a
// photo's full render when real text is overlaid on the photo itself.
const photoCaption = { __geometry: true, text: 'Site visit 02/18', x: 112, top: 310, bottom: 320, width: 58, orientationSupported: true, keepInArtwork: false };
assert.equal(imageRegionHasTextOverlay(standalonePhoto, [photoCaption]), true);
assert.equal(shouldCropImageFromNormalRender(standalonePhoto, 600, 800, [photoCaption]), true, 'photo captions remain baked into a photo asset');
assert.equal(imageRegionHasTextOverlay(compositeBanner, bannerText), true);
assert.equal(shouldCropImageFromNormalRender(compositeBanner, 600, 800, bannerText), false, 'wide title/header art is cropped from the text-free render');
assert.equal(shouldCropImageFromNormalRender(compositeBanner, 600, 800, [{ ...bannerText[0], keepInArtwork: true }]), true, 'unsupported/rotated overlaid text remains baked into the crop so it is not lost');

// Regression: the photo-row builder must insert a non-breaking gap between side-by-side photos.
const fakeImageDocxApi = { Paragraph: FakeDocxNode, TextRun: FakeDocxNode, ImageRun: FakeDocxNode };
const imageParagraphs = buildFlowImageParagraphGroups([
  { x: 20, y: 30, width: 80, height: 54, data: new Uint8Array([1]), type: 'jpg' },
  { x: 112, y: 30, width: 80, height: 54, data: new Uint8Array([2]), type: 'jpg' },
], fakeImageDocxApi, 1, 360);
assert.equal(imageParagraphs.length, 1);
assert.ok(imageParagraphs[0].paragraph.options.children.some((child) => child.options?.text?.includes('\u00a0')), 'a visible non-breaking-space gap separates neighboring photo assets');

// The external-image path uses a borderless Word table (not a paragraph), so verify that the actual production
// helper adds a spacer grid column between side-by-side photos rather than putting whitespace at a cell boundary.
const fakePhotoTableApi = { Table: FakeDocxNode, TableRow: FakeDocxNode, TableCell: FakeDocxNode, Paragraph: FakeDocxNode, TextRun: FakeDocxNode, ImageRun: FakeDocxNode };
const externalPhotoTable = buildFlowImageGroupTable([
  { x: 20, y: 30, width: 80, height: 54, data: new Uint8Array([1]), type: 'jpg' },
  { x: 112, y: 30, width: 80, height: 54, data: new Uint8Array([2]), type: 'jpg' },
], fakePhotoTableApi, 1, 360, flowMargins);
const externalPhotoRow = externalPhotoTable.options.rows[0];
assert.equal(externalPhotoRow.options.children.length, 3, 'external side-by-side photos produce image, spacer, image cells');
assert.equal(externalPhotoTable.options.columnWidths.length, 3, 'the spacer has an explicit table-grid width');
assert.ok(externalPhotoTable.options.columnWidths[1] > 0, 'the inter-photo spacer is not zero-width');

// Regression against the supplied Netskope procedure PDF: page 1 contains source images around
// 275x223 pt and 430x177 pt. Neither standalone images nor cell image groups may be shrunk by an
// arbitrary global height ceiling; keep their physical dimensions unless available width requires fitting.
const imageTransformFromTable = (table, childIndex = 0) => table.options.rows[0].options.children[childIndex]
  .options.children[0].options.children[0].options.transformation;
const netskopeScreenshotA = { x: 90, y: 249.1, width: 275.2, height: 222.8, data: new Uint8Array([1]), type: 'jpg' };
const netskopeScreenshotB = { x: 90, y: 499.5, width: 429.7, height: 177.2, data: new Uint8Array([2]), type: 'jpg' };
const fullSizeScreenshotA = buildFlowImageGroupTable([netskopeScreenshotA], fakePhotoTableApi, 1, 612, { left: 54, right: 54 });
const fullSizeScreenshotB = buildFlowImageGroupTable([netskopeScreenshotB], fakePhotoTableApi, 1, 612, { left: 54, right: 54 });
assert.equal(imageTransformFromTable(fullSizeScreenshotA).width, Math.round(275.2 * 4 / 3), 'first screenshot keeps its 275 pt source width');
assert.equal(imageTransformFromTable(fullSizeScreenshotA).height, Math.round(222.8 * 4 / 3), 'first screenshot keeps its 223 pt source height, not the old 92 pt cap');
assert.equal(imageTransformFromTable(fullSizeScreenshotB).width, Math.round(429.7 * 4 / 3), 'second screenshot keeps its 430 pt source width');
assert.equal(imageTransformFromTable(fullSizeScreenshotB).height, Math.round(177.2 * 4 / 3), 'second screenshot keeps its 177 pt source height');
const fullSizeCellImage = buildFlowImageParagraphGroups([netskopeScreenshotA], fakeImageDocxApi, 1, 440)[0].paragraph.options.children[0].options.transformation;
assert.equal(fullSizeCellImage.height, Math.round(222.8 * 4 / 3), 'table-cell photos also keep natural size when they fit the available width');
const widthConstrained = buildFlowImageGroupTable([
  { x: 90, y: 120, width: 700, height: 350, data: new Uint8Array([3]), type: 'jpg' },
], fakePhotoTableApi, 1, 612, { left: 54, right: 54 });
const widthConstrainedTransform = imageTransformFromTable(widthConstrained);
assert.ok(Math.abs(widthConstrainedTransform.width * 0.75 - 468) < 0.5, 'oversized images are fitted to available page width');
assert.ok(Math.abs(widthConstrainedTransform.height * 0.75 - 234) < 0.5, 'width fitting preserves the original photo aspect ratio');

// Regression: image XObjects nested inside a transformed Form XObject use the combined form + image transform.
const formPdfJs = {
  OPS: { save: 1, restore: 2, transform: 3, paintImageXObject: 4, paintFormXObjectBegin: 5, paintFormXObjectEnd: 6 },
  Util: fakePdfJs.Util,
};
const formImageRegions = collectPageImageRegions({
  fnArray: [1, 3, 5, 3, 4, 6, 2],
  argsArray: [[], [1, 0, 0, 1, 30, 40], [[0.5, 0, 0, 0.5, 100, 200]], [80, 0, 0, 60, 10, 20], ['nested-photo', 80, 60], [], []],
}, { width: 600, height: 800, transform: [1, 0, 0, -1, 0, 800] }, formPdfJs);
assert.equal(formImageRegions.length, 1, 'nested Form XObject image is retained as one placed image region');
assert.ok(Math.abs(formImageRegions[0].x - 135) < 0.01, 'form/image transform yields the correct horizontal image origin');
assert.ok(Math.abs(formImageRegions[0].y - 520) < 0.01, 'form/image transform yields the correct top edge in page coordinates');
assert.ok(Math.abs(formImageRegions[0].width - 40) < 0.01, 'form/image transform preserves rendered image width');
assert.ok(Math.abs(formImageRegions[0].height - 30) < 0.01, 'form/image transform preserves rendered image height');

console.log('PDF-to-Word tests passed: semantic paragraphs/tables, merged rows, image extraction, OCR, legacy layout, reading order, and package XML.');
