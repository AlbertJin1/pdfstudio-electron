'use strict';
/**
 * Built-in image-to-text (OCR) engine. Runs Tesseract compiled to WebAssembly (tesseract.js) in a worker thread,
 * entirely offline: the English model ships inside the app and more models can be dropped into
 * resources/ocr/tessdata (or %TESSDATA_PREFIX%). Nothing is downloaded and nothing leaves the computer.
 */
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { promisify } = require('node:util');
const gunzip = promisify(zlib.gunzip);

const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const IDLE_MS = 90 * 1000;
const LANGUAGE_CODE = /^[a-z]{3}(?:_[a-z]{3,5})?$/;
const LANGUAGE_LABELS = {
  eng: 'English', fil: 'Filipino (Tagalog)', ceb: 'Cebuano', spa: 'Spanish', fra: 'French', deu: 'German', ita: 'Italian', por: 'Portuguese',
  nld: 'Dutch', rus: 'Russian', ukr: 'Ukrainian', pol: 'Polish', tur: 'Turkish', ara: 'Arabic', heb: 'Hebrew', hin: 'Hindi', ben: 'Bengali',
  tha: 'Thai', vie: 'Vietnamese', ind: 'Indonesian', msa: 'Malay', jpn: 'Japanese', kor: 'Korean', chi_sim: 'Chinese (Simplified)',
  chi_tra: 'Chinese (Traditional)', ell: 'Greek', swe: 'Swedish', nor: 'Norwegian', dan: 'Danish', fin: 'Finnish', ces: 'Czech', ron: 'Romanian',
};
const PSM = { auto: '3', block: '6', column: '4', line: '7', sparse: '11' };

const workers = new Map(); // language key -> { promise, timer }
let queue = Promise.resolve();

const unpacked = (file) => {
  const alt = file.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
  try { if (alt !== file && fs.existsSync(alt)) return alt; } catch { /* use original */ }
  return file;
};

function packageDir(name) {
  try { return path.dirname(require.resolve(`${name}/package.json`)); } catch { /* try main entry */ }
  try {
    const main = require.resolve(name);
    let dir = path.dirname(main);
    for (let i = 0; i < 4; i += 1) { if (fs.existsSync(path.join(dir, 'package.json'))) return dir; dir = path.dirname(dir); }
  } catch { /* not installed */ }
  return null;
}

function extraDirs(ctx = {}) {
  const list = [];
  const add = (dir) => { if (dir && !list.includes(dir)) list.push(dir); };
  if (ctx.resourcesPath) add(path.join(ctx.resourcesPath, 'ocr', 'tessdata'));
  if (ctx.projectRoot) add(path.join(ctx.projectRoot, 'resources', 'ocr', 'tessdata'));
  if (ctx.userDataPath) add(path.join(ctx.userDataPath, 'ocr', 'tessdata'));
  const prefix = process.env.TESSDATA_PREFIX;
  if (prefix) { add(prefix); add(path.join(prefix, 'tessdata')); }
  return list.map((dir) => unpacked(dir));
}

function findLanguageFile(code, ctx) {
  for (const dir of extraDirs(ctx)) {
    for (const suffix of ['.traineddata', '.traineddata.gz']) {
      const file = path.join(dir, `${code}${suffix}`);
      if (fs.existsSync(file)) return { file, gz: suffix.endsWith('.gz') };
    }
  }
  const pkg = packageDir(`@tesseract.js-data/${code}`);
  if (pkg) {
    for (const variant of ['4.0.0_best_int', '4.0.0', '4.0.0_fast']) {
      const file = unpacked(path.join(pkg, variant, `${code}.traineddata.gz`));
      if (fs.existsSync(file)) return { file, gz: true };
    }
  }
  return null;
}

function listLanguages(ctx = {}) {
  const codes = new Set();
  for (const dir of extraDirs(ctx)) {
    let entries = [];
    try { entries = fs.readdirSync(dir); } catch { continue; }
    for (const name of entries) {
      const match = name.match(/^([a-z]{3}(?:_[a-z]{3,5})?)\.traineddata(?:\.gz)?$/);
      if (match && !['osd', 'equ'].includes(match[1])) codes.add(match[1]);
    }
  }
  for (const bundled of ['eng', 'fil', 'ceb']) if (packageDir(`@tesseract.js-data/${bundled}`)) codes.add(bundled);
  return [...codes].sort((a, b) => (a === 'eng' ? -1 : b === 'eng' ? 1 : a.localeCompare(b)))
    .map((code) => ({ code, label: LANGUAGE_LABELS[code] || code }));
}

async function stageLanguage(code, ctx) {
  const source = findLanguageFile(code, ctx);
  if (!source) {
    const error = new Error(`The "${LANGUAGE_LABELS[code] || code}" OCR language model is not installed. Put ${code}.traineddata in resources/ocr/tessdata.`);
    error.code = 'OCR_LANGUAGE_MISSING';
    throw error;
  }
  const stageDir = path.join(os.tmpdir(), `pdfstudio-ocr-models-${typeof process.getuid === 'function' ? process.getuid() : 'user'}`);
  await fsp.mkdir(stageDir, { recursive: true, mode: 0o700 });
  const target = path.join(stageDir, `${code}.traineddata`);
  const [srcStat, dstStat] = await Promise.all([fsp.stat(source.file), fsp.stat(target).catch(() => null)]);
  if (!dstStat || dstStat.size === 0 || dstStat.mtimeMs < srcStat.mtimeMs) {
    const raw = await fsp.readFile(source.file);
    const data = source.gz ? await gunzip(raw) : raw;
    const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
    await fsp.writeFile(temp, data, { mode: 0o600 });
    await fsp.rename(temp, target);
  }
  return stageDir;
}

