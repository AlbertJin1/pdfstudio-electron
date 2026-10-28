const { app, BrowserWindow, dialog, ipcMain, shell, session, safeStorage, net, nativeTheme } = require('electron');
const { fileURLToPath } = require('node:url');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const { Worker } = require('node:worker_threads');
const { isPdfStudioMonitorApiUrl, monitorApiUrlCandidates } = require('./services/monitor-api.cjs');
const accessPolicy = require('./services/access-policy.cjs');
const reviewQueuePolicy = require('./review-queue-policy.cjs');
const ocrService = require('./ocr-service.cjs');
const imageTextExtractor = require('./services/image-text-extractor.cjs');
const ghostscriptCompression = require('./services/ghostscript-compression.cjs');
const portableUpdateEngine = require('./services/portable-update-engine.cjs');

// All settings, caches and staged updates live in the per-user app-data folder (%AppData%\PDF Studio), so the
// portable EXE never creates any folder next to itself. The folder name is set explicitly because the package name
// is not the product name.
function configureUserData() {
  const userDataDir = path.join(app.getPath('appData'), 'PDF Studio');
  app.setPath('userData', userDataDir);
  // One-time carry-over from earlier builds that stored data in "PDF Studio Data" beside the EXE (copy only, never deleted).
  try {
    const oldDir = process.env.PORTABLE_EXECUTABLE_DIR && path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'PDF Studio Data');
    if (oldDir && fsSync.existsSync(oldDir) && !fsSync.existsSync(userDataDir)) {
      fsSync.cpSync(oldDir, userDataDir, { recursive: true });
    }
  } catch {
    // Starting with fresh settings is acceptable if the old folder cannot be read.
  }
}
configureUserData();

// One running copy only: a second launch just brings the existing window forward.
const gotInstanceLock = app.requestSingleInstanceLock();
if (!gotInstanceLock) app.quit();
app.on('second-instance', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

// Windows: Chromium's native occlusion tracking delays the first paint on some GPUs/drivers and is not needed here.
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
try { require('node:module').enableCompileCache?.(path.join(app.getPath('userData'), 'js-cache')); } catch { /* optional speed-up */ }

// Use the same hand-authored app icon for the Windows taskbar, auxiliary windows,
// and packaged application. extraResources copies these files to resources/icons.
function getAppIconPath() {
  const iconName = 'pdf-studio.ico';
  const packagedPath = path.join(process.resourcesPath, 'icons', iconName);
  const developmentPath = path.join(__dirname, '..', 'public', 'icons', iconName);
  return app.isPackaged ? packagedPath : developmentPath;
}

app.setAppUserModelId('com.regualos.pdfstudio');

// Log stray async failures instead of surfacing Node's UnhandledPromiseRejection warning.
process.on('unhandledRejection', (reason) => console.error('[pdf-studio] Unhandled rejection:', reason));

// ───────────────────────── Security helpers ─────────────────────────
// The dev server URL is honoured only in unpackaged runs, so an environment variable can never point a shipped build at remote content.
function getDevUrl() { return app.isPackaged ? '' : (process.env.VITE_DEV_SERVER_URL || ''); }
function isTrustedUrl(raw) {
  try {
    const url = new URL(String(raw));
    const dev = getDevUrl();
    if (dev) return url.origin === new URL(dev).origin;
    if (url.protocol !== 'file:') return false;
    const target = path.normalize(fileURLToPath(url)).toLowerCase();
    return target === path.normalize(path.join(app.getAppPath(), 'dist', 'index.html')).toLowerCase();
  } catch { return false; }
}
function openExternalSafe(value) {
  try {
    const url = new URL(String(value));
    if (url.protocol !== 'https:' || url.username || url.password) return false;
    void shell.openExternal(url.toString());
    return true;
  } catch { return false; }
}
/** Every IPC call must come from our own bundled page; anything else (injected frame, navigated page) is refused. */
function handle(channel, listener) {
  ipcMain.handle(channel, (event, ...args) => {
    const frameUrl = event.senderFrame?.url || '';
    if (!isTrustedUrl(frameUrl)) throw new Error('Blocked IPC call from an untrusted page.');
    return listener(event, ...args);
  });
}
app.on('web-contents-created', (_event, contents) => {
  const guard = (event, url) => { if (!isTrustedUrl(url)) event.preventDefault(); };
  contents.on('will-navigate', guard);
  contents.on('will-redirect', guard);
  contents.on('will-attach-webview', (event) => event.preventDefault());
  contents.setWindowOpenHandler(({ url }) => { openExternalSafe(url); return { action: 'deny' }; });
});

let mainWindow;
let activeUpdateDownload = null;

function getSystemThemeName() {
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
}

// Keep all renderer windows synchronized when Windows switches between light and dark mode.
nativeTheme.on('updated', () => {
  const theme = getSystemThemeName();
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed() || win.webContents.isDestroyed()) continue;
    win.webContents.send('theme:system-changed', theme);
  }
});

// Keep PDF Studio on the same release channel as the legacy C# client.
// This is the Monitor API root (not the public downloads page); remote client requests use client-gateway.php.
const PDF_STUDIO_MONITOR_BASE_URL = 'https://pdfstudio.shares.zrok.io/pdfstudio-monitor/api';
// The shared Monitor API key belongs exclusively on the Monitor server. Electron never stores,
// loads, decrypts, or sends it. All remote operations go through the allowlisted server-side gateway.
// Deploy the matching public/api/client-gateway.php from Monitor 2.4.18 or this server-bridge copy.
// No client secret is needed; configure MONITOR_API_KEY only in the Monitor server .env/private config.
const MONITOR_GATEWAY_SCRIPT = 'client-gateway.php';
function monitorGatewayEndpoint(params = {}) {
  const endpoint = new URL(`${PDF_STUDIO_MONITOR_BASE_URL}/${MONITOR_GATEWAY_SCRIPT}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') endpoint.searchParams.set(key, String(value));
  }
  return endpoint;
}

// Update state is owned by the main process so downloads continue even if the Settings view is closed.
let updaterState = { status: 'idle', message: 'Automatic updates are enabled.' };
let pendingUpdate = null;
let updateCheckPromise = null;
let promptedVersionThisSession = '';
let readyEventSentVersionThisSession = '';
let autoUpdateTimer = null;
let autoUpdateInterval = null;
let autoUpdateRetryTimer = null;
let usageIdentity = null;
let usageIdentityPromise = null;
let usageSession = null;
let usageHeartbeatTimer = null;
let usageStartPromise = null;
let usageStopPromise = null;
let usageQueueFlushing = false;
let usageStopping = false;
let usageStopped = false;
let usageShutdownInProgress = false;
let usageShutdownComplete = false;

function toBuffer(data) {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof Uint8Array) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (Array.isArray(data)) return Buffer.from(data);
  if (data && typeof data === 'object') return Buffer.from(Object.values(data));
  throw new TypeError('No valid file data was supplied.');
}
const MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024;
const toSafeBuffer = (data) => { const b = toBuffer(data); if (b.length > MAX_FILE_BYTES) throw new RangeError('File is too large.'); return b; };

// QPDF/WASM runs in a Node worker thread, never in the Vite browser bundle or Electron UI thread.
// A persistent worker caches the compiled WASM module between exports and keeps large-file work responsive.
let pdfToolkitWorker = null;
let pdfToolkitRequestId = 0;
const pdfToolkitRequests = new Map();

function rejectPdfToolkitRequestsForWorker(child, error) {
  for (const [id, request] of pdfToolkitRequests) {
    if (request.worker !== child) continue;
    pdfToolkitRequests.delete(id);
    request.reject(error);
  }
}

function getPdfToolkitWorker() {
  if (pdfToolkitWorker) return pdfToolkitWorker;
  const child = new Worker(path.join(__dirname, 'pdf-toolkit-worker.mjs'), { name: 'pdfstudio-qpdf-optimizer' });
  pdfToolkitWorker = child;
  child.on('message', (message) => {
    const request = pdfToolkitRequests.get(message?.id);
    if (!request || request.worker !== child) return;
    pdfToolkitRequests.delete(message.id);
    if (message.error) {
      const error = new Error(String(message.error.message || 'PDF optimization failed.'));
      error.name = String(message.error.name || 'Error');
      request.reject(error);
      return;
    }
    if (!(message.bytes instanceof ArrayBuffer)) {
      request.reject(new Error('The PDF optimization worker returned an invalid result.'));
      return;
    }
    request.resolve(new Uint8Array(message.bytes));
  });
  child.on('error', (error) => {
    if (pdfToolkitWorker === child) pdfToolkitWorker = null;
    rejectPdfToolkitRequestsForWorker(child, new Error(`PDF optimization worker failed: ${error.message || 'unknown worker error'}`));
  });
  child.on('exit', (code) => {
    if (pdfToolkitWorker === child) pdfToolkitWorker = null;
    rejectPdfToolkitRequestsForWorker(child, new Error(code === 0 ? 'PDF optimization worker stopped before completing the export.' : `PDF optimization worker exited unexpectedly (code ${code}).`));
  });
  return child;
}

function finalizePdfInWorker(data, options = {}) {
  const source = toSafeBuffer(data);
  const bytes = Uint8Array.from(source); // exact-sized transferable buffer; do not transfer a pooled Buffer's backing store
  const id = ++pdfToolkitRequestId;
  return new Promise((resolve, reject) => {
    try {
      const child = getPdfToolkitWorker();
      pdfToolkitRequests.set(id, { resolve, reject, worker: child });
      child.postMessage({ id, bytes: bytes.buffer, options }, [bytes.buffer]);
    } catch (error) {
      pdfToolkitRequests.delete(id);
      reject(error);
    }
  });
}

app.once('before-quit', () => {
  const child = pdfToolkitWorker;
  pdfToolkitWorker = null;
  if (child) void child.terminate();
  for (const request of pdfToolkitRequests.values()) request.reject(new Error('PDF Studio is closing.'));
  pdfToolkitRequests.clear();
});

function safeName(value, fallback = 'document') {
  const name = path.basename(String(value || fallback)).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim();
  return name || fallback;
}

function assertPublicHttps(value, base) {
  let parsed;
  try { parsed = new URL(value, base); }
  catch { throw new Error('The update endpoint contains an invalid URL.'); }
  if (parsed.protocol !== 'https:') throw new Error('PDF Studio Monitor update requests and downloads must remain on HTTPS.');
  if (parsed.username || parsed.password) throw new Error('Release URLs cannot contain embedded credentials.');
  return parsed;
}

async function fetchHttpsResponse(value, { signal, accept = 'application/json', maxRedirects = 5, allowApiPathFallback = true, method = 'GET', body = null } = {}) {
  let current = assertPublicHttps(value);
  const requestSignal = signal || AbortSignal.timeout(20_000);
  for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
    let response;
    try {
      const headers = {
        'User-Agent': `PDF-Studio/${app.getVersion()}`,
        'ngrok-skip-browser-warning': '1',
        Accept: accept,
      };
      // No shared API key is shipped to or sent by the desktop client. The server gateway
      // injects its server-only key only when forwarding allowlisted requests internally.
      const requestHeaders = body === null ? headers : { ...headers, 'Content-Type': 'application/json' };
      response = await fetch(current, {
        method,
        redirect: 'manual',
        signal: requestSignal,
        headers: requestHeaders,
        ...(body === null ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
      });
    } catch (error) {
      if (!signal && (error?.name === 'TimeoutError' || error?.name === 'AbortError')) {
        throw new Error('The PDF Studio Monitor did not respond within 20 seconds. Check your connection and try again.');
      }
      throw error;
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) throw new Error('The PDF Studio Monitor returned an incomplete redirect.');
      if (redirects === maxRedirects) throw new Error('Too many redirects while connecting to the PDF Studio Monitor.');
      current = assertPublicHttps(location, current);
      continue;
    }
    if (!response.ok) {
      // Support both deployment layouts: the normal root rewrite (/api) and hosts
      // that expose public/ directly (/public/api). The old path silently returned
      // 404 on the latter, which also caused telemetry to be discarded.
      const routeFallbackStatuses = [401, 403, 404, 405];
      const alternatives = allowApiPathFallback ? monitorApiUrlCandidates(current) : [];
      const alternate = alternatives.find((candidate) => candidate.pathname !== current.pathname);
      if (alternate && routeFallbackStatuses.includes(response.status)) {
        return fetchHttpsResponse(alternate.toString(), { signal, accept, maxRedirects, allowApiPathFallback: false, method, body });
      }
      let serverDetail = '';
      if (accept.includes('application/json')) {
        try {
          const rawError = (await response.clone().text()).slice(0, 1200);
          const errorBody = JSON.parse(rawError);
          if (typeof errorBody?.error === 'string') serverDetail = errorBody.error.replace(/[\r\n\t]+/g, ' ').slice(0, 300);
        } catch { /* a non-JSON Apache/tunnel response is summarized by status below */ }
      }
      if (response.status === 401) throw new Error(`The PDF Studio Monitor gateway refused the request.${serverDetail ? ` ${serverDetail}` : ' Check the server-side gateway configuration and Monitor API credentials.'}`);
      if (response.status === 404) throw new Error(`The PDF Studio Monitor client gateway was not found. Deploy client-gateway.php to the Monitor API directory and verify the server URL.${serverDetail ? ` ${serverDetail}` : ''}`);
      if (response.status === 403 || response.status === 429) throw new Error(`The PDF Studio Monitor temporarily refused the request.${serverDetail ? ` ${serverDetail}` : ' Try again later.'}`);
      throw new Error(`PDF Studio Monitor returned HTTP ${response.status}${serverDetail ? `: ${serverDetail}` : '.'}`);
    }
    // A tunnel splash or web-server fallback can return HTML with HTTP 200. Do not
    // mistake it for valid API metadata; try the alternate deployment path once.
    if (accept.includes('application/json') && !/\bjson\b/i.test(response.headers.get('content-type') || '')) {
      const alternatives = allowApiPathFallback ? monitorApiUrlCandidates(current) : [];
      const alternate = alternatives.find((candidate) => candidate.pathname !== current.pathname);
      if (alternate) {
        return fetchHttpsResponse(alternate.toString(), { signal, accept, maxRedirects, allowApiPathFallback: false, method, body });
      }
      throw new Error('The PDF Studio Monitor gateway returned a non-JSON response. Check the gateway deployment and tunnel route.');
    }
    return response;
  }
  throw new Error('Could not reach the PDF Studio Monitor.');
}
function parseVersion(value) {
  const version = String(value || '').trim().replace(/^v/i, '');
  if (!/^\d+(?:\.\d+){1,3}(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Invalid release version “${value}”. Use a version such as 3.1.0.`);
  }
  const withoutBuild = version.split('+')[0];
  const [numeric, prerelease = ''] = withoutBuild.split('-', 2);
  return { raw: version, numbers: numeric.split('.').map((part) => Number(part)), prerelease };
}

function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (let i = 0; i < Math.max(a.numbers.length, b.numbers.length); i += 1) {
    const difference = (a.numbers[i] || 0) - (b.numbers[i] || 0);
    if (difference) return Math.sign(difference);
  }
  if (!a.prerelease && b.prerelease) return 1;
  if (a.prerelease && !b.prerelease) return -1;
  if (a.prerelease === b.prerelease) return 0;
  return a.prerelease.localeCompare(b.prerelease, undefined, { numeric: true });
}

function monitorTarget() {
  const architecture = process.arch === 'arm64'
    ? 'arm64'
    : process.arch === 'ia32'
      ? 'x86'
      : process.arch === 'x64'
        ? 'x64'
        : null;
  if (process.platform !== 'win32' || !architecture) {
    throw new Error(`PDF Studio supports Windows only (detected ${process.platform}/${process.arch}).`);
  }
  return { platform: 'windows', architecture };
}

function assertMonitorUpdateUrl(value, expectedAction = '') {
  const url = assertPublicHttps(value);
  const allowedPath = [
    '/pdfstudio-monitor/api/client-gateway.php',
    '/pdfstudio-monitor/public/api/client-gateway.php',
  ].includes(url.pathname.toLowerCase());
  const action = url.searchParams.get('action') || 'latest';
  if (!isPdfStudioMonitorApiUrl(url)
      || !allowedPath
      || url.searchParams.get('resource') !== 'update'
      || !['latest', 'download', 'manifest', 'delta'].includes(action)
      || (expectedAction && action !== expectedAction)) {
    throw new Error('The update URL is not a valid PDF Studio Monitor update endpoint.');
  }
  const format = url.searchParams.get('format');
  if (format && (action !== 'download' || format !== 'zip')) {
    throw new Error('The update endpoint contains an unsupported package format.');
  }
  return url;
}
function assertMonitorDownloadUrl(value) {
  return assertMonitorUpdateUrl(value, 'download');
}

