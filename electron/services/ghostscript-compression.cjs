const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Worker } = require('node:worker_threads');

let engineInfoPromise;

function uniqueCandidates() {
  const candidates = [];
  const add = (value) => { if (value && !candidates.includes(value)) candidates.push(value); };
  const win = process.platform === 'win32';
  const names = win ? ['gswin64c.exe', 'gswin32c.exe', 'gs.exe'] : ['gs'];
  const resourceRoot = process.resourcesPath || path.resolve(__dirname, '..', '..', 'resources');
  for (const name of names) add(path.join(resourceRoot, 'ghostscript', 'bin', name));
  add(path.join(path.resolve(__dirname, '..', '..'), 'resources', 'ghostscript', 'bin', names[0]));
  // Explicit override: GHOSTSCRIPT_PATH may point at the executable or at its folder.
  const override = process.env.GHOSTSCRIPT_PATH || process.env.PDFSTUDIO_GHOSTSCRIPT;
  if (override) { add(override); for (const name of names) add(path.join(override, name)); }
  for (const folder of String(process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
    for (const name of names) add(path.join(folder, name));
  }
  // Default install locations. The official Windows installer does NOT add Ghostscript to PATH.
  const roots = win
    ? [process.env.ProgramW6432, process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs')].filter(Boolean)
    : [];
  for (const root of roots) {
    for (const vendor of ['gs', 'Ghostscript', 'Artifex Software']) {
      const base = path.join(root, vendor);
      let versions = [];
      try { versions = fsSync.readdirSync(base).filter((entry) => /^gs\d/i.test(entry)); } catch { continue; }
      versions.sort((a, b) => b.localeCompare(a, undefined, { numeric: true })); // newest first
      for (const version of versions) for (const name of names) add(path.join(base, version, 'bin', name));
    }
  }
  if (!win) for (const folder of ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/snap/bin']) add(path.join(folder, 'gs'));
  return candidates;
}

async function resolveExecutable() {
  for (const candidate of uniqueCandidates()) {
    try {
      const stat = await fs.stat(candidate);
      if (stat.isFile()) return candidate;
    } catch { /* next candidate */ }
  }
  return null;
}

function execute(executable, args, { timeoutMs = 300000, cwd, maxStderr = 12000 } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let stderr = '';
    let stdout = '';
    const child = spawn(executable, args, { cwd, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error); else resolve(value);
    };
    child.stdout.on('data', (chunk) => { if (stdout.length < 4000) stdout += chunk.toString('utf8').slice(0, 4000 - stdout.length); });
    child.stderr.on('data', (chunk) => { if (stderr.length < maxStderr) stderr += chunk.toString('utf8').slice(0, maxStderr - stderr.length); });
    child.on('error', (error) => finish(error));
    child.on('close', (code, signal) => {
      if (code === 0) finish(null, { code, stdout, stderr });
      else {
        const detail = stderr.trim().split(/\r?\n/).filter(Boolean).slice(-8).join(' ').slice(0, 1800);
        const error = new Error(detail || `Ghostscript exited with code ${code ?? signal ?? 'unknown'}.`);
        error.code = code;
        finish(error);
      }
    });
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* ignored */ }
      const error = new Error('Smart PDF compression timed out. Try a smaller file or a less intensive preset.');
      error.code = 'ETIMEDOUT';
      finish(error);
    }, timeoutMs);
    timer.unref?.();
  });
}

const BUNDLED_VERSION = '9.56'; // matches the pinned @jspawn/ghostscript-wasm release

/* ---- Bundled engine: Ghostscript compiled to WebAssembly (no install, ships inside the app) ---- */
function unpacked(file) {
  // Files listed under build.asarUnpack live next to app.asar; prefer the real file when it exists.
  const alt = file.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
  try { if (alt !== file && fsSync.statSync(alt).isFile()) return alt; } catch { /* use the original path */ }
  return file;
}

