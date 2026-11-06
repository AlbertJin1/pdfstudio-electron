// Page content interpreter for the PDF → Word engine.
//
// Walks the PDF.js operator list exactly the way the canvas renderer does, but instead of painting it records
// what was painted: every glyph with its true position, font, size and fill colour, every vector path with its
// stroke/fill colours and geometry, and every image with its placed bounding box. All coordinates are returned in
// top-left page space (points, y grows downwards, page rotation applied) so the layout pass never has to think in
// PDF user space.

const IDENTITY = [1, 0, 0, 1, 0, 0];

export function multiply(m1, m2) {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

export function applyPoint(m, x, y) {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

function bboxOfPoints(points) {
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const [x, y] of points) {
    if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1 };
}

function parseColor(value) {
  if (typeof value !== 'string') return null;
  const hex = value.trim().replace(/^#/, '');
  if (/^[0-9a-f]{6}$/i.test(hex)) return hex.toUpperCase();
  if (/^[0-9a-f]{3}$/i.test(hex)) return hex.split('').map((c) => c + c).join('').toUpperCase();
  const rgb = value.match(/rgba?\(([^)]+)\)/i);
  if (rgb) {
    const [r, g, b] = rgb[1].split(',').map((part) => Math.round(Number(part) || 0));
    return [r, g, b].map((n) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0')).join('').toUpperCase();
  }
  return null;
}

const grayHex = (g) => { const v = Math.round(Math.max(0, Math.min(1, Number(g) || 0)) * 255).toString(16).padStart(2, '0'); return (v + v + v).toUpperCase(); };
const rgbHex = (r, g, b) => [r, g, b].map((n) => Math.round(Math.max(0, Math.min(1, Number(n) || 0)) * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
const cmykHex = (c, m, y, k) => rgbHex((1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k));

function freshState(ctm) {
  return {
    ctm,
    fill: '000000', stroke: '000000', fillPattern: false, strokePattern: false,
    fillAlpha: 1, strokeAlpha: 1, lineWidth: 1,
    font: null, fontName: '', fontSize: 0, fontMatrix: [0.001, 0, 0, 0.001, 0, 0], fontDirection: 1,
    charSpacing: 0, wordSpacing: 0, hScale: 1, leading: 0, rise: 0, renderMode: 0,
    textMatrix: IDENTITY, x: 0, y: 0, lineX: 0, lineY: 0,
    clip: null,
  };
}

const cloneState = (state) => ({ ...state });

function intersectBox(a, b) {
  if (!a) return b; if (!b) return a;
  return { x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1) };
}

/** Parse a PDF.js DrawOPS path buffer into subpaths of device-space points. */
function parsePath(buffer, ctm, DrawOPS) {
  const subpaths = [];
  let current = null;
  let hasCurves = false;
  const data = buffer || [];
  const push = (x, y) => {
    const point = applyPoint(ctm, x, y);
    if (!current) { current = { points: [], closed: false }; subpaths.push(current); }
    current.points.push(point);
  };
  for (let i = 0; i < data.length;) {
    const op = data[i++];
    if (op === DrawOPS.moveTo) {
      current = { points: [], closed: false }; subpaths.push(current);
      push(data[i], data[i + 1]); i += 2;
    } else if (op === DrawOPS.lineTo) {
      push(data[i], data[i + 1]); i += 2;
    } else if (op === DrawOPS.curveTo) {
      hasCurves = true;
      push(data[i], data[i + 1]); push(data[i + 2], data[i + 3]); push(data[i + 4], data[i + 5]); i += 6;
    } else if (op === DrawOPS.quadraticCurveTo) {
      hasCurves = true;
      push(data[i], data[i + 1]); push(data[i + 2], data[i + 3]); i += 4;
    } else if (op === DrawOPS.closePath) {
      if (current) current.closed = true;
    } else {
      break; // Unknown opcode: stop rather than misread the remaining coordinates.
    }
  }
  return { subpaths: subpaths.filter((sub) => sub.points.length), hasCurves };
}

/** Axis-aligned rectangle test for a closed 4/5 point subpath. */
function asRect(sub) {
  let pts = sub.points;
  if (pts.length === 5 && Math.abs(pts[0][0] - pts[4][0]) < 0.01 && Math.abs(pts[0][1] - pts[4][1]) < 0.01) pts = pts.slice(0, 4);
  if (pts.length === 2) {
    // "re" with zero width/height is emitted as a 2-point path.
    return null;
  }
  if (pts.length !== 4) return null;
  const xs = [...new Set(pts.map((p) => Math.round(p[0] * 100) / 100))];
  const ys = [...new Set(pts.map((p) => Math.round(p[1] * 100) / 100))];
  if (xs.length > 2 || ys.length > 2) return null;
  for (let i = 0; i < 4; i += 1) {
    const a = pts[i]; const b = pts[(i + 1) % 4];
    if (Math.abs(a[0] - b[0]) > 0.05 && Math.abs(a[1] - b[1]) > 0.05) return null;
  }
  const box = bboxOfPoints(pts);
  return box;
}

function segmentsOf(sub) {
  const segments = [];
  const pts = sub.points;
  for (let i = 0; i + 1 < pts.length; i += 1) segments.push([pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]]);
  if (sub.closed && pts.length > 2) segments.push([pts[pts.length - 1][0], pts[pts.length - 1][1], pts[0][0], pts[0][1]]);
  return segments;
}

function fontInfo(fontObject, fallbackName) {
  const name = String(fontObject?.name || fallbackName || '');
  const lower = name.toLowerCase();
  return {
    name,
    bold: Boolean(fontObject?.bold || fontObject?.black) || /bold|black|heavy|semibold|demibold|[-,]sb\b/.test(lower),
    italic: Boolean(fontObject?.italic) || /italic|oblique/.test(lower),
    monospace: Boolean(fontObject?.isMonospace),
    serif: Boolean(fontObject?.isSerifFont),
    type3: Boolean(fontObject?.isType3Font),
    vertical: Boolean(fontObject?.vertical),
    ascent: Number.isFinite(fontObject?.ascent) ? fontObject.ascent : 0.8,
    descent: Number.isFinite(fontObject?.descent) ? fontObject.descent : -0.2,
    fallbackName: String(fontObject?.fallbackName || ''),
  };
}

/**
 * Interpret a page's operator list.
 * @returns {{ glyphs, paths, images, width, height }}
 */
export function interpretPage(page, operatorList, viewport, pdfjsLib, { recordTextOps = false } = {}) {
  const OPS = pdfjsLib.OPS;
  const DrawOPS = pdfjsLib.DrawOPS || { moveTo: 0, lineTo: 1, curveTo: 2, quadraticCurveTo: 3, closePath: 4 };
  const fonts = new Map();
  const getFont = (loadedName) => {
    if (fonts.has(loadedName)) return fonts.get(loadedName);
    let object = null;
    try { object = page.commonObjs.get(loadedName); } catch { object = null; }
    const info = { object, ...fontInfo(object, loadedName) };
    fonts.set(loadedName, info);
    return info;
  };

  const base = viewport.transform.slice();
  let state = freshState(base);
  const stack = [];
  const baseStack = [];
  const glyphs = [];
  const paths = [];
  const images = [];
  let pendingClip = false;
  let nesting = 0; // >0 inside form XObjects / annotation appearances (not part of the page content stream)
  const textOps = recordTextOps ? new Map() : null;
  const fnArray = operatorList.fnArray;
  const argsArray = operatorList.argsArray;

  const showGlyphs = (opIndex, glyphList) => {
    const font = state.font;
    if (!font || !Array.isArray(glyphList)) return;
    const size = state.fontSize;
    if (!size) return;
    const fontMatrix = state.fontMatrix || [0.001, 0, 0, 0.001, 0, 0];
    const widthScale = size * fontMatrix[0];
    const hScale = state.hScale * state.fontDirection;
    // Text rendering matrix without the running x offset.
    const textToDevice = multiply(state.ctm, state.textMatrix);
    const vertical = font.vertical;
    const record = textOps ? { topLevel: nesting === 0, size, charSpacing: state.charSpacing, wordSpacing: state.wordSpacing, widthScale: fontMatrix[0], vertical, glyphs: [] } : null;
    if (record) textOps.set(opIndex, record);
    let x = 0;
    for (const glyph of glyphList) {
      if (typeof glyph === 'number') {
        // TJ adjustments are in thousandths of text space units and move the pen backwards.
        x += (vertical ? 1 : -1) * glyph * size / 1000;
        continue;
      }
      if (!glyph) continue;
      const spacing = (glyph.isSpace ? state.wordSpacing : 0) + state.charSpacing;
      const advance = (Number(glyph.width) || 0) * widthScale + spacing * state.fontDirection;
      const unicode = typeof glyph.unicode === 'string' ? glyph.unicode : '';
      if (record) {
        const sx = state.x + x * hScale; const ex = state.x + (x + (Number(glyph.width) || 0) * widthScale) * hScale;
        const ty = state.y + state.rise;
        const a = applyPoint(textToDevice, sx, ty); const b = applyPoint(textToDevice, ex, ty);
        const up = Math.hypot(textToDevice[2] * size, textToDevice[3] * size);
        record.glyphs.push({ width: Number(glyph.width) || 0, spaceCode: Boolean(glyph.isSpace), cx: (a[0] + b[0]) / 2, cy: (a[1] + b[1]) / 2 - up * 0.32, x0: Math.min(a[0], b[0]), x1: Math.max(a[0], b[0]), size: up });
      }
      if (!vertical && state.renderMode !== 7) {
        const startX = state.x + x * hScale;
        const endX = state.x + (x + (Number(glyph.width) || 0) * widthScale) * hScale;
        const ty = state.y + state.rise;
        const p0 = applyPoint(textToDevice, startX, ty);
        const p1 = applyPoint(textToDevice, endX, ty);
        // Device-space em size: transform the vertical unit vector of the text space.
        const up = [textToDevice[2] * size, textToDevice[3] * size];
        const deviceSize = Math.hypot(up[0], up[1]);
        const angle = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]);
        const invisible = state.renderMode === 3 || state.renderMode === 7;
        if (unicode && deviceSize > 0.5) {
          glyphs.push({
            ch: unicode,
            isSpace: /^[\s\u00A0\u2000-\u200B\u3000]+$/.test(unicode),
            x0: Math.min(p0[0], p1[0]), x1: Math.max(p0[0], p1[0]),
            ox: p0[0], oy: p0[1],
            baseline: p0[1],
            size: deviceSize,
            angle: Math.abs(angle) < 1e-3 || Math.abs(p1[0] - p0[0]) < 1e-6 && Math.abs(p1[1] - p0[1]) < 1e-6 ? 0 : angle,
            font: state.fontName,
            color: state.fillPattern ? '000000' : (state.fill || '000000'),
            alpha: state.fillAlpha,
            invisible,
            stroked: state.renderMode === 1 || state.renderMode === 2,
            opIndex,
            seq: glyphs.length,
            clip: state.clip,
          });
        }
      }
      x += advance;
    }
    // Advance the text cursor exactly as the canvas renderer does.
    state.x += x * hScale;
  };

  for (let i = 0; i < fnArray.length; i += 1) {
    const fn = fnArray[i];
    const args = argsArray[i] || [];
    switch (fn) {
      case OPS.save: stack.push(cloneState(state)); break;
      case OPS.restore: if (stack.length) state = stack.pop(); break;
      case OPS.transform: state.ctm = multiply(state.ctm, args); break;
      case OPS.setLineWidth: state.lineWidth = Number(args[0]) || 0; break;
      case OPS.setGState:
        for (const [key, value] of args[0] || []) {
          if (key === 'LW') state.lineWidth = Number(value) || 0;
          else if (key === 'ca') state.fillAlpha = Number(value);
          else if (key === 'CA') state.strokeAlpha = Number(value);
          else if (key === 'Font' && Array.isArray(value)) {
            const info = getFont(value[0]);
            state.font = info; state.fontName = value[0];
            state.fontSize = Math.abs(Number(value[1]) || 0); state.fontDirection = Number(value[1]) < 0 ? -1 : 1;
            state.fontMatrix = info.object?.fontMatrix || [0.001, 0, 0, 0.001, 0, 0];
          }
        }
        break;
      case OPS.setFillRGBColor: state.fill = Array.isArray(args) && args.length >= 3 && typeof args[0] === 'number' ? rgbHex(args[0] / 255, args[1] / 255, args[2] / 255) : parseColor(args[0]) || state.fill; state.fillPattern = false; break;
      case OPS.setStrokeRGBColor: state.stroke = Array.isArray(args) && args.length >= 3 && typeof args[0] === 'number' ? rgbHex(args[0] / 255, args[1] / 255, args[2] / 255) : parseColor(args[0]) || state.stroke; state.strokePattern = false; break;
      case OPS.setFillGray: state.fill = grayHex(args[0]); state.fillPattern = false; break;
      case OPS.setStrokeGray: state.stroke = grayHex(args[0]); state.strokePattern = false; break;
      case OPS.setFillCMYKColor: state.fill = cmykHex(...args); state.fillPattern = false; break;
      case OPS.setStrokeCMYKColor: state.stroke = cmykHex(...args); state.strokePattern = false; break;
      case OPS.setFillColorN: state.fillPattern = true; break;
      case OPS.setStrokeColorN: state.strokePattern = true; break;
      case OPS.setFillTransparent: state.fill = null; break;
      case OPS.setStrokeTransparent: state.stroke = null; break;
      case OPS.beginText: state.textMatrix = IDENTITY; state.x = state.lineX = 0; state.y = state.lineY = 0; break;
      case OPS.endText: break;
      case OPS.setFont: {
        const info = getFont(args[0]);
        state.font = info; state.fontName = args[0];
        const size = Number(args[1]) || 0;
        state.fontSize = Math.abs(size); state.fontDirection = size < 0 ? -1 : 1;
        state.fontMatrix = info.object?.fontMatrix || [0.001, 0, 0, 0.001, 0, 0];
        break;
      }
      case OPS.setCharSpacing: state.charSpacing = Number(args[0]) || 0; break;
      case OPS.setWordSpacing: state.wordSpacing = Number(args[0]) || 0; break;
      case OPS.setHScale: state.hScale = (Number(args[0]) || 100) / 100; break;
      case OPS.setLeading: state.leading = -(Number(args[0]) || 0); break;
      case OPS.setTextRise: state.rise = Number(args[0]) || 0; break;
      case OPS.setTextRenderingMode: state.renderMode = Number(args[0]) || 0; break;
      case OPS.moveText: state.x = state.lineX += Number(args[0]) || 0; state.y = state.lineY += Number(args[1]) || 0; break;
      case OPS.setLeadingMoveText: state.leading = Number(args[1]) || 0; state.x = state.lineX += Number(args[0]) || 0; state.y = state.lineY += Number(args[1]) || 0; break;
      case OPS.setTextMatrix: {
        const matrix = Array.isArray(args[0]) || ArrayBuffer.isView(args[0]) ? Array.from(args[0]) : Array.from(args);
        state.textMatrix = matrix.slice(0, 6);
        state.x = state.lineX = 0; state.y = state.lineY = 0;
        break;
      }
      case OPS.nextLine: state.x = state.lineX += 0; state.y = state.lineY += state.leading; break;
      case OPS.showText:
      case OPS.showSpacedText:
        showGlyphs(i, args[0]);
        break;
      case OPS.nextLineShowText:
        state.y = state.lineY += state.leading; state.x = state.lineX;
        showGlyphs(i, args[0]);
        break;
      case OPS.nextLineSetSpacingShowText:
        state.wordSpacing = Number(args[0]) || 0; state.charSpacing = Number(args[1]) || 0;
        state.y = state.lineY += state.leading; state.x = state.lineX;
        showGlyphs(i, args[2]);
        break;
      case OPS.clip: case OPS.eoClip: pendingClip = true; break;
      case OPS.constructPath: {
        const paintOp = args[0];
        const buffer = Array.isArray(args[1]) ? args[1][0] : args[1];
        const parsed = parsePath(buffer, state.ctm, DrawOPS);
        if (pendingClip) {
          const all = parsed.subpaths.flatMap((sub) => sub.points);
          if (all.length) state.clip = intersectBox(state.clip, bboxOfPoints(all));
          pendingClip = false;
        }
        if (paintOp === OPS.endPath || !parsed.subpaths.length) break;
        const strokes = [OPS.stroke, OPS.closeStroke, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke].includes(paintOp);
        const fills = [OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke, OPS.rawFillPath].includes(paintOp);
        const closeAll = [OPS.closeStroke, OPS.closeFillStroke, OPS.closeEOFillStroke].includes(paintOp);
        if (closeAll) for (const sub of parsed.subpaths) sub.closed = true;
        const scale = Math.sqrt(Math.abs(state.ctm[0] * state.ctm[3] - state.ctm[1] * state.ctm[2])) || 1;
        const points = parsed.subpaths.flatMap((sub) => sub.points);
        let box = bboxOfPoints(points);
        if (state.clip) {
          const clipped = intersectBox(box, state.clip);
          if (clipped.x1 < clipped.x0 - 0.5 || clipped.y1 < clipped.y0 - 0.5) break; // fully clipped away
          box = { x0: Math.max(box.x0, state.clip.x0 - 0.5), y0: Math.max(box.y0, state.clip.y0 - 0.5), x1: Math.min(box.x1, state.clip.x1 + 0.5), y1: Math.min(box.y1, state.clip.y1 + 0.5) };
        }
        const rects = parsed.hasCurves ? [] : parsed.subpaths.map(asRect);
        paths.push({
          opIndex: i,
          box,
          stroke: strokes && !state.strokePattern ? state.stroke : (strokes ? '000000' : null),
          fill: fills && !state.fillPattern ? state.fill : (fills ? 'pattern' : null),
          strokeAlpha: state.strokeAlpha,
          fillAlpha: state.fillAlpha,
          lineWidth: Math.max(0.1, (state.lineWidth || 0) * scale || 0.6),
          hasCurves: parsed.hasCurves,
          subpaths: parsed.subpaths.length,
          rects: rects.every(Boolean) ? rects : null,
          subBoxes: parsed.subpaths.map((sub) => bboxOfPoints(sub.points)),
          segments: parsed.hasCurves ? [] : parsed.subpaths.flatMap(segmentsOf),
        });
        break;
      }
      case OPS.paintImageXObject:
      case OPS.paintInlineImageXObject:
      case OPS.paintImageMaskXObject:
      case OPS.paintImageXObjectRepeat:
      case OPS.paintSolidColorImageMask: {
        const corners = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => applyPoint(state.ctm, x, y));
        let box = bboxOfPoints(corners);
        if (state.clip) box = intersectBox(box, state.clip);
        if (box.x1 - box.x0 < 0.5 || box.y1 - box.y0 < 0.5) break;
        let pixelWidth = 0; let pixelHeight = 0;
        if (fn === OPS.paintImageXObject || fn === OPS.paintImageXObjectRepeat) { pixelWidth = Number(args[1]) || 0; pixelHeight = Number(args[2]) || 0; }
        else if (args[0] && typeof args[0] === 'object') { pixelWidth = Number(args[0].width) || 0; pixelHeight = Number(args[0].height) || 0; }
        images.push({
          opIndex: i,
          box,
          objId: typeof args[0] === 'string' ? args[0] : null,
          mask: fn === OPS.paintImageMaskXObject || fn === OPS.paintSolidColorImageMask,
          maskColor: state.fill,
          pixelWidth, pixelHeight,
          rotated: Math.abs(state.ctm[1]) > 1e-3 || Math.abs(state.ctm[2]) > 1e-3,
        });
        break;
      }
      case OPS.shadingFill: {
        const box = state.clip || { x0: 0, y0: 0, x1: viewport.width, y1: viewport.height };
        paths.push({ opIndex: i, box, stroke: null, fill: 'shading', strokeAlpha: 1, fillAlpha: state.fillAlpha, lineWidth: 0, hasCurves: true, subpaths: 1, rects: null, segments: [] });
        break;
      }
      case OPS.paintFormXObjectBegin: {
        nesting += 1;
        stack.push(cloneState(state));
        baseStack.push(null);
        const matrix = args[0];
        if (matrix && matrix.length >= 6) state.ctm = multiply(state.ctm, Array.from(matrix));
        const bbox = args[1];
        if (bbox && bbox.length >= 4) {
          const corners = [[bbox[0], bbox[1]], [bbox[2], bbox[1]], [bbox[0], bbox[3]], [bbox[2], bbox[3]]].map(([x, y]) => applyPoint(state.ctm, x, y));
          state.clip = intersectBox(state.clip, bboxOfPoints(corners));
        }
        break;
      }
      case OPS.paintFormXObjectEnd: nesting = Math.max(0, nesting - 1); if (stack.length) state = stack.pop(); baseStack.pop(); break;
      case OPS.beginAnnotation: {
        nesting += 1;
        stack.push(cloneState(state));
        const [, rect, transform, matrix] = args;
        const next = freshState(base);
        let ctm = base;
        if (transform) ctm = multiply(ctm, Array.from(transform));
        if (matrix) ctm = multiply(ctm, Array.from(matrix));
        next.ctm = ctm;
        if (rect && rect.length >= 4) {
          const corners = [[rect[0], rect[1]], [rect[2], rect[3]]].map(([x, y]) => applyPoint(base, x, y));
          next.clip = bboxOfPoints(corners);
        }
        state = next;
        break;
      }
      case OPS.endAnnotation: nesting = Math.max(0, nesting - 1); if (stack.length) state = stack.pop(); break;
      default: break;
    }
  }

  return { glyphs, paths, images, width: viewport.width, height: viewport.height, fonts, textOps };
}

/** Painting operator ids — used to isolate a subset of a page when rendering crops. */
export function paintingOperatorSet(pdfjsLib) {
  const OPS = pdfjsLib.OPS;
  return new Set([
    OPS.showText, OPS.showSpacedText, OPS.nextLineShowText, OPS.nextLineSetSpacingShowText,
    OPS.constructPath, OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject,
    OPS.paintImageXObjectRepeat, OPS.paintImageMaskXObjectRepeat, OPS.paintSolidColorImageMask,
    OPS.paintImageMaskXObjectGroup, OPS.paintInlineImageXObjectGroup, OPS.shadingFill, OPS.rawFillPath,
  ].filter((id) => Number.isInteger(id)));
}