async function readMonitorReleaseMetadata() {
  const currentVersion = app.getVersion();
  const target = monitorTarget();
  const identity = await ensureUsageIdentity();
  const query = {
    action: 'latest',
    app: 'pdfstudio',
    version: currentVersion,
    install_id: identity.installId,
    hostname: getUsageHostname(),
    local_ip: getUsageLocalIp(),
  };
  // Windows uses the original C#-compatible release channel (action=latest / action=download).
  const endpoint = monitorGatewayEndpoint({ resource: 'update', ...query });
  const response = await fetchHttpsResponse(endpoint.toString(), { accept: 'application/json' });
  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength > 8 * 1024 * 1024) throw new Error('The PDF Studio Monitor release metadata is unexpectedly large.');
  const body = await response.text();
  if (Buffer.byteLength(body, 'utf8') > 8 * 1024 * 1024) throw new Error('The PDF Studio Monitor release metadata is unexpectedly large.');

  let data;
  try { data = JSON.parse(body); }
  catch { throw new Error('The PDF Studio Monitor did not return valid JSON from update.php.'); }
  if (!data || typeof data !== 'object' || data.ok === false) {
    throw new Error(String(data?.error || 'The PDF Studio Monitor returned an unexpected update response.'));
  }

  const latest = data.latest && typeof data.latest === 'object' ? data.latest : null;
  if (!latest) {
    const blocked = data.status === 'rollout_blocked';
    const message = blocked
      ? 'The PDF Studio Monitor is holding this update until the required bridge release is available.'
      : target.platform === 'windows'
        ? 'No release is currently available from the PDF Studio Monitor for this update channel.'
        : `The PDF Studio Monitor has no published ${target.platform} ${target.architecture} release yet.`;
    return {
      currentVersion,
      latestVersion: currentVersion,
      updateAvailable: false,
      blocked,
      message,
      notes: '',
      publishedAt: null,
      download: null,
      platform: target,
    };
  }

  const latestVersion = String(latest.version || '').trim().replace(/^v/i, '');
  parseVersion(latestVersion);
  const updateAvailable = compareVersions(latestVersion, currentVersion) > 0;
  const notes = String(latest.notes || data.notes || '').slice(0, 24000);
  const releasedAt = latest.released_at ?? data.released_at ?? null;
  const publishedAt = typeof releasedAt === 'number' && releasedAt > 0
    ? new Date(releasedAt * 1000).toISOString()
    : (typeof releasedAt === 'string' && releasedAt ? releasedAt : null);

  let download = null;
  if (updateAvailable) {
    const declaredHash = String(latest.sha256 || '').trim().replace(/^sha256[:=]/i, '').toLowerCase();
    const targetSize = Number(latest.size || data.size || 0);
    if (!/^[a-f0-9]{64}$/.test(declaredHash)) {
      throw new Error('The PDF Studio Monitor did not provide a valid SHA-256 checksum required to verify this update.');
    }
    if (!Number.isSafeInteger(targetSize) || targetSize < 1 || targetSize > MAX_FILE_BYTES) {
      throw new Error('The PDF Studio Monitor returned an invalid executable size for this update.');
    }
    const name = `PDF-Studio-${latestVersion}-Portable-${target.architecture}.exe`;
    const downloadUrl = monitorGatewayEndpoint({ resource: 'update', action: 'download', app: 'pdfstudio', version: latestVersion }).toString();
    download = { url: assertMonitorDownloadUrl(downloadUrl).toString(), name, sha256: declaredHash, size: targetSize };

    // Monitor provides a cached ZIP of the exact portable EXE. Its own checksum and the final EXE checksum
    // are both checked, so compressed transfers are safe and older Monitor releases still have a raw-EXE fallback.
    const packageInfo = latest.package && typeof latest.package === 'object' ? latest.package : null;
    const packageSize = Number(packageInfo?.size || 0);
    const packageHash = String(packageInfo?.sha256 || '').trim().replace(/^sha256[:=]/i, '').toLowerCase();
    if (String(packageInfo?.format || '').toLowerCase() === 'zip'
        && Number.isSafeInteger(packageSize) && packageSize > 0 && packageSize <= MAX_FILE_BYTES
        && /^[a-f0-9]{64}$/.test(packageHash)
        && (!packageInfo.entry || String(packageInfo.entry) === 'PdfStudio.exe')) {
      const zipUrl = monitorGatewayEndpoint({ resource: 'update', action: 'download', app: 'pdfstudio', version: latestVersion, format: 'zip' }).toString();
      download.compressed = { url: assertMonitorUpdateUrl(zipUrl, 'download').toString(), size: packageSize, sha256: packageHash, entry: 'PdfStudio.exe' };
    }

    const deltaInfo = latest.delta && typeof latest.delta === 'object' ? latest.delta : null;
    const manifestSize = Number(deltaInfo?.manifest_size || 0);
    const manifestHash = String(deltaInfo?.manifest_sha256 || '').trim().replace(/^sha256[:=]/i, '').toLowerCase();
    if (String(deltaInfo?.format || '') === portableUpdateEngine.DELTA_FORMAT
        && Number.isSafeInteger(manifestSize) && manifestSize > 0 && manifestSize <= portableUpdateEngine.MAX_MANIFEST_BYTES
        && /^[a-f0-9]{64}$/.test(manifestHash)) {
      const manifestUrl = monitorGatewayEndpoint({ resource: 'update', action: 'manifest', app: 'pdfstudio', version: latestVersion }).toString();
      download.delta = { format: portableUpdateEngine.DELTA_FORMAT, manifestUrl: assertMonitorUpdateUrl(manifestUrl, 'manifest').toString(), manifestSize, manifestSha256: manifestHash };
    }
    // If the monitor doesn't support the newer compressed/delta fields, retain the existing verified raw EXE path.
  }

  return {
    currentVersion,
    latestVersion,
    updateAvailable,
    blocked: false,
    message: updateAvailable
      ? `PDF Studio ${latestVersion} is available from the PDF Studio Monitor.`
      : `No newer release is available. Installed: ${currentVersion}; latest on Monitor: ${latestVersion}.`,
    notes,
    publishedAt,
    download,
    platform: target,
    monitor: true,
  };
}

async function getAvailableDownloadPath(fileName) {
  const directory = app.getPath('downloads');
  await fs.mkdir(directory, { recursive: true });
  const safe = safeName(fileName, `PDF-Studio-update-${Date.now()}`);
  const extension = path.extname(safe);
  const stem = path.basename(safe, extension);
  let candidate = path.join(directory, safe);
  let suffix = 2;
  while (fsSync.existsSync(candidate) || fsSync.existsSync(`${candidate}.part`)) {
    candidate = path.join(directory, `${stem} (${suffix++})${extension}`);
  }
  return candidate;
}

function getUpdatesDirectory() {
  return path.join(app.getPath('userData'), 'updates');
}

async function getStagedUpdatePath(fileName) {
  const directory = getUpdatesDirectory();
  await fs.mkdir(directory, { recursive: true });
  const safe = safeName(fileName, `PDF-Studio-update-${Date.now()}`);
  const extension = path.extname(safe);
  const stem = path.basename(safe, extension);
  let candidate = path.join(directory, safe);
  let suffix = 2;
  // Never overwrite a previously staged, verified update while trying a newer release.
  while (fsSync.existsSync(candidate) || fsSync.existsSync(`${candidate}.part`)) {
    candidate = path.join(directory, `${stem} (${suffix++})${extension}`);
  }
  return candidate;
}

function getPortableLauncherPath() {
  const candidates = [process.env.PORTABLE_EXECUTABLE_FILE, process.execPath];
  for (const candidate of candidates) {
    if (!candidate || !path.isAbsolute(candidate) || !fsSync.existsSync(candidate)) continue;
    try {
      const stat = fsSync.statSync(candidate);
      if (stat.isFile() && path.extname(candidate).toLowerCase() === '.exe') return path.resolve(candidate);
    } catch { /* try the next candidate */ }
  }
  return null;
}

function reportUpdateProgress(sender, { percent = null, downloadedBytes = 0, totalBytes = null, message }) {
  const safePercent = Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : null;
  publishUpdaterState({ status: 'downloading', percent: safePercent, downloadedBytes, totalBytes, message });
  if (!sender?.isDestroyed?.()) sender.send('updater:download-progress', { percent: safePercent, downloadedBytes, totalBytes, message });
}

async function streamResponseToFile(response, targetPath, {
  sender, signal, expectedSize = 0, expectedSha256 = '', maxBytes = MAX_FILE_BYTES,
  message = 'Downloading update…',
} = {}) {
  const partialPath = `${targetPath}.part`;
  await fs.rm(partialPath, { force: true }).catch(() => {});
  await fs.rm(targetPath, { force: true }).catch(() => {});
  const fileHandle = await fs.open(partialPath, 'w');
  const digest = crypto.createHash('sha256');
  const headerSize = Number(response.headers.get('content-length') || 0);
  const totalBytes = headerSize > 0 ? headerSize : (expectedSize > 0 ? expectedSize : null);
  let downloadedBytes = 0;
  try {
    reportUpdateProgress(sender, { percent: 0, downloadedBytes: 0, totalBytes, message });
    for await (const chunk of response.body) {
      if (signal?.aborted) { const error = new Error('Update cancelled.'); error.name = 'AbortError'; throw error; }
      const buffer = Buffer.from(chunk);
      downloadedBytes += buffer.length;
      if (downloadedBytes > maxBytes) throw new Error('The update package is larger than the 2 GB safety limit.');
      digest.update(buffer);
      let offset = 0;
      while (offset < buffer.length) {
        const { bytesWritten } = await fileHandle.write(buffer, offset, buffer.length - offset, downloadedBytes - buffer.length + offset);
        if (!bytesWritten) throw new Error('The update package could not be written to disk. Check available storage and permissions.');
        offset += bytesWritten;
      }
      const percent = totalBytes ? Math.min(100, (downloadedBytes / totalBytes) * 100) : null;
      reportUpdateProgress(sender, { percent, downloadedBytes, totalBytes, message });
    }
    if (expectedSize > 0 && downloadedBytes !== expectedSize) throw new Error('The update download is incomplete. Please try again.');
    await fileHandle.sync();
    const actualHash = digest.digest('hex');
    const expectedHash = String(expectedSha256 || '').trim().replace(/^sha256[:=]/i, '').toLowerCase();
    if (expectedHash && (!/^[a-f0-9]{64}$/.test(expectedHash) || actualHash !== expectedHash)) {
      throw new Error('SHA-256 verification failed. The downloaded update was removed because it does not match the checksum published by PDF Studio Monitor.');
    }
    await fileHandle.close();
    await fs.rename(partialPath, targetPath);
    reportUpdateProgress(sender, { percent: 100, downloadedBytes, totalBytes, message });
    return { path: targetPath, sha256: actualHash, size: downloadedBytes };
  } catch (error) {
    await fileHandle.close().catch(() => {});
    await fs.rm(partialPath, { force: true }).catch(() => {});
    throw error;
  }
}

function isUpdateCancelled(error, signal) {
  return Boolean(signal?.aborted || error?.name === 'AbortError' || /download cancelled/i.test(String(error?.message || '')));
}

async function readDeltaManifest(payload, signal, sender) {
  const delta = payload.delta;
  if (!delta || delta.format !== portableUpdateEngine.DELTA_FORMAT) throw new Error('The update does not advertise a supported differential manifest.');
  const url = assertMonitorUpdateUrl(delta.manifestUrl, 'manifest');
  reportUpdateProgress(sender, { percent: null, downloadedBytes: 0, totalBytes: delta.manifestSize, message: 'Checking which parts of the new version can be reused…' });
  const response = await fetchHttpsResponse(url.toString(), { signal, accept: 'application/json', maxRedirects: 5 });
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > portableUpdateEngine.MAX_MANIFEST_BYTES) throw new Error('The differential-update manifest is unexpectedly large.');
  const parts = [];
  let total = 0;
  for await (const chunk of response.body) {
    if (signal?.aborted) { const error = new Error('Update cancelled.'); error.name = 'AbortError'; throw error; }
    const bytes = Buffer.from(chunk);
    total += bytes.length;
    if (total > portableUpdateEngine.MAX_MANIFEST_BYTES) throw new Error('The differential-update manifest is unexpectedly large.');
    parts.push(bytes);
  }
  if (delta.manifestSize > 0 && total !== Number(delta.manifestSize)) throw new Error('The differential-update manifest download is incomplete.');
  const bytes = Buffer.concat(parts, total);
  if (portableUpdateEngine.sha256(bytes) !== String(delta.manifestSha256).toLowerCase()) throw new Error('The differential-update manifest failed its SHA-256 integrity check.');
  return portableUpdateEngine.validateDeltaManifest(bytes, {
    version: payload.version,
    size: Number(payload.size),
    sha256: payload.sha256,
  });
}

async function tryDownloadDeltaUpdate(payload, targetPath, sender, signal) {
  // Delta reuse is for Electron portable EXE -> Electron portable EXE updates only. A C# v2 -> Electron v3
  // migration intentionally uses the compressed full launcher because the executable format changed.
  if (!app.isPackaged || compareVersions(app.getVersion(), '3.0.0') < 0 || compareVersions(payload.version, '3.0.0') < 0 || !payload.delta) return false;
  const launcher = getPortableLauncherPath();
  if (!launcher) return false;

  const manifest = await readDeltaManifest(payload, signal, sender);
  reportUpdateProgress(sender, { percent: null, downloadedBytes: 0, totalBytes: Number(payload.size) || null, message: 'Analyzing the current portable executable for reusable data…' });
  const localIndex = await portableUpdateEngine.buildLocalChunkIndex(launcher, {
    signal,
    onProgress: ({ done, total }) => reportUpdateProgress(sender, {
      percent: total ? Math.min(18, (done / total) * 18) : null,
      downloadedBytes: done,
      totalBytes: total,
      message: 'Analyzing the current portable executable for reusable data…',
    }),
  });
  const missing = new Map();
  for (const chunk of manifest.chunks) {
    const local = localIndex.get(chunk.sha256);
    if (!local || local.size !== chunk.size) missing.set(chunk.sha256, chunk);
  }
  const missingRawBytes = [...missing.values()].reduce((sum, chunk) => sum + chunk.size, 0);
  const targetBytes = Number(payload.size) || manifest.size;
  const zipBytes = Number(payload.compressed?.size) || 0;
  const fallbackThreshold = zipBytes > 0 ? Math.min(targetBytes * 0.92, zipBytes * 1.75) : targetBytes * 0.92;
  if (missingRawBytes >= fallbackThreshold) {
    reportUpdateProgress(sender, { percent: null, downloadedBytes: missingRawBytes, totalBytes: targetBytes, message: 'Most of the executable changed; switching to the compressed update…' });
    return false;
  }

  const tempDirectory = path.join(getUpdatesDirectory(), `delta-${crypto.randomBytes(10).toString('hex')}`);
  const deltaPath = path.join(tempDirectory, 'changed-parts.delta');
  const targetPartPath = `${targetPath}.part`;
  await fs.mkdir(tempDirectory, { recursive: true });
  try {
    if (missing.size > 0) {
      const deltaUrl = assertMonitorUpdateUrl(monitorGatewayEndpoint({ resource: 'update', action: 'delta', version: payload.version }).toString(), 'delta');
      reportUpdateProgress(sender, { percent: null, downloadedBytes: 0, totalBytes: null, message: `Downloading ${missing.size.toLocaleString()} changed parts only…` });
      const response = await fetchHttpsResponse(deltaUrl.toString(), {
        method: 'POST',
        body: { version: payload.version, chunks: [...missing.keys()] },
        signal,
        accept: 'application/vnd.pdfstudio.delta, application/octet-stream, */*',
        maxRedirects: 5,
      });
      await streamResponseToFile(response, deltaPath, {
        sender, signal, maxBytes: MAX_FILE_BYTES, message: 'Downloading changed parts only…',
      });
      await portableUpdateEngine.extractDeltaPack(deltaPath, missing, tempDirectory, {
        signal,
        onProgress: ({ done, total }) => reportUpdateProgress(sender, {
          percent: total ? 18 + (done / total) * 5 : null,
          downloadedBytes: done,
          totalBytes: total,
          message: 'Verifying downloaded update parts…',
        }),
      });
    }

    reportUpdateProgress(sender, { percent: 25, downloadedBytes: 0, totalBytes: targetBytes, message: 'Rebuilding the new portable executable from unchanged and changed parts…' });
    await portableUpdateEngine.assembleDelta(launcher, targetPartPath, manifest, localIndex, tempDirectory, {
      signal,
      onProgress: ({ done, total }) => reportUpdateProgress(sender, {
        percent: total ? 25 + (done / total) * 70 : null,
        downloadedBytes: done,
        totalBytes: total,
        message: 'Rebuilding the new portable executable from unchanged and changed parts…',
      }),
    });
    const rebuiltHash = await sha256File(targetPartPath);
    if (rebuiltHash.toLowerCase() !== String(payload.sha256).toLowerCase()) throw new Error('The rebuilt executable failed its final SHA-256 integrity check.');
    const rebuiltStat = await fs.stat(targetPartPath);
    if (rebuiltStat.size !== targetBytes) throw new Error('The rebuilt executable has an unexpected file size.');
    await fs.rm(targetPath, { force: true }).catch(() => {});
    await fs.rename(targetPartPath, targetPath);
    reportUpdateProgress(sender, { percent: 100, downloadedBytes: rebuiltStat.size, totalBytes: rebuiltStat.size, message: 'Differential update verified.' });
    return { path: targetPath, sha256: rebuiltHash, size: rebuiltStat.size, method: 'delta' };
  } catch (error) {
    await fs.rm(targetPartPath, { force: true }).catch(() => {});
    throw error;
  } finally {
    await fs.rm(tempDirectory, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 }).catch(() => {});
  }
}

