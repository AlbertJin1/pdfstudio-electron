// Text measuring and layout shared by the editor preview and the PDF exporter, so what you
// see in the editor is laid out the same way in the saved file. Arial, Times New Roman and
// Courier New are metric-compatible with the PDF standard fonts Helvetica, Times and Courier.
export const FONT_FAMILIES = {
  helvetica: { label: 'Helvetica (Arial)', css: 'Arial, Helvetica, "Liberation Sans", sans-serif', shift: 0.3465 },
  times: { label: 'Times', css: '"Times New Roman", Times, "Liberation Serif", serif', shift: 0.3375 },
  courier: { label: 'Courier', css: '"Courier New", Courier, "Liberation Mono", monospace', shift: 0.2665 },
};

export const TEXT_TYPES = new Set(['text', 'textedit', 'note', 'stamp']);
export const AUTO_SIZE_TYPES = new Set(['text', 'textedit']);

let measureContext;
function getContext() {
  if (!measureContext && typeof document !== 'undefined') {
    measureContext = document.createElement('canvas').getContext('2d');
    // Measure exactly the way the editor draws text (see TEXT_RENDER_STYLE): no hinting-based advance rounding.
    try { measureContext.textRendering = 'geometricPrecision'; measureContext.fontKerning = 'normal'; } catch { /* older engines keep their defaults */ }
  }
  return measureContext;
}

/** Applied to BOTH the static text and the editing textarea so switching between them cannot change glyph
 * advances. A textarea resets text-rendering/letter-spacing/etc. to the user-agent defaults while a div inherits
 * the app's global values, which is what used to nudge the text when a box went into edit mode. */
export const TEXT_RENDER_STYLE = {
  textRendering: 'geometricPrecision', fontKerning: 'normal', letterSpacing: 'normal', wordSpacing: 'normal',
  textIndent: 0, textTransform: 'none', fontFeatureSettings: 'normal', fontVariantLigatures: 'normal', fontSynthesis: 'none',
  WebkitFontSmoothing: 'antialiased', tabSize: 8,
};

/** Fonts commonly installed with Windows/Office. Export embeds the real font file when it can be found. */
export const COMMON_FONTS = [
  { name: 'Arial', base: 'helvetica' }, { name: 'Times New Roman', base: 'times' }, { name: 'Courier New', base: 'courier' },
  { name: 'Calibri', base: 'helvetica' }, { name: 'Cambria', base: 'times' }, { name: 'Candara', base: 'helvetica' },
  { name: 'Verdana', base: 'helvetica' }, { name: 'Tahoma', base: 'helvetica' }, { name: 'Georgia', base: 'times' },
  { name: 'Segoe UI', base: 'helvetica' }, { name: 'Trebuchet MS', base: 'helvetica' }, { name: 'Consolas', base: 'courier' },
  { name: 'Comic Sans MS', base: 'helvetica' }, { name: 'Impact', base: 'helvetica' }, { name: 'Palatino Linotype', base: 'times' },
  { name: 'Century Gothic', base: 'helvetica' },
];

/** "ABCDEF+Calibri-Bold" -> "Calibri", "TimesNewRomanPS-BoldMT" -> "Times New Roman". */
export function familyFromName(real = '') {
  let name = String(real).replace(/^[A-Z]{6}\+/, '').split(/[-,]/)[0];
  name = name.replace(/(PSMT|PS|MT)$/i, '').replace(/(Bold|Italic|Oblique|Regular)+$/i, '');
  name = name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Z]{2,})([A-Z][a-z])/g, '$1 $2').replace(/\s+/g, ' ').trim();
  if (/^helvetica$/i.test(name)) return '';
  if (/^times(roman)?$/i.test(name)) return 'Times New Roman';
  if (/^courier$/i.test(name)) return 'Courier New';
  return name;
}

const quote = (name) => `"${String(name).replace(/"/g, '')}"`;

/** Resolve the preview font. PDF.js's fontRef (for example `g_d0_f1`) is an internal object id,
 * not a CSS family name; treating it as one used to suppress bold/italic and silently render regular text. */
export function cssFontOf(item, t) {
  const base = FONT_FAMILIES[t.family] || FONT_FAMILIES.helvetica;
  const stack = [];
  // Only a real family name belongs in CSS. Never use PDF.js's synthetic fontRef as a browser family.
  if (item.fontName && !/^g_[a-z0-9]+_f\d+$/i.test(item.fontName)) stack.push(quote(item.fontName));
  stack.push(base.css);
  return { cssFamily: stack.join(', '), cssBold: !!t.bold, cssItalic: !!t.italic };
}

