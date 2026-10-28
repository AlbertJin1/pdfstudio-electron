// Helpers shared by every dialog that accepts a single PDF from a file picker or from drag and drop.

const PDF_MIME = 'application/pdf';

export function isPdfLike(file) {
  return /\.pdf$/i.test(file?.name || '') || file?.type === PDF_MIME;
}

/** True while the user is dragging real files (not text, links or in-app page cards). */
export function dragHasFiles(event) {
  const types = event?.dataTransfer?.types;
  return Boolean(types) && Array.prototype.includes.call(types, 'Files');
}

/**
 * Looks at what is being dragged (before it is dropped) and says whether it can be a PDF.
 * Browsers only expose MIME types during a drag, and not always (the type can be empty), so
 * anything unknown is treated as acceptable and validated properly on drop.
 */
export function classifyDrag(event, kind = 'pdf') {
  const items = Array.from(event?.dataTransfer?.items || []).filter((item) => item.kind === 'file');
  if (!items.length) return { state: 'valid', count: 0 };
  const known = items.filter((item) => item.type);
  // Image tools: valid unless every file with a known type is something other than an image (HEIC often has no type, so it passes).
  if (kind === 'image') return { state: known.length === items.length && !known.some((item) => item.type.startsWith('image/')) ? 'invalid' : 'valid', count: items.length };
  const hasPdf = items.some((item) => item.type === PDF_MIME);
  const allKnownNonPdf = known.length === items.length && !hasPdf;
  return { state: allKnownNonPdf ? 'invalid' : 'valid', count: items.length };
}

// A valid PDF starts with "%PDF-" within its first KB (some writers put a few bytes of junk before it).
function hasPdfHeader(bytes) {
  const limit = Math.min(bytes.length - 4, 1024);
  for (let i = 0; i <= limit; i += 1) {
    if (bytes[i] === 0x25 && bytes[i + 1] === 0x50 && bytes[i + 2] === 0x44 && bytes[i + 3] === 0x46 && bytes[i + 4] === 0x2d) return true;
  }
  return false;
}

/** Reads one browser File into the same item shape that window.pdfStudio.openFiles() returns. */
export async function readPdfFile(file) {
  const label = file?.name ? `“${file.name}”` : 'This file';
  let buffer;
  try { buffer = await file.arrayBuffer(); }
  catch { throw new Error(`${label} couldn’t be read. If it’s a folder, drop the PDF file inside it instead.`); }
  const bytes = new Uint8Array(buffer);
  if (!bytes.length) throw new Error(`${label} is empty.`);
  if (!hasPdfHeader(bytes)) throw new Error(`${label} doesn’t look like a valid PDF.`);
  return { name: file.name || 'document.pdf', mime: PDF_MIME, kind: 'pdf', bytes };
}

/**
 * Picks the single PDF to use from a dropped or browsed FileList.
 * Returns { item, ignored } on success (ignored = how many extra files were left out) or { error }.
 */
export async function pickPdfFromFiles(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return { error: 'No file was received. Try dropping it again.' };
  const pdfs = files.filter(isPdfLike);
  if (!pdfs.length) {
    return { error: files.length === 1 ? `“${files[0].name}” isn’t a PDF. Choose a .pdf file.` : 'None of those files are PDFs. Choose a .pdf file.' };
  }
  try {
    const item = await readPdfFile(pdfs[0]);
    return { item, ignored: files.length - 1 };
  } catch (error) {
    return { error: error?.message || 'Could not read the PDF.' };
  }
}
