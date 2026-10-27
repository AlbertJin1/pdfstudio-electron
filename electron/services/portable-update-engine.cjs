'use strict';

// Content-defined update reconstruction, byte-compatible with Monitor src/delta.php and the
// PDF Studio 2.x UpdateService. All offsets and checksums are validated before a staged EXE is used.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { Transform, PassThrough } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const DELTA_FORMAT = 'psd-chunks-v1';
const DELTA_MAGIC = Buffer.from('PSDDELTA', 'ascii');
const WINDOW_SIZE = 64;
const MIN_CHUNK_SIZE = 65_536;
const AVERAGE_CHUNK_MASK = 0x1FFFF;
const MAX_CHUNK_SIZE = 1_048_576;
const MAX_CHUNK_COUNT = 10_000;
const MAX_MANIFEST_BYTES = 32 * 1024 * 1024;
const MAX_PACKAGE_BYTES = 2 * 1024 * 1024 * 1024;

function throwIfAborted(signal) {
  if (signal?.aborted) {
    const error = new Error('Update cancelled.');
    error.name = 'AbortError';
    throw error;
  }
}

function sha256(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }

function createGearTable() {
  const gear = new Uint32Array(256);
  let x = 0x9E3779B9;
  for (let i = 0; i < 256; i += 1) {
    x = (x ^ (x << 13)) >>> 0;
    x = (x ^ (x >>> 17)) >>> 0;
    x = (x ^ (x << 5)) >>> 0;
    gear[i] = x;
  }
  return gear;
}

function rotateLeftOne(value) { return ((value << 1) | (value >>> 31)) >>> 0; }

async function buildLocalChunkIndex(filePath, { signal, onProgress } = {}) {
  const stat = await fsp.stat(filePath);
  if (!stat.isFile() || stat.size < 1 || stat.size > MAX_PACKAGE_BYTES) throw new Error('The installed portable executable has an unsupported size.');
  const gear = createGearTable();
  const window = new Uint8Array(WINDOW_SIZE);
  let windowCount = 0;
  let windowPosition = 0;
  let rollingHash = 0;
  const index = new Map();
  let chunkOffset = 0;
  let chunkSize = 0;
  let chunkParts = [];
  let processed = 0;
  let nextProgress = 8 * 1024 * 1024;

  const addChunk = () => {
    if (chunkSize < 1 || chunkSize > MAX_CHUNK_SIZE) throw new Error('The installed executable produced an invalid chunk size.');
    const bytes = chunkParts.length === 1 ? chunkParts[0] : Buffer.concat(chunkParts, chunkSize);
    const hash = sha256(bytes);
    if (!index.has(hash)) index.set(hash, { offset: chunkOffset, size: chunkSize });
    chunkOffset += chunkSize;
    chunkSize = 0;
    chunkParts = [];
  };

  for await (const buffer of fs.createReadStream(filePath, { highWaterMark: 1024 * 1024 })) {
    throwIfAborted(signal);
    let segmentStart = 0;
    for (let i = 0; i < buffer.length; i += 1) {
      const value = buffer[i];
      if (windowCount < WINDOW_SIZE) {
        rollingHash = (rotateLeftOne(rollingHash) ^ gear[value]) >>> 0;
        window[windowCount] = value;
        windowCount += 1;
      } else {
        const outgoing = window[windowPosition];
        rollingHash = (rotateLeftOne(rollingHash) ^ gear[value] ^ gear[outgoing]) >>> 0;
        window[windowPosition] = value;
        windowPosition = (windowPosition + 1) % WINDOW_SIZE;
      }

      const candidateSize = chunkSize + i - segmentStart + 1;
      if (candidateSize >= MIN_CHUNK_SIZE && ((rollingHash & AVERAGE_CHUNK_MASK) === 0 || candidateSize >= MAX_CHUNK_SIZE)) {
        const segmentLength = i - segmentStart + 1;
        if (segmentLength > 0) chunkParts.push(buffer.subarray(segmentStart, i + 1));
        chunkSize += segmentLength;
        addChunk();
        segmentStart = i + 1;
      }
    }
    if (segmentStart < buffer.length) {
      chunkParts.push(buffer.subarray(segmentStart));
      chunkSize += buffer.length - segmentStart;
    }
    processed += buffer.length;
    if (onProgress && processed >= nextProgress) {
      onProgress({ done: processed, total: stat.size });
      nextProgress = processed + 8 * 1024 * 1024;
    }
    // Yield the Electron main event loop between 1 MB buffers while hashing large launchers.
    await new Promise((resolve) => setImmediate(resolve));
  }
  if (chunkSize > 0) addChunk();
  if (chunkOffset !== stat.size || index.size < 1) throw new Error('The installed executable could not be indexed safely.');
  if (onProgress) onProgress({ done: stat.size, total: stat.size });
  return index;
}

