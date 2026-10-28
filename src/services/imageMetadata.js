/**
 * Photo metadata helpers for the format converter's "Privacy shield".
 *
 *  - readMetadata():   finds the EXIF block in JPEG, PNG, WebP, HEIC/HEIF and AVIF files and summarises what it reveals
 *                      (GPS location, camera, date, serial number, owner ...).
 *  - prepareExifForJpeg(): builds a brand-new EXIF block for the converted JPG. It is assembled from an allow-list
 *                      rather than edited in place, so removed data (GPS, serial numbers, maker notes, embedded
 *                      thumbnails that can contain the uncropped photo) cannot linger in unused bytes.
 *  - injectExif():     inserts that block into a JPEG.
 * Everything runs locally; nothing is uploaded.
 */
const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 13: 4 };
const MAX_VALUE_BYTES = 1_000_000;

export const METADATA_MODES = [
  { value: 'strip', label: 'Remove everything', hint: 'Safest for sharing' },
  { value: 'safe', label: 'Keep camera & date', hint: 'Removes location & personal info' },
  { value: 'keep', label: 'Keep all details', hint: 'Including GPS location' },
];

const ascii = (bytes, from, text) => text.split('').every((char, i) => bytes[from + i] === char.charCodeAt(0));
const isTiff = (b) => b && b.length >= 8 && ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a && b[3] === 0) || (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0 && b[3] === 0x2a));
const hasExifHeader = (b, at) => b[at] === 0x45 && b[at + 1] === 0x78 && b[at + 2] === 0x69 && b[at + 3] === 0x66 && b[at + 4] === 0 && b[at + 5] === 0;

/** Returns the TIFF-structured EXIF block of an image file, or null. */
export function findExif(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  if (b.length < 16) return null;
  if (b[0] === 0xff && b[1] === 0xd8) { // JPEG
    let o = 2;
    while (o + 4 <= b.length) {
      if (b[o] !== 0xff) break;
      const marker = b[o + 1];
      if (marker === 0xff) { o += 1; continue; }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { o += 2; continue; }
      if (marker === 0xda || marker === 0xd9) break;
      const length = (b[o + 2] << 8) | b[o + 3];
      if (length < 2) break;
      if (marker === 0xe1 && length >= 14 && hasExifHeader(b, o + 4)) { const tiff = b.subarray(o + 10, o + 2 + length); return isTiff(tiff) ? tiff : null; }
      o += 2 + length;
    }
    return null;
  }
  if (b[0] === 0x89 && ascii(b, 1, 'PNG')) { // PNG: eXIf chunk
    let o = 8;
    while (o + 12 <= b.length) {
      const length = ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
      if (ascii(b, o + 4, 'eXIf')) { const tiff = b.subarray(o + 8, o + 8 + length); return isTiff(tiff) ? tiff : null; }
      o += 12 + length;
    }
    return null;
  }
  if (ascii(b, 0, 'RIFF') && ascii(b, 8, 'WEBP')) { // WebP: EXIF chunk
    let o = 12;
    while (o + 8 <= b.length) {
      const size = (b[o + 4] | (b[o + 5] << 8) | (b[o + 6] << 16) | (b[o + 7] << 24)) >>> 0;
      if (ascii(b, o, 'EXIF')) {
        let data = b.subarray(o + 8, o + 8 + size);
        if (data.length > 6 && hasExifHeader(data, 0)) data = data.subarray(6);
        return isTiff(data) ? data : null;
      }
      o += 8 + size + (size & 1);
    }
    return null;
  }
  if (ascii(b, 4, 'ftyp')) { // HEIC / HEIF / AVIF: the Exif item is "Exif\0\0" + TIFF header somewhere in the file
    for (let i = 0; i + 14 < b.length; i += 1) {
      if (b[i] === 0x45 && hasExifHeader(b, i) && isTiff(b.subarray(i + 6, i + 14))) return b.subarray(i + 6);
    }
  }
  return null;
}

