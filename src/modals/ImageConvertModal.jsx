import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Camera, CheckCircle2, Download, ImageDown, KeyRound, MapPin, RotateCw, ShieldCheck, Trash2, UploadCloud } from 'lucide-react';
import ActionButton from '../components/common/ActionButton.jsx';
import FolderDestination from '../components/common/FolderDestination.jsx';
import Modal from '../components/common/Modal.jsx';
import Select from '../components/common/Select.jsx';
import { useExportFolder } from '../hooks/useExportFolder.js';
import { INPUT_EXTENSIONS, KIND_LABEL, MAX_INPUT_BYTES, OUTPUT_FORMATS, SIZE_LIMITS, TARGET_SIZES, convertImage, inspectImage, outputName } from '../services/imageConvert.js';
import { METADATA_MODES, describeMetadata, readMetadata, survivesMode } from '../services/imageMetadata.js';
import { saveInBrowser } from '../utils/download.js';
import { formatBytes } from '../utils/format.js';
import { saveImageExportPrefs } from '../utils/imageExportPrefs.js';
import { cx } from '../utils/cx.js';

const MAX_FILES = 100;
let nextId = 1;

// Desktop picker items carry their data in `bytes` (a Uint8Array); browser/dropped Files must be read. Careful: in current
// Chromium, File also has a bytes() METHOD, so `file.bytes` is only data when it is not a function.
async function readBytes(file) {
  if (file.bytes instanceof Uint8Array) return file.bytes;
  if (file.bytes instanceof ArrayBuffer) return new Uint8Array(file.bytes);
  if (ArrayBuffer.isView(file.bytes)) return new Uint8Array(file.bytes.buffer, file.bytes.byteOffset, file.bytes.byteLength);
  return new Uint8Array(await file.arrayBuffer());
}

const percent = (from, to) => (from > 0 ? Math.round((1 - to / from) * 100) : 0);
const savings = (from, to) => { const p = percent(from, to); return p > 0 ? `−${p}%` : p < 0 ? `+${-p}%` : 'same size'; };
const levelIcon = { location: MapPin, camera: Camera, serial: KeyRound, owner: KeyRound, artist: KeyRound };

