import assert from 'node:assert/strict';
import { buildExif, describeMetadata, findExif, injectExif, parseTiff, prepareExifForJpeg, readMetadata, survivesMode } from '../src/services/imageMetadata.js';

// Hand-built little-endian TIFF/EXIF block: Make, Orientation(6), Software, ExifIFD(DateTimeOriginal, SerialNumber, MakerNote), GPS(N/E + altitude).
function buildFixture() {
  const enc = new TextEncoder();
  const ascii = (s) => Uint8Array.from([...enc.encode(s), 0]);
  const rat = (pairs) => { const b = new Uint8Array(pairs.length * 8); const dv = new DataView(b.buffer); pairs.forEach(([n, d], i) => { dv.setUint32(i * 8, n, true); dv.setUint32(i * 8 + 4, d, true); }); return b; };
  const ifds = {
    ifd0: [[0x010f, 2, ascii('Acme')], [0x0112, 3, Uint8Array.from([6, 0])], [0x0131, 2, ascii('Editor 9')], [0x8769, 4, null], [0x8825, 4, null]],
    exif: [[0x9003, 2, ascii('2024:05:17 09:30:12')], [0x927c, 7, Uint8Array.from([1, 2, 3, 4, 5, 6])], [0xa431, 2, ascii('SN-12345')]],
    gps: [[1, 2, ascii('S')], [2, 5, rat([[33, 1], [51, 1], [3000, 100]])], [3, 2, ascii('W')], [4, 5, rat([[70, 1], [39, 1], [0, 1]])], [6, 5, rat([[250, 10]])]],
  };
  const size = (list) => 2 + list.length * 12 + 4;
  const at = { ifd0: 8 }; at.exif = at.ifd0 + size(ifds.ifd0); at.gps = at.exif + size(ifds.exif);
  let cursor = at.gps + size(ifds.gps);
  const out = new Uint8Array(4096); const dv = new DataView(out.buffer);
  out.set([0x49, 0x49, 0x2a, 0], 0); dv.setUint32(4, 8, true);
  for (const name of ['ifd0', 'exif', 'gps']) {
    let o = at[name]; dv.setUint16(o, ifds[name].length, true); o += 2;
    for (const [tag, type, value] of ifds[name]) {
      dv.setUint16(o, tag, true); dv.setUint16(o + 2, type, true);
      if (value === null) { dv.setUint32(o + 4, 1, true); dv.setUint32(o + 8, tag === 0x8769 ? at.exif : at.gps, true); } else {
        const unit = type === 5 ? 8 : type === 3 ? 2 : 1; dv.setUint32(o + 4, value.length / unit, true);
        if (value.length <= 4) out.set(value, o + 8); else { dv.setUint32(o + 8, cursor, true); out.set(value, cursor); cursor += value.length; }
      }
      o += 12;
    }
  }
  return out.slice(0, cursor);
}
const jpegWith = (tiff) => { const len = 8 + tiff.length; return Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, len >> 8, len & 255, 0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff, 0xff, 0xda, 0, 2, 0xff, 0xd9]); };

const tiff = buildFixture();
const jpeg = jpegWith(tiff);
assert.ok(findExif(jpeg), 'EXIF is found inside a JPEG');

const meta = readMetadata(jpeg);
assert.equal(meta.make, 'Acme'); assert.equal(meta.software, 'Editor 9'); assert.equal(meta.serial, 'SN-12345');
assert.equal(meta.taken, '2024:05:17 09:30:12');
assert.ok(Math.abs(meta.gps.lat - -33.8583333) < 1e-5, 'south latitude is negative');
assert.ok(Math.abs(meta.gps.lon - -70.65) < 1e-6, 'west longitude is negative');
assert.equal(meta.gps.altitude, 25);
const ids = describeMetadata(meta).map((fact) => fact.id);
assert.deepEqual(ids.slice(0, 2), ['location', 'serial']);
assert.equal(describeMetadata(meta)[0].level, 'high');

// PNG (eXIf chunk) and WebP (EXIF chunk) containers.
const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...[0, 0, tiff.length >> 8, tiff.length & 255], 0x65, 0x58, 0x49, 0x66, ...tiff, 0, 0, 0, 0]);
assert.equal(readMetadata(png).make, 'Acme');
const webp = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x45, 0x58, 0x49, 0x46, tiff.length & 255, tiff.length >> 8, 0, 0, ...tiff]);
assert.equal(readMetadata(webp).make, 'Acme');
assert.equal(readMetadata(Uint8Array.from({ length: 64 }, () => 7)).found, false, 'no EXIF in unknown data');

// Modes. "strip" writes nothing; "safe" keeps camera and date but never GPS, serial or maker notes; "keep" keeps GPS.
assert.equal(prepareExifForJpeg(jpeg, 'strip'), null);
const safe = parseTiff(prepareExifForJpeg(jpeg, 'safe'));
assert.deepEqual(safe.ifd0.map((e) => e.tag), [0x010f, 0x0112, 0x0131, 0x8769]);
assert.deepEqual(safe.exif.map((e) => e.tag), [0x9003]);
assert.equal(safe.gps.length, 0);
const keep = prepareExifForJpeg(jpeg, 'keep');
const kept = parseTiff(keep);
assert.equal(kept.gps.length, 5); assert.ok(kept.exif.some((e) => e.tag === 0xa431)); assert.ok(!kept.exif.some((e) => e.tag === 0x927c), 'maker notes are never copied');
assert.equal(new DataView(kept.ifd0.find((e) => e.tag === 0x0112).raw.buffer).getUint16(0, true), 1, 'orientation is reset because pixels are already rotated');
// Removed data must not survive anywhere in the bytes.
const safeBytes = prepareExifForJpeg(jpeg, 'safe');
assert.ok(!new TextDecoder('latin1').decode(safeBytes).includes('SN-12345'));
assert.equal(readMetadata(injectExif(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xd9]), safeBytes)).gps, null);
assert.equal(readMetadata(injectExif(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xd9]), keep)).gps.altitude, 25);
const injected = injectExif(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xd9]), safeBytes);
assert.equal(injected[2], 0xff); assert.equal(injected[3], 0xe0, 'JFIF segment stays first');
assert.equal(buildExif(tiff, 'strip'), null);

assert.equal(survivesMode('location', 'strip'), false); assert.equal(survivesMode('location', 'safe'), false); assert.equal(survivesMode('location', 'keep'), true);
assert.equal(survivesMode('camera', 'safe'), true); assert.equal(survivesMode('serial', 'safe'), false);
console.log('Image metadata checks passed.');
