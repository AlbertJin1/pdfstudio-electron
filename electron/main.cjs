const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const { spawn } = require('node:child_process');
const mammoth = require('mammoth');
const { isPdfStudioMonitorApiUrl, monitorApiUrlCandidates } = require('./services/monitor-api.cjs');
const accessPolicy = require('./services/access-policy.cjs');

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

// Use the same hand-authored app icon for the Windows taskbar, auxiliary windows,
// and packaged application. extraResources copies these files to resources/icons.
function getAppIconPath() {
  const iconName = 'pdf-studio.ico';
  const packagedPath = path.join(process.resourcesPath, 'icons', iconName);
  const developmentPath = path.join(__dirname, '..', 'public', 'icons', iconName);
  return app.isPackaged ? packagedPath : developmentPath;
}

app.setAppUserModelId('com.regualos.pdfstudio');

let mainWindow;
let activeUpdateDownload = null;

// Keep PDF Studio on the same release channel as the legacy C# client.
// This is the monitor base URL (not the public downloads page); the API appends update.php.
const PDF_STUDIO_MONITOR_BASE_URL = 'https://pdfstudio.shares.zrok.io/pdfstudio-monitor/api';
// Must match `api_key` in pdfstudio-monitor/config/config.php and the legacy C# UsageTracker.DefaultApiKey.
const PDF_STUDIO_MONITOR_API_KEY = '2YN0sJIeJZeGL33wip2xmN2YEvs4TzqV';

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