function resolveBundled() {
  try {
    const modulePath = unpacked(require.resolve('@jspawn/ghostscript-wasm'));
    const wasmPath = path.join(path.dirname(modulePath), 'gs.wasm');
    if (!fsSync.existsSync(wasmPath)) return null;
    return { modulePath, wasmPath, workerPath: unpacked(path.join(__dirname, 'ghostscript-wasm-worker.cjs')) };
  } catch { return null; }
}

function runBundled({ files = [], args = [], outputName, timeoutMs = 300000 }) {
  const bundled = resolveBundled();
  if (!bundled) return Promise.reject(Object.assign(new Error('The bundled Ghostscript engine is missing from this build.'), { code: 'PDFSTUDIO_GHOSTSCRIPT_UNAVAILABLE' }));
  return new Promise((resolve, reject) => {
    let settled = false;
    let worker;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { worker?.terminate(); } catch { /* already gone */ }
      if (error) reject(error); else resolve(value);
    };
    const timer = setTimeout(() => finish(Object.assign(new Error('Smart PDF compression timed out. Try a smaller file or a less intensive preset.'), { code: 'ETIMEDOUT' })), timeoutMs);
    timer.unref?.();
    try {
      const wasmBytes = fsSync.readFileSync(bundled.wasmPath);
      worker = new Worker(bundled.workerPath, { workerData: { modulePath: bundled.modulePath, wasmBytes, files, args, outputName } });
    } catch (error) { return finish(error); }
    worker.once('message', (message) => (message?.ok ? finish(null, message) : finish(new Error(message?.error || 'Bundled Ghostscript failed.'))));
    worker.once('error', (error) => finish(error));
    worker.once('exit', (code) => { if (!settled) finish(new Error(`Bundled Ghostscript stopped unexpectedly (code ${code}).`)); });
  });
}

async function getGhostscriptInfo() {
  if (!engineInfoPromise) {
    engineInfoPromise = (async () => {
      const executable = await resolveExecutable();
      if (!executable && resolveBundled()) {
        try {
          await runBundled({ args: ['--version'], timeoutMs: 30000 }); // proves the engine starts on this machine
          return { available: true, engine: 'Ghostscript pdfwrite', version: `${BUNDLED_VERSION} built-in`, executable: null, bundled: true };
        } catch (error) { return { available: false, engine: null, version: null, reason: `The bundled Ghostscript engine could not start: ${error.message}` }; }
      }
      if (!executable) return { available: false, engine: null, version: null, reason: 'Ghostscript was not found. Lossless optimization remains available; image-aware compression requires Ghostscript (install it, or set GHOSTSCRIPT_PATH).' };
      try {
        const result = await execute(executable, ['-version'], { timeoutMs: 10000, maxStderr: 1000 });
        const version = `${result.stdout}\n${result.stderr}`.trim().split(/\r?\n/)[0] || 'Version unknown';
        return { available: true, engine: 'Ghostscript pdfwrite', version, executable };
      } catch (error) {
        return { available: false, engine: null, version: null, reason: `Ghostscript was found but could not start: ${error.message}` };
      }
    })().catch((error) => {
      engineInfoPromise = undefined;
      throw error;
    });
  }
  const info = await engineInfoPromise;
  return { ...info };
}

function safeNumber(value, fallback, min, max, round = false) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  const clamped = Math.max(min, Math.min(max, number));
  return round ? Math.round(clamped) : clamped;
}

function resolveImageFilterMode({ imageFilterMode, preset, quality } = {}) {
  if (imageFilterMode === 'auto' || imageFilterMode === 'jpeg') return imageFilterMode;
  const presetQuality = ({ high: 85, balanced: 70, small: 55, smallest: 42, ultra: 32, target: 70 })[preset] || 70;
  const qualityPercent = safeNumber(quality, presetQuality, 15, 95, true);
  // 'auto' lets Ghostscript pass existing JPEGs through untouched, which is why already-compressed images never shrank.
  // Only the highest-quality preset may keep that behaviour; everything else re-encodes every image.
  return preset === 'high' && qualityPercent >= 85 ? 'auto' : 'jpeg';
}

