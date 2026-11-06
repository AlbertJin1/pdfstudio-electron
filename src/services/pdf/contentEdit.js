// True in-place editing of existing PDF page content (what Acrobat does when you edit text or move an image).
//
// The editor used to hide the original text/image under an opaque rectangle and draw the replacement on top.
// The old text then stayed in the file (searchable, copyable, visible to screen readers) and the rectangle could
// blot out table lines, backgrounds or neighbouring text. This module removes the original glyphs / image
// drawing operators from the page content stream instead:
//   • every text-showing operator (Tj, TJ, ', ") is matched one-to-one with PDF.js's decoded glyphs, so we know
//     exactly where each character code sits on the page;
//   • glyphs inside an edited region are dropped and replaced by a TJ spacing adjustment of exactly their
//     advance, so all remaining glyphs of the same line stay where they were;
//   • image XObjects / inline images whose placement matches a moved, replaced or deleted image are removed.
// Anything that cannot be matched with certainty (text inside form XObjects, unusual CMaps, count mismatches)
// is reported back so the caller can fall back to the old cover rectangle for just that item.

import { getPdfJsLib } from './pdfjs.js';
import { applyPoint, interpretPage, multiply } from './word/extract.js';

// ---------------------------------------------------------------------------------------------------------------
// Content stream lexer (works on a latin-1 string so offsets equal byte offsets)
// ---------------------------------------------------------------------------------------------------------------

const WS = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const DELIM = new Set('()<>[]{}/%'.split('').map((c) => c.charCodeAt(0)));
const LITERALS = new Set(['true', 'false', 'null']);

export function tokenizeContent(text) {
  const ops = [];
  let operands = [];
  let opStart = -1;
  const n = text.length;
  let i = 0;
  const push = (token) => { if (opStart < 0) opStart = token.start; operands.push(token); };
  while (i < n) {
    const c = text.charCodeAt(i);
    if (WS.has(c)) { i += 1; continue; }
    if (c === 0x25) { while (i < n && text[i] !== '\n' && text[i] !== '\r') i += 1; continue; } // % comment
    const start = i;
    if (c === 0x28) { // ( literal string )
      let depth = 1; i += 1;
      while (i < n && depth > 0) {
        const ch = text[i];
        if (ch === '\\') i += 2;
        else { if (ch === '(') depth += 1; else if (ch === ')') depth -= 1; i += 1; }
      }
      push({ type: 'str', raw: text.slice(start, i), start, end: i });
      continue;
    }
    if (c === 0x3c) { // < hex > or <<
      if (text[i + 1] === '<') { i += 2; push({ type: 'dictStart', raw: '<<', start, end: i }); continue; }
      const close = text.indexOf('>', i);
      i = close < 0 ? n : close + 1;
      push({ type: 'hex', raw: text.slice(start, i), start, end: i });
      continue;
    }
    if (c === 0x3e) { i += text[i + 1] === '>' ? 2 : 1; push({ type: 'dictEnd', raw: '>>', start, end: i }); continue; }
    if (c === 0x5b || c === 0x5d || c === 0x7b || c === 0x7d) { i += 1; push({ type: text[start], raw: text[start], start, end: i }); continue; }
    if (c === 0x2f) { // /Name
      i += 1;
      while (i < n && !WS.has(text.charCodeAt(i)) && !DELIM.has(text.charCodeAt(i))) i += 1;
      push({ type: 'name', raw: text.slice(start, i), value: text.slice(start + 1, i), start, end: i });
      continue;
    }
    // Number or keyword.
    while (i < n && !WS.has(text.charCodeAt(i)) && !DELIM.has(text.charCodeAt(i))) i += 1;
    if (i === start) { i += 1; continue; } // stray delimiter
    const word = text.slice(start, i);
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) { push({ type: 'num', raw: word, value: Number(word), start, end: i }); continue; }
    if (LITERALS.has(word)) { push({ type: 'lit', raw: word, start, end: i }); continue; }
    // Operator.
    if (word === 'BI') {
      // Inline image: BI <dict> ID <binary> EI
      const idMatch = /(^|[\s])ID[\s]/g;
      idMatch.lastIndex = i;
      const id = idMatch.exec(text);
      if (!id) { i = n; break; }
      const dataStart = id.index + id[0].length;
      const eiRe = /[\s]EI(?=[\s]|$)/g;
      eiRe.lastIndex = dataStart;
      const ei = eiRe.exec(text);
      const end = ei ? ei.index + ei[0].length : n;
      const dictText = text.slice(i, id.index + id[1].length);
      ops.push({ op: 'BI', operands: [], start: opStart < 0 ? start : opStart, end, inlineDict: dictText });
      operands = []; opStart = -1; i = end;
      continue;
    }
    ops.push({ op: word, operands, start: opStart < 0 ? start : opStart, end: i });
    operands = []; opStart = -1;
  }
  return ops;
}