async function downloadReleasePackage(payload, sender) {
  if (!payload || typeof payload !== 'object') throw new Error('Missing update download details.');
  const source = assertMonitorDownloadUrl(payload.url);
  const outputName = safeName(payload.name || payload.fileName || `PDF-Studio-${payload.version || Date.now()}-Portable.exe`, `PDF-Studio-update-${Date.now()}.exe`);
  const targetPath = payload.background
    ? await getStagedUpdatePath(outputName)
    : await getAvailableDownloadPath(outputName);
  const controller = new AbortController();
  const download = { controller, partialPath: `${targetPath}.part`, cancelled: false };
  activeUpdateDownload = download;
  const zipPath = `${targetPath}.download.zip`;
  try {
    // 1) Try a content-defined delta for already-installed Electron portable builds.
    if (payload.delta) {
      try {
        const deltaResult = await tryDownloadDeltaUpdate(payload, targetPath, sender, controller.signal);
        if (deltaResult) return { ...deltaResult, canceled: false, fileName: path.basename(targetPath), verified: true };
      } catch (error) {
        if (isUpdateCancelled(error, controller.signal)) throw new Error('Download cancelled.');
        await fs.rm(`${targetPath}.part`, { force: true }).catch(() => {});
        await fs.rm(targetPath, { force: true }).catch(() => {});
        console.warn('[PDF Studio] Differential update could not be used; falling back to a compressed package:', error?.message || error);
        reportUpdateProgress(sender, { percent: null, downloadedBytes: 0, totalBytes: Number(payload.size) || null, message: 'The smart update was unavailable. Preparing the compressed update…' });
      }
    }

    // 2) Prefer the Monitor's cached compressed portable EXE package. Verify the ZIP checksum, extract
    // exactly PdfStudio.exe, then verify the reconstructed EXE checksum and byte length independently.
    if (payload.compressed?.url && /^[a-f0-9]{64}$/i.test(String(payload.compressed.sha256 || ''))
        && Number(payload.compressed.size) > 0) {
      try {
        const zipUrl = assertMonitorUpdateUrl(payload.compressed.url, 'download');
        const response = await fetchHttpsResponse(zipUrl.toString(), {
          signal: controller.signal,
          accept: 'application/zip, application/octet-stream, */*',
        });
        const zipDownload = await streamResponseToFile(response, zipPath, {
          sender,
          signal: controller.signal,
          expectedSize: Number(payload.compressed.size),
          expectedSha256: payload.compressed.sha256,
          maxBytes: MAX_FILE_BYTES,
          message: 'Downloading the compressed update package…',
        });
        const extracted = await portableUpdateEngine.extractZipExecutable(zipPath, targetPath, {
          entryName: String(payload.compressed.entry || 'PdfStudio.exe'),
          expectedSize: Number(payload.size),
          expectedSha256: String(payload.sha256),
          signal: controller.signal,
        });
        await fs.rm(zipPath, { force: true }).catch(() => {});
        reportUpdateProgress(sender, { percent: 100, downloadedBytes: zipDownload.size, totalBytes: zipDownload.size, message: 'Compressed update verified.' });
        return { canceled: false, path: targetPath, fileName: path.basename(targetPath), sha256: extracted.sha256, verified: true, size: extracted.size, bytesDownloaded: zipDownload.size, method: 'compressed' };
      } catch (error) {
        if (isUpdateCancelled(error, controller.signal)) throw new Error('Download cancelled.');
        await fs.rm(zipPath, { force: true }).catch(() => {});
        await fs.rm(`${zipPath}.part`, { force: true }).catch(() => {});
        await fs.rm(targetPath, { force: true }).catch(() => {});
        console.warn('[PDF Studio] Compressed update could not be used; falling back to the full executable:', error?.message || error);
        reportUpdateProgress(sender, { percent: null, downloadedBytes: 0, totalBytes: Number(payload.size) || null, message: 'The compressed package was unavailable. Downloading the verified executable…' });
      }
    }

    // 3) Legacy Monitor fallback: old releases still provide a raw EXE with a published checksum.
    const response = await fetchHttpsResponse(source.toString(), {
      signal: controller.signal,
      accept: 'application/octet-stream, application/zip, */*',
    });
    const result = await streamResponseToFile(response, targetPath, {
      sender,
      signal: controller.signal,
      expectedSize: Number(payload.size) || 0,
      expectedSha256: String(payload.sha256 || ''),
      maxBytes: MAX_FILE_BYTES,
      message: 'Downloading the verified portable executable…',
    });
    return { canceled: false, path: targetPath, fileName: path.basename(targetPath), sha256: result.sha256, verified: true, size: result.size, bytesDownloaded: result.size, method: 'full' };
  } catch (error) {
    await fs.rm(`${targetPath}.part`, { force: true }).catch(() => {});
    await fs.rm(targetPath, { force: true }).catch(() => {});
    await fs.rm(zipPath, { force: true }).catch(() => {});
    await fs.rm(`${zipPath}.part`, { force: true }).catch(() => {});
    if (download.cancelled || controller.signal.aborted || error?.name === 'AbortError') throw new Error('Download cancelled.');
    throw error;
  } finally {
    if (activeUpdateDownload === download) activeUpdateDownload = null;
  }
}

// ───────────────────────── Monitor session tracking (compatible with legacy C# client) ─────────────────────────

function getReviewStatePath() {
  return path.join(app.getPath('userData'), 'review-state.json');
}
const DEFAULT_REVIEW_STATE = Object.freeze({
  totalUsageSeconds: 0,
  submittedAt: 0,
  neverAskAgain: false,
  snoozedUntil: 0,
  lastPromptAt: 0,
  promptCount: 0,
  reviewStatus: 'none',
  pendingReviewId: '',
  lastReviewId: '',
  lastReviewVersion: '',
  usageSecondsAtReview: 0,
});
let cachedReviewState = null;
let reviewStateLoadPromise = null;
let reviewUsageAccountingPromise = null;
let reviewOutboxReadBlocked = false;
let reviewStateReadBlocked = false;
let reviewOutboxFlushing = false;
let reviewOutboxTimer = null;
async function readReviewStateSnapshot() {
  const file = getReviewStatePath();
  let foundAny = false;
  let lastError = null;
  // A complete .tmp file is the newest intended state when a process was interrupted during replacement.
  for (const candidate of [`${file}.tmp`, file, `${file}.bak`]) {
    let raw;
    try { raw = await fs.readFile(candidate, 'utf8'); }
    catch (error) { if (error?.code === 'ENOENT') continue; foundAny = true; lastError = error; continue; }
    foundAny = true;
    try {
      const value = JSON.parse(raw);
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Review state is not a JSON object.');
      if (candidate !== file) {
        await fs.copyFile(candidate, file);
        await fs.rm(`${file}.tmp`, { force: true }).catch(() => {});
        await fs.rm(`${file}.bak`, { force: true }).catch(() => {});
      }
      reviewStateReadBlocked = false;
      return value;
    } catch (error) { lastError = error; }
  }
  if (!foundAny) { reviewStateReadBlocked = false; return null; }
  reviewStateReadBlocked = true;
  throw lastError || new Error('Review state could not be recovered.');
}