function buildArgs({ inputPath, outputPath, preset, resolutionDpi, quality, colorMode, preserveMetadata, includeAnnotations, password, imageObjectCount, duplicateImageEstimate, detectDuplicateImages = true, metadataCleanupPath, imageFilterMode }) {
  const presets = {
    high: { dpi: 250, quality: 85 },
    balanced: { dpi: 150, quality: 70 },
    small: { dpi: 110, quality: 55 },
    smallest: { dpi: 85, quality: 42 },
    ultra: { dpi: 66, quality: 32 },
    target: { dpi: 150, quality: 70 },
  };
  const defaults = presets[preset] || presets.balanced;
  const dpi = safeNumber(resolutionDpi, defaults.dpi, 40, 600, true);
  const qualityPercent = safeNumber(quality, defaults.quality, 15, 95, true);
  // Ghostscript's Distiller /QFactor convention is inverse to an ordinary quality slider:
  // values nearer 0 retain more JPEG detail; values nearer 1 compress more aggressively.
  const qFactor = Number(Math.min(2.4, qualityPercent >= 50 ? 1.02 - (qualityPercent / 100) * 0.86 : 0.59 + (50 - qualityPercent) * 0.045).toFixed(3));
  const sampling = qualityPercent >= 85 ? '[1 1 1 1]' : '[2 1 1 2]';
  const knownImageCount = Number.isFinite(Number(imageObjectCount)) && imageObjectCount !== null && imageObjectCount !== undefined;
  const imageCount = knownImageCount ? safeNumber(imageObjectCount, 0, 0, 10000000, true) : null;
  const knownDuplicateEstimate = Number.isFinite(Number(duplicateImageEstimate)) && duplicateImageEstimate !== null && duplicateImageEstimate !== undefined;
  const duplicateCount = knownDuplicateEstimate ? safeNumber(duplicateImageEstimate, 0, 0, 10000000, true) : null;
  // Ghostscript's duplicate-image search becomes expensive as image objects accumulate. Keep it
  // on for ordinary PDFs and when the analysis finds duplicates, but skip an expensive O(n²)-like
  // search for very image-heavy PDFs with no byte-identical duplicate estimate.
  const adaptiveDuplicateDetection = detectDuplicateImages !== false && !(imageCount !== null && imageCount > 500 && duplicateCount === 0);
  const selectedImageFilterMode = resolveImageFilterMode({ imageFilterMode, preset, quality });
  const adaptiveFilterArgs = selectedImageFilterMode === 'auto'
    ? ['-dAutoFilterColorImages=true', '-dAutoFilterGrayImages=true', '-dPassThroughJPEGImages=true', '-dPassThroughJPXImages=true']
    : ['-dAutoFilterColorImages=false', '-dAutoFilterGrayImages=false', '-dPassThroughJPEGImages=false', '-dPassThroughJPXImages=false'];
  const args = [
    '-dSAFER', '-dBATCH', '-dNOPAUSE', '-dQUIET',
    '-sDEVICE=pdfwrite', '-dCompatibilityLevel=1.7',
    `-dDetectDuplicateImages=${adaptiveDuplicateDetection ? 'true' : 'false'}`,
    '-dCompressFonts=true', '-dSubsetFonts=true', '-dCompressStreams=true', '-dCompressPages=true',
    '-dPreserveAnnots=true', '-dEmbedAllFonts=true', '-dDownsampleColorImages=true', '-dDownsampleGrayImages=true',
    '-dDownsampleMonoImages=true', '-dColorImageDownsampleType=/Bicubic',
    '-dGrayImageDownsampleType=/Bicubic', '-dMonoImageDownsampleType=/Bicubic',
    `-dColorImageResolution=${dpi}`, `-dGrayImageResolution=${dpi}`, `-dMonoImageResolution=${Math.min(300, Math.max(dpi * 2, 200))}`,
    '-dColorImageDownsampleThreshold=1.0', '-dGrayImageDownsampleThreshold=1.0', '-dMonoImageDownsampleThreshold=1.0',
    // Choose per content at high/recommended settings. More aggressive profiles force JPEG so
    // target-size mode can make further progress when the adaptive filter remains lossless/large.
    '-dEncodeColorImages=true', '-dEncodeGrayImages=true', '-dEncodeMonoImages=true', '-dMonoImageFilter=/CCITTFaxEncode',
    '-dColorImageFilter=/DCTEncode', '-dGrayImageFilter=/DCTEncode',
  ];
  args.push(...adaptiveFilterArgs);
  // Strong tiers: smoother downsampling, RGB conversion (drops big ICC/CMYK data) and removal of print-only baggage.
  const strong = dpi <= 110 || qualityPercent <= 55;
  if (strong) {
    args.push('-dColorImageDownsampleType=/Average', '-dGrayImageDownsampleType=/Average',
      '-dPreserveOverprintSettings=false', '-dPreserveHalftoneInfo=false', '-dTransferFunctionInfo=/Remove',
      '-dUCRandBGInfo=/Remove', '-dPreserveOPIComments=false', '-dPreserveEPSInfo=false', '-dOmitXMP=true', '-dMaxSubsetPct=100');
    if (colorMode !== 'grayscale') args.push('-sColorConversionStrategy=sRGB');
  }
  if (!preserveMetadata) args.push('-dOmitXMP=true', '-dOmitInfoDate=true');
  args.push(`-sOutputFile=${outputPath}`);
  if (colorMode === 'grayscale') args.push('-sColorConversionStrategy=Gray');
  // Smart mode never converts vector/text pages to black-and-white bitmaps. A true page-wide
  // monochrome result is routed through the explicit raster fallback by the caller.
  // The annotation option controls only the opt-in raster fallback. The smart engine preserves
  // annotations where supported; post-compression validation rejects lost links/fields.
  void includeAnnotations;
  if (password) args.push(`-sPDFPassword=${String(password)}`);
  const jpegDict = (extra = '') => `<< /QFactor ${qFactor} /Blend 1 ${extra}/HSamples ${sampling} /VSamples ${sampling} >>`;
  const imageParams = `<< /ColorImageDict ${jpegDict('/ColorTransform 1 ')} /ColorACSImageDict ${jpegDict('/ColorTransform 1 ')} /GrayImageDict ${jpegDict()} /GrayACSImageDict ${jpegDict()} >> setdistillerparams`;
  args.push('-c', imageParams, '-f', inputPath);
  if (!preserveMetadata && metadataCleanupPath) args.push(metadataCleanupPath);
  return args;
}