async function fetchHttpsResponse(value, { signal, accept = 'application/json', maxRedirects = 5, allowApiPathFallback = true } = {}) {
  let current = assertPublicHttps(value);
  const initialOrigin = current.origin;
  const requestSignal = signal || AbortSignal.timeout(20_000);
  for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
    let response;
    try {
      const headers = {
        'User-Agent': `PDF-Studio/${app.getVersion()}`,
        'ngrok-skip-browser-warning': '1',
        Accept: accept,
      };
      // Mirror the C# client's X-Api-Key and tunnel-warning header. Never forward the key off-host.
      if (current.origin === initialOrigin && isPdfStudioMonitorApiUrl(current)) {
        headers['X-Api-Key'] = PDF_STUDIO_MONITOR_API_KEY;
      }
      response = await fetch(current, {
        method: 'GET',
        redirect: 'manual',
        signal: requestSignal,
        headers,
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
        return fetchHttpsResponse(alternate.toString(), { signal, accept, maxRedirects, allowApiPathFallback: false });
      }
      if (response.status === 401) throw new Error('The PDF Studio Monitor rejected its API key. Check the key in the Electron app against config/config.php or config/config.local.php on the Monitor server.');
      if (response.status === 404) throw new Error('The PDF Studio Monitor API endpoint was not found at either supported deployment path. Check the Monitor URL and that public/api/update.php is deployed.');
      if (response.status === 403 || response.status === 429) throw new Error('The PDF Studio Monitor temporarily refused the request. Try again later.');
      throw new Error(`PDF Studio Monitor returned HTTP ${response.status}.`);
    }
    // A tunnel splash or web-server fallback can return HTML with HTTP 200. Do not
    // mistake it for valid API metadata; try the alternate deployment path once.
    if (accept.includes('application/json') && !/\bjson\b/i.test(response.headers.get('content-type') || '')) {
      const alternatives = allowApiPathFallback ? monitorApiUrlCandidates(current) : [];
      const alternate = alternatives.find((candidate) => candidate.pathname !== current.pathname);
      if (alternate) {
        return fetchHttpsResponse(alternate.toString(), { signal, accept, maxRedirects, allowApiPathFallback: false });
      }
      throw new Error('The PDF Studio Monitor returned a non-JSON response. Check the API path and tunnel warning page.');
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

function monitorEndpoint(params = {}) {
  const endpoint = new URL(`${PDF_STUDIO_MONITOR_BASE_URL}/update.php`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') endpoint.searchParams.set(key, String(value));
  }
  return endpoint;
}

function assertMonitorDownloadUrl(value) {
  const url = assertPublicHttps(value);
  const allowedPath = [
    '/pdfstudio-monitor/api/update.php',
    '/pdfstudio-monitor/public/api/update.php',
  ].includes(url.pathname.toLowerCase());
  if (!isPdfStudioMonitorApiUrl(url)
      || !allowedPath
      || !['download'].includes(url.searchParams.get('action') || '')) {
    throw new Error('The update package URL is not a valid PDF Studio Monitor download endpoint.');
  }
  return url;
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
  const endpoint = monitorEndpoint(query);
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
    // Match legacy C# UpdateService.Endpoint("action=download&version=...").
    const downloadUrl = monitorEndpoint({ action: 'download', app: 'pdfstudio', version: latestVersion }).toString();
    const safeDownloadUrl = assertMonitorDownloadUrl(downloadUrl).toString();
    const declaredHash = String(latest.sha256 || '').trim().replace(/^sha256[:=]/i, '').toLowerCase();
    if (!declaredHash) {
      throw new Error('The PDF Studio Monitor did not provide the SHA-256 checksum required to verify this update.');
    }
    if (!/^[a-f0-9]{64}$/.test(declaredHash)) {
      throw new Error('The PDF Studio Monitor returned an invalid SHA-256 checksum for this release.');
    }
    const name = `PDF-Studio-${latestVersion}-Portable-${target.architecture}.exe`;
    download = { url: safeDownloadUrl, name, sha256: declaredHash, size: Number(latest.size || data.size || 0) };
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

async function downloadReleasePackage(payload, sender) {
  if (!payload || typeof payload !== 'object') throw new Error('Missing update download details.');
  const source = assertMonitorDownloadUrl(payload.url);
  const targetPath = payload.background
    ? await getStagedUpdatePath(payload.fileName || path.basename(source.pathname) || `PDF-Studio-update-${Date.now()}`)
    : await getAvailableDownloadPath(payload.fileName || path.basename(source.pathname) || `PDF-Studio-update-${Date.now()}`);
  const partialPath = `${targetPath}.part`;
  if (payload.background) { await fs.rm(targetPath, { force: true }).catch(() => {}); await fs.rm(partialPath, { force: true }).catch(() => {}); }
  const controller = new AbortController();
  const download = { controller, partialPath, cancelled: false };
  activeUpdateDownload = download;
  let fileHandle;
  try {
    const response = await fetchHttpsResponse(source.toString(), { signal: controller.signal, accept: 'application/octet-stream, application/zip, */*' });
    const totalBytes = Number(response.headers.get('content-length') || 0) || null;
    const maxBytes = 2 * 1024 * 1024 * 1024;
    if (totalBytes && totalBytes > maxBytes) throw new Error('The update package is larger than the 2 GB safety limit.');
    fileHandle = await fs.open(partialPath, 'w');
    const digest = crypto.createHash('sha256');
    let downloadedBytes = 0;
    const progressMessage = payload.background ? 'Downloading securely in the background. You can keep working.' : 'Downloading update…';
    const sendProgress = (percent) => {
      // Keep progress in main-process state as well as streaming it to the renderer. If the user
      // opens Settings after a background download has started, the current progress is still shown.
      publishUpdaterState({ status: 'downloading', percent, downloadedBytes, totalBytes, message: progressMessage });
      if (!sender?.isDestroyed?.()) sender.send('updater:download-progress', { percent, downloadedBytes, totalBytes, message: progressMessage });
    };
    sendProgress(0);
    for await (const chunk of response.body) {
      if (download.cancelled || controller.signal.aborted) throw new Error('Download cancelled.');
      const buffer = Buffer.from(chunk);
      downloadedBytes += buffer.length;
      if (downloadedBytes > maxBytes) throw new Error('The update package is larger than the 2 GB safety limit.');
      digest.update(buffer);
      const chunkStart = downloadedBytes - buffer.length;
      let offset = 0;
      while (offset < buffer.length) {
        const { bytesWritten } = await fileHandle.write(buffer, offset, buffer.length - offset, chunkStart + offset);
        if (!bytesWritten) throw new Error('The update package could not be written to disk. Check available storage and permissions.');
        offset += bytesWritten;
      }
      const percent = totalBytes ? Math.min(100, (downloadedBytes / totalBytes) * 100) : null;
      sendProgress(percent);
    }
    await fileHandle.close();
    fileHandle = null;
    const actualHash = digest.digest('hex');
    const expectedHash = String(payload.sha256 || '').replace(/^sha256[:=]/i, '').trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(expectedHash)) throw new Error('The PDF Studio Monitor download is missing a valid SHA-256 checksum.');
    if (actualHash !== expectedHash) throw new Error('SHA-256 verification failed. The downloaded file was removed because it does not match the checksum published by PDF Studio Monitor.');
    await fs.rename(partialPath, targetPath);
    if (!sender?.isDestroyed?.()) sender.send('updater:download-progress', { percent: 100, downloadedBytes, totalBytes, message: progressMessage });
    return { canceled: false, path: targetPath, fileName: path.basename(targetPath), sha256: actualHash, verified: true };
  } catch (error) {
    if (fileHandle) { try { await fileHandle.close(); } catch {} }
    try { await fs.unlink(partialPath); } catch {}
    if (download.cancelled || controller.signal.aborted || error?.name === 'AbortError') throw new Error('Download cancelled.');
    throw error;
  } finally {
    if (activeUpdateDownload === download) activeUpdateDownload = null;
  }
}

// ───────────────────────── Monitor session tracking (compatible with legacy C# client) ─────────────────────────

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
  const canonical = `${PDF_STUDIO_MONITOR_BASE_URL}/`;
  const candidates = monitorApiUrlCandidates(canonical);
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
          'X-Api-Key': PDF_STUDIO_MONITOR_API_KEY,
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
    usageSession = {
      id: crypto.randomBytes(16).toString('hex'),
      startedAt: Math.floor(Date.now() / 1000),
      startedMs: Date.now(),
    };
    await flushUsageQueue();
    await sendUsageEvent(usageSessionPayload('open'), 8000);
    if (usageHeartbeatTimer) clearInterval(usageHeartbeatTimer);
    usageHeartbeatTimer = setInterval(() => {
      if (!usageStopping && usageSession) {
        void sendUsageEvent(usageSessionPayload('heartbeat'), 8000);
        void flushUsageQueue();
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
//   * polls api/access.php with the shared API key (about every 30 seconds, and again when the window regains focus);
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
        apiKey: PDF_STUDIO_MONITOR_API_KEY,
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

function psQuote(value) { return `'${String(value).replace(/'/g, "''")}'`; }
async function scheduleWindowsUpdate(update) {
  const launcher = process.env.PORTABLE_EXECUTABLE_FILE;
  if (!launcher || !fsSync.existsSync(launcher)) {
    throw new Error('This Windows build cannot locate the portable launcher to replace. Reopen PDF Studio from its Portable EXE and try again.');
  }
  const target = path.resolve(launcher);
  const targetDir = path.dirname(target);
  const extension = path.extname(target) || '.exe';
  const replacement = path.join(targetDir, `.pdfstudio-update-${update.version}-${process.pid}${extension}`);
  await fs.copyFile(update.path, replacement);
  const scriptPath = path.join(getUpdatesDirectory(), `apply-update-${process.pid}.ps1`);
  const backup = `${target}.previous`;
  const script = `$ErrorActionPreference='Stop'\n$Target=${psQuote(target)}\n$Replacement=${psQuote(replacement)}\n$Backup=${psQuote(backup)}\n$WaitPid=${process.pid}\n$Log=${psQuote(path.join(getUpdatesDirectory(), 'apply-update.log'))}\ntry {\n  while (Get-Process -Id $WaitPid -ErrorAction SilentlyContinue) { Start-Sleep -Milliseconds 400 }\n  if (!(Test-Path -LiteralPath $Target)) { throw 'The current launcher was not found.' }\n  if (Test-Path -LiteralPath $Backup) { Remove-Item -LiteralPath $Backup -Force }\n  $movedOriginal = $false\n  for ($attempt = 0; $attempt -lt 30; $attempt++) {\n    try { Move-Item -LiteralPath $Target -Destination $Backup -Force -ErrorAction Stop; $movedOriginal = $true; break }\n    catch { if ($attempt -ge 29) { throw }; Start-Sleep -Milliseconds 500 }\n  }\n  $installed = $false\n  for ($attempt = 0; $attempt -lt 30; $attempt++) {\n    try { Move-Item -LiteralPath $Replacement -Destination $Target -Force -ErrorAction Stop; $installed = $true; break }\n    catch { if ($attempt -ge 29) { throw }; Start-Sleep -Milliseconds 500 }\n  }\n  if (!$installed) { throw 'The downloaded launcher could not be installed.' }\n  Start-Process -FilePath $Target\n  Add-Content -LiteralPath $Log -Value ('Updated to ${update.version} at ' + (Get-Date).ToString('o'))\n} catch {\n  if (!(Test-Path -LiteralPath $Target) -and (Test-Path -LiteralPath $Backup)) { Move-Item -LiteralPath $Backup -Destination $Target -Force }\n  Add-Content -LiteralPath $Log -Value ('Update failed: ' + $_.Exception.Message)\n}\n`;
  await fs.writeFile(scriptPath, script, 'utf8');
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const child = spawn(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', scriptPath], { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
}
async function applyPendingUpdateNow() {
  if (!pendingUpdate) throw new Error('No verified update is ready to install.');
  const digest = await sha256File(pendingUpdate.path);
  if (digest.toLowerCase() !== String(pendingUpdate.sha256).toLowerCase()) {
    await removePendingUpdate({ removePayload: true });
    throw new Error('The update package did not pass its integrity check. Please check for updates again.');
  }
  await scheduleWindowsUpdate(pendingUpdate);
  publishUpdaterState({ status: 'applying', latestVersion: pendingUpdate.version, message: 'Applying the update and restarting PDF Studio…' });
  setTimeout(() => app.quit(), 250);
  return { started: true };
}

async function docxBufferToPdf(buffer) {
  const result = await mammoth.convertToHtml({ buffer });
  const body = result.value || '<p>This Word document contains no readable text.</p>';
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
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
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
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
  const devUrl = process.env.VITE_DEV_SERVER_URL;
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
    },
  });
  const contentsId = win.webContents.id;
  // Without the default menu, Ctrl+Plus / Ctrl+Minus / Ctrl+0 / Ctrl+R no longer zoom or reload the whole
  // page. The editor handles those shortcuts itself, and pinch/ctrl+wheel zoom is left to the editor too.
  win.removeMenu();
  win.setMenuBarVisibility(false);
  win.webContents.setVisualZoomLevelLimits(1, 1);
  editorInitPayloads.set(contentsId, initial || null);
  editorWindows.add(win);
  win.once('ready-to-show', () => { win.show(); win.focus(); });
  win.on('closed', () => { editorWindows.delete(win); editorInitPayloads.delete(contentsId); });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  // The renderer sets a beforeunload guard while there are unsaved edits; ask the user instead of silently blocking.
  win.webContents.on('will-prevent-unload', (event) => {
    const choice = dialog.showMessageBoxSync(win, {
      type: 'question', buttons: ['Discard changes', 'Keep editing'], defaultId: 1, cancelId: 1,
      title: 'Unsaved edits', message: 'This PDF has edits that have not been saved.', detail: 'Closing the window discards them.',
    });
    if (choice === 0) event.preventDefault();
  });
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) void win.loadURL(`${devUrl}${devUrl.includes('?') ? '&' : '?'}window=edit`);
  else void win.loadFile(path.join(app.getAppPath(), 'dist', 'index.html'), { query: { window: 'edit' } });
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
  if (process.platform === 'win32') return [path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts'), path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'Microsoft', 'Windows', 'Fonts')];
  if (process.platform === 'darwin') return ['/System/Library/Fonts', '/System/Library/Fonts/Supplemental', '/Library/Fonts', path.join(home, 'Library', 'Fonts')];
  return ['/usr/share/fonts', '/usr/local/share/fonts', path.join(home, '.fonts'), path.join(home, '.local', 'share', 'fonts')];
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
  return null;
}

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
    },
  });
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    void startUsageMonitoring();
  });
  mainWindow.on('focus', recheckAccessSoon);
  mainWindow.on('maximize', () => mainWindow.webContents.send('window:maximized', true));
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('window:maximized', false));
  mainWindow.on('enter-full-screen', () => mainWindow.webContents.send('window:fullscreen', true));
  mainWindow.on('leave-full-screen', () => mainWindow.webContents.send('window:fullscreen', false));
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

  void loadRenderer(mainWindow);
}