function literalBytes(raw) {
  const out = [];
  const s = raw.slice(1, -1);
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (ch !== '\\') { out.push(s.charCodeAt(i) & 0xff); continue; }
    i += 1;
    const e = s[i];
    if (e === undefined) break;
    if (e === 'n') out.push(10); else if (e === 'r') out.push(13); else if (e === 't') out.push(9);
    else if (e === 'b') out.push(8); else if (e === 'f') out.push(12);
    else if (e === '\r') { if (s[i + 1] === '\n') i += 1; } // line continuation
    else if (e === '\n') { /* line continuation */ }
    else if (/[0-7]/.test(e)) {
      let oct = e;
      while (oct.length < 3 && /[0-7]/.test(s[i + 1] || '')) { i += 1; oct += s[i]; }
      out.push(Number.parseInt(oct, 8) & 0xff);
    } else out.push(s.charCodeAt(i) & 0xff);
  }
  return out;
}

function hexBytes(raw) {
  let hex = raw.slice(1, -1).replace(/[^0-9a-fA-F]/g, '');
  if (hex.length % 2) hex += '0';
  const out = [];
  for (let i = 0; i < hex.length; i += 2) out.push(Number.parseInt(hex.slice(i, i + 2), 16));
  return out;
}

const tokenBytes = (token) => (token.type === 'str' ? literalBytes(token.raw) : hexBytes(token.raw));
const toHex = (bytes) => `<${bytes.map((b) => b.toString(16).padStart(2, '0')).join('')}>`;
const fmt = (v) => { const r = Math.round(v * 1000) / 1000; return Object.is(r, -0) ? '0' : String(r); };

// ---------------------------------------------------------------------------------------------------------------
// Resource helpers (pdf-lib)
// ---------------------------------------------------------------------------------------------------------------

function resourceDict(pdfLib, context, pageNode, category) {
  const { PDFDict, PDFName } = pdfLib;
  const resources = context.lookup(pageNode.Resources?.() ?? pageNode.get(PDFName.of('Resources')));
  if (!(resources instanceof PDFDict)) return null;
  const sub = context.lookup(resources.get(PDFName.of(category)));
  return sub instanceof PDFDict ? sub : null;
}

function codeLengthOf(pdfLib, context, fonts, name) {
  const { PDFDict, PDFName } = pdfLib;
  if (!fonts || !name) return null;
  const font = context.lookup(fonts.get(PDFName.of(name)));
  if (!(font instanceof PDFDict)) return null;
  const subtype = font.get(PDFName.of('Subtype'))?.toString();
  if (subtype !== '/Type0') return 1;
  const encoding = context.lookup(font.get(PDFName.of('Encoding')));
  const enc = encoding?.toString?.() || '';
  return enc === '/Identity-H' || enc === '/Identity-V' ? 2 : null;
}

function isImageXObject(pdfLib, context, xobjects, name) {
  const { PDFName } = pdfLib;
  if (!xobjects || !name) return false;
  const xobject = context.lookup(xobjects.get(PDFName.of(name)));
  const dict = xobject?.dict || xobject;
  return dict?.get?.(PDFName.of('Subtype'))?.toString() === '/Image';
}

function decodeContents(pdfLib, context, pageNode) {
  const { PDFArray, PDFName, PDFRawStream, PDFStream, decodePDFRawStream } = pdfLib;
  const contents = context.lookup(pageNode.get(PDFName.of('Contents')));
  const streams = contents instanceof PDFArray ? contents.asArray().map((ref) => context.lookup(ref)) : [contents];
  const parts = [];
  for (const stream of streams) {
    if (!stream) continue;
    let bytes;
    if (stream instanceof PDFRawStream) bytes = decodePDFRawStream(stream).decode();
    else if (stream instanceof PDFStream && typeof stream.getContents === 'function') bytes = stream.getContents();
    else if (typeof stream.getUnencodedContents === 'function') bytes = stream.getUnencodedContents();
    else return null;
    let text = '';
    for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
    parts.push(text);
  }
  return parts.join('\n');
}

