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


    // 5b) In-place swap: the app keeps its exact file name, the old build goes to ".old" and is then deleted.
    const sha = (file) => require('node:crypto').createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    const sha256File = async (file) => sha(file);
    const staged = make('staged-update.bin', 'brand-new-build');
    const swapExe = make('My Own Name.exe', 'running-old-build');
    const swapOpts = { launcher: swapExe, stagedPath: staged, sha256: sha(staged), sha256File, markerPath: marker, oldVersion: '3.0.7', newVersion: '3.0.8' };
    const swap = await cleanup.prepareSwap(swapOpts);
    assert.equal(swap.finalPath, swapExe, 'new build owns the original file name');
    assert.equal(fs.readFileSync(swapExe, 'utf8'), 'brand-new-build');
    assert.equal(fs.readFileSync(`${swapExe}.old`, 'utf8'), 'running-old-build', 'old build is kept as .old until the new one runs');
    assert.equal(fs.existsSync(`${swapExe}.new`), false, 'no temp file left behind');
    assert.equal(fs.readdirSync(dir).some((n) => /^PdfStudio-\d/.test(n) && n.includes('3.0.8')), false, 'no versioned file name is ever created');
    // old process still running -> .old is locked: marker kept, retried next launch
    fsp.rm = async (file, o) => { if (file === `${swapExe}.old`) { const e = new Error('busy'); e.code = 'EBUSY'; throw e; } return realRm(file, o); };
    result = await cleanup.runCleanup({ ...opts, currentExe: swapExe, currentVersion: '3.0.8', attempts: 2 });
    fsp.rm = realRm;
    assert.equal(result.pending, true); assert.equal(fs.existsSync(marker), true); assert.equal(fs.existsSync(`${swapExe}.old`), true);
    // old process gone -> .old deleted, marker removed, name unchanged
    result = await cleanup.runCleanup({ ...opts, currentExe: swapExe, currentVersion: '3.0.8' });
    assert.equal(result.pending, false); assert.equal(result.renamedTo, null);
    assert.deepEqual(result.removed, [`${swapExe}.old`]);
    assert.equal(fs.existsSync(`${swapExe}.old`), false, 'old build is deleted');
    assert.equal(fs.readFileSync(swapExe, 'utf8'), 'brand-new-build'); assert.equal(fs.existsSync(marker), false);

    // 5c) Swap safety: wrong checksum changes nothing; a marker may only ever delete "<exe>.old"; failed launch rolls back.
    const exeB = make('Keep.exe', 'old-b');
    await assert.rejects(cleanup.prepareSwap({ ...swapOpts, launcher: exeB, sha256: '0'.repeat(64) }));
    assert.equal(fs.readFileSync(exeB, 'utf8'), 'old-b'); assert.equal(fs.existsSync(`${exeB}.new`), false); assert.equal(fs.existsSync(marker), false);
    const decoy = make('Decoy.exe', 'old-build');
    await cleanup.writeMarker(marker, { mode: 'swap', oldPath: decoy, oldVersion: '3.0.7', newPath: swapExe, newVersion: '3.0.8', oldSize: fs.statSync(decoy).size });
    await cleanup.runCleanup({ ...opts, currentExe: swapExe, currentVersion: '3.0.8' });
    assert.equal(fs.existsSync(decoy), true, 'swap marker cannot delete anything except <exe>.old');
    await fsp.rm(marker, { force: true });
    const swapB = await cleanup.prepareSwap({ ...swapOpts, launcher: exeB });
    assert.equal(fs.readFileSync(exeB, 'utf8'), 'brand-new-build');
    assert.equal(await cleanup.rollbackSwap({ ...swapB, markerPath: marker }), true);
    assert.equal(fs.readFileSync(exeB, 'utf8'), 'old-b', 'failed launch restores the original EXE');
    assert.equal(fs.existsSync(`${exeB}.old`), false); assert.equal(fs.existsSync(marker), false);

    // 5d) Helper route (a running portable EXE cannot be renamed): wait for the old app to exit, then swap under the same name.
    const hExe = make('Helper Name.exe', 'old-h');
    const hOpts = { launcher: hExe, stagedPath: staged, sha256: sha(staged), sha256File, markerPath: marker, oldVersion: '3.0.8', newVersion: '3.0.9' };
    const prep = await cleanup.prepareHelper(hOpts);
    assert.equal(prep.helperPath, path.join(dir, 'Helper Name.updating.exe'));
    assert.equal(fs.readFileSync(hExe, 'utf8'), 'old-h', 'nothing touched yet: the old app is still running');
    const realRename = fsp.rename; let busy = 3; const launched = []; const logs = [];
    fsp.rename = async (a, b) => { if (a === hExe && busy-- > 0) { const e = new Error('locked'); e.code = 'EBUSY'; throw e; } return realRename(a, b); };
    const hres = await cleanup.runHelperSwap({ target: hExe, source: prep.helperPath, sha256File, launch: async (f) => launched.push(f), log: (m) => logs.push(m), sleep: noSleep });
    fsp.rename = realRename;
    assert.equal(hres.ok, true); assert.deepEqual(launched, [hExe], 'the new build is started under the original name');
    assert.equal(fs.readFileSync(hExe, 'utf8'), 'brand-new-build'); assert.equal(fs.readFileSync(`${hExe}.old`, 'utf8'), 'old-h');
    // new build starts at the original name: deletes .old and the helper copy
    result = await cleanup.runCleanup({ ...opts, currentExe: hExe, currentVersion: '3.0.9' });
    assert.equal(result.pending, false);
    assert.equal(fs.existsSync(`${hExe}.old`), false); assert.equal(fs.existsSync(prep.helperPath), false); assert.equal(fs.existsSync(marker), false);
    assert.equal(fs.readdirSync(dir).filter((n) => /Helper Name/.test(n)).join(), 'Helper Name.exe', 'only the original file name remains');
    // old app never closes: the helper gives up without touching anything
    const hExe2 = make('Stuck.exe', 'old-s'); const prep2 = await cleanup.prepareHelper({ ...hOpts, launcher: hExe2 });
    let t = 0; fsp.rename = async (a, b) => { if (a === hExe2) { const e = new Error('locked'); e.code = 'EBUSY'; throw e; } return realRename(a, b); };
    const stuck = await cleanup.runHelperSwap({ target: hExe2, source: prep2.helperPath, sha256File, launch: async () => {}, sleep: noSleep, now: () => (t += 100000), timeoutMs: 250000 });
    fsp.rename = realRename;
    assert.equal(stuck.ok, false); assert.equal(stuck.reason, 'timeout'); assert.equal(fs.readFileSync(hExe2, 'utf8'), 'old-s');
    // a helper that is not at the expected temp name is refused
    const refused = await cleanup.runHelperSwap({ target: hExe2, source: staged, sha256File, launch: async () => {}, sleep: noSleep });
    assert.equal(refused.ok, false);
    fs.rmSync(prep2.helperPath, { force: true }); fs.rmSync(marker, { force: true });

    // 6) Wiring in main.cjs.
    const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
    assert.match(main, /oldVersionCleanup\.prepareSwap/, 'update swaps the EXE in place under its own name');
    assert.match(main, /oldVersionCleanup\.prepareHelper/, 'a running portable EXE that cannot be renamed is swapped by a helper after it exits');
    assert.match(main, /PDFSTUDIO_FINISH_UPDATE_TARGET/, 'helper mode is wired');
    assert.match(main, /oldVersionCleanup\.rollbackSwap/, 'a failed launch restores the previous EXE');
    assert.match(main, /oldVersionCleanup\.writeMarker/, 'fallback install still schedules cleanup before launching the update');
    assert.match(main, /void removeOldVersionAfterUpdate\(\)/, 'new version runs cleanup on startup');
    assert.match(main, /launcherPathOverride = result\.renamedTo/, 'launcher path follows the rename so the next update still works');
    console.log('PASS: update keeps the same file name (old build -> .old -> deleted), with rollback and safety guards.');
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
