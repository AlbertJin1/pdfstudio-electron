'use strict';
// In-place update swap for the portable EXE, so the app keeps the SAME file name after every update:
//   1. the verified new build is copied next to the launcher as "<name>.new" and re-verified,
//   2. the running (locked) EXE is renamed to "<name>.old"  - Windows allows renaming a running EXE, not deleting it,
//   3. "<name>.new" is renamed to "<name>", so the new build now owns the original file name,
//   4. the new build is started and the old process quits,
//   5. the new build deletes "<name>.old" once the old process has exited (retrying for a while).
// If anything fails before the new build starts, the swap is rolled back and the original EXE is restored.
//
// A running portable EXE usually CANNOT be renamed (the launcher keeps its own file open), so step 2 is attempted first and,
// when Windows refuses, a helper does the same swap after the old app has exited: the verified build is copied to
// "<name>.updating.exe" and started with PDFSTUDIO_FINISH_UPDATE_* set. That helper waits until "<name>" is free, renames it to
// "<name>.old", copies itself to "<name>", starts it and exits. The new build then deletes "<name>.old" and "<name>.updating.exe".
//
// The older flow (new build saved as PdfStudio-<version>.exe, old EXE deleted and the new one renamed afterwards) is still
// understood below, because versions that shipped before the in-place swap write that kind of marker when they update.
//
// Original notes on the delete-after-start approach:
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
const OLD_SUFFIX = '.old';
const NEW_SUFFIX = '.new';
const HELPER_SUFFIX = '.updating.exe';
const helperPathFor = (exePath) => path.join(path.dirname(exePath), `${path.basename(exePath, path.extname(exePath))}${HELPER_SUFFIX}`);
// Names the updater itself creates: PdfStudio-3.0.7.exe or PdfStudio-3.0.7 (2).exe
const VERSIONED_EXE_NAME = /^PdfStudio-(\d+\.\d+\.\d+)(?: \(\d+\))?\.exe$/i;

const sameFile = (a, b) => {
  if (!a || !b) return false;
  const left = path.resolve(a);
  const right = path.resolve(b);
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
};

