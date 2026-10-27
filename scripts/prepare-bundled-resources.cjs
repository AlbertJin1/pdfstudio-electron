'use strict';

/**
 * Stage only runtime resources that should ship in the single-file portable build.
 *
 * Default policy:
 *  - OCR: if a local Tesseract runtime has been staged, include its executable/DLLs
 *    and only English + Traditional Chinese traineddata (when present).
 *  - Ghostscript: use the existing bundled WASM engine; native Ghostscript is an
 *    optional accelerator and is excluded from the default portable EXE.
 *
 * Opt-ins:
 *  - PDFSTUDIO_OCR_LANGS=eng,chi_tra,jpn,... : choose exact models to bundle.
 *  - PDFSTUDIO_OCR_LANGS=all                : bundle every *.traineddata model.
 *  - PDFSTUDIO_BUNDLE_OCR=0                 : exclude Tesseract and all OCR data.
 *  - PDFSTUDIO_BUNDLE_NATIVE_GHOSTSCRIPT=1   : include a staged native GS runtime.
 *
 * This avoids unintentionally packaging entire tessdata collections and duplicate
 * native Ghostscript distributions into every portable EXE.
 */
const fs = require('node:fs');
const path = require('node:path');

function remove(target) {
  fs.rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
function copyFile(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}
function copyTree(source, target, filter = () => true) {
  if (!fs.existsSync(source)) return 0;
  let count = 0;
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    const relative = path.relative(source, from).replace(/\\/g, '/');
    if (entry.isDirectory()) {
      count += copyTree(from, to, (child) => filter(`${relative}/${child}`));
    } else if (entry.isFile() && filter(relative)) {
      copyFile(from, to);
      count += 1;
    }
  }
  return count;
}
function parseLanguages(value) {
  const normalized = String(value || 'eng,chi_tra').trim().toLowerCase();
  if (normalized === 'all' || normalized === '*') return 'all';
  const languages = [...new Set(normalized.split(/[\s,;]+/).map((item) => item.trim()).filter(Boolean))];
  for (const language of languages) {
    if (!/^[a-z0-9_]+$/.test(language)) throw new Error(`Invalid OCR language code: ${language}`);
  }
  return languages;
}
function walkModelFiles(root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.traineddata'))
    .map((entry) => entry.name.slice(0, -'.traineddata'.length));
}
function prepareBundleResources(root = path.resolve(__dirname, '..'), env = process.env) {
  const sourceOcr = path.join(root, 'resources', 'ocr');
  const sourceGs = path.join(root, 'resources', 'ghostscript');
  const stageRoot = path.join(root, 'build-resources');
  const stageOcr = path.join(stageRoot, 'ocr');
  const stageGs = path.join(stageRoot, 'ghostscript');
  remove(stageRoot);
  fs.mkdirSync(stageOcr, { recursive: true });
  fs.mkdirSync(stageGs, { recursive: true });

  let ocrFiles = 0;
  const ocrEnabled = String(env.PDFSTUDIO_BUNDLE_OCR ?? '1').trim() !== '0';
  const languages = parseLanguages(env.PDFSTUDIO_OCR_LANGS);
  const tessdata = path.join(sourceOcr, 'tessdata');
  const tesseractExe = path.join(sourceOcr, 'tesseract.exe');
  const haveTesseract = fs.existsSync(tesseractExe);
  const availableModels = walkModelFiles(tessdata);
  const selectedModels = languages === 'all'
    ? availableModels
    : languages.filter((language) => availableModels.includes(language));

  if (ocrEnabled && haveTesseract && selectedModels.length > 0) {
    ocrFiles += copyTree(sourceOcr, stageOcr, (relative) => {
      const rel = relative.replace(/\\/g, '/');
      // Keep the Tesseract executable, root runtime DLLs, and license notices only.
      if (/^tesseract\.exe$/i.test(rel) || /^[^/]+\.dll$/i.test(rel) || /^(?:LICENSE|COPYING|NOTICE)(?:\..*)?$/i.test(rel)) return true;
      // Language data is the major optional OCR size contributor. Default to two common languages.
      const model = rel.match(/^tessdata\/([^/]+)\.traineddata$/i);
      if (model) return languages === 'all' || selectedModels.includes(model[1]);
      // Tesseract uses small config folders for its TSV output; preserve them but not extra models.
      if (/^tessdata\/(?:configs|tessconfigs)\//i.test(rel)) return true;
      return false;
    });
  } else if (!ocrEnabled) {
    console.log('[size] OCR bundling disabled by PDFSTUDIO_BUNDLE_OCR=0.');
  } else if (!haveTesseract) {
    console.log('[size] No resources/ocr/tesseract.exe found; OCR can still use PDFSTUDIO_TESSERACT_PATH or system PATH.');
  } else {
    console.log(`[size] Tesseract found but none of the selected language models are staged (${languages === 'all' ? 'no .traineddata files found' : selectedModels.join(', ') || 'requested models missing'}); OCR runtime omitted to avoid shipping an unusable engine.`);
  }

  let gsFiles = 0;
  const bundleNativeGs = String(env.PDFSTUDIO_BUNDLE_NATIVE_GHOSTSCRIPT || '').trim() === '1';
  if (bundleNativeGs) {
    gsFiles = copyTree(sourceGs, stageGs, (relative) => !/^README\.md$/i.test(relative));
  } else {
    console.log('[size] Native Ghostscript excluded; built-in Ghostscript WASM remains available as fallback.');
  }

  const summarize = (folder) => {
    let bytes = 0;
    if (!fs.existsSync(folder)) return bytes;
    const visit = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) visit(full);
        else if (entry.isFile()) bytes += fs.statSync(full).size;
      }
    };
    visit(folder);
    return bytes;
  };
  const toMiB = (bytes) => (bytes / 1024 / 1024).toFixed(1);
  console.log(`[size] Staged OCR: ${ocrFiles} files, ${toMiB(summarize(stageOcr))} MiB${ocrFiles ? `; languages: ${selectedModels.join(', ')}` : ''}.`);
  console.log(`[size] Staged native Ghostscript: ${gsFiles} files, ${toMiB(summarize(stageGs))} MiB.`);
  return { ocrFiles, gsFiles, selectedModels, stageOcr, stageGs };
}

if (require.main === module) {
  try { prepareBundleResources(); }
  catch (error) { console.error(`[size] Resource staging failed: ${error.message}`); process.exitCode = 1; }
}

module.exports = { prepareBundleResources, parseLanguages };