/** Reads a TIFF block into IFD0 / Exif / GPS entry lists (values are kept as raw bytes). */
export function parseTiff(t) {
  if (!isTiff(t)) return null;
  const little = t[0] === 0x49;
  const dv = new DataView(t.buffer, t.byteOffset, t.byteLength);
  const u16 = (o) => dv.getUint16(o, little);
  const u32 = (o) => dv.getUint32(o, little);
  const readIfd = (offset) => {
    const entries = [];
    if (!offset || offset < 8 || offset + 2 > t.length) return entries;
    const count = Math.min(u16(offset), 512);
    for (let i = 0; i < count; i += 1) {
      const at = offset + 2 + i * 12;
      if (at + 12 > t.length) break;
      const tag = u16(at); const type = u16(at + 2); const n = u32(at + 4);
      const size = (TYPE_SIZE[type] || 0) * n;
      if (!size || size > MAX_VALUE_BYTES) continue;
      const start = size <= 4 ? at + 8 : u32(at + 8);
      if (start + size > t.length) continue;
      entries.push({ tag, type, count: n, raw: t.slice(start, start + size) });
    }
    return entries;
  };
  const ifd0 = readIfd(u32(4));
  const pointer = (tag) => { const e = ifd0.find((entry) => entry.tag === tag); return e && e.raw.length >= 4 ? new DataView(e.raw.buffer).getUint32(0, little) : 0; };
  const exif = readIfd(pointer(0x8769));
  const gps = readIfd(pointer(0x8825));
  // IFD1 (the embedded thumbnail) is only inspected so the report can mention it.
  const next = u32(4) + 2 + 12 * Math.min(u16(u32(4)), 512);
  const hasThumbnail = next + 4 <= t.length && u32(next) > 0;
  return { little, ifd0, exif, gps, hasThumbnail };
}

const view = (entry, little) => new DataView(entry.raw.buffer, entry.raw.byteOffset, entry.raw.byteLength);
const text = (entry) => { if (!entry || entry.type !== 2) return ''; let end = entry.raw.indexOf(0); if (end < 0) end = entry.raw.length; return new TextDecoder().decode(entry.raw.subarray(0, end)).trim(); };
const rationals = (entry, little) => {
  if (!entry || (entry.type !== 5 && entry.type !== 10)) return [];
  const dv = view(entry); const out = [];
  for (let i = 0; i + 8 <= entry.raw.length; i += 8) {
    const num = entry.type === 5 ? dv.getUint32(i, little) : dv.getInt32(i, little);
    const den = entry.type === 5 ? dv.getUint32(i + 4, little) : dv.getInt32(i + 4, little);
    out.push(den ? num / den : NaN);
  }
  return out;
};
const find = (entries, tag) => entries.find((entry) => entry.tag === tag);

const coordinate = (values, ref, limit) => {
  if (!values.length || values.some((v) => !Number.isFinite(v))) return null;
  const degrees = values[0] + (values[1] || 0) / 60 + (values[2] || 0) / 3600;
  const signed = /^[SW]/i.test(ref) ? -degrees : degrees;
  return Math.abs(signed) <= limit ? signed : null;
};

/** What the EXIF block reveals. Always returns an object; `found` is false when the file has no EXIF. */
export function readMetadata(bytes) {
  const tiff = findExif(bytes);
  const parsed = tiff ? parseTiff(tiff) : null;
  const empty = { found: false, tagCount: 0, gps: null, make: '', model: '', software: '', taken: '', lens: '', artist: '', serial: '', owner: '', hasThumbnail: false };
  if (!parsed) return empty;
  const { little, ifd0, exif, gps } = parsed;
  const lat = coordinate(rationals(find(gps, 2), little), text(find(gps, 1)), 90);
  const lon = coordinate(rationals(find(gps, 4), little), text(find(gps, 3)), 180);
  let altitude = null;
  const alt = rationals(find(gps, 6), little)[0];
  if (Number.isFinite(alt)) { const below = find(gps, 5)?.raw?.[0] === 1; altitude = below ? -alt : alt; }
  return {
    found: true, tagCount: ifd0.length + exif.length + gps.length,
    make: text(find(ifd0, 0x010f)), model: text(find(ifd0, 0x0110)), software: text(find(ifd0, 0x0131)),
    artist: text(find(ifd0, 0x013b)),
    taken: text(find(exif, 0x9003)) || text(find(ifd0, 0x0132)),
    lens: text(find(exif, 0xa434)), serial: text(find(exif, 0xa431)), owner: text(find(exif, 0xa430)),
    gps: lat !== null && lon !== null ? { lat, lon, altitude } : null,
    hasThumbnail: parsed.hasThumbnail,
  };
}

