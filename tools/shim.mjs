// Node harness shims so the REAL src/services/pdf/docx.js can run outside Electron.
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
const require = createRequire(import.meta.url);
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const napi = require('@napi-rs/canvas');
Promise.try ||= (fn, ...a) => new Promise((res) => res(fn(...a)));
Math.sumPrecise ||= (arr) => { let s = 0; for (const v of arr) s += v; return s; };
Uint8Array.prototype.toHex ||= function () { return Array.from(this, (b) => b.toString(16).padStart(2, '0')).join(''); };
Uint8Array.prototype.toBase64 ||= function () { return Buffer.from(this).toString('base64'); };
Uint8Array.fromBase64 ||= (s) => new Uint8Array(Buffer.from(s, 'base64'));
Uint8Array.fromHex ||= (s) => new Uint8Array(Buffer.from(s, 'hex'));
for (const C of [Map, WeakMap]) {
  C.prototype.getOrInsertComputed ||= function (k, fn) { if (!this.has(k)) this.set(k, fn(k)); return this.get(k); };
  C.prototype.getOrInsert ||= function (k, v) { if (!this.has(k)) this.set(k, v); return this.get(k); };
}
for (const k of ['Path2D', 'DOMMatrix', 'ImageData', 'Image']) if (napi[k] && !globalThis[k]) globalThis[k] = napi[k];
globalThis.window = globalThis;
globalThis.window.location = { href: pathToFileURL(path.join(root, 'public') + path.sep).href };
globalThis.document = { createElement: () => napi.createCanvas(1, 1) };
export const docxModule = () => import(pathToFileURL(path.join(root, 'src/services/pdf/docx.js')).href);
