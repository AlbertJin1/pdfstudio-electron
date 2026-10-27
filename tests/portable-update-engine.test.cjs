'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const engine = require('../electron/services/portable-update-engine.cjs');

function randomBytes(size, seed = 0x12345678) {
  const result = Buffer.allocUnsafe(size);
  let state = seed >>> 0;
  for (let i = 0; i < size; i += 1) {
    state ^= state << 13; state >>>= 0;
    state ^= state >>> 17; state >>>= 0;
    state ^= state << 5; state >>>= 0;
    result[i] = state & 0xff;
  }
  return result;
}
function sha(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }
function makeZip(entryName, content) {
  const name = Buffer.from(entryName, 'utf8');
  const compressed = zlib.deflateRawSync(content, { level: 1 });
  const crc = 0; // The extractor additionally verifies the authoritative SHA-256 of the expanded EXE.
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034B50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8);
  local.writeUInt32LE(crc, 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(content.length, 22);
  local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014B50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
  central.writeUInt16LE(8, 10); central.writeUInt32LE(crc, 16); central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(content.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt16LE(0, 30);
  central.writeUInt16LE(0, 32); central.writeUInt16LE(0, 34); central.writeUInt32LE(0, 38); central.writeUInt32LE(0, 42);
  const centralDir = Buffer.concat([central, name]);
  const localFile = Buffer.concat([local, name, compressed]);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054B50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(centralDir.length, 12); eocd.writeUInt32LE(localFile.length, 16); eocd.writeUInt16LE(0, 20);
  return Buffer.concat([localFile, centralDir, eocd]);
}

(async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'pdfstudio-update-test-'));
  try {
    const sourceBytes = randomBytes(2 * 1024 * 1024);
    const targetBytes = Buffer.from(sourceBytes);
    // A small edit in the middle of an EXE simulates a normal incremental update.
    for (let i = 0; i < 96; i += 1) targetBytes[720_000 + i] ^= (i * 17) & 0xff;
    const sourcePath = path.join(dir, 'current.exe');
    const targetPath = path.join(dir, 'expected.exe');
    await fsp.writeFile(sourcePath, sourceBytes);
    await fsp.writeFile(targetPath, targetBytes);

    const sourceIndex = await engine.buildLocalChunkIndex(sourcePath);
    const targetIndex = await engine.buildLocalChunkIndex(targetPath);
    const ordered = [...targetIndex.entries()].map(([hash, chunk]) => ({ hash, ...chunk })).sort((a, b) => a.offset - b.offset);
    assert.equal(ordered.reduce((total, chunk) => total + chunk.size, 0), targetBytes.length, 'chunk index covers the whole executable');
    const manifest = {
      format: engine.DELTA_FORMAT,
      version: '3.0.4',
      size: targetBytes.length,
      sha256: sha(targetBytes),
      chunks: ordered.map(({ hash, offset, size }) => ({ offset, size, sha256: hash })),
    };
    const manifestBytes = Buffer.from(JSON.stringify(manifest));
    const parsedManifest = engine.validateDeltaManifest(manifestBytes, {
      version: '3.0.4', size: targetBytes.length, sha256: sha(targetBytes),
    });
    assert.throws(() => engine.validateDeltaManifest(manifestBytes, {
      version: '3.0.5', size: targetBytes.length, sha256: sha(targetBytes),
    }), /does not match/, 'manifest version mismatch is rejected');

    const missing = new Map();
    for (const chunk of parsedManifest.chunks) {
      const local = sourceIndex.get(chunk.sha256);
      if (!local || local.size !== chunk.size) missing.set(chunk.sha256, chunk);
    }
    assert.ok(missing.size > 0, 'simulated update has at least one changed chunk');
    const pack = [Buffer.from('PSDDELTA'), Buffer.alloc(4)];
    pack[1].writeUInt32LE(missing.size, 0);
    for (const [hash, descriptor] of missing) {
      const raw = targetBytes.subarray(descriptor.offset, descriptor.offset + descriptor.size);
      assert.equal(sha(raw), hash, 'target chunk hash matches manifest');
      const compressed = zlib.deflateRawSync(raw, { level: 1 });
      const header = Buffer.alloc(40);
      Buffer.from(hash, 'hex').copy(header, 0);
      header.writeUInt32LE(raw.length, 32); header.writeUInt32LE(compressed.length, 36);
      pack.push(header, compressed);
    }
    const deltaPath = path.join(dir, 'update.delta');
    const chunkDir = path.join(dir, 'chunks');
    await fsp.writeFile(deltaPath, Buffer.concat(pack));
    await engine.extractDeltaPack(deltaPath, missing, chunkDir);
    const rebuiltPath = path.join(dir, 'rebuilt.exe');
    await engine.assembleDelta(sourcePath, rebuiltPath, parsedManifest, sourceIndex, chunkDir);
    assert.deepEqual(await fsp.readFile(rebuiltPath), targetBytes, 'delta reconstruction reproduces the exact target executable');

    const zipPath = path.join(dir, 'release.zip');
    const extractedPath = path.join(dir, 'zip-extracted.exe');
    const zip = makeZip('PdfStudio.exe', targetBytes);
    await fsp.writeFile(zipPath, zip);
    const extracted = await engine.extractZipExecutable(zipPath, extractedPath, {
      entryName: 'PdfStudio.exe', expectedSize: targetBytes.length, expectedSha256: sha(targetBytes),
    });
    assert.equal(extracted.sha256, sha(targetBytes), 'compressed package extraction returns verified executable hash');
    assert.deepEqual(await fsp.readFile(extractedPath), targetBytes, 'compressed package extraction reproduces exact executable bytes');
    await assert.rejects(engine.extractZipExecutable(zipPath, path.join(dir, 'bad.exe'), {
      entryName: 'wrong.exe', expectedSize: targetBytes.length, expectedSha256: sha(targetBytes),
    }), /does not contain/, 'unexpected package entry is rejected');

    const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
    assert.match(main, /tryDownloadDeltaUpdate/, 'Electron updater attempts delta reconstruction');
    assert.match(main, /payload\.compressed/, 'Electron updater supports the verified compressed fallback');
    assert.match(main, /message: 'Downloading the verified portable executable…'/, 'raw EXE remains as compatibility fallback');
    assert.match(main, /PORTABLE_EXECUTABLE_FILE/, 'portable launcher source is used for chunk reuse');
    console.log(`PASS: Electron portable updater reconstruction, ZIP extraction, and fallback policy (${missing.size} changed chunks).`);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
