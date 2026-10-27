'use strict';

const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_TSV_BYTES = 24 * 1024 * 1024;
const LANGUAGE_PATTERN = /^(?:eng|chi_tra|chi_sim|jpn|kor|fra|deu|spa|ita|por|vie|tha|ind|eng\+(?:chi_tra|chi_sim|jpn|kor|fra|deu|spa|ita|por|vie|tha|ind)|(?:chi_tra|chi_sim|jpn|kor|fra|deu|spa|ita|por|vie|tha|ind)\+eng)$/;

function isPng(bytes) {
  return bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
}
function isJpeg(bytes) { return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff; }
function isWebp(bytes) { return bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'; }

function parseTesseractTsv(tsv) {
  const lines = String(tsv || '').split(/\r?\n/);
  if (!lines.length) return [];
  const words = [];
  for (let index = 1; index < lines.length; index += 1) {
    const row = lines[index];
    if (!row) continue;
    // Tesseract's TSV has 12 fields. The text field is last and can contain spaces,
    // so parse the first 11 tab-separated fields separately.
    const columns = row.split('\t');
    if (columns.length < 12) continue;
    const level = Number(columns[0]);
    const left = Number(columns[6]);
    const top = Number(columns[7]);
    const width = Number(columns[8]);
    const height = Number(columns[9]);
    const confidence = Number(columns[10]);
    const text = columns.slice(11).join('\t').trim();
    if (level !== 5 || !text || !Number.isFinite(left + top + width + height + confidence) || width <= 0 || height <= 0) continue;
    if (confidence < 0) continue;
    words.push({
      text: text.slice(0, 200), left: Math.max(0, Math.round(left)), top: Math.max(0, Math.round(top)),
      width: Math.round(width), height: Math.round(height), confidence: Math.round(confidence * 10) / 10,
      block: Number(columns[2]) || 0, paragraph: Number(columns[3]) || 0, line: Number(columns[4]) || 0,
    });
  }
  return words;
}

function candidates({ resourcesPath, projectRoot, env = process.env, platform = process.platform }) {
  const list = [];
  const envPath = String(env.PDFSTUDIO_TESSERACT_PATH || '').trim();
  if (envPath) list.push(envPath);
  if (resourcesPath) list.push(path.join(resourcesPath, 'ocr', platform === 'win32' ? 'tesseract.exe' : 'tesseract'));
  if (projectRoot) list.push(path.join(projectRoot, 'resources', 'ocr', platform === 'win32' ? 'tesseract.exe' : 'tesseract'));
  list.push(platform === 'win32' ? 'tesseract.exe' : 'tesseract');
  return [...new Set(list)];
}

function runTesseract(executable, args, options = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(executable, args, {
        windowsHide: true,
        cwd: options.cwd,
        env: options.env || process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) { reject(error); return; }
    const stdout = [];
    let stdoutBytes = 0;
    let stderr = '';
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error); else resolve(value);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(new Error('OCR timed out. Try a lower page resolution or fewer pages.'));
    }, Math.max(5000, Math.min(180000, Number(options.timeoutMs) || 90000)));
    child.stdout.on('data', (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_TSV_BYTES) {
        child.kill();
        finish(new Error('OCR generated an unexpectedly large result.'));
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on('data', (chunk) => { if (stderr.length < 12000) stderr += chunk.toString('utf8').slice(0, 12000 - stderr.length); });
    child.on('error', (error) => finish(error));
    child.on('close', (code) => {
      if (code === 0) finish(null, { tsv: Buffer.concat(stdout).toString('utf8'), stderr });
      else finish(new Error(stderr.trim() || `Tesseract OCR exited with code ${code}.`));
    });
  });
}

async function recognizeImage(imageData, { language = 'eng', resourcesPath, projectRoot, timeoutMs } = {}) {
  const image = Buffer.isBuffer(imageData) ? imageData : Buffer.from(imageData || []);
  if (!image.length || image.length > MAX_IMAGE_BYTES) throw new TypeError('OCR image must be between 1 byte and 25 MB.');
  if (!isPng(image) && !isJpeg(image) && !isWebp(image)) throw new TypeError('OCR accepts rendered PNG, JPEG, or WebP images only.');
  const lang = String(language || 'eng');
  if (!LANGUAGE_PATTERN.test(lang)) throw new TypeError('Choose a supported OCR language combination.');

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pdfstudio-ocr-'));
  const inputPath = path.join(tempDir, `page${isPng(image) ? '.png' : isJpeg(image) ? '.jpg' : '.webp'}`);
  const tessdataCandidates = [
    resourcesPath && path.join(resourcesPath, 'ocr', 'tessdata'),
    projectRoot && path.join(projectRoot, 'resources', 'ocr', 'tessdata'),
    process.env.TESSDATA_PREFIX,
  ].filter(Boolean);
  try {
    await fs.writeFile(inputPath, image, { flag: 'wx', mode: 0o600 });
    let lastError;
    for (const executable of candidates({ resourcesPath, projectRoot })) {
      if (path.isAbsolute(executable) && !fsSync.existsSync(executable)) continue;
      const args = [inputPath, 'stdout', '-l', lang, '--psm', '6', 'tsv'];
      const requiredModels = lang.split('+').map((code) => `${code}.traineddata`);
      const tessdataDir = tessdataCandidates.find((candidate) => requiredModels.every((model) => fsSync.existsSync(path.join(candidate, model))));
      if (tessdataDir) args.push('--tessdata-dir', tessdataDir);
      const env = { ...process.env, OMP_THREAD_LIMIT: '2' };
      if (tessdataDir) env.TESSDATA_PREFIX = tessdataDir;
      try {
        const result = await runTesseract(executable, args, { cwd: tempDir, env, timeoutMs });
        const words = parseTesseractTsv(result.tsv);
        return {
          available: true, words,
          confidence: words.length ? Math.round(words.reduce((sum, word) => sum + word.confidence, 0) / words.length * 10) / 10 : 0,
          engine: 'Tesseract OCR', language: lang,
          warning: words.length ? '' : 'OCR completed but no readable words were found. Check the language model or scan quality.',
        };
      } catch (error) {
        lastError = error;
        // A missing executable can be skipped; a configured executable failing to load a
        // language model is returned as a meaningful error rather than trying a different engine.
        if (error?.code && error.code !== 'ENOENT') break;
        if (/traineddata|language|failed loading/i.test(error?.message || '')) break;
      }
    }
    const notInstalled = lastError?.code === 'ENOENT' || !lastError;
    return {
      available: false, words: [], confidence: 0, engine: '', language: lang,
      warning: notInstalled
        ? 'Tesseract OCR is not installed. Put tesseract.exe, its DLL files, and the selected *.traineddata language models in resources/ocr, or set PDFSTUDIO_TESSERACT_PATH.'
        : `OCR could not run: ${String(lastError?.message || 'unknown error').slice(0, 500)}`,
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = { parseTesseractTsv, recognizeImage, candidates };