async function writeMarker(markerPath, { oldPath, oldVersion, newPath, newVersion, oldSize = 0, mode = 'rename' }) {
  const body = JSON.stringify({ mode, oldPath, oldVersion, newPath, newVersion, oldSize, createdAt: Date.now() });
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
function isSafeOldExe(target, { currentExe, newPath, oldSize, mode = 'rename' }) {
  if (!target || !path.isAbsolute(target)) return false;
  // In-place swap: the only file ever removed is "<running exe>.old", nothing else.
  if (mode === 'swap' ? !sameFile(target, `${newPath}${OLD_SUFFIX}`) : path.extname(target).toLowerCase() !== '.exe') return false;
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

  const mode = marker.mode === 'swap' ? 'swap' : 'rename';
  const ctx = { currentExe, newPath: marker.newPath, oldSize: Number(marker.oldSize), mode };
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
  // (Not needed for an in-place swap: the new build already owns the original name.)
  if (mode !== 'swap' && oldExeOk && oldGone && !pending && !sameFile(marker.oldPath, currentExe)) {
    for (let attempt = 1; attempt <= 3 && !renamedTo; attempt += 1) {
      try { await fsp.rename(currentExe, marker.oldPath); renamedTo = marker.oldPath; }
      catch (error) { if (attempt < 3) await sleep(delayMs); else console.warn('[PDF Studio] Could not take over the old file name:', error?.message || error); }
    }
  }
  if (mode === 'swap') {
    await fsp.rm(`${currentExe}${NEW_SUFFIX}`, { force: true }).catch(() => {});
    // The helper copy (if the update went through the helper) exits right after starting this build.
    const helper = helperPathFor(currentExe);
    if (fs.existsSync(helper) && !sameFile(helper, currentExe)) {
      if (await deleteWithRetry(helper, { attempts, delayMs, sleep })) removed.push(helper); else pending = true;
    }
  }
  if (!pending) await fsp.rm(markerPath, { force: true }).catch(() => {});
  return { removed, pending, renamedTo };
}


// Step 1-3 of the in-place swap (see the header). Returns { finalPath, oldPath }. Throws, after restoring the original EXE,
// if anything goes wrong; the caller may then fall back to another install method.
async function prepareSwap({ launcher, stagedPath, sha256, sha256File, markerPath, oldVersion, newVersion }) {
  if (!launcher || !path.isAbsolute(launcher) || path.extname(launcher).toLowerCase() !== '.exe') throw new Error('The current EXE path is not usable for an in-place update.');
  const finalPath = path.resolve(launcher);
  const oldPath = `${finalPath}${OLD_SUFFIX}`;
  const tempPath = `${finalPath}${NEW_SUFFIX}`;
  const oldSize = (await fsp.stat(finalPath)).size;

  // Leftovers from an earlier update or an interrupted attempt. A locked ".old" means a previous version is still running.
  await fsp.rm(tempPath, { force: true });
  await fsp.rm(oldPath, { force: true });

  try {
    await fsp.copyFile(stagedPath, tempPath);
    if (String(await sha256File(tempPath)).toLowerCase() !== String(sha256).toLowerCase()) throw new Error('The copied update did not match its checksum.');
  } catch (error) {
    await fsp.rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }

  // The note comes first so a crash between the renames can never leave an undeletable ".old" without an owner.
  await writeMarker(markerPath, { mode: 'swap', oldPath, oldVersion, newPath: finalPath, newVersion, oldSize });
  try {
    await fsp.rename(finalPath, oldPath);          // allowed even while the EXE is running
    try { await fsp.rename(tempPath, finalPath); }  // the new build takes the original name
    catch (error) {
      await fsp.rename(oldPath, finalPath).catch(() => {});
      throw error;
    }
  } catch (error) {
    await fsp.rm(tempPath, { force: true }).catch(() => {});
    await fsp.rm(markerPath, { force: true }).catch(() => {});
    throw error;
  }
  return { finalPath, oldPath };
}

// Undo prepareSwap when the new build could not be started: put the previous EXE back under its original name.
async function rollbackSwap({ finalPath, oldPath, markerPath }) {
  await fsp.rm(markerPath, { force: true }).catch(() => {});
  if (!fs.existsSync(oldPath)) return false;
  await fsp.rm(finalPath, { force: true });        // the new build never ran, so it is not locked
  await fsp.rename(oldPath, finalPath);
  return true;
}

// Helper route, old-app side: copy the verified build to "<name>.updating.exe" and leave the note for the new build.
async function prepareHelper({ launcher, stagedPath, sha256, sha256File, markerPath, oldVersion, newVersion }) {
  if (!launcher || !path.isAbsolute(launcher) || path.extname(launcher).toLowerCase() !== '.exe') throw new Error('The current EXE path is not usable for an update.');
  const finalPath = path.resolve(launcher);
  const helperPath = helperPathFor(finalPath);
  const oldSize = (await fsp.stat(finalPath)).size;
  await fsp.rm(helperPath, { force: true });
  try {
    await fsp.copyFile(stagedPath, helperPath);
    if (String(await sha256File(helperPath)).toLowerCase() !== String(sha256).toLowerCase()) throw new Error('The copied update did not match its checksum.');
    await writeMarker(markerPath, { mode: 'swap', oldPath: `${finalPath}${OLD_SUFFIX}`, oldVersion, newPath: finalPath, newVersion, oldSize });
  } catch (error) {
    await fsp.rm(helperPath, { force: true }).catch(() => {});
    await fsp.rm(markerPath, { force: true }).catch(() => {});
    throw error;
  }
  return { finalPath, helperPath };
}

// Helper route, helper side. `target` is the original EXE path, `source` is this helper's own file. Returns { ok, reason }.
// Never deletes anything except a stale "<target>.old"; on any failure the previous EXE is put back and started again.
async function runHelperSwap({
  target, source, sha256File, launch, log = () => {},
  timeoutMs = 180000, delayMs = 400, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), now = () => Date.now(),
}) {
  if (!target || !source || !path.isAbsolute(target) || !path.isAbsolute(source)) return { ok: false, reason: 'bad-arguments' };
  if (path.extname(target).toLowerCase() !== '.exe' || !sameFile(source, helperPathFor(target))) return { ok: false, reason: 'unexpected-paths' };
  const oldPath = `${target}${OLD_SUFFIX}`;
  const deadline = now() + timeoutMs;
  let renamed = false;
  for (;;) {
    try {
      await fsp.rm(oldPath, { force: true });
      try { await fsp.rename(target, oldPath); renamed = true; }
      catch (error) { if (error?.code !== 'ENOENT') throw error; }   // already gone: nothing to move aside
      break;
    } catch (error) {
      if (!['EBUSY', 'EPERM', 'EACCES'].includes(error?.code)) { log(`rename failed: ${error?.code || error?.message}`); return { ok: false, reason: 'rename-failed' }; }
      if (now() > deadline) { log('the previous version never closed; giving up'); return { ok: false, reason: 'timeout' }; }
      await sleep(delayMs);
    }
  }
  log(renamed ? `renamed ${path.basename(target)} -> ${path.basename(oldPath)}` : `${path.basename(target)} was already gone`);
  try {
    await fsp.copyFile(source, target);
    const [a, b] = await Promise.all([sha256File(source), sha256File(target)]);
    if (String(a).toLowerCase() !== String(b).toLowerCase()) throw new Error('copy does not match');
  } catch (error) {
    log(`copy failed: ${error?.message || error}; restoring the previous version`);
    await fsp.rm(target, { force: true }).catch(() => {});
    if (renamed) await fsp.rename(oldPath, target).catch((e) => log(`restore failed: ${e?.message || e}`));
    if (fs.existsSync(target)) await launch(target);
    return { ok: false, reason: 'copy-failed' };
  }
  await launch(target);
  log(`started ${path.basename(target)}`);
  return { ok: true, reason: '' };
}

module.exports = { MARKER_NAME, writeMarker, readMarker, runCleanup, prepareSwap, rollbackSwap, prepareHelper, runHelperSwap, helperPathFor, isSafeOldExe, isSafeSibling };
