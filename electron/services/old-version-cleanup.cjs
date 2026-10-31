'use strict';
// Removes the previous PDF Studio portable EXE once the updated version is running, then renames the new EXE to the
// old file's name, so a copy the user renamed (or pinned / made a shortcut to) keeps working after the update.
//
// Why it works this way: a running portable EXE is locked by Windows, so the old version cannot delete itself, and
// the app deliberately uses no helper scripts or hidden shells (self-replacing droppers are an antivirus trigger).
// Instead the old version leaves a small marker file in %AppData%\PDF Studio before it starts the new one, and the
// NEW version deletes the old EXE shortly after it starts, retrying until the old process has fully exited.

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const MARKER_NAME = 'cleanup-old-version.json';
const MARKER_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;
// Names the updater itself creates: PdfStudio-3.0.7.exe or PdfStudio-3.0.7 (2).exe
const VERSIONED_EXE_NAME = /^PdfStudio-(\d+\.\d+\.\d+)(?: \(\d+\))?\.exe$/i;

const sameFile = (a, b) => {
  if (!a || !b) return false;
  const left = path.resolve(a);
  const right = path.resolve(b);
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
};

async function writeMarker(markerPath, { oldPath, oldVersion, newPath, newVersion, oldSize = 0 }) {
  const body = JSON.stringify({ oldPath, oldVersion, newPath, newVersion, oldSize, createdAt: Date.now() });
  const temp = `${markerPath}.tmp`;
  await fsp.mkdir(path.dirname(markerPath), { recursive: true });
  await fsp.writeFile(temp, body, 'utf8');
  await fsp.rename(temp, markerPath);
}

async function readMarker(markerPath) {
  try {
    const marker = JSON.parse(await fsp.readFile(markerPath, 'utf8'));
    if (!marker || typeof marker.oldPath !== 'string' || typeof marker.newPath !== 'string'
        || typeof marker.oldVersion !== 'string' || typeof marker.newVersion !== 'string') return null;
    return marker;
  } catch { return null; }
}

// The previous EXE keeps whatever name the user gave it, so it is identified by the path the old version recorded for
// itself and by its size, not by a name pattern.
function isSafeOldExe(target, { currentExe, newPath, oldSize }) {
  if (!target || !path.isAbsolute(target) || path.extname(target).toLowerCase() !== '.exe') return false;
  if (sameFile(target, currentExe) || sameFile(target, newPath)) return false;
  // The old EXE must sit beside the new one (the updater always installs next to the launcher).
  if (!sameFile(path.dirname(target), path.dirname(newPath))) return false;
  if (Number.isFinite(oldSize) && oldSize > 0) {
    try { if (fs.statSync(target).size !== oldSize) return false; } catch { return false; }
  }
  return true;
}
function isSafeSibling(target, { currentExe, newPath }) {
  if (!target || !path.isAbsolute(target) || !VERSIONED_EXE_NAME.test(path.basename(target))) return false;
  if (sameFile(target, currentExe) || sameFile(target, newPath)) return false;
  return sameFile(path.dirname(target), path.dirname(newPath));
}

async function deleteWithRetry(target, { attempts, delayMs, sleep }) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try { await fsp.rm(target, { force: true }); if (!fs.existsSync(target)) return true; }
    catch (error) { if (!['EBUSY', 'EPERM', 'EACCES'].includes(error?.code)) return false; }
    if (attempt < attempts) await sleep(delayMs);
  }
  return false;
}

// Also sweeps leftovers from earlier updates (PdfStudio-<older version>.exe) so folders do not pile up copies.
function olderVersionedSiblings(dir, currentVersion, currentExe, compareVersions) {
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return []; }
  return names
    .map((name) => ({ name, match: VERSIONED_EXE_NAME.exec(name) }))
    .filter(({ match }) => match && compareVersions(match[1], currentVersion) < 0)
    .map(({ name }) => path.join(dir, name))
    .filter((file) => !sameFile(file, currentExe));
}

// Returns { removed: string[], pending: boolean }. pending=true means "try again on next launch".
async function runCleanup({
  markerPath, currentExe, currentVersion, compareVersions,
  attempts = 30, delayMs = 1000, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), now = Date.now(),
}) {
  const marker = await readMarker(markerPath);
  if (!marker) { await fsp.rm(markerPath, { force: true }).catch(() => {}); return { removed: [], pending: false }; }

  // Only the freshly started new version may clean up. If the old EXE was started again, or the new one never ran,
  // leave everything alone (and drop the marker once it is stale).
  if (!sameFile(marker.newPath, currentExe)) {
    const stale = !Number.isFinite(marker.createdAt) || now - marker.createdAt > MARKER_MAX_AGE_MS;
    if (stale) await fsp.rm(markerPath, { force: true }).catch(() => {});
    return { removed: [], pending: !stale };
  }
  if (compareVersions(marker.oldVersion, currentVersion) >= 0) {
    await fsp.rm(markerPath, { force: true }).catch(() => {});
    return { removed: [], pending: false };
  }

  const ctx = { currentExe, newPath: marker.newPath, oldSize: Number(marker.oldSize) };
  const oldExeOk = isSafeOldExe(marker.oldPath, ctx);
  const siblings = olderVersionedSiblings(path.dirname(marker.newPath), currentVersion, currentExe, compareVersions)
    .filter((target) => !sameFile(target, marker.oldPath) && isSafeSibling(target, ctx));

  const removed = [];
  let pending = false;
  let oldGone = !fs.existsSync(marker.oldPath);
  if (oldExeOk && !oldGone) {
    if (await deleteWithRetry(marker.oldPath, { attempts, delayMs, sleep })) { removed.push(marker.oldPath); oldGone = true; }
    else pending = true;
  }
  for (const target of siblings) {
    if (!fs.existsSync(target)) continue;
    if (await deleteWithRetry(target, { attempts: 3, delayMs, sleep })) removed.push(target);
  }

  // Take over the old file's name. Windows allows renaming a running EXE (not deleting it); if it is refused we simply
  // keep the versioned name and the app still works.
  let renamedTo = null;
  if (oldExeOk && oldGone && !pending && !sameFile(marker.oldPath, currentExe)) {
    for (let attempt = 1; attempt <= 3 && !renamedTo; attempt += 1) {
      try { await fsp.rename(currentExe, marker.oldPath); renamedTo = marker.oldPath; }
      catch (error) { if (attempt < 3) await sleep(delayMs); else console.warn('[PDF Studio] Could not take over the old file name:', error?.message || error); }
    }
  }
  if (!pending) await fsp.rm(markerPath, { force: true }).catch(() => {});
  return { removed, pending, renamedTo };
}

module.exports = { MARKER_NAME, writeMarker, readMarker, runCleanup, isSafeOldExe, isSafeSibling };
