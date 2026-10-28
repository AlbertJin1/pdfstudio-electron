/**
 * Emoji recovery for the image-to-text tool.
 *
 * OCR engines (Tesseract included) are trained on letters and digits, so an emoji comes back as junk such as "&)" or
 * is dropped. This module finds emoji on the pre-processed canvas, matches each one against emoji rendered by the
 * system emoji font, paints the emoji out of the OCR copy of the image (so it cannot become junk characters), and then
 * writes the matched emoji back into the recognised text at the position where it appeared. Everything is local.
 */
const GRID = 16; // features are compared on a GRID x GRID thumbnail
const ACCEPT_DISTANCE = 0.3; // best match must be at least this close (0 = identical, 1 = opposite)
const MAX_EMOJI = 200;
const EMOJI_FONT = '"Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji","Twemoji Mozilla","EmojiOne Color",sans-serif';
const POPULAR = Array.from('😂🤣😭😍🥰😊😁😆😅😄😀🙂😉😎😢😡😠😮😱🤔🙄😒😔😞😴🤗😘😜🤪😋🥺😳🤯😤😬😇🤩🥳😏😐😑🙃😌😷😈👍👎👏🙏💪👌🤞👀💔💕💖💙💚💛🧡💜🖤🔥💯✨🎉😻😹😿🤭🤫🥹😫😩😓😰😨😥😪😵🤮🤢😝😛🤑🤠🤓🧐😕🙁😟🤐😶🥱❤💀👻🤡💩🙈🙉🙊👋🤝🙌🌹🎂')
  .map((glyph) => glyph.codePointAt(0));
const POPULAR_SET = new Set(POPULAR);
const RANGES = [
  [0x1F600, 0x1F64F], [0x1F90C, 0x1F9FF], [0x1F300, 0x1F5FF], [0x1F680, 0x1F6D7], [0x1F7E0, 0x1F7EB], [0x1FA70, 0x1FAFF],
  [0x2600, 0x27BF], [0x2B50, 0x2B50], [0x2B55, 0x2B55], [0x1F004, 0x1F004], [0x1F0CF, 0x1F0CF],
];

const canvasOf = (width, height) => { const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; return canvas; };
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/* ---------- candidate emoji (rendered with the system emoji font) ---------- */

let poolPromise = null;

async function buildPool() {
  try { await document.fonts?.ready; } catch { /* fonts API is optional */ }
  const SIZE = 96; const FONT = 64;
  const big = canvasOf(SIZE, SIZE); const bigCtx = big.getContext('2d', { willReadFrequently: true });
  const small = canvasOf(GRID, GRID); const smallCtx = small.getContext('2d', { willReadFrequently: true });
  smallCtx.imageSmoothingEnabled = true; smallCtx.imageSmoothingQuality = 'high';

  const feature = (glyph) => {
    bigCtx.clearRect(0, 0, SIZE, SIZE);
    bigCtx.font = `${FONT}px ${EMOJI_FONT}`; bigCtx.textBaseline = 'alphabetic'; bigCtx.fillStyle = '#000';
    bigCtx.fillText(glyph, 10, 74);
    const px = bigCtx.getImageData(0, 0, SIZE, SIZE).data;
    let x0 = SIZE; let y0 = SIZE; let x1 = -1; let y1 = -1; let solid = 0; let colorful = 0;
    for (let y = 0; y < SIZE; y += 1) {
      for (let x = 0; x < SIZE; x += 1) {
        const i = (y * SIZE + x) * 4; const a = px[i + 3];
        if (a < 24) continue;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        if (a > 128) { solid += 1; const mx = Math.max(px[i], px[i + 1], px[i + 2]); const mn = Math.min(px[i], px[i + 1], px[i + 2]); if (mx > 40 && (mx - mn) / mx > 0.25) colorful += 1; }
      }
    }
    if (x1 < 0 || solid < 40) return null;
    const w = x1 - x0 + 1; const h = y1 - y0 + 1;
    smallCtx.clearRect(0, 0, GRID, GRID);
    smallCtx.drawImage(big, x0, y0, w, h, 0, 0, GRID, GRID);
    const d = smallCtx.getImageData(0, 0, GRID, GRID).data;
    const p = new Float32Array(GRID * GRID * 3); const a = new Float32Array(GRID * GRID);
    for (let i = 0, c = 0; i < d.length; i += 4, c += 1) {
      const alpha = d[i + 3] / 255; a[c] = alpha;
      p[c * 3] = d[i] * alpha; p[c * 3 + 1] = d[i + 1] * alpha; p[c * 3 + 2] = d[i + 2] * alpha;
    }
    return { p, a, ratio: w / h, colorRatio: colorful / solid };
  };
  const same = (one, two) => {
    let sum = 0;
    for (let i = 0; i < one.p.length; i += 1) sum += Math.abs(one.p[i] - two.p[i]);
    for (let i = 0; i < one.a.length; i += 1) sum += Math.abs(one.a[i] - two.a[i]) * 255;
    return sum / (one.a.length * 4 * 255);
  };

  const tofu = feature(String.fromCodePoint(0x10FFFD));
  const pool = [];
  let counter = 0;
  for (const [from, to] of RANGES) {
    for (let code = from; code <= to; code += 1) {
      const glyph = (code >= 0x2600 && code <= 0x27BF) || code === 0x2B50 || code === 0x2B55 ? `${String.fromCodePoint(code)}\uFE0F` : String.fromCodePoint(code);
      const f = feature(glyph);
      counter += 1;
      if (counter % 160 === 0) await tick(); // keep the window responsive while the set is prepared
      if (!f || f.colorRatio < 0.2) continue; // missing glyph or a monochrome text symbol
      if (tofu && same(f, tofu) < 0.02) continue; // the "unknown character" box
      pool.push({ glyph, code, p: f.p, a: f.a, ratio: f.ratio });
    }
  }
  return pool;
}