app.whenReady().then(() => {
  loadAccessCacheSync();
  createWindow();
  startAccessControl();
  // Begin telemetry as soon as Electron is ready. ready-to-show may be delayed or
  // suppressed by display/rendering issues even while the app process is running.
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
});
app.on('window-all-closed', () => { app.quit(); });
app.on('before-quit', (event) => {
  if (usageShutdownComplete) return;
  if (usageShutdownInProgress) { event.preventDefault(); return; }
  usageShutdownInProgress = true;
  event.preventDefault();
  stopAccessControl();
  if (autoUpdateTimer) clearTimeout(autoUpdateTimer);
  if (autoUpdateInterval) clearInterval(autoUpdateInterval);
  clearAutoUpdateRetry();
  if (activeUpdateDownload) { activeUpdateDownload.cancelled = true; activeUpdateDownload.controller.abort(); }
  void stopUsageMonitoring().finally(() => {
    usageShutdownComplete = true;
    app.quit();
  });
});

ipcMain.handle('access:get-state', () => publicAccessState());
ipcMain.handle('access:recheck', async () => {
  if (accessCheckPromise) return accessCheckPromise;
  return checkAccessPolicy();
});
ipcMain.handle('window:minimize', () => mainWindow?.minimize());
ipcMain.handle('window:maximize-toggle', () => {
  if (!mainWindow) return false;
  if (mainWindow.isMaximized()) mainWindow.unmaximize(); else mainWindow.maximize();
  return mainWindow.isMaximized();
});
ipcMain.handle('window:close', () => mainWindow?.close());
ipcMain.handle('window:is-maximized', () => Boolean(mainWindow?.isMaximized()));
ipcMain.handle('app:version', () => app.getVersion());
ipcMain.handle('app:open-external', async (_event, url) => {
  if (typeof url !== 'string' || !/^https:\/\//i.test(url)) throw new TypeError('Only HTTPS links are allowed.');
  return shell.openExternal(url);
});
ipcMain.handle('app:platform', () => process.platform);
ipcMain.handle('updater:check', async () => {
  void checkAndStageUpdate({ manual: true });
  return { status: 'checking', message: 'Checking for updates…' };
});
ipcMain.handle('updater:get-state', async () => getUpdaterSnapshot());
ipcMain.handle('updater:prompt-shown', async (_event, version) => { markUpdatePromptShown(version); return true; });
ipcMain.handle('updater:update-later', async (_event, version) => { markUpdatePromptShown(version); return true; });
ipcMain.handle('updater:apply-now', async () => applyPendingUpdateNow());
ipcMain.handle('updater:cancel', () => {
  if (!activeUpdateDownload) return false;
  activeUpdateDownload.cancelled = true;
  activeUpdateDownload.controller.abort();
  return true;
});
ipcMain.handle('updater:open-downloads', async () => shell.openPath(app.getPath('downloads')));

ipcMain.handle('files:open', async (event, options) => {
  assertAccessAllowed();
  const parent = BrowserWindow.fromWebContents(event.sender) || mainWindow;
  const pdfOnly = Boolean(options && options.pdfOnly);
  const picked = await dialog.showOpenDialog(parent, {
    title: pdfOnly ? 'Open a PDF to edit' : 'Add documents to PDF Studio',
    properties: pdfOnly ? ['openFile'] : ['openFile', 'multiSelections'],
    filters: pdfOnly ? [{ name: 'PDF document', extensions: ['pdf'] }] : [{ name: 'Supported documents', extensions: ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'tif', 'tiff', 'docx'] }],
  });
  if (picked.canceled) return [];
  const output = [];
  for (const filePath of picked.filePaths) {
    const ext = path.extname(filePath).toLowerCase();
    const raw = await fs.readFile(filePath);
    if (ext === '.docx') {
      const data = await docxBufferToPdf(raw);
      output.push({ name: `${path.basename(filePath, ext)}.pdf`, originName: path.basename(filePath), path: filePath, mime: 'application/pdf', kind: 'pdf', bytes: new Uint8Array(data) });
    } else {
      const mimeByExt = {
        '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
        '.webp': 'image/webp', '.bmp': 'image/bmp', '.gif': 'image/gif', '.tif': 'image/tiff', '.tiff': 'image/tiff',
      };
      output.push({ name: path.basename(filePath), path: filePath, mime: mimeByExt[ext] || 'application/octet-stream', kind: ext === '.pdf' ? 'pdf' : 'image', bytes: new Uint8Array(raw) });
    }
  }
  return output;
});