function validateDeltaManifest(input, { version, size, sha256: expectedSha } = {}) {
  if (!Buffer.isBuffer(input)) input = Buffer.from(input);
  if (input.length < 1 || input.length > MAX_MANIFEST_BYTES) throw new Error('The differential-update manifest is unexpectedly large.');
  let manifest;
  try { manifest = JSON.parse(input.toString('utf8')); }
  catch { throw new Error('The differential-update manifest is not valid JSON.'); }
  if (!manifest || manifest.format !== DELTA_FORMAT || manifest.version !== version
      || !Number.isSafeInteger(manifest.size) || manifest.size < 1 || manifest.size > MAX_PACKAGE_BYTES
      || !/^[a-f0-9]{64}$/i.test(String(manifest.sha256 || ''))
      || (Number.isFinite(size) && size > 0 && manifest.size !== size)
      || (expectedSha && String(manifest.sha256).toLowerCase() !== String(expectedSha).toLowerCase())) {
    throw new Error('The differential-update manifest does not match the announced release.');
  }
  if (!Array.isArray(manifest.chunks) || manifest.chunks.length < 1 || manifest.chunks.length > MAX_CHUNK_COUNT) {
    throw new Error('The differential-update manifest has an invalid chunk list.');
  }
  let expectedOffset = 0;
  const chunks = manifest.chunks.map((chunk) => {
    const offset = Number(chunk?.offset);
    const chunkSize = Number(chunk?.size);
    const hash = String(chunk?.sha256 || '').toLowerCase();
    if (!Number.isSafeInteger(offset) || offset !== expectedOffset || !Number.isSafeInteger(chunkSize)
        || chunkSize < 1 || chunkSize > MAX_CHUNK_SIZE || !/^[a-f0-9]{64}$/.test(hash)) {
      throw new Error('The differential-update manifest contains an invalid chunk descriptor.');
    }
    expectedOffset += chunkSize;
    if (!Number.isSafeInteger(expectedOffset) || expectedOffset > manifest.size) throw new Error('The differential-update manifest exceeds its declared size.');
    return { offset, size: chunkSize, sha256: hash };
  });
  if (expectedOffset !== manifest.size) throw new Error('The differential-update manifest does not cover the complete executable.');
  return { format: manifest.format, version: manifest.version, size: manifest.size, sha256: String(manifest.sha256).toLowerCase(), chunks };
}

async function readExactly(handle, length, position) {
  if (!Number.isSafeInteger(length) || length < 0 || length > MAX_CHUNK_SIZE * 2 + 40) throw new Error('An update part has an invalid length.');
  const buffer = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const result = await handle.read(buffer, offset, length - offset, position + offset);
    if (!result.bytesRead) throw new Error('The differential update ended unexpectedly.');
    offset += result.bytesRead;
  }
  return buffer;
}

async function extractDeltaPack(packagePath, expectedChunks, destinationDirectory, { signal, onProgress } = {}) {
  const handle = await fsp.open(packagePath, 'r');
  try {
    const stat = await handle.stat();
    if (stat.size < 12 || stat.size > MAX_PACKAGE_BYTES) throw new Error('The differential-update payload has an invalid size.');
    const header = await readExactly(handle, 12, 0);
    if (!header.subarray(0, 8).equals(DELTA_MAGIC)) throw new Error('The differential update has an invalid header.');
    const count = header.readUInt32LE(8);
    if (count !== expectedChunks.size || count > MAX_CHUNK_COUNT) throw new Error('The differential update contains an unexpected number of parts.');
    await fsp.mkdir(destinationDirectory, { recursive: true });
    const seen = new Set();
    let position = 12;
    for (let i = 0; i < count; i += 1) {
      throwIfAborted(signal);
      const descriptor = await readExactly(handle, 40, position);
      position += 40;
      const hash = descriptor.subarray(0, 32).toString('hex');
      const rawLength = descriptor.readUInt32LE(32);
      const compressedLength = descriptor.readUInt32LE(36);
      const expected = expectedChunks.get(hash);
      if (!expected || seen.has(hash)) throw new Error('The differential update contains an unrequested or duplicate part.');
      if (rawLength !== expected.size || rawLength < 1 || rawLength > MAX_CHUNK_SIZE || compressedLength < 1 || compressedLength > MAX_CHUNK_SIZE * 2
          || position + compressedLength > stat.size) throw new Error('The differential update contains an invalid part size.');
      const compressed = await readExactly(handle, compressedLength, position);
      position += compressedLength;
      let raw;
      try { raw = zlib.inflateRawSync(compressed, { maxOutputLength: rawLength }); }
      catch { throw new Error('A differential update part could not be decompressed.'); }
      if (raw.length !== rawLength || sha256(raw) !== hash) throw new Error('A changed part failed its SHA-256 integrity check.');
      await fsp.writeFile(path.join(destinationDirectory, `${hash}.chunk`), raw, { flag: 'wx' });
      seen.add(hash);
      onProgress?.({ done: i + 1, total: Math.max(1, count) });
    }
    if (seen.size !== expectedChunks.size || position !== stat.size) throw new Error('The differential update is incomplete or contains trailing data.');
  } finally { await handle.close(); }
}