export function loadEmojiPool() {
  if (!poolPromise) poolPromise = buildPool().catch(() => { poolPromise = null; return []; });
  return poolPromise;
}

/* ---------- finding emoji-like blobs ---------- */

function median(list) {
  if (!list.length) return 0;
  const sorted = Array.from(list).sort((a, b) => a - b);
  return sorted[sorted.length >> 1];
}

function ringBackground(data, width, height, box) {
  const reds = []; const greens = []; const blues = [];
  const take = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const i = (y * width + x) * 4; reds.push(data[i]); greens.push(data[i + 1]); blues.push(data[i + 2]);
  };
  const pad = 3;
  for (let x = box.x - pad; x < box.x + box.w + pad; x += 1) for (let k = 1; k <= pad; k += 1) { take(x, box.y - k); take(x, box.y + box.h - 1 + k); }
  for (let y = box.y; y < box.y + box.h; y += 1) for (let k = 1; k <= pad; k += 1) { take(box.x - k, y); take(box.x + box.w - 1 + k, y); }
  if (!reds.length) return [255, 255, 255];
  return [median(reds), median(greens), median(blues)];
}

/** Coloured, emoji-sized, roughly square blobs. Returns boxes in canvas pixels. */
function findBlobs(imageData) {
  const { width, height, data } = imageData;
  const step = Math.max(1, Math.round(Math.max(width, height) / 1600));
  const w = Math.ceil(width / step); const h = Math.ceil(height / step);
  const sums = new Float64Array(4096 * 3); const counts = new Uint32Array(4096);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = ((y * step) * width + x * step) * 4;
      const bin = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
      counts[bin] += 1; sums[bin * 3] += data[i]; sums[bin * 3 + 1] += data[i + 1]; sums[bin * 3 + 2] += data[i + 2];
    }
  }
  let top = 0; for (let b = 1; b < 4096; b += 1) if (counts[b] > counts[top]) top = b;
  const bg = [sums[top * 3] / counts[top], sums[top * 3 + 1] / counts[top], sums[top * 3 + 2] / counts[top]];

  const mask = new Uint8Array(w * h);
  let colorful = 0;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = ((y * step) * width + x * step) * 4;
      const r = data[i]; const g = data[i + 1]; const b = data[i + 2];
      const mx = Math.max(r, g, b); const mn = Math.min(r, g, b);
      if (mx < 70 || (mx - mn) / mx < 0.38) continue;
      if (Math.abs(r - bg[0]) + Math.abs(g - bg[1]) + Math.abs(b - bg[2]) < 90) continue;
      mask[y * w + x] = 1; colorful += 1;
    }
  }
  if (!colorful || colorful > w * h * 0.3) return { boxes: [], step, bg }; // blank, or a colourful photo rather than text with emoji

  // Typical height of ordinary (non-coloured) characters. Emoji are taller than letters, coloured letters are not.
  const ink = new Uint8Array(w * h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (mask[y * w + x]) continue;
      const i = ((y * step) * width + x * step) * 4;
      if (Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]) >= 90) ink[y * w + x] = 1;
    }
  }
  const heights = [];
  const inkSeen = new Uint8Array(w * h);
  const inkStack = [];
  for (let start = 0; start < w * h; start += 1) {
    if (!ink[start] || inkSeen[start]) continue;
    let y0 = h; let y1 = -1; let x0 = w; let x1 = -1;
    inkStack.length = 0; inkStack.push(start); inkSeen[start] = 1;
    while (inkStack.length) {
      const at = inkStack.pop(); const x = at % w; const y = (at - x) / w;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x > 0 && ink[at - 1] && !inkSeen[at - 1]) { inkSeen[at - 1] = 1; inkStack.push(at - 1); }
      if (x < w - 1 && ink[at + 1] && !inkSeen[at + 1]) { inkSeen[at + 1] = 1; inkStack.push(at + 1); }
      if (y > 0 && ink[at - w] && !inkSeen[at - w]) { inkSeen[at - w] = 1; inkStack.push(at - w); }
      if (y < h - 1 && ink[at + w] && !inkSeen[at + w]) { inkSeen[at + w] = 1; inkStack.push(at + w); }
    }
    const bh = y1 - y0 + 1;
    if (bh >= 4 && bh <= h * 0.6 && x1 - x0 >= 1) heights.push(bh);
  }
  heights.sort((a, b) => a - b);
  const letterHeight = heights.length >= 4 ? heights[Math.floor(heights.length * 0.75)] : 0;
  const minSide = Math.max(8, letterHeight * 1.1);

  const dilated = new Uint8Array(w * h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (!mask[y * w + x]) continue;
      for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
        const nx = x + dx; const ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < w && ny < h) dilated[ny * w + nx] = 1;
      }
    }
  }

  const seen = new Uint8Array(w * h);
  const stack = [];
  const maxSide = Math.max(96, h * 0.6);
  const boxes = [];
  const fillOf = (x0, y0, x1, y1) => {
    let n = 0; for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) n += mask[y * w + x];
    return n / ((x1 - x0 + 1) * (y1 - y0 + 1));
  };
  const tighten = (x0, y0, x1, y1) => {
    let ax = x1; let ay = y1; let bx = x0; let by = y0; let any = false;
    for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) if (mask[y * w + x]) { any = true; if (x < ax) ax = x; if (x > bx) bx = x; if (y < ay) ay = y; if (y > by) by = y; }
    return any ? [ax, ay, bx, by] : null;
  };
  const accept = (x0, y0, x1, y1) => {
    const bw = x1 - x0 + 1; const bh = y1 - y0 + 1;
    if (Math.min(bw, bh) < minSide || Math.max(bw, bh) > maxSide) return false;
    const aspect = bw / bh;
    if (aspect < 0.45 || aspect > 1.9) return false;
    if (fillOf(x0, y0, x1, y1) < 0.5) return false;
    boxes.push({ x: x0 * step, y: y0 * step, w: Math.min(width - x0 * step, bw * step), h: Math.min(height - y0 * step, bh * step) });
    return true;
  };

  for (let start = 0; start < w * h && boxes.length < MAX_EMOJI; start += 1) {
    if (!dilated[start] || seen[start]) continue;
    let x0 = w; let y0 = h; let x1 = -1; let y1 = -1; let count = 0;
    stack.length = 0; stack.push(start); seen[start] = 1;
    while (stack.length) {
      const at = stack.pop(); const x = at % w; const y = (at - x) / w;
      if (mask[at]) { count += 1; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
        const nx = x + dx; const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const next = ny * w + nx;
        if (dilated[next] && !seen[next]) { seen[next] = 1; stack.push(next); }
      }
    }
    if (count < 30 || x1 < 0) continue;
    const bw = x1 - x0 + 1; const bh = y1 - y0 + 1;
    if (bw / bh <= 1.9) { accept(x0, y0, x1, y1); continue; }
    if (bw / bh > 14 || bh < minSide) continue; // a coloured underline or a line of coloured text, not emoji
    // A run of emoji that touch: split on empty columns, otherwise into equal squares.
    const runs = []; let runStart = -1;
    for (let x = x0; x <= x1 + 1; x += 1) {
      let any = false; if (x <= x1) for (let y = y0; y <= y1; y += 1) if (mask[y * w + x]) { any = true; break; }
      if (any && runStart < 0) runStart = x;
      if (!any && runStart >= 0) { runs.push([runStart, x - 1]); runStart = -1; }
    }
    const usable = runs.filter(([a, b]) => b - a + 1 >= bh * 0.4);
    if (usable.length >= 2) {
      for (const [a, b] of usable) { const t = tighten(a, y0, b, y1); if (t) accept(...t); }
    } else {
      const pieces = Math.round(bw / bh);
      if (pieces >= 2) for (let k = 0; k < pieces; k += 1) {
        const a = x0 + Math.round((bw * k) / pieces); const b = x0 + Math.round((bw * (k + 1)) / pieces) - 1;
        const t = tighten(a, y0, b, y1); if (t) accept(...t);
      }
    }
  }
  boxes.sort((a, b) => a.y - b.y || a.x - b.x);
  return { boxes, step, bg };
}

