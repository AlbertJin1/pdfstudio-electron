'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const cleanup = require('../electron/services/old-version-cleanup.cjs');

const compareVersions = (a, b) => {
  const x = String(a).split('.').map(Number); const y = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i += 1) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
  return 0;
};
const noSleep = () => Promise.resolve();

(async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'pdfstudio-cleanup-'));
  try {
    const marker = path.join(dir, 'data', cleanup.MARKER_NAME);
    const make = (name, content = name) => { const file = path.join(dir, name); fs.writeFileSync(file, content); return file; };
    const opts = { markerPath: marker, compareVersions, sleep: noSleep };
    const note = (oldPath, newPath, extra = {}) => cleanup.writeMarker(marker, {
      oldPath, oldVersion: '3.0.6', newPath, newVersion: '3.0.7', oldSize: fs.existsSync(oldPath) ? fs.statSync(oldPath).size : 0, ...extra,
    });

    // 1) The user's custom name is kept: old EXE deleted, new EXE renamed to the old name, leftovers swept.
    const oldExe = make('My PDF Tool.exe', 'old-build');
    const stale = make('PdfStudio-3.0.5.exe');
    const newExe = make('PdfStudio-3.0.7.exe', 'new-build');
    const unrelated = make('notes.exe');
    const userPdf = make('PdfStudio-report.pdf');
    await note(oldExe, newExe);
    let result = await cleanup.runCleanup({ ...opts, currentExe: newExe, currentVersion: '3.0.7' });
    assert.equal(result.pending, false);
    assert.equal(result.renamedTo, oldExe, 'new EXE takes the old EXE name');
    assert.equal(fs.readFileSync(oldExe, 'utf8'), 'new-build', 'file at the old name is now the new build');
    assert.equal(fs.existsSync(newExe), false, 'versioned temp name is gone after rename');
    assert.equal(fs.existsSync(stale), false, 'older versioned leftover is deleted');
    assert.equal(fs.existsSync(unrelated), true, 'unrelated EXE is untouched');
    assert.equal(fs.existsSync(userPdf), true, 'non-EXE file is untouched');
    assert.equal(fs.existsSync(marker), false, 'marker is removed when done');

    // 2) Default name works the same way.
    fs.rmSync(oldExe);
    const def = make('PdfStudio.exe', 'old-build');
    const new2 = make('PdfStudio-3.0.7.exe', 'new-build');
    await note(def, new2);
    result = await cleanup.runCleanup({ ...opts, currentExe: new2, currentVersion: '3.0.7' });
    assert.equal(result.renamedTo, def);
    assert.equal(fs.readFileSync(def, 'utf8'), 'new-build');

    // 3) Old EXE launched again: nothing happens, marker kept; a stale marker is dropped.
    const oldB = make('Mine.exe', 'old-build');
    const newB = make('PdfStudio-3.0.7.exe', 'new-build');
    await note(oldB, newB);
    result = await cleanup.runCleanup({ ...opts, currentExe: oldB, currentVersion: '3.0.6' });
    assert.equal(fs.existsSync(oldB), true); assert.equal(fs.existsSync(newB), true); assert.equal(result.pending, true);
    await cleanup.runCleanup({ ...opts, currentExe: oldB, currentVersion: '3.0.6', now: Date.now() + 4 * 86400000 });
    assert.equal(fs.existsSync(marker), false, 'stale marker is dropped');

    // 4) Old EXE still locked: nothing is renamed, retry on the next launch.
    const locked = make('Locked.exe', 'old-build');
    const realRm = fsp.rm;
    fsp.rm = async (file, o) => { if (file === locked) { const e = new Error('busy'); e.code = 'EBUSY'; throw e; } return realRm(file, o); };
    await note(locked, newB);
    result = await cleanup.runCleanup({ ...opts, currentExe: newB, currentVersion: '3.0.7', attempts: 2 });
    fsp.rm = realRm;
    assert.equal(result.pending, true, 'locked old EXE keeps the marker');
    assert.equal(result.renamedTo, null, 'no rename while the old EXE still exists');
    assert.equal(fs.existsSync(newB), true);
    // next launch: lock gone
    result = await cleanup.runCleanup({ ...opts, currentExe: newB, currentVersion: '3.0.7' });
    assert.equal(result.renamedTo, locked); assert.equal(fs.existsSync(marker), false);

    // 5) Safety: other folder, size mismatch (a different program), running EXE, same version.
    const other = await fsp.mkdtemp(path.join(os.tmpdir(), 'pdfstudio-other-'));
    const foreign = path.join(other, 'PdfStudio.exe'); fs.writeFileSync(foreign, 'x');
    const newC = make('PdfStudio-3.0.7.exe', 'new-build');
    await note(foreign, newC);
    await cleanup.runCleanup({ ...opts, currentExe: newC, currentVersion: '3.0.7' });
    assert.equal(fs.existsSync(foreign), true, 'EXE in a different folder is refused');
    const impostor = make('Impostor.exe', 'a-completely-different-program');
    await note(impostor, newC, { oldSize: 5 });
    await cleanup.runCleanup({ ...opts, currentExe: newC, currentVersion: '3.0.7' });
    assert.equal(fs.existsSync(impostor), true, 'EXE whose size differs from the recorded old build is refused');
    await note(newC, newC);
    await cleanup.runCleanup({ ...opts, currentExe: newC, currentVersion: '3.0.7' });
    assert.equal(fs.existsSync(newC), true, 'running EXE is never a target');
    const same = make('Same.exe');
    await note(same, newC, { oldVersion: '3.0.7' });
    await cleanup.runCleanup({ ...opts, currentExe: newC, currentVersion: '3.0.7' });
    assert.equal(fs.existsSync(same), true, 'no action unless the running version is newer');
    await fsp.rm(other, { recursive: true, force: true });

    // 6) Wiring in main.cjs.
    const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
    assert.match(main, /oldVersionCleanup\.writeMarker/, 'old version schedules cleanup before launching the update');
    assert.match(main, /void removeOldVersionAfterUpdate\(\)/, 'new version runs cleanup on startup');
    assert.match(main, /launcherPathOverride = result\.renamedTo/, 'launcher path follows the rename so the next update still works');
    console.log('PASS: update removes the old EXE and the new EXE takes over its name, with safety guards.');
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