export default function ImageConvertModal({ setModal, notify }) {
  const [items, setItems] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [format, setFormat] = useState('jpg');
  const [quality, setQuality] = useState(90);
  const [maxSide, setMaxSide] = useState(0);
  const [target, setTarget] = useState(0);
  const [background, setBackground] = useState('#ffffff');
  const [metadata, setMetadata] = useState('strip');
  const [openWhenDone, setOpenWhenDone] = useState(true);
  const [working, setWorking] = useState(false);
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const inputRef = useRef(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const busyRef = useRef(false);
  busyRef.current = working || reading || saving;

  const spec = OUTPUT_FORMATS.find((entry) => entry.value === format) || OUTPUT_FORMATS[0];
  // Only JPG can carry camera details; every other output is always clean.
  const effectiveMode = format === 'jpg' ? metadata : 'strip';
  const settingsKey = `${format}|${quality}|${maxSide}|${spec.lossy ? target : 0}|${spec.alpha ? '' : background}|${effectiveMode}`;
  const folder = useExportFolder({ sourcePath: items.find((item) => item.path)?.path || '' });

  useEffect(() => () => { itemsRef.current.forEach((item) => item.thumb && URL.revokeObjectURL(item.thumb)); }, []);

  const patch = (id, changes) => setItems((current) => current.map((item) => (item.id === id ? { ...item, ...changes } : item)));

  const addFiles = useCallback(async (incoming) => {
    if (busyRef.current) { setMessage('Wait for the current task to finish, then add more images.'); return; }
    const list = Array.from(incoming || []);
    if (!list.length) return;
    setReading(true); setMessage('');
    const problems = [];
    let added = 0;
    try {
      for (const file of list) {
        const name = file.name || 'pasted-image.png';
        if (itemsRef.current.length + added >= MAX_FILES) { problems.push(`Only ${MAX_FILES} images can be converted at once.`); break; }
        const looksLikeImage = (file.type || file.mime || '').startsWith('image/') || INPUT_EXTENSIONS.test(name);
        if (!looksLikeImage) { problems.push(`${name}: not an image`); continue; }
        try {
          const bytes = await readBytes(file);
          if (!bytes.length) throw new Error('the file is empty');
          if (bytes.length > MAX_INPUT_BYTES) throw new Error('larger than 80 MB');
          if (itemsRef.current.some((item) => item.name === name && item.size === bytes.length && item.path === (file.path || ''))) { problems.push(`${name}: already in the list`); continue; }
          const info = await inspectImage(bytes, name);
          const entry = { id: nextId++, name, path: file.path || '', size: bytes.length, bytes, ...info, meta: readMetadata(bytes), status: 'queued', step: '', result: null, doneKey: '', error: '' };
          setItems((current) => [...current, entry]);
          setActiveId((current) => current ?? entry.id);
          itemsRef.current = [...itemsRef.current, entry];
          added += 1;
        } catch (error) { problems.push(`${name}: ${error?.message || 'could not be read'}`); }
      }
    } finally { setReading(false); }
    if (problems.length) setMessage(problems.slice(0, 3).join(' · ') + (problems.length > 3 ? ` · and ${problems.length - 3} more` : ''));
  }, []);

  const browse = async () => {
    if (window.pdfStudio?.openFiles) {
      try { addFiles(await window.pdfStudio.openFiles({ accept: 'convert' })); } catch (error) { setMessage(error?.message || 'Could not open the file picker.'); }
    } else inputRef.current?.click();
  };

  useEffect(() => {
    const onPaste = (event) => {
      const files = Array.from(event.clipboardData?.items || []).filter((entry) => entry.type.startsWith('image/')).map((entry) => entry.getAsFile()).filter(Boolean);
      if (files.length) { event.preventDefault(); addFiles(files); }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [addFiles]);

  const removeItem = (id) => {
    setItems((current) => {
      const target = current.find((item) => item.id === id);
      if (target?.thumb) URL.revokeObjectURL(target.thumb);
      const rest = current.filter((item) => item.id !== id);
      setActiveId((active) => (active === id ? (rest[0]?.id ?? null) : active));
      return rest;
    });
  };
  const clearAll = () => { itemsRef.current.forEach((item) => item.thumb && URL.revokeObjectURL(item.thumb)); setItems([]); setActiveId(null); setMessage(''); };

  const run = async () => {
    const pending = itemsRef.current.filter((item) => item.doneKey !== settingsKey);
    if (!pending.length || busyRef.current) return;
    setWorking(true); setMessage('');
    const used = new Set();
    // Names already taken by finished files in this batch keep their numbering stable.
    itemsRef.current.filter((item) => item.doneKey === settingsKey && item.result).forEach((item) => used.add(item.result.name.toLowerCase()));
    const options = { format, quality: quality / 100, maxSide, targetBytes: spec.lossy ? target : 0, background, metadata: effectiveMode };
    try {
      for (const item of pending) {
        patch(item.id, { status: 'working', error: '', step: 'Starting' });
        try {
          const result = await convertImage({ bytes: item.bytes, name: item.name }, options, (step) => patch(item.id, { step }));
          patch(item.id, { status: 'done', step: '', doneKey: settingsKey, result: { ...result, name: outputName(item.name, spec.ext, used), mime: spec.mime, label: spec.label, ext: spec.ext } });
        } catch (error) {
          patch(item.id, { status: 'error', step: '', error: error?.message || 'This image could not be converted.' });
        }
      }
    } finally { setWorking(false); }
  };

  const saveOne = async (item) => {
    if (!item?.result || busyRef.current) return;
    setSaving(true);
    try {
      const { name, data, label, ext } = item.result;
      const result = window.pdfStudio?.saveFile
        ? await window.pdfStudio.saveFile({ name, data, filters: [{ name: `${label} image`, extensions: [ext] }] })
        : await saveInBrowser(data, name, item.result.mime);
      if (!result?.canceled) notify?.(`Saved ${name}.`, 'info');
    } catch (error) { setMessage(error?.message || 'Could not save the file.'); } finally { setSaving(false); }
  };

  const done = items.filter((item) => item.status === 'done' && item.doneKey === settingsKey);
  const pendingCount = items.filter((item) => item.doneKey !== settingsKey).length;
  const folderName = `Converted to ${spec.label}`;

  const saveAll = async () => {
    if (!done.length || busyRef.current) return;
    if (done.length === 1) { saveOne(done[0]); return; }
    const bridge = window.pdfStudio;
    const desktop = Boolean(bridge?.beginFolderExport);
    if (desktop && !folder.parentPath) { setMessage('Choose a folder to save the converted images in.'); return; }
    setSaving(true); setMessage('');
    let session = null; let written = 0; let destination = '';
    try {
      let write;
      if (desktop) {
        session = await bridge.beginFolderExport({ parent: folder.parentPath, folderName });
        destination = session.folder;
        write = (name, data) => bridge.writeFolderExport({ token: session.token, name, data });
      } else if (folder.directoryHandle) {
        let name = null;
        for (let attempt = 1; attempt <= 500 && !name; attempt += 1) {
          const candidate = attempt === 1 ? folderName : `${folderName} (${attempt})`;
          try { await folder.directoryHandle.getDirectoryHandle(candidate); } catch { name = candidate; }
        }
        const dir = await folder.directoryHandle.getDirectoryHandle(name, { create: true });
        destination = `${folder.directoryHandle.name}/${name}`;
        write = async (fileName, data) => { const handle = await dir.getFileHandle(fileName, { create: true }); const writable = await handle.createWritable(); await writable.write(data); await writable.close(); };
      } else {
        write = (fileName, data) => saveInBrowser(data, fileName, spec.mime);
        destination = 'your Downloads folder';
      }
      for (const item of done) { await write(item.result.name, item.result.data); written += 1; }
      if (desktop) saveImageExportPrefs({ folder: folder.parentPath });
      if (session) { await bridge.finishFolderExport({ token: session.token, open: openWhenDone }); session = null; }
      notify?.(`${written} image${written === 1 ? '' : 's'} saved to ${destination}.`, 'info');
    } catch (error) {
      setMessage(error?.message || 'Could not save the images.');
    } finally {
      if (session) { try { await bridge.finishFolderExport({ token: session.token, open: false }); } catch { /* ignore */ } }
      setSaving(false);
    }
  };

  const active = items.find((item) => item.id === activeId) || null;
  const activeFacts = useMemo(() => describeMetadata(active?.meta), [active]);
  const withData = items.filter((item) => describeMetadata(item.meta).length).length;
  const withGps = items.filter((item) => item.meta?.gps).length;
  const totalBefore = done.reduce((sum, item) => sum + item.size, 0);
  const totalAfter = done.reduce((sum, item) => sum + item.result.data.length, 0);
  const locationsRemoved = done.filter((item) => item.meta?.gps && !survivesMode('location', item.result.metadata)).length;
  const modeHint = format === 'jpg' ? null : `${spec.label} files can’t carry camera details, so all hidden data is always removed. Choose JPG to keep some of it.`;

  const subtitle = (item) => {
    const base = `${KIND_LABEL[item.kind] || 'Image'} · ${item.width.toLocaleString()}×${item.height.toLocaleString()} · ${formatBytes(item.size)}`;
    if (item.status === 'working') return item.step || 'Working…';
    if (item.status === 'error') return 'Could not convert';
    if (item.status === 'done' && item.doneKey === settingsKey) {
      const r = item.result;
      return `${base} → ${r.label} · ${r.width.toLocaleString()}×${r.height.toLocaleString()} · ${formatBytes(r.data.length)} (${savings(item.size, r.data.length)})`;
    }
    return base;
  };

  return (
    <Modal title="Format converter" eyebrow="IMAGES · CONVERT" wide onClose={() => setModal(null)}
      onDropFiles={busyRef.current ? undefined : addFiles}
      dropHint={{ kind: 'image', title: 'Drop images to convert them', subtitle: 'HEIC, WebP, PNG, JPG, AVIF, TIFF, GIF, BMP, SVG or ICO.', invalidTitle: 'Only images can be converted here', invalidSubtitle: 'Drop HEIC, WebP, PNG, JPG, AVIF, TIFF, GIF, BMP, SVG or ICO files.' }}
      footer={<>
        <ActionButton onClick={() => setModal(null)}>Close</ActionButton>
        <ActionButton icon={Download} loading={saving} disabled={!done.length || working || reading || (done.length > 1 && folder.desktop && folder.needsFolder)} variant={pendingCount ? undefined : 'primary'} onClick={saveAll}>
          {done.length > 1 ? `Save ${done.length} images` : 'Save image'}
        </ActionButton>
        <ActionButton variant={pendingCount ? 'primary' : undefined} icon={done.length && !pendingCount ? RotateCw : ImageDown} loading={working} disabled={!items.length || !pendingCount || reading || saving} onClick={run}>
          {done.length && pendingCount ? 'Convert again' : done.length ? 'Converted' : `Convert${items.length ? ` ${items.length} image${items.length === 1 ? '' : 's'}` : ''}`}
        </ActionButton>
      </>}>
      <input ref={inputRef} type="file" multiple accept="image/*,.heic,.heif,.hif,.avif,.tif,.tiff,.svg,.ico" className="hidden-input" tabIndex={-1} aria-hidden="true"
        onChange={(event) => { const files = Array.from(event.target.files || []); event.target.value = ''; addFiles(files); }} />
      <div className="modal-intro">
        <div className="modal-hero-icon modal-hero-green"><ImageDown size={22} /></div>
        <div><strong>Convert HEIC, WebP, PNG, JPG and more</strong><p>Change the format of many images at once, resize them or squeeze each under a size limit. The Privacy shield shows the location and camera details hidden in your photos, and removes them.</p></div>
      </div>

      <button type="button" className="itx-drop" onClick={browse} disabled={working || reading || saving}>
        <UploadCloud size={22} />
        <strong>{reading ? 'Reading images…' : items.length ? 'Add more images' : 'Click to choose images, drop them here, or press Ctrl+V to paste'}</strong>
        <span>HEIC · WebP · PNG · JPG · AVIF · TIFF · GIF · BMP · SVG · ICO</span>
      </button>

      {items.length > 0 && <>
        <div className="cvt-list-head"><span>{items.length} image{items.length === 1 ? '' : 's'}</span><button type="button" className="cvt-link" onClick={clearAll} disabled={working || reading || saving}>Remove all</button></div>
        <div className="itx-list cvt-list" role="list">
          {items.map((item) => {
            const facts = describeMetadata(item.meta);
            const hasPersonal = facts.some((fact) => fact.level === 'personal');
            return (
              <div key={item.id} role="listitem" className={cx('itx-item', 'cvt-item', item.id === activeId && 'is-active', `is-${item.status}`)}>
                <button type="button" className="itx-item-main" onClick={() => setActiveId(item.id)}>
                  {item.thumb ? <img src={item.thumb} alt="" /> : <span className="cvt-thumb-empty"><ImageDown size={16} /></span>}
                  <span className="itx-item-copy"><strong>{item.name}</strong><small>{subtitle(item)}</small></span>
                  <span className="cvt-chips">
                    {item.meta?.gps && <span className="cvt-chip is-high" title="Contains a GPS location"><MapPin size={11} />Location</span>}
                    {hasPersonal && <span className="cvt-chip is-personal" title="Contains personal or device identifiers"><KeyRound size={11} />Personal</span>}
                    {!item.meta?.gps && !hasPersonal && facts.length > 0 && <span className="cvt-chip" title="Camera and date details"><Camera size={11} />Camera</span>}
                  </span>
                  {item.status === 'done' && item.doneKey === settingsKey && <CheckCircle2 size={15} className="itx-ok" />}
                  {item.status === 'error' && <AlertTriangle size={15} className="itx-bad" />}
                </button>
                {item.status === 'done' && item.doneKey === settingsKey && <button type="button" className="itx-remove cvt-save" aria-label={`Save ${item.result.name}`} title="Save this image" disabled={busyRef.current} onClick={() => saveOne(item)}><Download size={14} /></button>}
                <button type="button" className="itx-remove" aria-label={`Remove ${item.name}`} disabled={working || reading || saving} onClick={() => removeItem(item.id)}><Trash2 size={14} /></button>
              </div>
            );
          })}
        </div>
        {active?.error && <div className="compress-inline-error" role="alert"><AlertTriangle size={15} /><span>{active.name}: {active.error}</span></div>}
      </>}

      <div className="img-export-section cvt-section">
        <span className="img-export-label">Convert to</span>
        <div className="segmented-choice cvt-formats" role="radiogroup" aria-label="Output format">
          {OUTPUT_FORMATS.map((option) => <button key={option.value} type="button" role="radio" aria-checked={format === option.value} className={cx(format === option.value && 'segment-active')} disabled={working} onClick={() => setFormat(option.value)}><span>{option.label}</span><small>{option.hint}</small></button>)}
        </div>
      </div>

      <div className="compress-controls cvt-options">
        <label className="form-label">Quality {spec.lossy ? `· ${quality}%` : ''}
          <div className="range-row"><input type="range" min="40" max="100" step="1" value={quality} disabled={!spec.lossy || working} onChange={(event) => setQuality(Number(event.target.value))} aria-label="Quality" /><strong>{spec.lossy ? `${quality}%` : '—'}</strong></div>
          {!spec.lossy && <small className="cvt-hint">{spec.label} is lossless, so there is no quality setting.</small>}
        </label>
        <label className="form-label">Image size
          <Select className="form-input" value={maxSide} options={SIZE_LIMITS} onChange={setMaxSide} ariaLabel="Image size" disabled={working} />
        </label>
        <label className="form-label">File size limit
          <Select className="form-input" value={spec.lossy ? target : 0} options={TARGET_SIZES} onChange={setTarget} ariaLabel="File size limit" disabled={!spec.lossy || working} />
          <small className="cvt-hint">{spec.lossy ? (target ? 'Each image gets the best quality that fits; it is shrunk slightly only if it must be.' : 'Handy for upload forms that cap the file size.') : `Not available for ${spec.label}.`}</small>
        </label>
        {!spec.alpha && <label className="form-label">Background for transparent areas
          <span className="cvt-color"><input type="color" value={background} disabled={working} onChange={(event) => setBackground(event.target.value)} aria-label="Background color" /><code>{background.toUpperCase()}</code></span>
          <small className="cvt-hint">{spec.label} has no transparency, so see-through areas are filled with this color.</small>
        </label>}
      </div>

      <section className="cvt-shield" aria-label="Privacy shield">
        <div className="cvt-shield-head">
          <span className="cvt-shield-icon"><ShieldCheck size={18} /></span>
          <div>
            <strong>Privacy shield</strong>
            <span>{!items.length ? 'Add photos to see what hidden data they carry.' : withData ? `${withData} of ${items.length} image${items.length === 1 ? '' : 's'} carr${withData === 1 ? 'ies' : 'y'} hidden data${withGps ? ` · ${withGps} with a GPS location` : ''}.` : 'No hidden location or camera data found in these images.'}</span>
          </div>
        </div>
        <div className="segmented-choice is-three cvt-modes" role="radiogroup" aria-label="Hidden data">
          {METADATA_MODES.map((option) => {
            const locked = format !== 'jpg' && option.value !== 'strip';
            return <button key={option.value} type="button" role="radio" aria-checked={effectiveMode === option.value} disabled={locked || working} className={cx(effectiveMode === option.value && 'segment-active')} onClick={() => setMetadata(option.value)}><span>{option.label}</span><small>{option.hint}</small></button>;
          })}
        </div>
        {modeHint && <small className="cvt-hint">{modeHint}</small>}
        {active && <div className="cvt-facts">
          <div className="cvt-facts-title">Hidden in <b>{active.name}</b></div>
          {activeFacts.length === 0 && <div className="cvt-fact is-clear"><CheckCircle2 size={14} /><span><b>Nothing found</b><small>This image has no EXIF camera or location data.</small></span></div>}
          {activeFacts.map((fact) => {
            const Icon = levelIcon[fact.id] || (fact.level === 'info' ? Camera : KeyRound);
            const kept = survivesMode(fact.id, effectiveMode);
            return <div key={fact.id} className={cx('cvt-fact', `is-${fact.level}`)}>
              <Icon size={14} />
              <span><b>{fact.label}</b><small>{fact.value}</small></span>
              <em className={kept ? 'is-kept' : 'is-removed'}>{kept ? 'Kept' : 'Removed'}</em>
            </div>;
          })}
        </div>}
      </section>

      {done.length > 0 && <div className="cvt-summary" role="status">
        <CheckCircle2 size={15} />
        <span><b>{done.length} image{done.length === 1 ? '' : 's'} converted</b> · {formatBytes(totalBefore)} → {formatBytes(totalAfter)} ({savings(totalBefore, totalAfter)}){locationsRemoved ? ` · GPS location removed from ${locationsRemoved} image${locationsRemoved === 1 ? '' : 's'}` : ''}
          {done.some((item) => !item.result.fits) ? ' · some images could not get under the size limit' : done.some((item) => item.result.fitShrunk) ? ' · some were shrunk to fit the limit' : ''}</span>
      </div>}

      {done.length > 1 && <FolderDestination folder={folder} folderName={folderName} openWhenDone={openWhenDone} onOpenWhenDoneChange={setOpenWhenDone} />}
      {message && <div className="compress-inline-error" role="alert"><AlertTriangle size={15} /><span>{message}</span></div>}
      <div className="compress-privacy-note"><ShieldCheck size={14} /><span>Converted on this computer. Nothing is uploaded.</span></div>
    </Modal>
  );
}