async function loadReviewState() {
  if (cachedReviewState) return cachedReviewState;
  if (reviewStateLoadPromise) return reviewStateLoadPromise;
  reviewStateLoadPromise = (async () => {
    try {
      const saved = await readReviewStateSnapshot();
      cachedReviewState = {
        ...DEFAULT_REVIEW_STATE,
        ...(saved && typeof saved === 'object' ? saved : {}),
        totalUsageSeconds: Math.max(0, Math.min(315360000, Number(saved?.totalUsageSeconds) || 0)),
        submittedAt: Math.max(0, Number(saved?.submittedAt) || 0),
        neverAskAgain: Boolean(saved?.neverAskAgain),
        snoozedUntil: Math.max(0, Number(saved?.snoozedUntil) || 0),
        lastPromptAt: Math.max(0, Number(saved?.lastPromptAt) || 0),
        promptCount: Math.max(0, Math.min(10000, Number(saved?.promptCount) || 0)),
        reviewStatus: ['pending', 'submitted'].includes(saved?.reviewStatus) ? saved.reviewStatus : (Number(saved?.submittedAt) > 0 ? 'submitted' : 'none'),
        pendingReviewId: typeof saved?.pendingReviewId === 'string' ? saved.pendingReviewId.slice(0, 64) : '',
        lastReviewId: typeof saved?.lastReviewId === 'string' ? saved.lastReviewId.slice(0, 64) : '',
        lastReviewVersion: typeof saved?.lastReviewVersion === 'string' ? saved.lastReviewVersion.slice(0, 32) : '',
        usageSecondsAtReview: Math.max(0, Number(saved?.usageSecondsAtReview) || 0),
      };
      // Earlier builds switched the prompt off for good after a review. A reviewer is now only paused for a while,
      // so that legacy flag no longer means "never ask" (an explicit opt-out is made without a review on record).
      if (cachedReviewState.submittedAt > 0 && cachedReviewState.neverAskAgain) cachedReviewState.neverAskAgain = false;
      if (cachedReviewState.submittedAt > 0 && !cachedReviewState.usageSecondsAtReview) cachedReviewState.usageSecondsAtReview = cachedReviewState.totalUsageSeconds;
    } catch {
      cachedReviewState = { ...DEFAULT_REVIEW_STATE };
      if (reviewStateReadBlocked) {
        cachedReviewState.reviewStatus = 'pending';
        cachedReviewState.pendingReviewId = 'state-unreadable';
        cachedReviewState.neverAskAgain = true;
      }
    }
    // Recover the suppression state from the encrypted outbox if the process closed after
    // durably queueing a review but before it could update review-state.json.
    try {
      const queued = await readReviewOutbox();
      const pending = queued.find((item) => item && typeof item.id === 'string' && item.payload && typeof item.payload === 'object');
      if (pending && pending.id !== cachedReviewState.lastReviewId) {
        cachedReviewState.reviewStatus = 'pending';
        cachedReviewState.pendingReviewId = pending.id;
      }
    } catch (error) {
      // A queue that cannot be decrypted/read must never cause another prompt or be overwritten.
      reviewOutboxReadBlocked = true;
      cachedReviewState.reviewStatus = 'pending';
      cachedReviewState.pendingReviewId = cachedReviewState.pendingReviewId || 'pending-unreadable';
      void logUsageDiagnostic(`The encrypted review outbox could not be read; prompting is disabled to avoid duplicate feedback (${String(error?.message || error).slice(0, 180)}).`);
    }
    return cachedReviewState;
  })();
  try { return await reviewStateLoadPromise; }
  finally { reviewStateLoadPromise = null; }
}
async function persistReviewState() {
  const state = await loadReviewState();
  // Preserve an unrecoverable state file rather than overwriting history and possibly re-prompting a reviewer.
  if (reviewStateReadBlocked) return false;
  const file = getReviewStatePath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  const backup = `${file}.bak`;
  await fs.writeFile(temp, JSON.stringify(state), { encoding: 'utf8', mode: 0o600 });
  try {
    await fs.rm(backup, { force: true });
    try { await fs.rename(file, backup); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
    await fs.rename(temp, file);
    await fs.rm(backup, { force: true });
  } catch (error) {
    try { if (!fsSync.existsSync(file) && fsSync.existsSync(backup)) await fs.rename(backup, file); } catch {}
    throw error;
  }
}
function getReviewOutboxPath() {
  return path.join(app.getPath('userData'), 'review-outbox.enc');
}

/**
 * Reviews may contain free-form personal feedback, so the durable retry queue is encrypted using
 * Windows user-bound Electron safeStorage (DPAPI on Windows). No plaintext fallback is permitted.
 */
// Electron 45 deprecates the synchronous safeStorage calls. Use the async API when present, and fall back to the
// synchronous one (older Electron, or data written by an earlier build) so existing queued reviews stay readable.
async function secureStorageAvailable() {
  if (typeof safeStorage.isAsyncEncryptionAvailable === 'function') {
    try { if (await safeStorage.isAsyncEncryptionAvailable()) return true; } catch { /* fall through */ }
  }
  try { return Boolean(safeStorage.isEncryptionAvailable()); } catch { return false; }
}
async function secureEncrypt(text) {
  if (typeof safeStorage.encryptStringAsync === 'function') {
    try { return Buffer.from(await safeStorage.encryptStringAsync(text)); } catch { /* use the synchronous API */ }
  }
  return safeStorage.encryptString(text);
}
async function secureDecrypt(buffer) {
  if (typeof safeStorage.decryptStringAsync === 'function') {
    try {
      const out = await safeStorage.decryptStringAsync(buffer);
      return typeof out === 'string' ? out : String(out?.result ?? '');
    } catch { /* data written by the synchronous API: decrypt it that way */ }
  }
  return safeStorage.decryptString(buffer);
}

async function readReviewOutbox() {
  const file = getReviewOutboxPath();
  const candidates = [`${file}.tmp`, file, `${file}.bak`];
  let foundAny = false;
  let lastError = null;
  for (const candidate of candidates) {
    let encoded;
    try { encoded = await fs.readFile(candidate, 'utf8'); }
    catch (error) {
      if (error?.code === 'ENOENT') continue;
      lastError = error;
      foundAny = true;
      continue;
    }
    foundAny = true;
    try {
      if (!(await secureStorageAvailable())) throw new Error('Windows secure storage is not available to decrypt pending reviews.');
      const encrypted = Buffer.from(String(encoded).trim(), 'base64');
      if (!encrypted.length) throw new Error('The encrypted review outbox is empty or damaged.');
      const parsed = JSON.parse(await secureDecrypt(encrypted));
      const items = reviewQueuePolicy.normalizeOutbox(parsed);
      // Recover a fully-written temp/backup file after a crash during an atomic replacement.
      if (candidate !== file) {
        await fs.copyFile(candidate, file);
        await fs.rm(`${file}.tmp`, { force: true }).catch(() => {});
        await fs.rm(`${file}.bak`, { force: true }).catch(() => {});
      }
      reviewOutboxReadBlocked = false;
      return items;
    } catch (error) {
      lastError = error;
    }
  }
  if (!foundAny) return [];
  reviewOutboxReadBlocked = true;
  const failure = lastError || new Error('The encrypted review outbox cannot be read.');
  void logUsageDiagnostic(`The encrypted review outbox could not be read and was preserved (${String(failure?.message || failure).slice(0, 180)}).`);
  throw failure;
}

async function writeReviewOutbox(items) {
  if (reviewOutboxReadBlocked) throw new Error('The existing encrypted review queue could not be read; it was not overwritten.');
  if (!(await secureStorageAvailable())) throw new Error('Windows secure storage is unavailable, so the review cannot be saved safely.');
  const file = getReviewOutboxPath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  const encrypted = await secureEncrypt(JSON.stringify({ version: 1, items: items.slice(-5) }));
  const temp = `${file}.tmp`;
  await fs.writeFile(temp, encrypted.toString('base64'), { encoding: 'utf8', mode: 0o600 });
  // Windows rename cannot reliably replace an existing destination. Keep a recoverable backup
  // while swapping, and let the reader recover from it if the process is interrupted mid-write.
  const backup = `${file}.bak`;
  try {
    await fs.rm(backup, { force: true });
    try { await fs.rename(file, backup); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
    await fs.rename(temp, file);
    await fs.rm(backup, { force: true });
  } catch (error) {
    try { if (!fsSync.existsSync(file) && fsSync.existsSync(backup)) await fs.rename(backup, file); } catch {}
    throw error;
  }
}

async function queueReview(payload, id) {
  const queue = await readReviewOutbox();
  if (queue.some((item) => item.id === id)) return;
  // Only one review per install is needed. Never overwrite an existing pending review with new text.
  if (queue.length) throw new Error('A review is already pending delivery from this installation.');
  queue.push(reviewQueuePolicy.createOutboxItem(id, payload));
  await writeReviewOutbox(queue);
}

function reviewRetryDelayMs(attempts, status) { return reviewQueuePolicy.retryDelayMs(attempts, status); }

async function flushPendingReviews({ force = false } = {}) {
  if (reviewOutboxFlushing || reviewOutboxReadBlocked) return { delivered: 0, pending: true };
  if (typeof net?.isOnline === 'function' && !net.isOnline()) return { delivered: 0, pending: true, offline: true };
  reviewOutboxFlushing = true;
  let delivered = 0;
  try {
    let queue = await readReviewOutbox();
    if (!queue.length) return { delivered: 0, pending: false };
    const state = await loadReviewState();
    // If the server acknowledgement was persisted locally but queue cleanup was interrupted, finish cleanup without resending.
    queue = queue.filter((item) => !(state.submittedAt && state.lastReviewId && item.id === state.lastReviewId));
    for (const item of queue) {
      if (!force && Number(item.nextAttemptAt || 0) > Date.now()) continue;
      const result = await postMonitorUsage(item.payload, 8000);
      if (result.status === 'delivered') {
        state.submittedAt = Date.now();
        state.reviewStatus = 'submitted';
        state.pendingReviewId = '';
        state.lastReviewId = item.id;
        state.lastReviewVersion = String(item.payload?.version || app.getVersion()).slice(0, 32);
        state.snoozedUntil = 0;
        await persistReviewState();
        queue = queue.filter((candidate) => candidate.id !== item.id);
        await writeReviewOutbox(queue);
        delivered += 1;
        break;
      }
      // Keep the review on every failure, including gateway 4xx errors: a server-side gateway
      // deployment may become compatible later. Backoff prevents repeated request/log flooding.
      item.attempts = Math.min(30, Number(item.attempts || 0) + 1);
      item.lastStatus = String(result.status || 'retry');
      item.lastError = String(result.message || 'The Monitor did not acknowledge the review.').slice(0, 500);
      item.nextAttemptAt = Date.now() + reviewRetryDelayMs(item.attempts, item.lastStatus);
    }
    await writeReviewOutbox(queue);
    return { delivered, pending: queue.length > 0, message: queue[0]?.lastError || '' };
  } catch (error) {
    await logUsageDiagnostic(`Pending review delivery failed safely: ${String(error?.message || error).slice(0, 300)}`);
    return { delivered, pending: true, error: String(error?.message || error) };
  } finally {
    reviewOutboxFlushing = false;
  }
}

function startReviewOutboxService() {
  if (reviewOutboxTimer) return;
  // Once per launch ignore the retry backoff, so a review that was rejected earlier (for example by an older
  // Monitor gateway) is re-sent as soon as the app starts after the Monitor has been updated.
  void flushPendingReviews({ force: true });
  reviewOutboxTimer = setInterval(() => { void flushPendingReviews(); }, 60_000);
  reviewOutboxTimer.unref?.();
}

async function accountReviewUsage() {
  if (!usageSession) return;
  if (reviewUsageAccountingPromise) return reviewUsageAccountingPromise;
  reviewUsageAccountingPromise = (async () => {
    const now = Date.now();
    const last = Number(usageSession.reviewAccountedMs || usageSession.startedMs || now);
    const seconds = Math.max(0, Math.floor((now - last) / 1000));
    if (seconds < 1) return;
    usageSession.reviewAccountedMs = last + seconds * 1000;
    const state = await loadReviewState();
    state.totalUsageSeconds = Math.min(315360000, state.totalUsageSeconds + seconds);
    await persistReviewState();
  })().finally(() => { reviewUsageAccountingPromise = null; });
  return reviewUsageAccountingPromise;
}

function getUsageStatePath() {
  return path.join(app.getPath('userData'), 'monitor-usage.json');
}
function getUsageQueuePath() {
  return path.join(app.getPath('userData'), 'monitor-usage-queue.json');
}
function getPendingUpdatePath() {
  return path.join(app.getPath('userData'), 'pending-update.json');
}
function getUsageHostname() {
  try { return String(os.hostname() || '').trim().slice(0, 64); } catch { return ''; }
}
function getUsageOsLabel() {
  const system = String(os.type() || '').trim();
  const release = String(os.release() || '').trim();
  const architecture = process.arch === 'ia32' ? 'x86' : process.arch === 'x64' ? 'x64' : process.arch;
  if (process.platform === 'win32' || /^windows(?:_nt)?$/i.test(system)) {
    const match = release.match(/^(\d+)\.(\d+)(?:\.(\d+))?/);
    if (!match) return `Windows (${architecture})`;
    const major = Number(match[1]);
    const minor = Number(match[2]);
    const build = Number(match[3] || 0);
    let version;
    if (major === 10 && minor === 0) version = build >= 22000 ? 'Windows 11' : 'Windows 10';
    else if (major === 6 && minor === 3) version = 'Windows 8.1';
    else if (major === 6 && minor === 2) version = 'Windows 8';
    else if (major === 6 && minor === 1) version = 'Windows 7';
    else if (major === 6 && minor === 0) version = 'Windows Vista';
    else if (major === 5 && minor === 2) version = 'Windows XP / Server 2003';
    else if (major === 5 && minor === 1) version = 'Windows XP';
    else if (major === 5 && minor === 0) version = 'Windows 2000';
    else version = `Windows ${release}`;
    return `${version} (${architecture})`.slice(0, 120);
  }
  return `${system || 'Windows'} ${release} (${architecture})`.trim().slice(0, 120);
}
function getUsageLocalIp() {
  try {
    const all = os.networkInterfaces();
    for (const entries of Object.values(all)) {
      for (const item of entries || []) {
        const isV4 = item.family === 'IPv4' || item.family === 4;
        if (isV4 && !item.internal && item.address && item.address !== '0.0.0.0') return item.address;
      }
    }
  } catch {}
  return '';
}
function isValidInstallId(value) { return /^[a-f0-9]{16,64}$/i.test(String(value || '')); }
function adoptInstallId(value) {
  const candidate = String(value || '').trim().toLowerCase();
  if (!isValidInstallId(candidate)) return;
  if (usageIdentity && usageIdentity.installId === candidate) return;
  usageIdentity = { ...(usageIdentity || {}), installId: candidate };
  void persistUsageIdentity();
}
async function persistUsageIdentity() {
  if (!usageIdentity?.installId) return;
  const file = getUsageStatePath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  await fs.writeFile(temp, JSON.stringify({ installId: usageIdentity.installId }), 'utf8');
  await fs.rm(file, { force: true }).catch(() => {});
  await fs.rename(temp, file);
}
async function ensureUsageIdentity() {
  if (usageIdentity) return usageIdentity;
  if (usageIdentityPromise) return usageIdentityPromise;
  usageIdentityPromise = (async () => {
    try {
      const saved = JSON.parse(await fs.readFile(getUsageStatePath(), 'utf8'));
      if (isValidInstallId(saved?.installId)) usageIdentity = { installId: String(saved.installId).toLowerCase() };
    } catch {}
    if (!usageIdentity) {
      usageIdentity = { installId: crypto.randomBytes(16).toString('hex') };
      await persistUsageIdentity().catch(() => {});
    }
    return usageIdentity;
  })();
  try { return await usageIdentityPromise; }
  finally { usageIdentityPromise = null; }
}
function usageSessionPayload(eventName) {
  if (!usageSession || !usageIdentity) return null;
  return {
    event: eventName,
    app: 'pdfstudio',
    session_id: usageSession.id,
    install_id: usageIdentity.installId,
    version: app.getVersion(),
    os: getUsageOsLabel(),
    hostname: getUsageHostname(),
    local_ip: getUsageLocalIp(),
    started_at: usageSession.startedAt,
    seconds: Math.max(0, Math.floor((Date.now() - usageSession.startedMs) / 1000)),
  };
}
let lastUsageDiagnosticKey = '';
let lastUsageDiagnosticAt = 0;

function getUsageLogPath() {
  return path.join(app.getPath('userData'), 'monitor-usage.log');
}

async function logUsageDiagnostic(message) {
  const safeMessage = String(message || 'Unknown Monitor reporting error').replace(/[\r\n\t]+/g, ' ').slice(0, 700);
  const now = Date.now();
  // Avoid writing the same persistent server rejection once per heartbeat.
  if (safeMessage === lastUsageDiagnosticKey && now - lastUsageDiagnosticAt < 5 * 60 * 1000) return;
  lastUsageDiagnosticKey = safeMessage;
  lastUsageDiagnosticAt = now;
  console.warn(`[PDF Studio] Monitor reporting: ${safeMessage}`);
  try {
    const file = getUsageLogPath();
    await fs.mkdir(path.dirname(file), { recursive: true });
    try {
      const stat = await fs.stat(file);
      if (stat.size > 256 * 1024) {
        await fs.rm(`${file}.old`, { force: true });
        await fs.rename(file, `${file}.old`);
      }
    } catch {}
    await fs.appendFile(file, `${new Date().toISOString()} | ${safeMessage}\n`, 'utf8');
  } catch {}
}

async function postMonitorUsage(payload, timeoutMs = 8000) {
  const gateway = monitorGatewayEndpoint({ resource: 'telemetry' });
  const candidates = monitorApiUrlCandidates(gateway);
  let lastFailure = 'Could not reach the PDF Studio Monitor telemetry endpoint.';
  let lastStatus = 0;

  for (let index = 0; index < candidates.length; index += 1) {
    const endpoint = candidates[index];
    let response;
    let bodyText = '';
    try {
      response = await fetch(endpoint.toString(), {
        method: 'POST',
        redirect: 'manual',
        headers: {
          'User-Agent': `PdfStudio/${app.getVersion()}`,
          'ngrok-skip-browser-warning': '1',
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs),
      });
      bodyText = await response.text().catch(() => '');
      lastStatus = response.status;
      let result = null;
      try { result = JSON.parse(bodyText); } catch {}
      if (response.ok && result && result.ok === true) {
        if (typeof result.install_id === 'string') adoptInstallId(result.install_id);
        return { status: 'delivered' };
      }
      const detail = String(result?.error || (response.ok ? 'The endpoint returned HTTP success but did not confirm the event.' : '') || bodyText.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()).slice(0, 240);
      lastFailure = `${endpoint.pathname} returned HTTP ${response.status}${detail ? `: ${detail}` : ''}`;

      // Try the direct-public alias when the canonical rewrite points at the wrong
      // document root or an authentication/routing layer blocks that route.
      if (index + 1 < candidates.length && [301, 302, 303, 307, 308, 401, 403, 404, 405].includes(response.status)) continue;
      if (index + 1 < candidates.length && response.ok && (!result || result.ok !== true)) continue;
    } catch (error) {
      // A network failure is host-wide; do not wait for a second path on the same host.
      lastFailure = `${endpoint.origin}${endpoint.pathname} could not be reached: ${String(error?.message || error).slice(0, 220)}`;
      lastStatus = 0;
      break;
    }

    const temporary = lastStatus === 0 || lastStatus >= 500 || [408, 425, 429].includes(lastStatus) || [301, 302, 303, 307, 308].includes(lastStatus);
    const status = temporary ? 'retry' : 'permanent';
    await logUsageDiagnostic(lastFailure);
    return { status, message: lastFailure };
  }

  const temporary = lastStatus === 0 || lastStatus >= 500 || [408, 425, 429].includes(lastStatus) || [301, 302, 303, 307, 308].includes(lastStatus);
  await logUsageDiagnostic(lastFailure);
  return { status: temporary ? 'retry' : 'permanent', message: lastFailure };
}

async function readUsageQueue() {
  try {
    const parsed = JSON.parse(await fs.readFile(getUsageQueuePath(), 'utf8'));
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item === 'object') : [];
  } catch { return []; }
}
async function writeUsageQueue(queue) {
  const file = getUsageQueuePath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  await fs.writeFile(temp, JSON.stringify(queue.slice(-100)), 'utf8');
  await fs.rm(file, { force: true }).catch(() => {});
  await fs.rename(temp, file);
}
async function enqueueUsageEvent(payload) {
  try {
    const queue = await readUsageQueue();
    // Only retain the latest heartbeat for a session; open/close remain durable and idempotent.
    const key = `${payload.session_id}:${payload.event}`;
    const filtered = queue.filter((item) => `${item.session_id}:${item.event}` !== key);
    filtered.push(payload);
    await writeUsageQueue(filtered.slice(-100));
  } catch {}
}
async function flushUsageQueue() {
  if (usageQueueFlushing) return;
  usageQueueFlushing = true;
  try {
    const queue = await readUsageQueue();
    const remaining = [];
    let transientFailure = false;
    for (let index = 0; index < queue.length; index += 1) {
      const item = queue[index];
      if (transientFailure) { remaining.push(item); continue; }
      const result = await postMonitorUsage(item, 6000);
      if (result.status === 'retry') { transientFailure = true; remaining.push(item); }
      // Permanent 4xx rejection is logged locally and removed; retrying a malformed
      // event or a mismatched API key indefinitely would just clog the queue.
    }
    await writeUsageQueue(remaining);
  } finally { usageQueueFlushing = false; }
}
async function sendUsageEvent(payload, timeoutMs = 8000) {
  if (!payload) return;
  const result = await postMonitorUsage(payload, timeoutMs);
  if (result.status === 'delivered') {
    await flushUsageQueue();
  } else if (result.status === 'retry') {
    await enqueueUsageEvent(payload);
  }
}
async function startUsageMonitoring() {
  if (usageStartPromise) return usageStartPromise;
  if (usageSession && !usageStopped) return;
  usageStopped = false;
  usageStopping = false;
  usageStartPromise = (async () => {
    await ensureUsageIdentity();
    startReviewOutboxService();
    usageSession = {
      id: crypto.randomBytes(16).toString('hex'),
      startedAt: Math.floor(Date.now() / 1000),
      startedMs: Date.now(),
      reviewAccountedMs: Date.now(),
    };
    await flushUsageQueue();
    await sendUsageEvent(usageSessionPayload('open'), 8000);
    if (usageHeartbeatTimer) clearInterval(usageHeartbeatTimer);
    usageHeartbeatTimer = setInterval(() => {
      if (!usageStopping && usageSession) {
        void accountReviewUsage();
        void sendUsageEvent(usageSessionPayload('heartbeat'), 8000);
        void flushUsageQueue();
        void flushPendingReviews();
      }
    }, 60_000);
    usageHeartbeatTimer.unref?.();
  })().catch((error) => console.warn('[PDF Studio] Monitor session tracking unavailable:', error?.message || error))
    .finally(() => { usageStartPromise = null; });
  return usageStartPromise;
}
async function stopUsageMonitoring() {
  if (usageStopPromise) return usageStopPromise;
  usageStopping = true;
  if (usageHeartbeatTimer) clearInterval(usageHeartbeatTimer);
  usageHeartbeatTimer = null;
  usageStopPromise = (async () => {
    if (usageStartPromise) await Promise.race([usageStartPromise, new Promise((resolve) => setTimeout(resolve, 2500))]);
    if (usageSession && usageIdentity) {
      await accountReviewUsage();
      const payload = usageSessionPayload('close');
      const result = await postMonitorUsage(payload, 2500);
      if (result.status === 'retry') await enqueueUsageEvent(payload);
    }
    usageStopped = true;
  })().catch(() => {}).finally(() => { usageStopPromise = null; });
  return usageStopPromise;
}

// ───────────────────────── Device access control (Monitor enable / disable) ─────────────────────────
//
// The Monitor administrator can disable a single PC from the dashboard's Installs table. This client:
//   * starts normally and never waits for the network (new/unknown devices are enabled by default);
//   * polls the server-side client gateway (about every 30 seconds, and again when the window regains focus);
//   * locks immediately when the answer is "disabled", and unlocks on the next answer that says "enabled";
//   * caches the last answer on disk, so a disabled device stays locked after a restart or while offline;
//   * enforces the lock in THIS (main) process: file dialogs, reading and saving are refused while locked,
//     the renderer only draws the lock screen. Network errors never change the current decision.

let accessState = {
  status: 'enabled', reason: '', updatedAt: 0, updatedBy: '', checkedAt: 0, offline: false, source: 'default', message: '',
};
let accessTimer = null;
let accessFailures = 0;
let accessCheckPromise = null;
let accessStopped = false;
let accessLastCheckAt = 0;

function getAccessCachePath() {
  return path.join(app.getPath('userData'), 'monitor-access.json');
}
function isAccessLocked() {
  return accessState.status === 'disabled';
}
function publicAccessState() {
  return {
    status: accessState.status,
    locked: isAccessLocked(),
    reason: accessState.reason,
    updatedAt: accessState.updatedAt,
    updatedBy: accessState.updatedBy,
    checkedAt: accessState.checkedAt,
    offline: Boolean(accessState.offline),
    source: accessState.source,
    hostname: getUsageHostname(),
    installId: usageIdentity?.installId || '',
  };
}
function assertAccessAllowed() {
  if (!isAccessLocked()) return;
  const error = new Error('PDF Studio is disabled on this device by the administrator. Contact your administrator to restore access.');
  error.code = 'ACCESS_DISABLED';
  throw error;
}
function broadcastAccessState() {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('access:state', publicAccessState());
  } catch { /* the window may be closing */ }
}
function setAccessState(next) {
  const before = JSON.stringify([accessState.status, accessState.reason, accessState.updatedAt, accessState.updatedBy, accessState.offline, accessState.source]);
  accessState = next;
  const after = JSON.stringify([accessState.status, accessState.reason, accessState.updatedAt, accessState.updatedBy, accessState.offline, accessState.source]);
  if (before !== after) broadcastAccessState();
}
/** Synchronous on purpose: a cached "disabled" must already be in force before the first window is created. */
function loadAccessCacheSync() {
  try {
    const cached = accessPolicy.parseCache(fsSync.readFileSync(getAccessCachePath(), 'utf8'));
    if (!cached) return;
    accessState = {
      status: cached.enabled ? 'enabled' : 'disabled',
      reason: cached.enabled ? '' : (cached.reason || 'Access to PDF Studio was disabled on this device by an administrator.'),
      updatedAt: cached.updatedAt,
      updatedBy: cached.updatedBy,
      checkedAt: cached.checkedAt,
      offline: false,
      source: 'cache',
      message: '',
    };
  } catch { /* no cache yet: enabled by default */ }
}
async function persistAccessCache(policy) {
  try {
    const file = getAccessCachePath();
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temp = `${file}.tmp`;
    await fs.writeFile(temp, accessPolicy.serializeCache(policy, { installId: usageIdentity?.installId || policy.installId, hostname: getUsageHostname() }), 'utf8');
    await fs.rm(file, { force: true }).catch(() => {});
    await fs.rename(temp, file);
  } catch (error) {
    await logUsageDiagnostic(`Could not cache the access policy: ${error?.message || error}`);
  }
}
async function checkAccessPolicy() {
  if (accessCheckPromise) return accessCheckPromise;
  accessCheckPromise = (async () => {
    try {
      const identity = await ensureUsageIdentity();
      const outcome = await accessPolicy.fetchAccessPolicy({
        baseUrl: PDF_STUDIO_MONITOR_BASE_URL,
        candidatesFor: monitorApiUrlCandidates,
        userAgent: `PdfStudio/${app.getVersion()}`,
        identity: { installId: identity.installId, version: app.getVersion(), hostname: getUsageHostname(), localIp: getUsageLocalIp() },
      });
      accessLastCheckAt = Date.now();
      if (outcome.ok) {
        accessFailures = 0;
        // The monitor folds every install of one PC into a single canonical id: keep using it.
        if (outcome.policy.installId) adoptInstallId(outcome.policy.installId);
        await persistAccessCache(outcome.policy);
        setAccessState(accessPolicy.applyOutcome(accessState, outcome));
        accessPollAfterSeconds = outcome.policy.pollAfterSeconds;
      } else {
        accessFailures += 1;
        await logUsageDiagnostic(`Access policy check failed (keeping the current state): ${outcome.message}`);
        setAccessState(accessPolicy.applyOutcome(accessState, outcome));
      }
    } catch (error) {
      accessFailures += 1;
      await logUsageDiagnostic(`Access policy check error: ${error?.message || error}`);
    } finally {
      accessCheckPromise = null;
    }
    return publicAccessState();
  })();
  return accessCheckPromise;
}
let accessPollAfterSeconds = accessPolicy.DEFAULT_POLL_SECONDS;
function scheduleAccessCheck(delayMs) {
  if (accessStopped) return;
  if (accessTimer) clearTimeout(accessTimer);
  accessTimer = setTimeout(async () => {
    await checkAccessPolicy();
    scheduleAccessCheck(accessPolicy.nextPollDelayMs(accessPollAfterSeconds, accessFailures));
  }, delayMs);
  accessTimer.unref?.();
}
function startAccessControl() {
  accessStopped = false;
  scheduleAccessCheck(0);
}
function stopAccessControl() {
  accessStopped = true;
  if (accessTimer) clearTimeout(accessTimer);
  accessTimer = null;
}
/** Re-check when the user comes back to the window (also covers wake-from-sleep, when timers can be late). */
function recheckAccessSoon() {
  if (accessStopped || accessCheckPromise) return;
  if (Date.now() - accessLastCheckAt < 8000) return;
  scheduleAccessCheck(0);
}