export function textWidth(text, style, size) {
  const context = getContext();
  if (!context) return String(text).length * size * 0.5;
  const family = style.cssFamily || (FONT_FAMILIES[style.family] || FONT_FAMILIES.helvetica).css;
  const bold = style.cssBold ?? style.bold; const italic = style.cssItalic ?? style.italic;
  context.font = `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}100px ${family}`;
  return context.measureText(text).width * size / 100;
}

/** Fill in the defaults that depend on the item type. */
export function resolveText(item) {
  const type = item.type;
  const t = {
    family: item.font || 'helvetica',
    fontName: item.fontName || '',
    bold: item.bold ?? (type === 'stamp' || item.fontStyle === 'bold'),
    italic: item.italic ?? item.fontStyle === 'italic',
    underline: !!item.underline,
    strike: !!item.strike,
    size: Math.max(4, Math.min(300, Number(item.size) || 12)),
    lineHeight: Number(item.lineHeight) || 1.2,
    align: item.align || (type === 'stamp' ? 'center' : 'left'),
    // First-line indent (points) of each paragraph — only meaningful for flowing (reflow) text.
    firstIndent: item.reflow ? Math.max(-200, Math.min(400, Number(item.firstIndent) || 0)) : 0,
    pad: item.pad ?? (type === 'note' ? 4 : type === 'stamp' || type === 'textedit' ? 0 : 2),
    reflow: type === 'note' || type === 'stamp' ? true : !!item.reflow,
    valign: type === 'stamp' ? 'middle' : 'top',
  };
  return { ...t, ...cssFontOf(item, t) };
}

export function wrapLines(text, style, size, maxWidth, firstIndent = 0) {
  return wrapLinesInfo(text, style, size, maxWidth, firstIndent).map((entry) => entry.text);
}

/** Wrap text; each line reports its indent and whether it ends a paragraph (needed for justification). */
export function wrapLinesInfo(text, style, size, maxWidth, firstIndent = 0) {
  const paragraphs = String(text ?? '').split('\n');
  if (!maxWidth) return paragraphs.map((line) => ({ text: line, indent: 0, last: true }));
  const out = [];
  for (const paragraph of paragraphs) {
    if (!paragraph) { out.push({ text: '', indent: 0, last: true }); continue; }
    const lines = [];
    const width = () => maxWidth - (lines.length === 0 ? firstIndent : 0);
    let line = '';
    for (const word of paragraph.split(' ')) {
      const attempt = line ? `${line} ${word}` : word;
      if (!line || textWidth(attempt, style, size) <= width()) { line = attempt; continue; }
      lines.push(line);
      line = word;
      while (textWidth(line, style, size) > width() && line.length > 1) {
        let cut = line.length - 1;
        while (cut > 1 && textWidth(line.slice(0, cut), style, size) > width()) cut -= 1;
        lines.push(line.slice(0, cut));
        line = line.slice(cut);
      }
    }
    lines.push(line);
    lines.forEach((entry, index) => out.push({ text: entry, indent: index === 0 ? firstIndent : 0, last: index === lines.length - 1 }));
  }
  return out;
}

export function layoutItem(item) {
  const t = resolveText(item);
  const lineH = t.size * t.lineHeight;
  const lineInfo = wrapLinesInfo(item.text, t, t.size, t.reflow ? Math.max(t.size, (item.w || 0) - 2 * t.pad) : 0, t.firstIndent);
  const lines = lineInfo.map((entry) => entry.text);
  const widest = Math.max(0, ...lineInfo.map((entry) => textWidth(entry.text, t, t.size) + Math.max(0, entry.indent)));
  return { ...t, lines, lineInfo, lineH, textW: widest, autoW: widest + 2 * t.pad, autoH: lines.length * lineH + 2 * t.pad };
}

/** Patch that makes an auto-sized text box fit its content. */
export function fitTextPatch(item) {
  if (!AUTO_SIZE_TYPES.has(item.type)) return null;
  const layout = layoutItem(item);
  const patch = { h: layout.autoH };
  if (!layout.reflow) patch.w = Math.max(layout.size * 0.6, layout.autoW);
  return patch;
}

/** Baseline of line `index` for a box whose top is `top`. */
export const baselineOf = (layout, top, index) => top + layout.pad + index * layout.lineH + layout.lineH / 2 + (FONT_FAMILIES[layout.family]?.shift ?? 0.3465) * layout.size;

const WIN_ANSI_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
export const isEncodable = (ch) => ch.charCodeAt(0) <= 0xff || WIN_ANSI_EXTRA.includes(ch);
export const findUnsupported = (text) => [...new Set([...String(text || '')].filter((ch) => ch !== '\n' && !isEncodable(ch)))];