async function assembleDelta(sourcePath, targetPartPath, manifest, localIndex, changedDirectory, { signal, onProgress } = {}) {
  const source = await fsp.open(sourcePath, 'r');
  const output = await fsp.open(targetPartPath, 'w');
  let assembled = 0;
  const buffer = Buffer.alloc(128 * 1024);
  try {
    for (let i = 0; i < manifest.chunks.length; i += 1) {
      throwIfAborted(signal);
      const chunk = manifest.chunks[i];
      const local = localIndex.get(chunk.sha256);
      const changedPath = path.join(changedDirectory, `${chunk.sha256}.chunk`);
      const changed = local && local.size === chunk.size ? null : await fsp.open(changedPath, 'r').catch(() => null);
      if (!local || local.size !== chunk.size) {
        if (!changed) throw new Error('A required changed update part is missing.');
        const stat = await changed.stat();
        if (stat.size !== chunk.size) { await changed.close(); throw new Error('A changed update part has an unexpected size.'); }
      }
      let offset = 0;
      try {
        while (offset < chunk.size) {
          throwIfAborted(signal);
          const length = Math.min(buffer.length, chunk.size - offset);
          const readResult = local && local.size === chunk.size
            ? await source.read(buffer, 0, length, local.offset + offset)
            : await changed.read(buffer, 0, length, offset);
          if (!readResult.bytesRead) throw new Error('An update part was truncated.');
          let written = 0;
          while (written < readResult.bytesRead) {
            const result = await output.write(buffer, written, readResult.bytesRead - written, null);
            if (!result.bytesWritten) throw new Error('The rebuilt executable could not be written to disk.');
            written += result.bytesWritten;
          }
          offset += readResult.bytesRead;
          assembled += readResult.bytesRead;
        }
      } finally { if (changed) await changed.close(); }
      if (onProgress && (i % 8 === 0 || i === manifest.chunks.length - 1)) onProgress({ done: assembled, total: manifest.size });
    }
    await output.sync();
    const stat = await output.stat();
    if (assembled !== manifest.size || stat.size !== manifest.size) throw new Error('The rebuilt executable has an unexpected size.');
  } catch (error) {
    await output.close().catch(() => {});
    await fsp.rm(targetPartPath, { force: true }).catch(() => {});
    throw error;
  } finally {
    await source.close().catch(() => {});
    await output.close().catch(() => {});
  }
}