// ───────────────────────── Automatic, staged updates ─────────────────────────

function isPathInside(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}
async function sha256File(filePath) {
  return await new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fsSync.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}
function publicPendingUpdate(update) {
  if (!update) return null;
  return {
    version: update.version,
    currentVersion: update.currentVersion || app.getVersion(),
    notes: String(update.notes || '').slice(0, 8000),
    size: Number(update.size || 0),
    platform: update.platform || process.platform,
    architecture: update.architecture || process.arch,
    fileName: update.fileName || path.basename(update.path || ''),
  };
}
function publishUpdaterState(next) {
  updaterState = { ...updaterState, ...next };
  const safeState = { ...updaterState };
  delete safeState.url;
  delete safeState.download;
  delete safeState.path;
  delete safeState.sha256;
  if (mainWindow?.webContents && !mainWindow.webContents.isDestroyed()) mainWindow.webContents.send('updater:state', safeState);
}
function notifyUpdateReady(update) {
  if (!update || readyEventSentVersionThisSession === update.version) return;
  if (!mainWindow?.webContents || mainWindow.webContents.isDestroyed()) return;
  readyEventSentVersionThisSession = update.version;
  mainWindow.webContents.send('updater:update-ready', publicPendingUpdate(update));
}
async function persistPendingUpdate(update) {
  const file = getPendingUpdatePath();
  const temp = `${file}.tmp`;
  const backup = `${file}.previous`;
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(temp, JSON.stringify(update), 'utf8');
  let movedPrevious = false;
  try {
    if (fsSync.existsSync(file)) {
      await fs.rm(backup, { force: true }).catch(() => {});
      await fs.rename(file, backup);
      movedPrevious = true;
    }
    await fs.rename(temp, file);
  } catch (error) {
    await fs.rm(temp, { force: true }).catch(() => {});
    if (movedPrevious && !fsSync.existsSync(file)) await fs.rename(backup, file).catch(() => {});
    throw error;
  }
  if (movedPrevious) await fs.rm(backup, { force: true }).catch(() => {});
}
async function removePendingUpdate({ removePayload = false } = {}) {
  const previous = pendingUpdate;
  pendingUpdate = null;
  await fs.rm(getPendingUpdatePath(), { force: true }).catch(() => {});
  if (removePayload && previous?.path && isPathInside(getUpdatesDirectory(), previous.path)) {
    await fs.rm(previous.path, { force: true }).catch(() => {});
  }
}
async function restorePendingUpdate() {
  try {
    await fs.mkdir(getUpdatesDirectory(), { recursive: true });
    const marker = getPendingUpdatePath();
    const markerBackup = `${marker}.previous`;
    // Recover a marker if the process was interrupted while replacing metadata for a newer package.
    if (!fsSync.existsSync(marker) && fsSync.existsSync(markerBackup)) await fs.rename(markerBackup, marker).catch(() => {});
    else await fs.rm(markerBackup, { force: true }).catch(() => {});
    // Interrupted downloads never count as staged updates; remove stale partial files on next launch.
    for (const entry of await fs.readdir(getUpdatesDirectory(), { withFileTypes: true }).catch(() => [])) {
      if (entry.isFile() && entry.name.endsWith('.part')) await fs.rm(path.join(getUpdatesDirectory(), entry.name), { force: true }).catch(() => {});
    }
    const saved = JSON.parse(await fs.readFile(marker, 'utf8'));
    if (!saved || typeof saved.version !== 'string' || typeof saved.path !== 'string' || typeof saved.sha256 !== 'string') throw new Error('Invalid pending update marker.');
    if (!isPathInside(getUpdatesDirectory(), saved.path) || !fsSync.existsSync(saved.path)) throw new Error('Pending update package is missing.');
    if (!/^[a-f0-9]{64}$/i.test(saved.sha256)) throw new Error('Pending update checksum is invalid.');
    if (compareVersions(saved.version, app.getVersion()) <= 0) {
      pendingUpdate = saved;
      await removePendingUpdate({ removePayload: true });
      publishUpdaterState({ status: 'up-to-date', message: 'PDF Studio is up to date.' });
      return;
    }
    const digest = await sha256File(saved.path);
    if (digest.toLowerCase() !== saved.sha256.toLowerCase()) throw new Error('Staged update package checksum no longer matches.');
    pendingUpdate = saved;
    publishUpdaterState({ status: 'ready', latestVersion: saved.version, message: `Version ${saved.version} is downloaded and ready to install.` });
  } catch (error) {
    if (error?.code !== 'ENOENT') console.warn('[PDF Studio] Discarding invalid staged update:', error?.message || error);
    try {
      const marker = JSON.parse(await fs.readFile(getPendingUpdatePath(), 'utf8'));
      if (marker?.path && isPathInside(getUpdatesDirectory(), marker.path)) await fs.rm(marker.path, { force: true }).catch(() => {});
    } catch {}
    pendingUpdate = null;
    await fs.rm(getPendingUpdatePath(), { force: true }).catch(() => {});
    await fs.rm(`${getPendingUpdatePath()}.tmp`, { force: true }).catch(() => {});
  }
}
function clearAutoUpdateRetry() {
  if (autoUpdateRetryTimer) clearTimeout(autoUpdateRetryTimer);
  autoUpdateRetryTimer = null;
}
function scheduleAutoUpdateRetry() {
  if (autoUpdateRetryTimer) clearTimeout(autoUpdateRetryTimer);
  autoUpdateRetryTimer = setTimeout(() => {
    autoUpdateRetryTimer = null;
    void checkAndStageUpdate({ manual: false });
  }, 15 * 60 * 1000);
  autoUpdateRetryTimer.unref?.();
}
async function checkAndStageUpdate({ manual = false } = {}) {
  if (updateCheckPromise) return updateCheckPromise;
  updateCheckPromise = (async () => {
    publishUpdaterState({ status: 'checking', message: 'Checking for updates…', percent: null, downloadedBytes: null, totalBytes: null });
    let verifiedStaged = null;
    try {
      // A staged update remains usable even if the release service is temporarily offline.
      if (pendingUpdate) {
        try {
          if (!pendingUpdate.path || !fsSync.existsSync(pendingUpdate.path)) throw new Error('Staged update package is missing.');
          const stagedHash = await sha256File(pendingUpdate.path);
          if (stagedHash.toLowerCase() === String(pendingUpdate.sha256).toLowerCase()
              && compareVersions(pendingUpdate.version, app.getVersion()) > 0) {
            verifiedStaged = pendingUpdate;
          } else {
            await removePendingUpdate({ removePayload: true });
          }
        } catch {
          await removePendingUpdate({ removePayload: true });
        }
      }

      await ensureUsageIdentity();
      const release = await readMonitorReleaseMetadata();
      if (!release.updateAvailable || release.blocked) {
        clearAutoUpdateRetry();
        if (verifiedStaged) {
          publishUpdaterState({ status: 'ready', currentVersion: app.getVersion(), latestVersion: verifiedStaged.version, percent: 100, message: `Version ${verifiedStaged.version} is downloaded and ready to install.` });
          notifyUpdateReady(verifiedStaged);
          return { status: 'ready', updateAvailable: true, currentVersion: app.getVersion(), latestVersion: verifiedStaged.version };
        }
        const state = { status: 'up-to-date', currentVersion: release.currentVersion, latestVersion: release.latestVersion, percent: null, downloadedBytes: null, totalBytes: null, message: 'PDF Studio is up to date.' };
        publishUpdaterState(state);
        return state;
      }

      const targetVersion = String(release.latestVersion || '');
      if (!release.download?.url || !release.download?.sha256) throw new Error('The release package metadata was incomplete.');
      if (verifiedStaged && compareVersions(verifiedStaged.version, targetVersion) >= 0) {
        clearAutoUpdateRetry();
        publishUpdaterState({ status: 'ready', currentVersion: app.getVersion(), latestVersion: verifiedStaged.version, percent: 100, message: `Version ${verifiedStaged.version} is downloaded and ready to install.` });
        notifyUpdateReady(verifiedStaged);
        return { status: 'ready', updateAvailable: true, currentVersion: app.getVersion(), latestVersion: verifiedStaged.version };
      }
      // Keep the previous verified update until this newer package has downloaded and its marker is durable.
      publishUpdaterState({ status: 'downloading', currentVersion: release.currentVersion, latestVersion: targetVersion, percent: 0, downloadedBytes: 0, totalBytes: Number(release.download.size || 0) || null, message: 'Downloading update in the background…' });
      const download = await downloadReleasePackage({ ...release.download, version: targetVersion, background: true }, mainWindow?.webContents);
      const staged = {
        version: targetVersion,
        currentVersion: release.currentVersion,
        notes: release.notes || '',
        size: Number(release.download.size || 0),
        sha256: download.sha256,
        fileName: download.fileName,
        path: download.path,
        platform: release.platform?.platform || monitorTarget().platform,
        architecture: release.platform?.architecture || monitorTarget().architecture,
        publishedAt: release.publishedAt || null,
        downloadedAt: new Date().toISOString(),
      };
      try {
        // Persist the ready marker before advertising an update, so the prompt survives a restart.
        await persistPendingUpdate(staged);
      } catch (error) {
        await fs.rm(staged.path, { force: true }).catch(() => {});
        throw error;
      }
      const replacedStaged = verifiedStaged;
      pendingUpdate = staged;
      if (replacedStaged?.path && replacedStaged.path !== staged.path && isPathInside(getUpdatesDirectory(), replacedStaged.path)) {
        await fs.rm(replacedStaged.path, { force: true }).catch(() => {});
      }
      clearAutoUpdateRetry();
      publishUpdaterState({ status: 'ready', currentVersion: release.currentVersion, latestVersion: targetVersion, percent: 100, message: `Version ${targetVersion} is downloaded and ready to install.` });
      notifyUpdateReady(staged);
      return { status: 'ready', updateAvailable: true, currentVersion: release.currentVersion, latestVersion: targetVersion };
    } catch (error) {
      // If a verified package is already staged, temporary network errors must not hide it from the user.
      if (verifiedStaged && fsSync.existsSync(verifiedStaged.path)) {
        publishUpdaterState({ status: 'ready', currentVersion: app.getVersion(), latestVersion: verifiedStaged.version, percent: 100, message: `Version ${verifiedStaged.version} is downloaded and ready to install.` });
        notifyUpdateReady(verifiedStaged);
        scheduleAutoUpdateRetry();
        return { status: 'ready', updateAvailable: true, currentVersion: app.getVersion(), latestVersion: verifiedStaged.version };
      }
      // Keep endpoint, host and transport errors out of the user interface; diagnostics stay local.
      console.warn('[PDF Studio] Automatic update check failed:', error?.message || error);
      const message = 'We couldn’t check for updates. PDF Studio will try again automatically.';
      publishUpdaterState({ status: 'error', message, percent: null, downloadedBytes: null, totalBytes: null });
      scheduleAutoUpdateRetry();
      return { status: 'error', message };
    } finally {
      updateCheckPromise = null;
    }
  })();
  return updateCheckPromise;
}
function getUpdaterSnapshot() {
  const safeState = { ...updaterState };
  delete safeState.url; delete safeState.download; delete safeState.path; delete safeState.sha256;
  const ready = pendingUpdate ? publicPendingUpdate(pendingUpdate) : null;
  return {
    state: safeState,
    pendingUpdate: ready,
    shouldPrompt: Boolean(ready && promptedVersionThisSession !== ready.version),
  };
}
function markUpdatePromptShown(version) {
  if (pendingUpdate && pendingUpdate.version === String(version || '')) promptedVersionThisSession = pendingUpdate.version;
}

async function uniqueUpdateTarget(dir, version) {
  let candidate = path.join(dir, `PdfStudio-${version}.exe`);
  for (let n = 2; fsSync.existsSync(candidate); n += 1) candidate = path.join(dir, `PdfStudio-${version} (${n}).exe`);
  return candidate;
}
// No scripts, no hidden shells, no overwriting of the running file: the verified package is copied beside the launcher
// (or into Downloads), re-verified, and started as a normal visible process. Self-replacing droppers are a classic antivirus trigger.
async function applyPendingUpdateNow() {
  if (!pendingUpdate) throw new Error('No verified update is ready to install.');
  const digest = await sha256File(pendingUpdate.path);
  if (digest.toLowerCase() !== String(pendingUpdate.sha256).toLowerCase()) {
    await removePendingUpdate({ removePayload: true });
    throw new Error('The update package did not pass its integrity check. Please check for updates again.');
  }
  const launcher = process.env.PORTABLE_EXECUTABLE_FILE;
  const dirs = [launcher && fsSync.existsSync(launcher) ? path.dirname(path.resolve(launcher)) : null, app.getPath('downloads')].filter(Boolean);
  let installed = null;
  for (const dir of dirs) {
    try {
      const target = await uniqueUpdateTarget(dir, pendingUpdate.version);
      await fs.copyFile(pendingUpdate.path, target);
      if ((await sha256File(target)).toLowerCase() !== digest.toLowerCase()) { await fs.rm(target, { force: true }); continue; }
      installed = target; break;
    } catch { /* try the next location */ }
  }
  if (!installed) throw new Error('The verified update could not be copied to a writable folder.');
  publishUpdaterState({ status: 'applying', latestVersion: pendingUpdate.version, message: 'Starting the new version of PDF Studio…' });
  app.releaseSingleInstanceLock();
  const failure = await shell.openPath(installed);
  if (failure) throw new Error(`The new version could not be started: ${failure}`);
  setTimeout(() => app.quit(), 400);
  return { started: true, path: installed };
}