/* ---------- matching ---------- */

function matchBox(canvas, smallCtx, small, box, imageData, pool) {
  smallCtx.clearRect(0, 0, GRID, GRID);
  smallCtx.drawImage(canvas, box.x, box.y, box.w, box.h, 0, 0, GRID, GRID);
  const crop = smallCtx.getImageData(0, 0, GRID, GRID).data;
  const bg = ringBackground(imageData.data, imageData.width, imageData.height, box);
  const ratio = box.w / box.h;
  let best = null; let bestScore = Infinity; let bestDistance = Infinity;
  for (const item of pool) {
    let sum = 0;
    for (let c = 0, i = 0; c < GRID * GRID; c += 1, i += 4) {
      const inv = 1 - item.a[c];
      sum += Math.abs(item.p[c * 3] + inv * bg[0] - crop[i]) + Math.abs(item.p[c * 3 + 1] + inv * bg[1] - crop[i + 1]) + Math.abs(item.p[c * 3 + 2] + inv * bg[2] - crop[i + 2]);
    }
    const distance = sum / (GRID * GRID * 3 * 255) + 0.12 * Math.abs(Math.log(ratio / item.ratio));
    const score = POPULAR_SET.has(item.code) ? distance * 0.88 : distance;
    if (score < bestScore) { bestScore = score; bestDistance = distance; best = item; }
  }
  return best ? { glyph: best.glyph, distance: bestDistance, bg } : null;
}