async function extractZipExecutable(zipPath, targetPath, { entryName = 'PdfStudio.exe', expectedSize, expectedSha256, signal } = {}) {
  const archive = await fsp.open(zipPath, 'r');
  const partial = `${targetPath}.part`;
  try {
    throwIfAborted(signal);
    const stat = await archive.stat();
    if (stat.size < 22 || stat.size > MAX_PACKAGE_BYTES) throw new Error('The compressed update package has an invalid size.');
    const tailLength = Math.min(stat.size, 65_557);
    const tail = await readExactly(archive, tailLength, stat.size - tailLength);
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i -= 1) {
      if (tail.readUInt32LE(i) === 0x06054B50 && i + 22 + tail.readUInt16LE(i + 20) <= tail.length) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('The compressed update package has an invalid ZIP directory.');
    const disk = tail.readUInt16LE(eocd + 4);
    const directoryDisk = tail.readUInt16LE(eocd + 6);
    const entriesDisk = tail.readUInt16LE(eocd + 8);
    const entriesTotal = tail.readUInt16LE(eocd + 10);
    const directorySize = tail.readUInt32LE(eocd + 12);
    const directoryOffset = tail.readUInt32LE(eocd + 16);
    if (disk !== 0 || directoryDisk !== 0 || entriesDisk !== entriesTotal || entriesTotal < 1 || entriesTotal > 64
        || directorySize === 0xFFFFFFFF || directoryOffset === 0xFFFFFFFF || directoryOffset + directorySize > stat.size
        || directorySize > 1024 * 1024) throw new Error('The ZIP directory layout is unsupported or invalid.');
    const directory = await readExactly(archive, directorySize, directoryOffset);
    let cursor = 0;
    let selected = null;
    for (let i = 0; i < entriesTotal; i += 1) {
      if (cursor + 46 > directory.length || directory.readUInt32LE(cursor) !== 0x02014B50) throw new Error('The ZIP directory contains an invalid entry.');
      const flags = directory.readUInt16LE(cursor + 8);
      const method = directory.readUInt16LE(cursor + 10);
      const compressedSize = directory.readUInt32LE(cursor + 20);
      const uncompressedSize = directory.readUInt32LE(cursor + 24);
      const nameLength = directory.readUInt16LE(cursor + 28);
      const extraLength = directory.readUInt16LE(cursor + 30);
      const commentLength = directory.readUInt16LE(cursor + 32);
      const localOffset = directory.readUInt32LE(cursor + 42);
      const end = cursor + 46 + nameLength + extraLength + commentLength;
      if (end > directory.length) throw new Error('The ZIP directory entry is truncated.');
      const name = directory.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
      if (name === entryName) selected = { flags, method, compressedSize, uncompressedSize, localOffset, nameLength };
      cursor = end;
    }
    if (!selected) throw new Error(`The compressed update does not contain ${entryName}.`);
    if ((selected.flags & 0x1) !== 0 || ![0, 8].includes(selected.method)
        || selected.compressedSize > MAX_PACKAGE_BYTES || selected.uncompressedSize < 1 || selected.uncompressedSize > MAX_PACKAGE_BYTES
        || (Number.isFinite(expectedSize) && expectedSize > 0 && selected.uncompressedSize !== expectedSize)) {
      throw new Error('The compressed update contains an unsupported or unexpected executable entry.');
    }
    const localHeader = await readExactly(archive, 30, selected.localOffset);
    if (localHeader.readUInt32LE(0) !== 0x04034B50) throw new Error('The ZIP local file header is invalid.');
    const localNameLength = localHeader.readUInt16LE(26);
    const localExtraLength = localHeader.readUInt16LE(28);
    const dataOffset = selected.localOffset + 30 + localNameLength + localExtraLength;
    if (dataOffset + selected.compressedSize > stat.size) throw new Error('The ZIP executable data extends beyond the package.');
    const input = fs.createReadStream(zipPath, { start: dataOffset, end: dataOffset + selected.compressedSize - 1 });
    const decompressor = selected.method === 8 ? zlib.createInflateRaw() : new PassThrough();
    const digest = crypto.createHash('sha256');
    let unpacked = 0;
    const checker = new Transform({ transform(chunk, _encoding, callback) {
      unpacked += chunk.length;
      if (unpacked > selected.uncompressedSize || unpacked > MAX_PACKAGE_BYTES) return callback(new Error('The compressed executable expands beyond its declared size.'));
      digest.update(chunk);
      callback(null, chunk);
    } });
    await fsp.rm(partial, { force: true });
    try {
      await pipeline(input, decompressor, checker, fs.createWriteStream(partial, { flags: 'wx' }), { signal });
      const actualSha = digest.digest('hex');
      if (unpacked !== selected.uncompressedSize || (expectedSha256 && actualSha !== String(expectedSha256).toLowerCase())) {
        throw new Error('The extracted executable failed its size or SHA-256 integrity check.');
      }
      await fsp.rm(targetPath, { force: true });
      await fsp.rename(partial, targetPath);
      return { size: unpacked, sha256: actualSha };
    } catch (error) {
      await fsp.rm(partial, { force: true }).catch(() => {});
      throw error;
    }
  } finally { await archive.close(); }
}

module.exports = {
  DELTA_FORMAT,
  MAX_MANIFEST_BYTES,
  MAX_PACKAGE_BYTES,
  buildLocalChunkIndex,
  validateDeltaManifest,
  extractDeltaPack,
  assembleDelta,
  extractZipExecutable,
  sha256,
};