const formatCoordinate = (value, positive, negative) => `${Math.abs(value).toFixed(5)}° ${value >= 0 ? positive : negative}`;
const formatDate = (value) => { const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2})/.exec(value || ''); return m ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}` : value; };

/**
 * Human-readable list for the privacy panel. level: 'high' (reveals where you were), 'personal' (identifies you or
 * your device), 'info' (harmless technical detail).
 */
export function describeMetadata(meta) {
  if (!meta?.found) return [];
  const items = [];
  if (meta.gps) items.push({ id: 'location', level: 'high', label: 'GPS location', value: `${formatCoordinate(meta.gps.lat, 'N', 'S')}, ${formatCoordinate(meta.gps.lon, 'E', 'W')}${meta.gps.altitude !== null ? ` · ${Math.round(meta.gps.altitude)} m` : ''}` });
  if (meta.serial) items.push({ id: 'serial', level: 'personal', label: 'Camera serial number', value: meta.serial });
  if (meta.owner) items.push({ id: 'owner', level: 'personal', label: 'Camera owner', value: meta.owner });
  if (meta.artist) items.push({ id: 'artist', level: 'personal', label: 'Author', value: meta.artist });
  const camera = [meta.make, meta.model].filter(Boolean).join(' ');
  if (camera) items.push({ id: 'camera', level: 'info', label: 'Camera', value: meta.lens ? `${camera} · ${meta.lens}` : camera });
  if (meta.taken) items.push({ id: 'date', level: 'info', label: 'Date taken', value: formatDate(meta.taken) });
  if (meta.software) items.push({ id: 'software', level: 'info', label: 'Software', value: meta.software });
  if (meta.hasThumbnail) items.push({ id: 'thumbnail', level: 'personal', label: 'Embedded thumbnail', value: 'A small copy of the photo (may show the uncropped original)' });
  return items;
}

/** Which described items survive in the converted file for a given mode. */
export function survivesMode(id, mode) {
  if (mode === 'keep') return id !== 'thumbnail';
  if (mode === 'safe') return id === 'camera' || id === 'date' || id === 'software';
  return false;
}

/* ---------- writing a clean EXIF block ---------- */

const SAFE_IFD0 = new Set([0x010f, 0x0110, 0x0131, 0x0132, 0x011a, 0x011b, 0x0128]);
const SAFE_EXIF = new Set([0x829a, 0x829d, 0x8822, 0x8827, 0x9000, 0x9003, 0x9004, 0x9201, 0x9202, 0x9203, 0x9204, 0x9205, 0x9207, 0x9209, 0x920a, 0xa001, 0xa402, 0xa403, 0xa405, 0xa432, 0xa433, 0xa434]);
// Never copied: structure that no longer matches the re-encoded pixels, embedded copies of the picture, vendor blobs.
const NEVER_IFD0 = new Set([0x0100, 0x0101, 0x0102, 0x0103, 0x0106, 0x0111, 0x0112, 0x0115, 0x0116, 0x0117, 0x011c, 0x014a, 0x0201, 0x0202, 0x02bc, 0x8769, 0x83bb, 0x8773, 0x8825, 0xc4a5]);
const NEVER_EXIF = new Set([0x927c, 0xa002, 0xa003, 0xa005, 0xa302]);

/** Builds a fresh TIFF/EXIF block for the converted JPG, or null when nothing is left to keep. Orientation is reset to 1. */
export function buildExif(tiff, mode) {
  if (mode !== 'safe' && mode !== 'keep') return null;
  const parsed = parseTiff(tiff);
  if (!parsed) return null;
  const { little } = parsed;
  const keepIfd0 = (e) => (mode === 'safe' ? SAFE_IFD0.has(e.tag) : !NEVER_IFD0.has(e.tag));
  const keepExif = (e) => (mode === 'safe' ? SAFE_EXIF.has(e.tag) : !NEVER_EXIF.has(e.tag));
  const ifd0 = parsed.ifd0.filter(keepIfd0);
  const exif = parsed.exif.filter(keepExif);
  const gps = mode === 'keep' ? parsed.gps : [];
  if (!ifd0.length && !exif.length && !gps.length) return null;

  const orientation = { tag: 0x0112, type: 3, count: 1, raw: Uint8Array.from(little ? [1, 0] : [0, 1]) };
  const pointer = (tag) => ({ tag, type: 4, count: 1, raw: new Uint8Array(4) });
  const exifPointer = exif.length ? pointer(0x8769) : null;
  const gpsPointer = gps.length ? pointer(0x8825) : null;
  const layout = [
    [...ifd0, orientation, ...(exifPointer ? [exifPointer] : []), ...(gpsPointer ? [gpsPointer] : [])],
    exif, gps,
  ].map((entries) => entries.sort((a, b) => a.tag - b.tag));
  const ifdSize = (entries) => (entries.length ? 2 + entries.length * 12 + 4 : 0);
  const starts = [8]; starts.push(starts[0] + ifdSize(layout[0])); starts.push(starts[1] + ifdSize(layout[1]));
  let cursor = starts[2] + ifdSize(layout[2]);
  const dataOffsets = new Map();
  for (const entries of layout) for (const entry of entries) {
    if (entry.raw.length > 4) { if (cursor & 1) cursor += 1; dataOffsets.set(entry, cursor); cursor += entry.raw.length; }
  }
  const out = new Uint8Array(cursor + (cursor & 1));
  const dv = new DataView(out.buffer);
  out.set(little ? [0x49, 0x49, 0x2a, 0] : [0x4d, 0x4d, 0, 0x2a], 0);
  dv.setUint32(4, 8, little);
  if (exifPointer) new DataView(exifPointer.raw.buffer).setUint32(0, starts[1], little);
  if (gpsPointer) new DataView(gpsPointer.raw.buffer).setUint32(0, starts[2], little);
  layout.forEach((entries, index) => {
    if (!entries.length) return;
    let at = starts[index];
    dv.setUint16(at, entries.length, little); at += 2;
    for (const entry of entries) {
      dv.setUint16(at, entry.tag, little); dv.setUint16(at + 2, entry.type, little); dv.setUint32(at + 4, entry.count, little);
      if (entry.raw.length > 4) { const place = dataOffsets.get(entry); dv.setUint32(at + 8, place, little); out.set(entry.raw, place); } else out.set(entry.raw, at + 8);
      at += 12;
    }
    dv.setUint32(at, 0, little); // no next IFD, so no embedded thumbnail
  });
  return out;
}

export function prepareExifForJpeg(sourceBytes, mode) {
  if (mode !== 'safe' && mode !== 'keep') return null;
  const tiff = findExif(sourceBytes);
  return tiff ? buildExif(tiff, mode) : null;
}

/** Inserts an EXIF block after the JPEG header (and the JFIF segment, which must come first). */
export function injectExif(jpeg, tiff) {
  if (!tiff || !jpeg || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return jpeg;
  const segmentLength = 2 + 6 + tiff.length;
  if (segmentLength > 0xffff) return jpeg;
  let at = 2;
  while (at + 4 <= jpeg.length && jpeg[at] === 0xff && (jpeg[at + 1] === 0xe0 || jpeg[at + 1] === 0xe1)) {
    if (jpeg[at + 1] === 0xe1 && hasExifHeader(jpeg, at + 4)) { // drop an existing EXIF segment
      const length = (jpeg[at + 2] << 8) | jpeg[at + 3];
      jpeg = Uint8Array.from([...jpeg.subarray(0, at), ...jpeg.subarray(at + 2 + length)]);
      continue;
    }
    at += 2 + ((jpeg[at + 2] << 8) | jpeg[at + 3]);
  }
  const out = new Uint8Array(jpeg.length + 2 + segmentLength);
  out.set(jpeg.subarray(0, at), 0);
  out.set([0xff, 0xe1, segmentLength >> 8, segmentLength & 0xff, 0x45, 0x78, 0x69, 0x66, 0, 0], at);
  out.set(tiff, at + 10);
  out.set(jpeg.subarray(at), at + 2 + segmentLength);
  return out;
}
