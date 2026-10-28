import assert from 'node:assert/strict';
import { mergeEmoji } from '../src/services/emoji.js';
import { createRequire } from 'node:module';
const { buildResult } = createRequire(import.meta.url)('../electron/services/image-text-extractor.cjs');

const w = (text, left, top, line, confidence = 90, paragraph = 1) => ({ text, left, top, width: text.length * 12, height: 30, confidence, paragraph, line });
const base = (words, lines) => ({ available: true, text: lines.join('\n'), paragraphs: [{ lines, confidence: 90 }], words, wordCount: words.length, confidence: 90, lowConfidenceWords: 0, warning: '' });

// Emoji lands at the end of the right line, and the OCR junk for it ("&)") is not needed any more.
let result = mergeEmoji(base([w('Vin', 40, 0, 1), w('Vicente', 90, 0, 1), w('Tanungin', 0, 50, 2), w('bato', 120, 50, 2)], ['Vin Vicente', 'Tanungin bato']),
  [{ glyph: '🤣', left: 190, top: 48, width: 34, height: 34 }]);
assert.equal(result.text, 'Vin Vicente\nTanungin bato 🤣');
assert.equal(result.emojiCount, 1);

// Emoji in the middle of a line, several in a row stay in reading order, close ones are not space separated.
result = mergeEmoji(base([w('hello', 0, 0, 1), w('world', 200, 0, 1)], ['hello world']),
  [{ glyph: '😭', left: 100, top: 0, width: 30, height: 30 }, { glyph: '🔥', left: 132, top: 0, width: 30, height: 30 }]);
assert.equal(result.text, 'hello 😭🔥 world');

// Stray low-confidence punctuation (avatar edge) is removed, real punctuation survives.
result = mergeEmoji(base([w(')', 0, 0, 1, 31), w('Vin', 60, 0, 1), w('Vicente', 110, 0, 1), w('!', 200, 0, 1, 95)], [') Vin Vicente !']), []);
assert.equal(result.text, 'Vin Vicente !');
assert.equal(result.wordCount, 3);

// An emoji on its own line (reaction below the text) and an emoji-only image.
result = mergeEmoji(base([w('nice', 0, 0, 1)], ['nice']), [{ glyph: '👍', left: 0, top: 120, width: 30, height: 30 }]);
assert.equal(result.text, 'nice\n👍');
result = mergeEmoji({ available: true, text: '', paragraphs: [], words: [], wordCount: 0, confidence: 0, lowConfidenceWords: 0, warning: 'No readable text was found.' },
  [{ glyph: '😂', left: 10, top: 10, width: 30, height: 30 }, { glyph: '😂', left: 50, top: 10, width: 30, height: 30 }]);
assert.equal(result.text, '😂😂');
assert.equal(result.warning, '');

// Nothing changes when there are no emoji and nothing to clean.
const plain = base([w('plain', 0, 0, 1)], ['plain']);
assert.equal(mergeEmoji(plain, []).text, 'plain');

// word.paragraph / word.line index straight into paragraphs[p-1].lines[l-1], even when an empty paragraph precedes.
const built = buildResult({ blocks: [{ paragraphs: [
  { confidence: 90, lines: [{ text: '  ', words: [] }] },
  { confidence: 90, lines: [{ text: 'real text', words: [{ text: 'real', confidence: 90, bbox: { x0: 0, y0: 0, x1: 40, y1: 20 } }, { text: 'text', confidence: 90, bbox: { x0: 50, y0: 0, x1: 90, y1: 20 } }] }] },
] }] }, ['eng']);
assert.equal(built.words[0].paragraph, 1);
assert.equal(built.paragraphs[built.words[0].paragraph - 1].lines[built.words[0].line - 1], 'real text');
console.log('Emoji merge checks passed.');