async function docxBufferToPdf(buffer) {
  // Loaded on demand: mammoth is only needed for Word imports and costs startup time otherwise.
  const mammoth = require('mammoth');
  const result = await mammoth.convertToHtml({ buffer });
  const body = result.value || '<p>This Word document contains no readable text.</p>';
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><style>
    @page { size: A4; margin: 22mm 20mm; }
    * { box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; color: #202236; font-size: 11pt; line-height: 1.55; }
    h1,h2,h3 { page-break-after: avoid; } p { orphans: 3; widows: 3; }
    table { border-collapse: collapse; width: 100%; } td,th { border: 1px solid #d7d9e2; padding: 5px; }
    img { max-width: 100%; height: auto; }
    blockquote { border-left: 3px solid #8066f6; margin-left: 0; padding-left: 12px; color: #555b71; }
  </style></head><body>${body}</body></html>`;
  const printWindow = new BrowserWindow({
    icon: getAppIconPath(),
    show: false,
    width: 980,
    height: 1200,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, devTools: false },
  });
  try {
    await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    return await printWindow.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true, margins: { top: 0, bottom: 0, left: 0, right: 0 } });
  } finally {
    if (!printWindow.isDestroyed()) printWindow.destroy();
  }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>\"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', "'": '&#39;',
  }[character]));
}

let startupFailureShown = false;

async function showStartupFailure(window, { heading, message, details = '' }) {
  if (!window || window.isDestroyed() || startupFailureShown) return;
  startupFailureShown = true;
  revealMainWindow();
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PDF Studio startup problem</title>
    <style>
      :root{color-scheme:light}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f5f6fb;color:#20223a;font:15px/1.55 Inter,Segoe UI,Arial,sans-serif;padding:28px}
      main{width:min(760px,100%);background:#fff;border:1px solid #e1e4ef;border-radius:22px;padding:clamp(24px,5vw,44px);box-shadow:0 20px 70px #28305b14}
      .brand{display:inline-flex;align-items:center;gap:10px;font-weight:800;color:#6554e8;letter-spacing:.02em}.mark{display:grid;place-items:center;width:38px;height:38px;border-radius:12px;color:white;background:linear-gradient(135deg,#9c78ff,#6a52ed);font-size:20px}
      h1{margin:26px 0 8px;font-size:clamp(25px,4vw,34px);line-height:1.15;letter-spacing:-.035em}p{color:#606982}.detail{overflow-wrap:anywhere;background:#f6f7fb;border:1px solid #e4e7f0;border-radius:12px;padding:12px 14px;color:#4a526c;font:13px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace;white-space:pre-wrap}
      .steps{margin:22px 0;padding-left:22px}.steps li{margin:8px 0}.tip{background:#f0edff;border-radius:12px;padding:13px 15px;color:#5145ac}.muted{font-size:12px;color:#838ba0;margin-top:24px}
    </style></head><body><main><div class="brand"><span class="mark">▤</span><span>PDF Studio <span style="display:block;font-size:10px;letter-spacing:.2em;color:#8d91aa">DESKTOP WORKSPACE</span></span></div>
    <h1>${escapeHtml(heading || 'PDF Studio could not start')}</h1><p>${escapeHtml(message || 'The application could not load its user interface.')}</p>
    ${details ? `<div class="detail">${escapeHtml(details)}</div>` : ''}
    <ol class="steps"><li>Close this window.</li><li>Open PowerShell or a terminal in the PDF Studio project folder.</li><li>Run <code>npm install</code> if dependencies are not installed.</li><li>Run <code>npm start</code>. This command now builds the interface before launching Electron.</li></ol>
    <div class="tip"><strong>Still not starting?</strong> Run <code>npm run check</code> and review the first build error. Electron should no longer open to a blank white window without an explanation.</div>
    <div class="muted">PDF Studio ${escapeHtml(app.getVersion())} · ${escapeHtml(process.platform)} · ${escapeHtml(process.arch)}</div></main></body></html>`;
  console.error('[PDF Studio startup]', heading, message, details);
  try {
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  } catch (error) {
    console.error('[PDF Studio] Failed to display startup diagnostics:', error);
  }
}

async function loadRenderer(window) {
  const devUrl = getDevUrl();
  if (devUrl) {
    try {
      await window.loadURL(devUrl);
    } catch (error) {
      await showStartupFailure(window, {
        heading: 'Development server is not responding',
        message: 'PDF Studio could not connect to the Vite development server.',
        details: `${devUrl}\n${error?.message || error}`,
      });
    }
    return;
  }

  const indexPath = path.join(app.getAppPath(), 'dist', 'index.html');
  if (!fsSync.existsSync(indexPath)) {
    await showStartupFailure(window, {
      heading: 'Built interface not found',
      message: 'The frontend bundle has not been generated, so Electron had no page to display. This is the cause of the blank white screen.',
      details: `Expected file: ${indexPath}\nFix: run npm start (it now builds the frontend automatically).`,
    });
    return;
  }

  try {
    await window.loadFile(indexPath);
  } catch (error) {
    await showStartupFailure(window, {
      heading: 'Could not load the interface',
      message: 'The compiled PDF Studio page exists, but Electron could not open it.',
      details: `${indexPath}\n${error?.message || error}`,
    });
  }
}


// ---------------------------------------------------------------------------------------------
// Edit PDF lives in its own window. Each window receives its document once through editor:init.
// ---------------------------------------------------------------------------------------------
const editorWindows = new Set();
const editorInitPayloads = new Map();

function createEditorWindow(initial) {
  const win = new BrowserWindow({
    icon: getAppIconPath(),
    width: 1400,
    height: 900,
    minWidth: 960,
    minHeight: 620,
    show: false,
    title: 'PDF Studio - Edit PDF',
    backgroundColor: '#f5f6fa',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      allowRunningInsecureContent: false,
      devTools: !app.isPackaged,
    },
  });
  const contents = win.webContents;
  const contentsId = contents.id;
  // Without the default menu, Ctrl+Plus / Ctrl+Minus / Ctrl+0 / Ctrl+R no longer zoom or reload the whole
  // page. The editor handles those shortcuts itself, and pinch/ctrl+wheel zoom is left to the editor too.
  win.removeMenu();
  win.setMenuBarVisibility(false);
  editorInitPayloads.set(contentsId, initial || null);
  editorWindows.add(win);
  // setVisualZoomLevelLimits needs a live render frame. Calling it straight after construction (before the first
  // navigation commits) throws "Render frame was disposed before WebFrameMain could be accessed", so it runs once
  // the page has started loading and is allowed to fail silently.
  const lockVisualZoom = () => {
    if (win.isDestroyed() || contents.isDestroyed()) return;
    try { contents.setVisualZoomLevelLimits(1, 1); } catch { /* purely cosmetic; the renderer also blocks pinch zoom */ }
  };
  contents.once('dom-ready', lockVisualZoom);
  win.once('ready-to-show', () => { if (!win.isDestroyed()) { win.show(); win.focus(); } });
  win.on('closed', () => { editorWindows.delete(win); editorInitPayloads.delete(contentsId); });
  contents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  // The renderer sets a beforeunload guard while there are unsaved edits; ask the user instead of silently blocking.
  contents.on('will-prevent-unload', (event) => {
    const choice = dialog.showMessageBoxSync(win, {
      type: 'question', buttons: ['Discard changes', 'Keep editing'], defaultId: 1, cancelId: 1,
      title: 'Unsaved edits', message: 'This PDF has edits that have not been saved.', detail: 'Closing the window discards them.',
    });
    if (choice === 0) event.preventDefault();
  });
  const devUrl = getDevUrl();
  const loading = devUrl
    ? win.loadURL(`${devUrl}${devUrl.includes('?') ? '&' : '?'}window=edit`)
    : win.loadFile(path.join(app.getAppPath(), 'dist', 'index.html'), { query: { window: 'edit' } });
  // A window closed mid-load rejects with ERR_ABORTED; that is expected and must not become an unhandled rejection.
  loading.catch((error) => { if (!win.isDestroyed()) console.error('[pdf-studio] Edit window failed to load:', error?.message || error); });
  return win;
}

// ---- Installed font lookup, so edited PDF text can be saved in the document's real font --------
let fontIndexPromise = null;
const fontNorm = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const WINDOWS_FONT_FILES = {
  arial: ['arial', 'arialbd', 'ariali', 'arialbi'], arialnarrow: ['arialn', 'arialnb', 'arialni', 'arialnbi'],
  timesnewroman: ['times', 'timesbd', 'timesi', 'timesbi'], couriernew: ['cour', 'courbd', 'couri', 'courbi'],
  calibri: ['calibri', 'calibrib', 'calibrii', 'calibriz'], calibrilight: ['calibril', 'calibrib', 'calibrili', 'calibriz'],
  cambria: ['cambria', 'cambriab', 'cambriai', 'cambriaz'], candara: ['candara', 'candarab', 'candarai', 'candaraz'],
  verdana: ['verdana', 'verdanab', 'verdanai', 'verdanaz'], tahoma: ['tahoma', 'tahomabd', 'tahoma', 'tahomabd'],
  georgia: ['georgia', 'georgiab', 'georgiai', 'georgiaz'], segoeui: ['segoeui', 'segoeuib', 'segoeuii', 'segoeuiz'],
  trebuchetms: ['trebuc', 'trebucbd', 'trebucit', 'trebucbi'], consolas: ['consola', 'consolab', 'consolai', 'consolaz'],
  comicsansms: ['comic', 'comicbd', 'comici', 'comicz'], impact: ['impact', 'impact', 'impact', 'impact'],
  palatinolinotype: ['pala', 'palab', 'palai', 'palabi'], centurygothic: ['gothic', 'gothicb', 'gothici', 'gothicbi'],
  lucidaconsole: ['lucon', 'lucon', 'lucon', 'lucon'], sylfaen: ['sylfaen', 'sylfaen', 'sylfaen', 'sylfaen'],
  franklingothicmedium: ['framd', 'framd', 'framdit', 'framdit'], bookantiqua: ['bkant', 'bkant', 'bkant', 'bkant'],
};

function fontDirectories() {
  const home = os.homedir();
  const managed = path.join(app.getPath('userData'), 'fonts'); // per-user cache; never installs into the OS
  if (process.platform === 'win32') return [path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts'), path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'Microsoft', 'Windows', 'Fonts'), managed];
  if (process.platform === 'darwin') return ['/System/Library/Fonts', '/System/Library/Fonts/Supplemental', '/Library/Fonts', path.join(home, 'Library', 'Fonts'), managed];
  return ['/usr/share/fonts', '/usr/local/share/fonts', path.join(home, '.fonts'), path.join(home, '.local', 'share', 'fonts'), managed];
}

// Missing fonts may only be resolved to explicitly allow-listed, SIL Open Font Licensed
// metric-compatible alternatives. No user-provided font URL or arbitrary download host is trusted.
const OPEN_FONT_FALLBACKS = {
  arial: {
    folder: 'arimo', family: 'Arimo', licenseUrls: [
      'https://raw.githubusercontent.com/google/fonts/main/ofl/arimo/OFL.txt',
      'https://raw.githubusercontent.com/googlefonts/arimo/main/OFL.txt',
    ],
    fileUrls: (style, file) => [
      `https://raw.githubusercontent.com/google/fonts/main/apache/arimo/Arimo-${file}.ttf`,
      `https://raw.githubusercontent.com/google/fonts/main/ofl/arimo/static/Arimo-${file}.ttf`,
      `https://raw.githubusercontent.com/googlefonts/noto-fonts/main/hinted/ttf/Arimo/Arimo-${file}.ttf`,
    ],
  },
  calibri: {
    folder: 'carlito', family: 'Carlito', licenseUrls: [
      'https://raw.githubusercontent.com/googlefonts/carlito/main/OFL.txt',
      'https://raw.githubusercontent.com/google/fonts/main/ofl/carlito/OFL.txt',
    ],
    fileUrls: (style, file) => [
      `https://raw.githubusercontent.com/googlefonts/carlito/main/fonts/ttf/Carlito-${file}.ttf`,
      `https://raw.githubusercontent.com/google/fonts/main/ofl/carlito/static/Carlito-${file}.ttf`,
    ],
  },
  timesnewroman: {
    folder: 'tinos', family: 'Tinos', licenseUrls: [
      'https://raw.githubusercontent.com/google/fonts/main/ofl/tinos/OFL.txt',
    ],
    fileUrls: (style, file) => [
      `https://raw.githubusercontent.com/google/fonts/main/apache/tinos/Tinos-${file}.ttf`,
      `https://raw.githubusercontent.com/google/fonts/main/ofl/tinos/static/Tinos-${file}.ttf`,
      `https://raw.githubusercontent.com/googlefonts/noto-fonts/main/hinted/ttf/Tinos/Tinos-${file}.ttf`,
    ],
  },
};
const FONT_STYLE_FILES = ['Regular', 'Bold', 'Italic', 'BoldItalic'];
const FONT_MAX_BYTES = 12 * 1024 * 1024;

async function fetchFontAsset(url, expectedLicense = false) {
  // Only hard-coded HTTPS GitHub raw URLs in OPEN_FONT_FALLBACKS are passed here.
  const response = await fetch(url, { signal: AbortSignal.timeout(10000), redirect: 'error', headers: { 'user-agent': 'PDF-Studio-font-cache/1.0' } });
  if (!response.ok) throw new Error(`Font host returned HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.length || bytes.length > (expectedLicense ? 512 * 1024 : FONT_MAX_BYTES)) throw new Error('Font asset size is outside the permitted limit.');
  if (!expectedLicense) {
    const signature = String.fromCharCode(...bytes.slice(0, 4));
    if (!(signature === '\u0000\u0001\u0000\u0000' || signature === 'OTTO' || signature === 'true' || signature === 'typ1')) throw new Error('Downloaded file is not a valid TTF/OTF font.');
  }
  return bytes;
}

async function downloadOpenFontFallback(familyKey, style) {
  const spec = OPEN_FONT_FALLBACKS[familyKey];
  if (!spec) return null;
  const folder = path.join(app.getPath('userData'), 'fonts', spec.folder);
  const fileName = `${spec.family}-${FONT_STYLE_FILES[style]}.ttf`;
  const destination = path.join(folder, fileName);
  try {
    const cached = await fs.readFile(destination);
    if (cached.length > 0 && cached.length <= FONT_MAX_BYTES) return new Uint8Array(cached);
  } catch { /* download missing style */ }
  try {
    await fs.mkdir(folder, { recursive: true });
    const licensePath = path.join(folder, 'OFL.txt');
    let licenseValid = false;
    try { licenseValid = (await fs.readFile(licensePath, 'utf8')).includes('SIL OPEN FONT LICENSE'); } catch { /* fetch license below */ }
    if (!licenseValid) {
      let license = null;
      for (const url of spec.licenseUrls) {
        try {
          const bytes = await fetchFontAsset(url, true);
          const body = Buffer.from(bytes).toString('utf8');
          if (!body.includes('SIL OPEN FONT LICENSE')) continue;
          license = body; break;
        } catch { /* try next known official mirror */ }
      }
      if (!license) return null;
      await fs.writeFile(licensePath, license, { flag: 'w' });
    }
    let fontBytes = null;
    for (const url of spec.fileUrls(style, FONT_STYLE_FILES[style])) {
      try { fontBytes = await fetchFontAsset(url); break; } catch { /* try next allow-listed official mirror */ }
    }
    if (!fontBytes) return null;
    await fs.writeFile(destination, fontBytes, { flag: 'wx' }).catch(async (error) => { if (error.code !== 'EEXIST') throw error; });
    fontIndexPromise = null; // Include the newly cached family on subsequent lookups.
    return fontBytes;
  } catch (error) {
    console.warn('[pdf-studio] Open font fallback unavailable:', spec.family, error?.message || error);
    return null;
  }
}

async function walkFonts(dir, depth, out) {
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (depth > 0) await walkFonts(full, depth - 1, out); continue; }
    const ext = path.extname(entry.name).toLowerCase();
    if (ext === '.ttf' || ext === '.otf') out.set(fontNorm(path.basename(entry.name, ext)), full);
  }
}

function getFontIndex() {
  if (!fontIndexPromise) {
    fontIndexPromise = (async () => {
      const index = new Map();
      for (const dir of fontDirectories()) await walkFonts(dir, 3, index);
      return index;
    })();
  }
  return fontIndexPromise;
}

async function findInstalledFont({ family, bold, italic }) {
  const index = await getFontIndex();
  const key = fontNorm(family);
  if (!key) return null;
  const style = (bold ? 1 : 0) + (italic ? 2 : 0);
  const candidates = [];
  if (WINDOWS_FONT_FILES[key]) candidates.push(WINDOWS_FONT_FILES[key][style]);
  const suffixes = [['', 'regular', 'roman', 'book'], ['bold', 'b', 'bd'], ['italic', 'it', 'i', 'oblique'], ['bolditalic', 'boldit', 'bi', 'z', 'boldoblique']][style];
  for (const suffix of suffixes) candidates.push(key + suffix);
  for (const candidate of candidates) {
    const file = index.get(candidate);
    if (!file) continue;
    try {
      const stat = await fs.stat(file);
      if (stat.size > 30 * 1024 * 1024) continue;
      return new Uint8Array(await fs.readFile(file));
    } catch { /* try the next candidate */ }
  }
  // Silently cache an open-licensed metrically compatible family under app data, without
  // prompting for elevation or registering a system-wide Windows font.
  return await downloadOpenFontFallback(key, style);
}

// ───────────────────────── Startup splash ─────────────────────────
const SPLASH_MIN_MS = 2850;        // long enough for the opening animation to finish
const SPLASH_READY_HOLD_MS = 620;   // lets the final progress segment fill before the splash fades
const STARTUP_WATCHDOG_MS = 22000;  // safety net only; the normal path waits for the renderer's ready signal
let splashWindow = null;
let splashShownAt = 0;
let splashLoaded = false;
let splashState = { step: 1, version: '', leaving: false };
let mainRevealed = false;

function sendSplash(patch) {
  Object.assign(splashState, patch);
  if (splashWindow && !splashWindow.isDestroyed() && splashLoaded) splashWindow.webContents.send('splash:update', splashState);
}
function createSplashWindow() {
  splashState.version = app.getVersion();
  splashWindow = new BrowserWindow({
    width: 560, height: 360, show: false, frame: false, transparent: true, hasShadow: false,
    resizable: false, maximizable: false, minimizable: false, fullscreenable: false, skipTaskbar: true,
    alwaysOnTop: true, center: true, title: 'PDF Studio', icon: getAppIconPath(), backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'splash-preload.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true,
      webviewTag: false, devTools: false, spellcheck: false,
    },
  });
  splashWindow.setMenuBarVisibility(false);
  splashWindow.webContents.once('did-finish-load', () => { splashLoaded = true; sendSplash({}); });
  splashWindow.once('ready-to-show', () => { if (!splashWindow.isDestroyed()) { splashShownAt = Date.now(); splashWindow.show(); } });
  splashWindow.on('closed', () => { splashWindow = null; });
  splashWindow.loadFile(path.join(__dirname, 'splash.html')).catch(() => { if (splashWindow && !splashWindow.isDestroyed()) splashWindow.destroy(); });
}
/** Shows the main window once the UI is mounted (or on failure/timeout) and fades the splash out over it. */
function revealMainWindow() {
  if (mainRevealed) return;
  mainRevealed = true;
  // Everything is loaded: fill the last progress segment ("Ready"), then let the whole animation finish.
  sendSplash({ step: 4 });
  const sinceShown = splashShownAt ? Date.now() - splashShownAt : SPLASH_MIN_MS;
  const wait = splashShownAt ? Math.max(SPLASH_READY_HOLD_MS, SPLASH_MIN_MS - sinceShown) : 0;
  setTimeout(() => {
    // Show the already-painted app underneath, then fade the splash out over it.
    if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.show(); mainWindow.focus(); }
    sendSplash({ leaving: true });
    setTimeout(() => { if (splashWindow && !splashWindow.isDestroyed()) splashWindow.destroy(); }, 450);
    setTimeout(runBackgroundStartup, 1500).unref?.();
  }, wait);
}
handle('app:renderer-ready', (event) => {
  if (mainWindow && event.sender === mainWindow.webContents) revealMainWindow();
  return true;
});

// ---- Unsaved-edit protection for the main window ----------------------------------------------------------
// The renderer reports whether any in-app Edit PDF tab has unsaved edits. Closing the window (title-bar X, Alt+F4) or
// quitting the app then asks once, natively. Choosing "Discard and close" proceeds for real; the old renderer-only
// `beforeunload` guard had no main-process handler, so Electron silently cancelled the close and the app never exited.
let rendererHasUnsaved = false;
let closeConfirmed = false;
let closePromptOpen = false;
function askDiscardUnsaved(win) {
  if (closePromptOpen) return Promise.resolve(false);
  closePromptOpen = true;
  if (win && !win.isDestroyed()) { if (win.isMinimized()) win.restore(); win.show(); }
  const options = {
    type: 'warning', buttons: ['Discard and close', 'Keep editing'], defaultId: 1, cancelId: 1, noLink: true,
    title: 'Unsaved PDF edits', message: 'You have unsaved PDF edits.',
    detail: 'If you close PDF Studio now, those edits will be lost. Your original PDF is not changed.',
  };
  const shown = win && !win.isDestroyed() ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options);
  return shown.then(({ response }) => response === 0).catch(() => false).finally(() => { closePromptOpen = false; });
}
handle('app:set-unsaved', (event, value) => {
  if (mainWindow && !mainWindow.isDestroyed() && event.sender === mainWindow.webContents) rendererHasUnsaved = value === true;
  return true;
});

function createWindow() {
  // Each newly created window gets its own chance to display a startup diagnostic.
  startupFailureShown = false;
  mainWindow = new BrowserWindow({
    icon: getAppIconPath(),
    width: 1360,
    height: 880,
    // Small enough for half-screen snapping and small laptops; the renderer adapts down to this size.
    minWidth: 520,
    minHeight: 480,
    show: false,
    // Windows draws its own window buttons in the app title bar.
    frame: false,
    backgroundColor: '#f6f7fb',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      allowRunningInsecureContent: false,
      devTools: !app.isPackaged,
    },
  });
  // The window stays hidden behind the splash until the renderer reports that the UI is mounted.
  mainWindow.webContents.once('did-start-loading', () => sendSplash({ step: 2 }));
  mainWindow.webContents.once('dom-ready', () => sendSplash({ step: 3 }));
  setTimeout(revealMainWindow, STARTUP_WATCHDOG_MS).unref?.();
  mainWindow.on('focus', recheckAccessSoon);
  mainWindow.on('focus', () => { void flushPendingReviews(); });
  mainWindow.on('maximize', () => mainWindow.webContents.send('window:maximized', true));
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('window:maximized', false));
  mainWindow.on('enter-full-screen', () => mainWindow.webContents.send('window:fullscreen', true));
  mainWindow.on('leave-full-screen', () => mainWindow.webContents.send('window:fullscreen', false));
  mainWindow.on('close', (event) => {
    if (closeConfirmed || !rendererHasUnsaved) return;
    event.preventDefault();
    void askDiscardUnsaved(mainWindow).then((discard) => {
      if (!discard) return;
      closeConfirmed = true;
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
    });
  });
  // Once the user has confirmed (or nothing is unsaved) a stale renderer `beforeunload` guard must never block shutdown.
  mainWindow.webContents.on('will-prevent-unload', (event) => { if (closeConfirmed || !rendererHasUnsaved) event.preventDefault(); });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame || startupFailureShown || String(validatedURL || '').startsWith('data:')) return;
    void showStartupFailure(mainWindow, {
      heading: 'The application page failed to load',
      message: 'Electron reported a renderer page-loading error.',
      details: `${validatedURL || '(unknown URL)'}\n${errorCode}: ${errorDescription}`,
    });
  });

  loadRenderer(mainWindow).catch((error) => console.error('[pdf-studio] Renderer load failed:', error));
}

app.whenReady().then(() => {
  if (!gotInstanceLock) return;
  // Deny every web permission request (camera, mic, geolocation, notifications…); the app needs none of them.
  const allowed = new Set(['fullscreen', 'clipboard-sanitized-write']);
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => callback(allowed.has(permission)));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));
  createSplashWindow();
  loadAccessCacheSync();
  createWindow();
  startAccessControl();
  startReviewOutboxService();
  // The access check stays on the launch path on purpose: it is one small async request, and the cached lock is
  // already in force. The update-package hash and the telemetry are not needed for the first frame and used to
  // compete with the renderer for disk and CPU, so they start once the window is shown (runBackgroundStartup).
  // The timer is only a safety net for machines where ready-to-show never fires.
  setTimeout(runBackgroundStartup, 6000).unref?.();
});

let backgroundStartupDone = false;
function runBackgroundStartup() {
  if (backgroundStartupDone) return;
  backgroundStartupDone = true;
  void startUsageMonitoring();
  // Validate any previously staged package before doing a fresh release lookup.
  // Every launch checks in the background; repeat checks during long sessions without interrupting document work.
  void restorePendingUpdate().then(() => {
    if (pendingUpdate) {
      publishUpdaterState({ status: 'ready', latestVersion: pendingUpdate.version, message: `Version ${pendingUpdate.version} is downloaded and ready to install.` });
      // React also reads getUpdaterState on mount, so a renderer startup race cannot lose this prompt.
      setTimeout(() => notifyUpdateReady(pendingUpdate), 900);
    }
    autoUpdateTimer = setTimeout(() => { void checkAndStageUpdate({ manual: false }); }, 5000);
    autoUpdateTimer.unref?.();
    autoUpdateInterval = setInterval(() => { void checkAndStageUpdate({ manual: false }); }, 6 * 60 * 60 * 1000);
    autoUpdateInterval.unref?.();
  });
}
app.on('window-all-closed', () => { app.quit(); });
app.on('before-quit', (event) => {
  if (usageShutdownComplete) return;
  if (usageShutdownInProgress) { event.preventDefault(); return; }
  // Quit paths other than the window's own close (tray, installer-driven update, taskbar "Close all windows").
  if (rendererHasUnsaved && !closeConfirmed) {
    event.preventDefault();
    void askDiscardUnsaved(mainWindow).then((discard) => { if (discard) { closeConfirmed = true; app.quit(); } });
    return;
  }
  usageShutdownInProgress = true;
  event.preventDefault();
  stopAccessControl();
  if (autoUpdateTimer) clearTimeout(autoUpdateTimer);
  if (autoUpdateInterval) clearInterval(autoUpdateInterval);
  if (reviewOutboxTimer) clearInterval(reviewOutboxTimer);
  reviewOutboxTimer = null;
  clearAutoUpdateRetry();
  if (activeUpdateDownload) { activeUpdateDownload.cancelled = true; activeUpdateDownload.controller.abort(); }
  void stopUsageMonitoring().finally(() => {
    usageShutdownComplete = true;
    app.quit();
  });
});

handle('access:get-state', () => publicAccessState());
handle('access:recheck', async () => {
  if (accessCheckPromise) return accessCheckPromise;
  return checkAccessPolicy();
});
handle('window:minimize', () => mainWindow?.minimize());
handle('window:maximize-toggle', () => {
  if (!mainWindow) return false;
  if (mainWindow.isMaximized()) mainWindow.unmaximize(); else mainWindow.maximize();
  return mainWindow.isMaximized();
});
handle('window:close', () => mainWindow?.close());
handle('window:is-maximized', () => Boolean(mainWindow?.isMaximized()));
handle('app:version', () => app.getVersion());
handle('app:open-external', async (_event, url) => {
  if (!openExternalSafe(url)) throw new TypeError('Only plain HTTPS links are allowed.');
});
handle('app:platform', () => process.platform);
handle('theme:get-system', () => getSystemThemeName());
handle('updater:check', async () => {
  void checkAndStageUpdate({ manual: true });
  return { status: 'checking', message: 'Checking for updates…' };
});
handle('updater:get-state', async () => getUpdaterSnapshot());
handle('updater:prompt-shown', async (_event, version) => { markUpdatePromptShown(version); return true; });
handle('updater:update-later', async (_event, version) => { markUpdatePromptShown(version); return true; });
handle('updater:apply-now', async () => applyPendingUpdateNow());
handle('updater:cancel', () => {
  if (!activeUpdateDownload) return false;
  activeUpdateDownload.cancelled = true;
  activeUpdateDownload.controller.abort();
  return true;
});
handle('updater:open-downloads', async () => shell.openPath(app.getPath('downloads')));

handle('files:open', async (event, options) => {
  assertAccessAllowed();
  const parent = BrowserWindow.fromWebContents(event.sender) || mainWindow;
  const pdfOnly = Boolean(options && options.pdfOnly);
  // accept: 'images' (Images to PDF) | 'pdf' (PDF tools) | anything else = every supported type.
  const accept = pdfOnly ? 'pdf-single' : (options && options.accept) || 'all';
  const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'tif', 'tiff'];
  // Format converter: everything it can decode (HEIC/AVIF/SVG/ICO are not offered to the PDF tools).
  const CONVERT_EXTS = [...IMAGE_EXTS, 'heic', 'heif', 'hif', 'avif', 'jfif', 'svg', 'ico'];
  const dialogSpec = {
    'pdf-single': { title: 'Select a PDF file', multi: false, filters: [{ name: 'PDF documents', extensions: ['pdf'] }] },
    pdf: { title: 'Select PDF files', multi: true, filters: [{ name: 'PDF documents', extensions: ['pdf'] }] },
    images: { title: 'Select images to convert to PDF', multi: true, filters: [{ name: 'Images', extensions: IMAGE_EXTS }] },
    convert: { title: 'Select images to convert', multi: true, filters: [{ name: 'Images', extensions: CONVERT_EXTS }] },
    all: { title: 'Add documents to PDF Studio', multi: true, filters: [{ name: 'Supported documents', extensions: ['pdf', ...IMAGE_EXTS] }] },
  }[accept] || null;
  const spec = dialogSpec || { title: 'Add documents to PDF Studio', multi: true, filters: [{ name: 'Supported documents', extensions: ['pdf', ...IMAGE_EXTS] }] };
  const picked = await dialog.showOpenDialog(parent, {
    title: spec.title,
    properties: spec.multi ? ['openFile', 'multiSelections'] : ['openFile'],
    filters: spec.filters,
  });
  if (picked.canceled) return [];
  const output = [];
  for (const filePath of picked.filePaths) {
    const ext = path.extname(filePath).toLowerCase();
    // Dialog filters are not a security boundary: reject unsupported files here as well.
    if (ext !== '.pdf' && !(accept === 'convert' ? CONVERT_EXTS : IMAGE_EXTS).includes(ext.slice(1))) continue;
    if (accept === 'convert' && ext === '.pdf') continue;
    const raw = await fs.readFile(filePath);
    const mimeByExt = {
      '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
      '.webp': 'image/webp', '.bmp': 'image/bmp', '.gif': 'image/gif', '.tif': 'image/tiff', '.tiff': 'image/tiff',
      '.heic': 'image/heic', '.heif': 'image/heif', '.hif': 'image/heif', '.avif': 'image/avif', '.jfif': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
    };
    output.push({ name: path.basename(filePath), path: filePath, mime: mimeByExt[ext], kind: ext === '.pdf' ? 'pdf' : 'image', bytes: new Uint8Array(raw) });
  }
  return output;
});

async function openExportFolder(filePath) {
  try {
    const folderPath = path.dirname(String(filePath || ''));
    if (folderPath && folderPath !== '.') {
      const error = await shell.openPath(folderPath);
      if (error) console.warn('[PDF Studio] Could not open the export folder:', error);
    }
  } catch (error) {
    console.warn('[PDF Studio] Could not open the export folder:', error?.message || error);
  }
}

handle('files:save', async (event, { name, data, filters }) => {
  assertAccessAllowed();
  const safeFile = safeName(name, 'PDF-Studio-export.pdf');
  const defaultExt = path.extname(safeFile).replace('.', '') || 'pdf';
  const result = await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender) || mainWindow, {
    title: 'Save export', defaultPath: safeFile,
    filters: Array.isArray(filters) && filters.length ? filters : [{ name: defaultExt.toUpperCase(), extensions: [defaultExt] }],
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  await fs.writeFile(result.filePath, toSafeBuffer(data));
  await openExportFolder(result.filePath);
  return { canceled: false, filePath: result.filePath };
});

function hasPdfHeader(data) {
  const source = toSafeBuffer(data);
  const marker = Buffer.from('%PDF-', 'ascii');
  const offset = source.indexOf(marker);
  return offset >= 0 && offset <= 1023;
}

handle('pdf:compression-engine-info', async () => {
  assertAccessAllowed();
  const info = await ghostscriptCompression.getGhostscriptInfo();
  // Do not expose full local paths to renderer UI; the renderer only needs availability/version.
  return { available: Boolean(info.available), engine: info.engine || null, version: info.version || null, reason: info.reason || null };
});

handle('pdf:smart-compress', async (_event, payload) => {
  assertAccessAllowed();
  if (!payload || typeof payload !== 'object' || !payload.data) throw new TypeError('No PDF data was supplied for smart compression.');
  const source = toSafeBuffer(payload.data);
  if (!hasPdfHeader(source)) throw new TypeError('Choose a valid PDF file to compress.');
  const options = payload.options && typeof payload.options === 'object' ? payload.options : {};
  // Missing Ghostscript is an expected, optional-engine state. Report it as data so Electron does not
  // log "Error occurred in handler" for every attempt; the renderer falls back to the built-in optimizer.
  const engine = await ghostscriptCompression.getGhostscriptInfo();
  if (!engine.available) return { unavailable: true, code: 'PDFSTUDIO_GHOSTSCRIPT_UNAVAILABLE', reason: engine.reason || 'Ghostscript is unavailable.' };
  const result = await ghostscriptCompression.compressWithGhostscript(source, {
    preset: String(options.preset || 'balanced'),
    resolutionDpi: options.resolutionDpi,
    quality: options.quality,
    colorMode: ['color', 'grayscale'].includes(options.colorMode) ? options.colorMode : 'color',
    preserveMetadata: options.preserveMetadata !== false,
    includeAnnotations: options.includeAnnotations !== false,
    password: String(options.password || ''),
    imageObjectCount: Number.isFinite(Number(options.imageObjectCount)) ? Number(options.imageObjectCount) : undefined,
    duplicateImageEstimate: Number.isFinite(Number(options.duplicateImageEstimate)) ? Number(options.duplicateImageEstimate) : undefined,
    detectDuplicateImages: options.detectDuplicateImages !== false,
    imageFilterMode: ['auto', 'jpeg'].includes(options.imageFilterMode) ? options.imageFilterMode : undefined,
    timeoutMs: options.timeoutMs,
  });
  if (!hasPdfHeader(result.bytes)) throw new Error('The smart optimizer returned an invalid PDF document.');
  return { bytes: result.bytes, engine: result.engine, version: result.version, warnings: result.warnings };
});

handle('pdf:optimize', async (_event, payload) => {
  assertAccessAllowed();
  if (!payload || typeof payload !== 'object' || !payload.data) throw new TypeError('No PDF data was supplied for optimization.');
  const source = toSafeBuffer(payload.data);
  if (!hasPdfHeader(source)) throw new TypeError('Choose a valid PDF file to optimize.');
  // QPDF/WASM runs in the existing worker thread so lossless optimization never blocks Electron's UI thread.
  const optimized = toSafeBuffer(await finalizePdfInWorker(source, { compress: true }));
  if (!hasPdfHeader(optimized)) throw new Error('The PDF optimizer returned an invalid document.');
  return new Uint8Array(optimized);
});

handle('pdf:lock', async (_event, payload) => {
  assertAccessAllowed();
  if (!payload || typeof payload !== 'object' || !payload.data) throw new TypeError('No PDF data was supplied for password protection.');
  const source = toSafeBuffer(payload.data);
  if (!hasPdfHeader(source)) throw new TypeError('Choose a valid PDF file to protect.');
  const password = String(payload.password || '');
  if (password.length < 8 || password.length > 1024) throw new TypeError('Use an output password between 8 and 1024 characters.');
  // Passwords are passed only through the isolated Electron IPC to the local PDF toolkit worker;
  // they are never written to logs or persistent settings.
  const protectedPdf = toSafeBuffer(await finalizePdfInWorker(source, { password }));
  if (!hasPdfHeader(protectedPdf)) throw new Error('The PDF toolkit returned an invalid protected document.');
  return new Uint8Array(protectedPdf);
});

const ocrContext = () => ({ resourcesPath: process.resourcesPath, projectRoot: app.getAppPath(), userDataPath: app.getPath('userData') });

// PDF-to-Word OCR: prefer a native Tesseract install, otherwise use the built-in offline engine.
handle('pdf:ocr-image', async (_event, payload) => {
  assertAccessAllowed();
  if (!payload || typeof payload !== 'object' || !payload.image) throw new TypeError('No image was supplied for OCR.');
  const image = toSafeBuffer(payload.image);
  if (image.length > 25 * 1024 * 1024) throw new RangeError('The rendered page is too large for OCR.');
  const native = await ocrService.recognizeImage(image, {
    language: String(payload.language || 'eng'),
    resourcesPath: process.resourcesPath,
    projectRoot: app.getAppPath(),
    timeoutMs: payload.timeoutMs,
  });
  if (native.available) return native;
  try {
    const builtIn = await imageTextExtractor.recognizeImage(image, { language: String(payload.language || 'eng'), psm: 'block', timeoutMs: payload.timeoutMs, ...ocrContext() });
    return builtIn.available ? builtIn : native;
  } catch { return native; }
});

// Image-to-text tool.
handle('ocr:languages', async () => {
  assertAccessAllowed();
  return imageTextExtractor.listLanguages(ocrContext());
});

handle('ocr:image-text', async (_event, payload) => {
  assertAccessAllowed();
  if (!payload || typeof payload !== 'object' || !payload.image) throw new TypeError('No image was supplied for text extraction.');
  const image = toSafeBuffer(payload.image);
  if (image.length > 25 * 1024 * 1024) throw new RangeError('The image is too large for text extraction (25 MB maximum).');
  return imageTextExtractor.recognizeImage(image, {
    language: String(payload.language || 'eng'),
    psm: String(payload.psm || 'auto'),
    timeoutMs: payload.timeoutMs,
    ...ocrContext(),
  });
});

app.on('will-quit', () => { imageTextExtractor.shutdown().catch(() => {}); });

handle('files:save-finalized-pdf', async (event, payload) => {
  assertAccessAllowed();
  if (!payload || typeof payload !== 'object') throw new TypeError('Missing PDF export data.');
  const safeFile = safeName(payload.name, 'PDF-Studio-export.pdf');
  const defaultExt = path.extname(safeFile).replace('.', '') || 'pdf';
  const options = payload.options && typeof payload.options === 'object' ? payload.options : {};
  const password = String(options.password || '');
  if (password && password.length < 8) throw new Error('Use at least 8 characters for the PDF password.');
  if (password.length > 4096) throw new Error('The PDF password is too long.');

  const result = await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender) || mainWindow, {
    title: 'Save exported PDF',
    defaultPath: safeFile,
    filters: Array.isArray(payload.filters) && payload.filters.length
      ? payload.filters
      : [{ name: 'PDF document', extensions: [defaultExt] }],
  });
  if (result.canceled || !result.filePath) return { canceled: true };

  // Keep the potentially large result out of the renderer-to-main round trip. Compression/encryption
  // stays in a worker thread, and the target file is written only after a successful transformation.
  let output = toSafeBuffer(payload.data);
  if (Boolean(options.compress) || password) {
    const transformed = await finalizePdfInWorker(output, { compress: Boolean(options.compress), password });
    output = toSafeBuffer(transformed);
  }
  await fs.writeFile(result.filePath, output);
  await openExportFolder(result.filePath);
  return { canceled: false, filePath: result.filePath };
});

handle('files:save-batch', async (event, files) => {
  assertAccessAllowed();
  if (!Array.isArray(files) || files.length === 0) return { canceled: true, count: 0 };
  const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender) || mainWindow, { title: 'Choose an export folder', properties: ['openDirectory', 'createDirectory'] });
  if (result.canceled || !result.filePaths[0]) return { canceled: true, count: 0 };
  const folder = result.filePaths[0];
  const used = new Set();
  let count = 0;
  for (const file of files) {
    let name = safeName(file.name, `export-${count + 1}.bin`);
    const ext = path.extname(name);
    const stem = path.basename(name, ext);
    let candidate = name;
    let n = 2;
    while (used.has(candidate.toLowerCase())) { candidate = `${stem} (${n++})${ext}`; }
    used.add(candidate.toLowerCase());
    await fs.writeFile(path.join(folder, candidate), toSafeBuffer(file.data));
    count += 1;
  }
  await shell.openPath(folder).catch((error) => console.warn('[PDF Studio] Could not open the export folder:', error?.message || error));
  return { canceled: false, count, folder };
});


// ── Multi-file exports (PDF → images, Split PDF): create a new sub-folder inside the chosen folder, then stream files into it one at a time ──
const folderExportSessions = new Map(); // token -> { folder, used:Set, written:number }
handle('files:choose-folder', async (event, options) => {
  assertAccessAllowed();
  const defaultPath = typeof options?.defaultPath === 'string' && path.isAbsolute(options.defaultPath) ? options.defaultPath : undefined;
  const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender) || mainWindow, {
    title: 'Choose where to save the images', defaultPath, buttonLabel: 'Select folder', properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || !result.filePaths[0]) return { canceled: true };
  return { canceled: false, folder: result.filePaths[0] };
});
handle('exports:begin', async (_event, payload) => {
  assertAccessAllowed();
  const parent = String(payload?.parent || '');
  if (!parent || !path.isAbsolute(parent)) throw new Error('Choose a folder to save the images in.');
  const stat = await fs.stat(parent).catch(() => null);
  if (!stat?.isDirectory()) throw new Error('The selected folder no longer exists. Choose another folder.');
  const stem = (safeName(payload?.folderName, 'images').replace(/[. ]+$/, '') || 'images').slice(0, 120);
  // Never write into or over an existing folder: "name-images", then "name-images (2)", …
  let folder = '';
  for (let attempt = 1; attempt <= 500 && !folder; attempt += 1) {
    const candidate = path.join(parent, attempt === 1 ? stem : `${stem} (${attempt})`);
    try { await fs.mkdir(candidate); folder = candidate; }
    catch (error) { if (error?.code !== 'EEXIST') throw new Error(`Could not create the export folder: ${error?.message || error}`); }
  }
  if (!folder) throw new Error('Could not find an unused folder name. Choose another location.');
  const token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  folderExportSessions.set(token, { folder, used: new Set(), written: 0 });
  return { token, folder };
});
handle('exports:write', async (_event, payload) => {
  assertAccessAllowed();
  const session = folderExportSessions.get(String(payload?.token || ''));
  if (!session) throw new Error('This export is no longer active.');
  const name = safeName(payload?.name, `image-${session.written + 1}.png`);
  const ext = path.extname(name); const stem = path.basename(name, ext);
  let candidate = name; let n = 2;
  while (session.used.has(candidate.toLowerCase())) candidate = `${stem} (${n++})${ext}`;
  session.used.add(candidate.toLowerCase());
  await fs.writeFile(path.join(session.folder, candidate), toSafeBuffer(payload.data));
  session.written += 1;
  return session.written;
});
handle('exports:finish', async (_event, payload) => {
  assertAccessAllowed();
  const token = String(payload?.token || '');
  const session = folderExportSessions.get(token);
  if (!session) return { count: 0 };
  folderExportSessions.delete(token);
  if (session.written === 0) { await fs.rmdir(session.folder).catch(() => {}); return { count: 0 }; }
  if (payload?.open) await shell.openPath(session.folder).catch((error) => console.warn('[PDF Studio] Could not open the export folder:', error?.message || error));
  return { count: session.written, folder: session.folder };
});


handle('editor:open', async (_event, payload) => {
  assertAccessAllowed();
  const bytes = payload && payload.bytes ? new Uint8Array(payload.bytes) : null;
  try {
    createEditorWindow(bytes ? { name: safeName(payload.name, 'document.pdf'), bytes } : null);
    return true;
  } catch (error) {
    console.error('[pdf-studio] Could not open the Edit PDF window:', error);
    return false;
  }
});
handle('editor:init', (event) => {
  const payload = editorInitPayloads.get(event.sender.id) || null;
  editorInitPayloads.set(event.sender.id, null);
  return payload;
});
handle('editor:close', (event) => { BrowserWindow.fromWebContents(event.sender)?.close(); return true; });
handle('editor:set-title', (event, title) => { BrowserWindow.fromWebContents(event.sender)?.setTitle(String(title || 'PDF Studio - Edit PDF').slice(0, 200)); return true; });
handle('review:maybe-prompt', async () => {
  assertAccessAllowed();
  await accountReviewUsage();
  const state = await loadReviewState();
  const now = Date.now();
  const liveSeconds = usageSession
    ? Math.max(0, Math.floor((now - Number(usageSession.reviewAccountedMs || usageSession.startedMs || now)) / 1000))
    : 0;
  const totalUsageSeconds = state.totalUsageSeconds + liveSeconds;
  const cooldownMs = 7 * 24 * 60 * 60 * 1000;
  const blocked = reviewOutboxReadBlocked || reviewStateReadBlocked;
  if (reviewQueuePolicy.shouldSuppressReviewPrompt(state, blocked, { appVersion: app.getVersion(), now })) {
    // Permanent only for an explicit opt-out or an unreadable store. A recent review (or one still being delivered)
    // just pauses the prompt; it is checked again later so it can return after 90 days / a new major version.
    const permanent = blocked || state.neverAskAgain;
    const resting = reviewQueuePolicy.reviewCooldownRemainingMs(state, app.getVersion(), now);
    return {
      shouldPrompt: false, stopChecking: permanent, totalUsageSeconds,
      submitted: Boolean(state.submittedAt), recentlyReviewed: resting > 0,
      pending: Boolean(state.pendingReviewId || state.reviewStatus === 'pending' || reviewOutboxReadBlocked),
      nextCheckAfterMs: resting > 0 ? Math.min(24 * 60 * 60 * 1000, resting) : 60 * 60 * 1000,
    };
  }
  if (now < state.snoozedUntil) {
    return { shouldPrompt: false, totalUsageSeconds, nextCheckAfterMs: Math.min(24 * 60 * 60 * 1000, state.snoozedUntil - now) };
  }
  if (state.lastPromptAt && now - state.lastPromptAt < cooldownMs) {
    return { shouldPrompt: false, totalUsageSeconds, nextCheckAfterMs: Math.min(24 * 60 * 60 * 1000, cooldownMs - (now - state.lastPromptAt)) };
  }
  // 30 minutes of use in total, and (after a review) 30 minutes of new use since it.
  const usageSinceReview = Math.max(0, totalUsageSeconds - state.usageSecondsAtReview);
  const neededSeconds = Math.max(0, reviewQueuePolicy.REVIEW_MIN_NEW_USAGE_SECONDS - usageSinceReview);
  if (totalUsageSeconds < 30 * 60 || neededSeconds > 0) {
    const missing = Math.max(30 * 60 - totalUsageSeconds, neededSeconds);
    return { shouldPrompt: false, totalUsageSeconds, nextCheckAfterMs: Math.max(60_000, Math.min(10 * 60_000, missing * 1000 + Math.random() * 20_000)) };
  }
  const shouldPrompt = Math.random() < 0.28;
  return { shouldPrompt, totalUsageSeconds, submitted: false, nextCheckAfterMs: shouldPrompt ? 0 : Math.round((12 + Math.random() * 18) * 60_000) };
});
handle('review:prompt-shown', async () => {
  const state = await loadReviewState();
  if (reviewQueuePolicy.shouldSuppressReviewPrompt(state, reviewOutboxReadBlocked || reviewStateReadBlocked)) return false;
  state.lastPromptAt = Date.now();
  state.promptCount = Math.min(10000, state.promptCount + 1);
  await persistReviewState();
  return true;
});
handle('review:defer', async (_event, choice) => {
  const state = await loadReviewState();
  if (state.pendingReviewId || state.reviewStatus === 'pending') return true;
  if (String(choice) === 'never') {
    state.neverAskAgain = true;
    state.snoozedUntil = 0;
  } else {
    state.snoozedUntil = Date.now() + 7 * 24 * 60 * 60 * 1000;
  }
  await persistReviewState();
  return true;
});
handle('review:submit', async (_event, review) => {
  assertAccessAllowed();
  const rating = Number(review?.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new Error('Choose a rating from 1 to 5 stars.');
  const state = await loadReviewState();
  // Reviews are never blocked here: people may review whenever they like (the Monitor rate-limits abuse). Only the
  // automatic prompt rests after a review; see review-queue-policy.cjs.
  if (reviewStateReadBlocked && state.pendingReviewId === 'state-unreadable') throw new Error('PDF Studio could not safely recover its local review history. No new review was added to avoid a possible duplicate.');
  if (reviewOutboxReadBlocked) throw new Error('PDF Studio could not safely read its existing encrypted review queue. No new review was added and no pending feedback was overwritten.');
  if (state.pendingReviewId || state.reviewStatus === 'pending') {
    // A review is already waiting: try to deliver it right now instead of just reporting it as queued.
    const retry = await flushPendingReviews({ force: true });
    return { ok: true, queued: !retry.delivered, delivered: retry.delivered > 0, alreadyQueued: true, detail: retry.message || '' };
  }

  // No name given -> the machine's hostname identifies the reviewer in the Monitor.
  await accountReviewUsage();
  state.usageSecondsAtReview = state.totalUsageSeconds; // the next automatic prompt needs fresh use after this review
  const hostname = getUsageHostname();
  const name = (String(review?.name || '').replace(/[\x00-\x1f\x7f]/g, '').trim() || hostname).slice(0, 60);
  const message = String(review?.message || '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').trim().slice(0, 1500);
  await ensureUsageIdentity();
  const reviewId = crypto.randomBytes(16).toString('hex');
  const payload = {
    event: 'review', app: 'pdfstudio', session_id: reviewId,
    client_review_id: reviewId,
    install_id: usageIdentity.installId, version: app.getVersion(), os: getUsageOsLabel(),
    hostname: getUsageHostname(), local_ip: getUsageLocalIp(),
    started_at: Math.floor(Date.now() / 1000), seconds: 0, rating, name, message,
  };

  // The encrypted outbox is written first. Only after it is durable do we suppress future prompts,
  // so an interrupted process cannot lose a review and then ask the same person to write it again.
  try {
    await queueReview(payload, reviewId);
  } catch (queueError) {
    // Secure storage unavailable: send straight to the Monitor so the review is not lost.
    const direct = await postMonitorUsage(payload, 10000);
    if (direct.status !== 'delivered') throw new Error(`Your review could not be sent or saved on this device (${String(direct.message || queueError?.message || 'unknown error').slice(0, 160)}). Please try again later.`);
    state.submittedAt = Date.now(); state.reviewStatus = 'submitted'; state.pendingReviewId = ''; state.lastReviewId = reviewId; state.lastReviewVersion = app.getVersion(); state.snoozedUntil = 0;
    state.usageSecondsAtReview = state.totalUsageSeconds;
    await persistReviewState();
    return { ok: true, delivered: true, reviewId };
  }
  state.reviewStatus = 'pending';
  state.pendingReviewId = reviewId;
  state.snoozedUntil = 0;
  await persistReviewState();
  // Attempt delivery now and report the real outcome; if the Monitor is unreachable the review stays queued and retries automatically.
  const sent = await flushPendingReviews({ force: true });
  return { ok: true, delivered: sent.delivered > 0, queued: !(sent.delivered > 0), reviewId, detail: sent.message || '' };
});
handle('review:identity', async () => {
  const state = await loadReviewState().catch(() => null);
  return { hostname: getUsageHostname(), lastReviewAt: Number(state?.submittedAt) || 0, reviewPending: Boolean(state?.pendingReviewId || state?.reviewStatus === 'pending') };
});
handle('fonts:find', async (_event, query) => {
  try { return await findInstalledFont({ family: String(query?.family || ''), bold: Boolean(query?.bold), italic: Boolean(query?.italic) }); } catch { return null; }
});