/**
 * Finds emoji on `canvas` and returns { emojis, skipped }. Each emoji has left/top/width/height in canvas pixels.
 * Matched emoji are painted out of the canvas (so OCR ignores them); unmatched blobs are left untouched.
 */
export async function detectAndEraseEmoji(canvas, context) {
  try {
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    const { boxes } = findBlobs(imageData);
    if (!boxes.length) return { emojis: [], skipped: 0 };
    const pool = await loadEmojiPool();
    if (!pool.length) return { emojis: [], skipped: boxes.length };
    const small = canvasOf(GRID, GRID);
    const smallCtx = small.getContext('2d', { willReadFrequently: true });
    smallCtx.imageSmoothingEnabled = true; smallCtx.imageSmoothingQuality = 'high';
    const emojis = []; let skipped = 0;
    for (const box of boxes) {
      const match = matchBox(canvas, smallCtx, small, box, imageData, pool);
      if (match && match.distance <= ACCEPT_DISTANCE) emojis.push({ glyph: match.glyph, left: box.x, top: box.y, width: box.w, height: box.h, distance: match.distance, bg: match.bg });
      else skipped += 1;
    }
    for (const emoji of emojis) {
      context.fillStyle = `rgb(${emoji.bg.map(Math.round).join(',')})`;
      context.fillRect(emoji.left - 2, emoji.top - 2, emoji.width + 4, emoji.height + 4);
      delete emoji.bg;
    }
    return { emojis, skipped };
  } catch {
    return { emojis: [], skipped: 0 }; // emoji recovery is best-effort and must never break text extraction
  }
}

/* ---------- putting emoji back into the recognised text ---------- */

const hasLetterOrDigit = (text) => /[\p{L}\p{N}]/u.test(text);
const isJunk = (word) => word.text.length <= 2 && !hasLetterOrDigit(word.text) && word.confidence < 70;

/**
 * Returns a copy of an OCR result with emoji inserted at the line and position where they were found, and with stray
 * low-confidence punctuation specks (often the edge of an avatar or a button) removed from lines that have real words.
 */