// ---------------------------------------------------------------------------------------------------------------
// Removal
// ---------------------------------------------------------------------------------------------------------------

const insideRect = (x, y, r, pad = 0.8) => x >= r.x - pad && x <= r.x + r.w + pad && y >= r.y - pad && y <= r.y + r.h + pad;
const matchesRect = (box, r, tol = 2.5) => Math.abs(box.x0 - r.x) <= tol && Math.abs(box.y0 - r.y) <= tol
  && Math.abs(box.x1 - (r.x + r.w)) <= tol && Math.abs(box.y1 - (r.y + r.h)) <= tol;

/**
 * Remove original text glyphs and images from one page's content stream.
 * Regions are in top-left points of the page as displayed (rotation applied), the editor's coordinate system.
 * @returns {{ text: Set<string>, images: Set<string>, reason?: string }} ids of regions that were fully handled
 */
export async function removeOriginalContent({ pdfLib, output, page, pdfJsPage, textRegions = [], imageRegions = [] }) {
  const handled = { text: new Set(), images: new Set() };
  if (!textRegions.length && !imageRegions.length) return handled;
  const { context } = output;
  const pageNode = page.node;
  const source = decodeContents(pdfLib, context, pageNode);
  if (source == null) return { ...handled, reason: 'content stream could not be decoded' };
  const ops = tokenizeContent(source);
  const pdfjsLib = await getPdfJsLib();
  const viewport = pdfJsPage.getViewport({ scale: 1, rotation: ((Number(pdfJsPage.rotate) || 0) % 360 + 360) % 360 });
  const fonts = resourceDict(pdfLib, context, pageNode, 'Font');
  const xobjects = resourceDict(pdfLib, context, pageNode, 'XObject');
  const replacements = new Map(); // op index → replacement text

  // ---- text ----
  if (textRegions.length) {
    const list = await pdfJsPage.getOperatorList();
    const content = interpretPage(pdfJsPage, list, viewport, pdfjsLib, { recordTextOps: true });
    const decoded = [...content.textOps.entries()].sort((a, b) => a[0] - b[0]);
    const topLevel = decoded.filter(([, rec]) => rec.topLevel).map(([, rec]) => rec);
    // Glyphs in nested content (form XObjects, annotations) cannot be removed from the page stream.
    const blocked = new Set();
    for (const [, rec] of decoded) {
      if (rec.topLevel) continue;
      for (const g of rec.glyphs) for (const region of textRegions) if (insideRect(g.cx, g.cy, region.rect)) blocked.add(region.id);
    }
    const showOps = [];
    let fontName = null; const fontStack = [];
    for (let k = 0; k < ops.length; k += 1) {
      const { op, operands } = ops[k];
      if (op === 'q') fontStack.push(fontName);
      else if (op === 'Q') fontName = fontStack.length ? fontStack.pop() : fontName;
      else if (op === 'Tf' && operands[0]?.type === 'name') fontName = operands[0].value;
      else if (op === 'Tj' || op === 'TJ' || op === "'" || op === '"') showOps.push({ k, fontName });
    }
    const failed = new Set(blocked);
    if (showOps.length !== topLevel.length) {
      for (const region of textRegions) failed.add(region.id);
    } else {
      for (let s = 0; s < showOps.length; s += 1) {
        const rec = topLevel[s];
        const regionOf = rec.glyphs.map((g) => textRegions.find((region) => insideRect(g.cx, g.cy, region.rect))?.id || null);
        if (!regionOf.some(Boolean)) continue;
        const { k, fontName: name } = showOps[s];
        const operation = ops[k];
        const codeLen = codeLengthOf(pdfLib, context, fonts, name);
        const strings = operation.op === 'TJ'
          ? operation.operands.filter((t) => t.type === 'str' || t.type === 'hex')
          : operation.operands.filter((t) => t.type === 'str' || t.type === 'hex').slice(-1);
        const total = strings.reduce((sum, t) => sum + tokenBytes(t).length, 0);
        if (!codeLen || rec.vertical || total % codeLen || total / codeLen !== rec.glyphs.length) {
          for (const id of regionOf) if (id) failed.add(id);
          continue;
        }
        // Rebuild as a TJ array.
        const elements = operation.op === 'TJ' ? operation.operands.filter((t) => t.type !== '[' && t.type !== ']') : strings;
        const out = [];
        let kept = []; let adjust = 0; let g = 0;
        const flushString = () => { if (kept.length) { if (adjust) { out.push(fmt(adjust)); adjust = 0; } out.push(toHex(kept)); kept = []; } };
        for (const element of elements) {
          if (element.type === 'num') { flushString(); adjust += element.value; continue; }
          if (element.type !== 'str' && element.type !== 'hex') continue;
          const bytes = tokenBytes(element);
          for (let b = 0; b < bytes.length; b += codeLen) {
            const glyph = rec.glyphs[g];
            if (regionOf[g]) {
              flushString();
              const advance = glyph.width * rec.widthScale * 1000 + (rec.charSpacing + (glyph.spaceCode ? rec.wordSpacing : 0)) * 1000 / (rec.size || 1);
              adjust -= advance;
            } else {
              if (adjust && !kept.length) { out.push(fmt(adjust)); adjust = 0; }
              kept.push(...bytes.slice(b, b + codeLen));
            }
            g += 1;
          }
        }
        flushString();
        if (adjust) out.push(fmt(adjust));
        const array = `[${out.join(' ')}] TJ`;
        let replacement = array;
        if (operation.op === "'") replacement = `T* ${array}`;
        else if (operation.op === '"') {
          const [aw, ac] = operation.operands.filter((t) => t.type === 'num');
          replacement = `${aw ? aw.raw : 0} Tw ${ac ? ac.raw : 0} Tc T* ${array}`;
        }
        replacements.set(k, replacement);
      }
    }
    for (const region of textRegions) if (!failed.has(region.id)) handled.text.add(region.id);
    // If any region failed, keep its glyphs: drop replacements that only served failed regions.
    if (failed.size) {
      // Re-run conservatively: undo replacements touching failed regions is complex; instead only keep the
      // replacements when every region they touched succeeded.
      for (let s = 0; s < showOps.length && showOps.length === topLevel.length; s += 1) {
        const rec = topLevel[s];
        const touched = new Set(rec.glyphs.map((g) => textRegions.find((region) => insideRect(g.cx, g.cy, region.rect))?.id).filter(Boolean));
        if ([...touched].some((id) => failed.has(id))) {
          replacements.delete(showOps[s].k);
          for (const id of touched) handled.text.delete(id);
        }
      }
    }
  }

  // ---- images ----
  if (imageRegions.length) {
    let ctm = [1, 0, 0, 1, 0, 0];
    const stack = [];
    const toView = (m) => {
      const full = multiply(viewport.transform, m);
      const pts = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => applyPoint(full, x, y));
      return { x0: Math.min(...pts.map((p) => p[0])), y0: Math.min(...pts.map((p) => p[1])), x1: Math.max(...pts.map((p) => p[0])), y1: Math.max(...pts.map((p) => p[1])) };
    };
    for (let k = 0; k < ops.length; k += 1) {
      const { op, operands } = ops[k];
      if (op === 'q') stack.push(ctm);
      else if (op === 'Q') ctm = stack.length ? stack.pop() : ctm;
      else if (op === 'cm' && operands.length >= 6) ctm = multiply(ctm, operands.slice(-6).map((t) => Number(t.value) || 0));
      else if ((op === 'Do' && isImageXObject(pdfLib, context, xobjects, operands[0]?.value)) || op === 'BI') {
        const box = toView(ctm);
        const region = imageRegions.find((r) => !handled.images.has(r.id) && matchesRect(box, r.rect));
        if (region) { replacements.set(k, ''); handled.images.add(region.id); }
      }
    }
  }

  if (!replacements.size) return handled;
  // Splice the new operators into the original stream text.
  let result = '';
  let cursor = 0;
  for (const k of [...replacements.keys()].sort((a, b) => a - b)) {
    const op = ops[k];
    result += source.slice(cursor, op.start) + replacements.get(k);
    cursor = op.end;
  }
  result += source.slice(cursor);
  const bytes = new Uint8Array(result.length);
  for (let i = 0; i < result.length; i += 1) bytes[i] = result.charCodeAt(i) & 0xff;
  const stream = context.flateStream(bytes);
  pageNode.set(pdfLib.PDFName.of('Contents'), context.register(stream));
  return handled;
}