function normalizeLanguage(language) {
  const codes = String(language || 'eng').split('+').map((part) => part.trim()).filter(Boolean);
  if (!codes.length || codes.length > 4 || !codes.every((code) => LANGUAGE_CODE.test(code))) throw new TypeError('Choose a supported OCR language.');
  return [...new Set(codes)];
}

function dropWorker(key) {
  const entry = workers.get(key);
  if (!entry) return;
  workers.delete(key);
  clearTimeout(entry.timer);
  entry.promise.then((worker) => worker.terminate()).catch(() => {});
}

async function getWorker(codes, ctx) {
  const key = codes.join('+');
  let entry = workers.get(key);
  if (!entry) {
    entry = {
      timer: null,
      promise: (async () => {
        const { createWorker } = require('tesseract.js');
        const stageDir = await stageLanguage(codes[0], ctx);
        for (const code of codes.slice(1)) await stageLanguage(code, ctx);
        const base = packageDir('tesseract.js');
        const workerPath = base ? unpacked(path.join(base, 'src', 'worker-script', 'node', 'index.js')) : undefined;
        return createWorker(codes, 1, {
          ...(workerPath ? { workerPath } : {}),
          langPath: stageDir, cachePath: stageDir, cacheMethod: 'readOnly', gzip: false, errorHandler: () => {},
        });
      })(),
    };
    workers.set(key, entry);
    entry.promise.catch(() => { if (workers.get(key) === entry) workers.delete(key); });
  }
  clearTimeout(entry.timer);
  entry.timer = setTimeout(() => dropWorker(key), IDLE_MS);
  entry.timer.unref?.();
  return { key, worker: await entry.promise };
}

function buildResult(data, codes) {
  const words = [];
  const paragraphs = [];
  let blockIndex = 0;
  for (const block of data.blocks || []) {
    blockIndex += 1;
    for (const paragraph of block.paragraphs || []) {
      // Numbered by position in the returned `paragraphs` array so word.paragraph/word.line map straight to paragraphs[p-1].lines[l-1].
      const paragraphIndex = paragraphs.length + 1;
      const lines = [];
      let lineIndex = 0;
      for (const line of paragraph.lines || []) {
        const text = String(line.text || '').replace(/\s+$/g, '').trim();
        if (!text) continue;
        lineIndex += 1;
        lines.push(text);
        for (const word of line.words || []) {
          const w = String(word.text || '').trim();
          const box = word.bbox || {};
          if (!w || !Number.isFinite(box.x0 + box.y0 + box.x1 + box.y1)) continue;
          words.push({
            text: w.slice(0, 200), left: Math.max(0, Math.round(box.x0)), top: Math.max(0, Math.round(box.y0)),
            width: Math.max(1, Math.round(box.x1 - box.x0)), height: Math.max(1, Math.round(box.y1 - box.y0)),
            confidence: Math.round(Number(word.confidence || 0) * 10) / 10, block: blockIndex, paragraph: paragraphIndex, line: lineIndex,
          });
        }
      }
      if (lines.length) paragraphs.push({ lines, confidence: Math.round(Number(paragraph.confidence || 0) * 10) / 10 });
    }
  }
  const text = paragraphs.map((p) => p.lines.join('\n')).join('\n\n');
  const meanConfidence = words.length ? Math.round(words.reduce((sum, w) => sum + w.confidence, 0) / words.length * 10) / 10 : 0;
  return {
    available: true, engine: 'Tesseract OCR (built-in)', language: codes.join('+'), text, paragraphs, words,
    wordCount: words.length, confidence: meanConfidence, lowConfidenceWords: words.filter((w) => w.confidence < 60).length,
    warning: words.length ? '' : 'No readable text was found. Try the "Document / scan" enhancement, a different language, or rotate the image.',
  };
}

function recognizeImage(imageData, options = {}) {
  const image = Buffer.isBuffer(imageData) ? imageData : Buffer.from(imageData || []);
  if (!image.length || image.length > MAX_IMAGE_BYTES) return Promise.reject(new TypeError('The image must be between 1 byte and 25 MB.'));
  const codes = normalizeLanguage(options.language);
  const pageSegMode = PSM[options.psm] || PSM.auto;
  const run = async () => {
    let handle;
    try { handle = await getWorker(codes, options); } catch (error) {
      if (error?.code === 'OCR_LANGUAGE_MISSING') return { available: false, words: [], text: '', paragraphs: [], confidence: 0, engine: '', language: codes.join('+'), warning: error.message };
      throw error;
    }
    try {
      await handle.worker.setParameters({ tessedit_pageseg_mode: pageSegMode, preserve_interword_spaces: '1', user_defined_dpi: '300' });
      const timeoutMs = Math.max(10000, Math.min(240000, Number(options.timeoutMs) || 120000));
      let timer;
      const timeout = new Promise((_, reject) => { timer = setTimeout(() => { dropWorker(handle.key); reject(new Error('OCR timed out. Try a smaller image or a simpler layout mode.')); }, timeoutMs); });
      try {
        const result = await Promise.race([handle.worker.recognize(image, {}, { blocks: true, text: true }), timeout]);
        return buildResult(result.data, codes);
      } finally { clearTimeout(timer); }
    } catch (error) {
      dropWorker(handle.key); // a failed worker is replaced on the next request
      throw error;
    }
  };
  const job = queue.then(run, run);
  queue = job.catch(() => {});
  return job;
}

async function shutdown() {
  for (const key of [...workers.keys()]) dropWorker(key);
}

module.exports = { recognizeImage, listLanguages, shutdown, normalizeLanguage, buildResult, PSM, LANGUAGE_LABELS };