ipcMain.handle('files:save', async (event, { name, data, filters }) => {
  assertAccessAllowed();
  const safeFile = safeName(name, 'PDF-Studio-export.pdf');
  const defaultExt = path.extname(safeFile).replace('.', '') || 'pdf';
  const result = await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender) || mainWindow, {
    title: 'Save export', defaultPath: safeFile,
    filters: Array.isArray(filters) && filters.length ? filters : [{ name: defaultExt.toUpperCase(), extensions: [defaultExt] }],
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  await fs.writeFile(result.filePath, toBuffer(data));
  return { canceled: false, filePath: result.filePath };
});

ipcMain.handle('files:save-batch', async (event, files) => {
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
    await fs.writeFile(path.join(folder, candidate), toBuffer(file.data));
    count += 1;
  }
  return { canceled: false, count, folder };
});


ipcMain.handle('editor:open', async (_event, payload) => {
  assertAccessAllowed();
  const bytes = payload && payload.bytes ? new Uint8Array(payload.bytes) : null;
  createEditorWindow(bytes ? { name: safeName(payload.name, 'document.pdf'), bytes } : null);
  return true;
});
ipcMain.handle('editor:init', (event) => {
  const payload = editorInitPayloads.get(event.sender.id) || null;
  editorInitPayloads.set(event.sender.id, null);
  return payload;
});
ipcMain.handle('editor:close', (event) => { BrowserWindow.fromWebContents(event.sender)?.close(); return true; });
ipcMain.handle('editor:set-title', (event, title) => { BrowserWindow.fromWebContents(event.sender)?.setTitle(String(title || 'PDF Studio - Edit PDF').slice(0, 200)); return true; });
ipcMain.handle('fonts:find', async (_event, query) => {
  try { return await findInstalledFont({ family: String(query?.family || ''), bold: Boolean(query?.bold), italic: Boolean(query?.italic) }); } catch { return null; }
});
