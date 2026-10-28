import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, ClipboardPaste, Copy, FileImage, HardDrive, RotateCw, Save, ScanSearch, Trash2, UploadCloud } from 'lucide-react';
import ActionButton from '../components/common/ActionButton.jsx';
import Modal from '../components/common/Modal.jsx';
import Select from '../components/common/Select.jsx';
import { ENHANCE_MODES, IMAGE_EXTENSIONS, LAYOUT_MODES, buildText, copyText, decodeImage, extractImageText } from '../services/imageText.js';
import { saveInBrowser } from '../utils/download.js';
import { formatBytes } from '../utils/format.js';

const MAX_FILE_BYTES = 40 * 1024 * 1024;
let nextId = 1;

const baseName = (name) => String(name || 'image').replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]/g, '-').slice(0, 80) || 'image';
const toBlob = (item) => (item instanceof Blob ? item : new Blob([item.bytes], { type: item.mime || 'image/png' }));

export default function ImageTextModal({ setModal, notify }) {
  const [items, setItems] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [language, setLanguage] = useState('eng');
  const [languages, setLanguages] = useState([{ value: 'eng', label: 'English' }]);
  const [enhance, setEnhance] = useState('auto');
  const [layout, setLayout] = useState('auto');
  const [autoRotate, setAutoRotate] = useState(true);
  const [emoji, setEmoji] = useState(true);
  const [reflow, setReflow] = useState(false);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState('');
  const inputRef = useRef(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const workingRef = useRef(false);
  workingRef.current = working;
  const desktop = typeof window !== 'undefined' && typeof window.pdfStudio?.extractImageText === 'function';

  useEffect(() => {
    let live = true;
    window.pdfStudio?.listOcrLanguages?.().then((list) => {
      if (!live || !Array.isArray(list) || !list.length) return;
      const options = list.map((entry) => ({ value: entry.code, label: entry.label }));
      // English plus a second language is the most useful combination for mixed documents.
      const combos = options.filter((o) => o.value !== 'eng').map((o) => ({ value: `eng+${o.value}`, label: `English + ${o.label}` }));
      setLanguages([...options, ...combos]);
    }).catch(() => {});
    return () => { live = false; };
  }, []);

  useEffect(() => () => { itemsRef.current.forEach((item) => item.thumb && URL.revokeObjectURL(item.thumb)); }, []);

  const settingsKey = `${language}|${enhance}|${layout}|${autoRotate}|${emoji}`;

  // `replace` (used by Ctrl+V) throws away the previous images and their text so the newest screenshot starts clean.
  const addFiles = useCallback((incoming, { replace = false } = {}) => {
    const accepted = [];
    let skipped = 0;
    for (const file of Array.from(incoming || [])) {
      const name = file.name || 'pasted-image.png';
      const size = file.size ?? file.bytes?.byteLength ?? 0;
      const isImage = (file.type || file.mime || '').startsWith('image/') || IMAGE_EXTENSIONS.test(name);
      if (!isImage || !size || size > MAX_FILE_BYTES) { skipped += 1; continue; }
      const blob = toBlob(file);
      accepted.push({ id: nextId++, name, size, blob, thumb: URL.createObjectURL(blob), status: 'queued', text: '', result: null, doneKey: '', error: '', step: '' });
    }
    setMessage(skipped ? `${skipped} file${skipped === 1 ? ' was' : 's were'} skipped (not an image, empty, or over 40 MB).` : '');
    if (!accepted.length) return;
    if (replace) {
      itemsRef.current.forEach((item) => item.thumb && URL.revokeObjectURL(item.thumb));
      setItems(accepted);
      setActiveId(accepted[0].id);
      return;
    }
    setItems((current) => [...current, ...accepted]);
    setActiveId((current) => current ?? accepted[0].id);
  }, []);

  const browse = async () => {
    if (window.pdfStudio?.openFiles) {
      try { addFiles(await window.pdfStudio.openFiles({ accept: 'images' })); } catch (error) { setMessage(error?.message || 'Could not open the file picker.'); }
    } else inputRef.current?.click();
  };

  // Ctrl+V pastes screenshots straight from the clipboard.
  useEffect(() => {
    const onPaste = (event) => {
      const files = Array.from(event.clipboardData?.items || []).filter((entry) => entry.type.startsWith('image/')).map((entry) => entry.getAsFile()).filter(Boolean);
      if (!files.length) return;
      event.preventDefault();
      if (workingRef.current) { setMessage('Wait for the current extraction to finish, then paste again.'); return; }
      addFiles(files, { replace: true });
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [addFiles]);

  const patch = (id, changes) => setItems((current) => current.map((item) => (item.id === id ? { ...item, ...changes } : item)));

  const run = async () => {
    const pending = itemsRef.current.filter((item) => item.doneKey !== settingsKey);
    if (!pending.length || working) return;
    setWorking(true); workingRef.current = true; setMessage('');
    try {
      for (const item of pending) {
        patch(item.id, { status: 'working', error: '', step: 'Preparing image' });
        try {
          const bitmap = await decodeImage(item.blob);
          let result;
          try {
            result = await extractImageText(bitmap, { language, enhance, layout, autoRotate, emoji }, (step) => patch(item.id, { step }));
          } finally { bitmap.close?.(); }
          if (!result.available) { patch(item.id, { status: 'error', error: result.warning || 'Text extraction is unavailable.', step: '' }); continue; }
          patch(item.id, { status: 'done', result, text: buildText(result, { reflow }), doneKey: settingsKey, step: '', error: result.warning || '' });
        } catch (error) {
          patch(item.id, { status: 'error', error: error?.message || 'Could not read this image.', step: '' });
        }
      }
      // Show the text that was just extracted, even if another (older) image was selected before extracting.
      setActiveId((current) => (pending.some((item) => item.id === current) ? current : pending[0].id));
    } finally { setWorking(false); workingRef.current = false; }
  };

  // Toggling "reflow" re-renders text from the stored OCR result without re-running OCR.
  const toggleReflow = (next) => {
    setReflow(next);
    setItems((current) => current.map((item) => (item.result ? { ...item, text: buildText(item.result, { reflow: next }) } : item)));
  };

  const removeItem = (id) => {
    setItems((current) => {
      const target = current.find((item) => item.id === id);
      if (target?.thumb) URL.revokeObjectURL(target.thumb);
      const rest = current.filter((item) => item.id !== id);
      setActiveId((active) => (active === id ? (rest[0]?.id ?? null) : active));
      return rest;
    });
  };

  const active = items.find((item) => item.id === activeId) || null;
  const done = items.filter((item) => item.status === 'done');
  const needsRun = items.some((item) => item.doneKey !== settingsKey);
  const combined = useMemo(() => done.map((item) => (done.length > 1 ? `===== ${item.name} =====\n${item.text}` : item.text)).join('\n\n'), [done]);

  const copy = async (text, label) => { notify?.(await copyText(text) ? `${label} copied to the clipboard.` : 'Could not access the clipboard.', 'info'); };
  const save = async (text, name) => {
    // A UTF-8 byte-order mark makes Windows Notepad (and Word) show emoji and accented letters correctly.
    const body = new TextEncoder().encode(text);
    const data = /[^\x00-\x7f]/.test(text) ? Uint8Array.from([0xef, 0xbb, 0xbf, ...body]) : body;
    const result = window.pdfStudio?.saveFile
      ? await window.pdfStudio.saveFile({ name, data, filters: [{ name: 'Text file', extensions: ['txt'] }] })
      : await saveInBrowser(data, name, 'text/plain;charset=utf-8');
    if (!result?.canceled) notify?.(`Saved ${name}.`, 'info');
  };

  const statusLabel = (item) => (item.status === 'working' ? (item.step || 'Working…') : item.status === 'done'
    ? `${item.result.wordCount.toLocaleString()} words · ${Math.round(item.result.confidence)}% confidence` : item.status === 'error' ? 'Failed' : 'Ready');

  return (
    <Modal title="Image to text" eyebrow="OCR · TEXT EXTRACTOR" wide onClose={() => setModal(null)}
      onDropFiles={working ? undefined : addFiles} dropHint={{ kind: 'image', title: 'Drop images to extract their text', subtitle: 'PNG, JPG, WebP, BMP or GIF. Processed locally.', invalidTitle: 'Only images can be read here', invalidSubtitle: 'Drop a PNG, JPG, WebP, BMP or GIF file.' }}
      footer={<>
        <ActionButton onClick={() => setModal(null)}>Close</ActionButton>
        {done.length > 1 && <ActionButton icon={Save} onClick={() => save(combined, 'extracted-text.txt')}>Save all as .txt</ActionButton>}
        <ActionButton variant="primary" icon={done.length && !needsRun ? RotateCw : ScanSearch} loading={working} disabled={!items.length || !needsRun || !desktop} onClick={run}>
          {done.length && needsRun ? 'Extract again' : 'Extract text'}
        </ActionButton>
      </>}>
      <input ref={inputRef} type="file" accept="image/*" multiple className="hidden-input" tabIndex={-1} aria-hidden="true"
        onChange={(event) => { const files = Array.from(event.target.files || []); event.target.value = ''; addFiles(files); }} />
      <div className="modal-intro">
        <div className="modal-hero-icon modal-hero-blue"><ScanSearch size={22}/></div>
        <div><strong>Read the text inside photos, screenshots and scans</strong><p>Built-in offline OCR with automatic cleanup and rotation. Add several images at once, edit the result, then copy or save it.</p></div>
      </div>
      {!desktop && <div className="compress-inline-error" role="alert"><AlertTriangle size={15}/><span>Image to text needs the PDF Studio desktop app (its offline OCR engine is not available in the browser).</span></div>}

      <button type="button" className="itx-drop" onClick={browse} disabled={working}>
        <UploadCloud size={22}/>
        <strong>{items.length ? 'Add more images' : 'Click to choose images, drop them here, or press Ctrl+V to paste a screenshot'}</strong>
        <span><ClipboardPaste size={12}/> PNG · JPG · WebP · BMP · GIF</span>
      </button>

      <div className="compress-controls itx-options">
        <label className="form-label">Language
          <Select className="form-input" value={language} options={languages} onChange={setLanguage} ariaLabel="OCR language" />
        </label>
        <label className="form-label">Image enhancement
          <Select className="form-input" value={enhance} options={ENHANCE_MODES} onChange={setEnhance} ariaLabel="Image enhancement" />
        </label>
        <label className="form-label">Text layout
          <Select className="form-input" value={layout} options={LAYOUT_MODES} onChange={setLayout} ariaLabel="Text layout" />
        </label>
        <label className="compress-check-row"><input type="checkbox" checked={autoRotate} onChange={(event) => setAutoRotate(event.target.checked)} /><span><strong>Auto-rotate sideways or upside-down images</strong><small>If the first read looks wrong, other orientations are tried and the best one is kept.</small></span></label>
        <label className="compress-check-row"><input type="checkbox" checked={emoji} onChange={(event) => setEmoji(event.target.checked)} /><span><strong>Recognize emoji</strong><small>Finds emoji in the image, matches them to the closest standard emoji and puts them back into the text.</small></span></label>
        <label className="compress-check-row"><input type="checkbox" checked={reflow} onChange={(event) => toggleReflow(event.target.checked)} /><span><strong>Join wrapped lines into paragraphs</strong><small>Removes hard line breaks and repairs words split by hyphens. Applies instantly.</small></span></label>
      </div>

      {items.length > 0 && <div className="itx-list" role="list">
        {items.map((item) => (
          <div key={item.id} role="listitem" className={`itx-item ${item.id === activeId ? 'is-active' : ''} is-${item.status}`}>
            <button type="button" className="itx-item-main" onClick={() => setActiveId(item.id)}>
              <img src={item.thumb} alt="" />
              <span className="itx-item-copy"><strong>{item.name}</strong><small>{formatBytes(item.size)} · {statusLabel(item)}</small></span>
              {item.status === 'done' && <CheckCircle2 size={15} className="itx-ok"/>}
              {item.status === 'error' && <AlertTriangle size={15} className="itx-bad"/>}
            </button>
            <button type="button" className="itx-remove" aria-label={`Remove ${item.name}`} disabled={working} onClick={() => removeItem(item.id)}><Trash2 size={14}/></button>
          </div>
        ))}
      </div>}

      {active && <section className="compress-result-panel itx-result" aria-label="Extracted text">
        <div className="compress-result-title">
          <div><strong>{active.name}</strong><span>{active.status === 'done' ? `${active.result.engine} · ${active.result.language}${active.result.rotation ? ` · rotated ${active.result.rotation}°` : ''}` : 'Not extracted yet'}</span></div>
          {active.status === 'done' && <span className={active.result.confidence >= 80 ? 'compress-result-pill' : 'compress-result-pill is-neutral'}>{Math.round(active.result.confidence)}% confidence</span>}
        </div>
        {active.status === 'done' && <>
          <div className={`compress-result-stats ${active.result.emojiCount ? 'has-emoji' : ''}`}>
            <div><small>Words</small><strong>{active.result.wordCount.toLocaleString()}</strong></div>
            <div><small>Characters</small><strong>{active.text.length.toLocaleString()}</strong></div>
            <div><small>Uncertain words</small><strong>{active.result.lowConfidenceWords}</strong></div>
            <div><small>Lines</small><strong>{active.text ? active.text.split('\n').filter(Boolean).length : 0}</strong></div>
            {active.result.emojiCount > 0 && <div><small>Emoji</small><strong>{active.result.emojiCount}</strong></div>}
          </div>
          <textarea className="form-input itx-text" value={active.text} spellCheck="false" aria-label="Extracted text" onChange={(event) => patch(active.id, { text: event.target.value })} />
          <div className="itx-actions">
            <ActionButton icon={Copy} onClick={() => copy(active.text, 'Text')}>Copy text</ActionButton>
            <ActionButton icon={Save} onClick={() => save(active.text, `${baseName(active.name)}.txt`)}>Save as .txt</ActionButton>
            {done.length > 1 && <ActionButton icon={Copy} onClick={() => copy(combined, 'All text')}>Copy all</ActionButton>}
          </div>
          {active.result.emojiCount > 0 && <p className="compress-help">Emoji are matched to the closest standard emoji, so a similar one (for example 😂 and 🤣) can be swapped. Edit the text if needed.</p>}
          {active.result.emojiSkipped > 0 && <p className="compress-help">{active.result.emojiSkipped} emoji-like image{active.result.emojiSkipped === 1 ? '' : 's'} could not be matched confidently and {active.result.emojiSkipped === 1 ? 'was' : 'were'} left out.</p>}
          {active.result.lowConfidenceWords > 0 && <p className="compress-help">{active.result.lowConfidenceWords} word{active.result.lowConfidenceWords === 1 ? '' : 's'} had low confidence. Proofread numbers and names, or try “Document / scan” enhancement.</p>}
        </>}
        {active.status === 'working' && <p className="compress-help">{active.step || 'Working…'}</p>}
        {active.error && <div className="compress-inline-error" role="alert"><AlertTriangle size={15}/><span>{active.error}</span></div>}
        {active.status === 'queued' && <p className="compress-help">Press “Extract text” to read {items.length > 1 ? 'all queued images' : 'this image'}.</p>}
      </section>}
      {message && <div className="compress-inline-error" role="alert"><AlertTriangle size={15}/><span>{message}</span></div>}
      <div className="compress-privacy-note"><HardDrive size={14}/><span>Processed locally on this computer. No cloud upload.</span></div>
    </Modal>
  );
}