/**
 * Object-aware PDF rewrite using Ghostscript's pdfwrite high-level device. This selectively
 * downsamples images by effective display resolution, recompresses image streams, deduplicates
 * reusable images, compresses/subsets fonts and streams, and recreates vector/text page content.
 * It is not a byte-preserving editor: non-marking metadata/features may be changed by pdfwrite.
 */
async function compressWithGhostscript(inputBytes, options = {}) {
  const bytes = Buffer.isBuffer(inputBytes) ? inputBytes : Buffer.from(inputBytes || []);
  if (bytes.length === 0) throw new TypeError('No PDF data was supplied to the smart compressor.');
  const info = await getGhostscriptInfo();
  if (!info.available || (!info.executable && !info.bundled)) {
    const error = new Error(info.reason || 'Ghostscript is unavailable.');
    error.code = 'PDFSTUDIO_GHOSTSCRIPT_UNAVAILABLE';
    throw error;
  }
  if (info.bundled) return compressWithBundled(bytes, options, info);
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pdfstudio-smart-compress-'));
  const inputPath = path.join(tempDir, 'source.pdf');
  const outputPath = path.join(tempDir, 'optimized.pdf');
  try {
    await fs.writeFile(inputPath, bytes, { mode: 0o600, flag: 'wx' });
    const metadataCleanupPath = path.join(tempDir, 'clear-metadata.ps');
    if (options.preserveMetadata === false) {
      // Clear standard document info and omit XMP/creation dates where the PDF profile permits it.
      // Ghostscript always writes its own Producer string; that field cannot be blanked reliably.
      await fs.writeFile(metadataCleanupPath, '[ /Title () /Author () /Subject () /Creator () /Keywords () /CreationDate () /ModDate () /DOCINFO pdfmark\n', { mode: 0o600, flag: 'wx' });
    }
    const args = buildArgs({ inputPath, outputPath, ...options, metadataCleanupPath: options.preserveMetadata === false ? metadataCleanupPath : undefined });
    await execute(info.executable, args, { timeoutMs: safeNumber(options.timeoutMs, 300000, 10000, 900000, true), cwd: tempDir });
    const output = await fs.readFile(outputPath);
    if (output.length < 8 || output.indexOf(Buffer.from('%PDF-')) < 0 || output.indexOf(Buffer.from('%PDF-')) > 1023) {
      throw new Error('Ghostscript did not produce a valid PDF document.');
    }
    const warnings = ['PDF content was rewritten by Ghostscript. Visual text/vector content is normally preserved, but some non-printing metadata or interactive features may change.'];
    const selectedImageFilterMode = resolveImageFilterMode(options);
    if (selectedImageFilterMode === 'jpeg') warnings.push('Aggressive JPEG image encoding was used; review small text embedded inside images and line-art at full resolution. Native PDF text and vector paths remain object-based.');
    const imageCount = Number.isFinite(Number(options.imageObjectCount)) ? Number(options.imageObjectCount) : null;
    const duplicateEstimate = Number.isFinite(Number(options.duplicateImageEstimate)) ? Number(options.duplicateImageEstimate) : null;
    if (options.detectDuplicateImages !== false && imageCount !== null && imageCount > 500 && duplicateEstimate === 0) {
      warnings.push('Duplicate-image scanning was skipped because analysis found more than 500 image objects and no byte-identical duplicates; this avoids excessive processing time on image-heavy PDFs.');
    }
    if (options.preserveMetadata === false) warnings.push('Standard document metadata and XMP were cleared where supported; Ghostscript writes its own Producer entry.');
    return { bytes: new Uint8Array(output), engine: 'Ghostscript pdfwrite', version: info.version, warnings };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function compressWithBundled(bytes, options, info) {
  const files = [{ name: 'source.pdf', data: new Uint8Array(bytes) }];
  if (options.preserveMetadata === false) files.push({ name: 'clear-metadata.ps', data: Buffer.from('[ /Title () /Author () /Subject () /Creator () /Keywords () /CreationDate () /ModDate () /DOCINFO pdfmark\n') });
  const args = buildArgs({ inputPath: '/work/source.pdf', outputPath: '/work/optimized.pdf', ...options, metadataCleanupPath: options.preserveMetadata === false ? '/work/clear-metadata.ps' : undefined });
  const result = await runBundled({ files, args, outputName: 'optimized.pdf', timeoutMs: safeNumber(options.timeoutMs, 300000, 10000, 900000, true) });
  const output = Buffer.from(result.bytes);
  if (output.length < 8 || output.indexOf(Buffer.from('%PDF-')) < 0 || output.indexOf(Buffer.from('%PDF-')) > 1023) throw new Error('Ghostscript did not produce a valid PDF document.');
  const warnings = ['PDF content was rewritten by the built-in Ghostscript engine. Visual text/vector content is normally preserved, but some non-printing metadata or interactive features may change.'];
  if (resolveImageFilterMode(options) === 'jpeg') warnings.push('Aggressive JPEG image encoding was used; review small text embedded inside images and line-art at full resolution.');
  if (options.preserveMetadata === false) warnings.push('Standard document metadata and XMP were cleared where supported; Ghostscript writes its own Producer entry.');
  return { bytes: new Uint8Array(output), engine: 'Ghostscript pdfwrite', version: info.version, warnings };
}

module.exports = { getGhostscriptInfo, compressWithGhostscript, buildArgs, resolveImageFilterMode };