export function mergeEmoji(result, emojis = [], skipped = 0) {
  if (!result?.available) return result;
  const paragraphs = (result.paragraphs || []).map((p) => ({ ...p, lines: [...p.lines] }));
  const groups = new Map();
  for (const word of result.words || []) {
    const key = `${word.paragraph}:${word.line}`;
    if (!groups.has(key)) groups.set(key, { p: word.paragraph - 1, l: word.line - 1, words: [], tokens: [], dirty: false });
    groups.get(key).words.push(word);
  }
  const dropped = new Set();
  for (const group of groups.values()) {
    const real = group.words.filter((word) => hasLetterOrDigit(word.text)).length;
    for (const word of group.words) if (real >= 2 && isJunk(word)) { dropped.add(word); group.dirty = true; }
    group.words = group.words.filter((word) => !dropped.has(word));
    group.top = Math.min(...group.words.map((w) => w.top), Infinity);
    group.bottom = Math.max(...group.words.map((w) => w.top + w.height), -Infinity);
    group.tokens = group.words.map((word) => ({ text: word.text, left: word.left, right: word.left + word.width, emoji: false }));
  }

  const orphans = [];
  for (const emoji of emojis) {
    const middle = emoji.top + emoji.height / 2;
    let target = null; let bestGap = Infinity;
    for (const group of groups.values()) {
      if (!Number.isFinite(group.top)) continue;
      const slack = (group.bottom - group.top) * 0.4;
      const gap = middle < group.top ? group.top - middle : middle > group.bottom ? middle - group.bottom : 0;
      if (gap <= slack && gap < bestGap) { bestGap = gap; target = group; }
    }
    if (target) { target.tokens.push({ text: emoji.glyph, left: emoji.left, right: emoji.left + emoji.width, emoji: true }); target.dirty = true; } else orphans.push(emoji);
  }

  for (const group of groups.values()) {
    if (!group.dirty) continue;
    const tokens = group.tokens.sort((a, b) => a.left - b.left);
    const height = Math.max(1, group.bottom - group.top);
    let text = '';
    tokens.forEach((token, index) => {
      if (index) {
        const previous = tokens[index - 1];
        const close = token.left - previous.right < height * 0.2;
        text += (token.emoji && previous.emoji) || (close && (token.emoji || previous.emoji)) ? '' : ' ';
      }
      text += token.text;
    });
    if (paragraphs[group.p]) paragraphs[group.p].lines[group.l] = text;
  }

  // Emoji that sit on a line of their own (a comment that is only emoji, or a reaction under the text).
  if (orphans.length) {
    const rows = [];
    for (const emoji of orphans) {
      const row = rows.find((r) => Math.abs(r.middle - (emoji.top + emoji.height / 2)) < Math.max(r.height, emoji.height) * 0.6);
      if (row) row.items.push(emoji); else rows.push({ middle: emoji.top + emoji.height / 2, height: emoji.height, items: [emoji] });
    }
    for (const row of rows) {
      const text = row.items.sort((a, b) => a.left - b.left).map((item) => item.glyph).join('');
      let best = -1; let bestGap = Infinity; let before = false;
      paragraphs.forEach((paragraph, index) => {
        const mine = [...groups.values()].filter((g) => g.p === index && Number.isFinite(g.top));
        if (!mine.length) return;
        const top = Math.min(...mine.map((g) => g.top)); const bottom = Math.max(...mine.map((g) => g.bottom));
        const gap = row.middle < top ? top - row.middle : row.middle > bottom ? row.middle - bottom : 0;
        if (gap < bestGap) { bestGap = gap; best = index; before = row.middle < top; }
      });
      if (best < 0) paragraphs.push({ lines: [text], confidence: 100 });
      else if (before) paragraphs[best].lines.unshift(text); else paragraphs[best].lines.push(text);
    }
  }

  const words = (result.words || []).filter((word) => !dropped.has(word));
  const wordCount = words.length;
  const confidence = wordCount ? Math.round(words.reduce((sum, w) => sum + w.confidence, 0) / wordCount * 10) / 10 : 0;
  const text = paragraphs.filter((p) => p.lines.length).map((p) => p.lines.join('\n')).join('\n\n');
  return {
    ...result, paragraphs: paragraphs.filter((p) => p.lines.length), words, text, wordCount, confidence,
    lowConfidenceWords: words.filter((w) => w.confidence < 60).length,
    emoji: emojis.map(({ glyph, left, top, width, height }) => ({ glyph, left, top, width, height })),
    emojiCount: emojis.length, emojiSkipped: skipped,
    warning: wordCount || emojis.length ? (wordCount ? result.warning : '') : result.warning,
  };
}
