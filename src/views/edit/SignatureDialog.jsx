import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ImagePlus, RotateCcw, Signature, Trash2, X } from 'lucide-react';
import { cx } from '../../utils/cx.js';
import { canvasToSignature, loadSignatures, removeSignature, saveSignature, signatureFromFile } from '../../services/signatureStore.js';

const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/bmp';

export default function SignatureDialog({ onClose, onUse, notify }) {
  const canvasRef = useRef(null);
  const fileRef = useRef(null);
  const [presets, setPresets] = useState(loadSignatures);
  const [mode, setMode] = useState('upload');
  const [text, setText] = useState('Your signature');
  const [color, setColor] = useState('#172033');
  const [inked, setInked] = useState(false);
  const [upload, setUpload] = useState(null); // { file, sig } preview of an uploaded image
  const [removeBg, setRemoveBg] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => { const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }; window.addEventListener('keydown', onKey, true); return () => window.removeEventListener('keydown', onKey, true); }, [onClose]);

  const point = (event) => {
    const canvas = canvasRef.current; const rect = canvas.getBoundingClientRect();
    return [(event.clientX - rect.left) * canvas.width / rect.width, (event.clientY - rect.top) * canvas.height / rect.height];
  };
  const down = (event) => {
    if (mode !== 'draw') return;
    const canvas = canvasRef.current; const ctx = canvas.getContext('2d');
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 3.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const [x, y] = point(event);
    ctx.beginPath(); ctx.arc(x, y, 1.7, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.moveTo(x, y);
    canvas.setPointerCapture?.(event.pointerId); setInked(true);
  };
  const move = (event) => {
    if (mode !== 'draw' || !event.buttons) return;
    const ctx = canvasRef.current.getContext('2d'); ctx.lineTo(...point(event)); ctx.stroke();
  };
  const clear = useCallback(() => { const c = canvasRef.current; if (c) c.getContext('2d').clearRect(0, 0, c.width, c.height); setInked(false); }, []);

  const finish = (sig) => {
    // Every signature that gets used is stored as a preset, so it never has to be created again.
    setPresets((list) => saveSignature(list, sig));
    onUse({ kind: 'signature', data: sig.data, mime: 'image/png', width: sig.width, height: sig.height });
  };

  // Uploads are stored right away (not only on "Use"), so they always appear in the saved list below the drop area.
  // `replaceId` swaps the previous version of the same upload (e.g. when toggling background removal) instead of duplicating it.
  const storeUpload = async (file, removeBackground, replaceId) => {
    const sig = await signatureFromFile(file, { removeBackground });
    const base = replaceId ? removeSignature(loadSignatures(), replaceId) : loadSignatures();
    const list = saveSignature(base, sig);
    const entry = list.find((item) => item.data === sig.data);
    setPresets(list);
    if (!entry) notify?.('The signature could not be saved (browser storage is full). You can still use it now.', 'error');
    setUpload({ file, sig, id: entry?.id });
  };
  const pickFile = async (file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) { notify?.('Choose an image file (PNG, JPG, WebP…).', 'error'); return; }
    setBusy(true);
    try { await storeUpload(file, removeBg); }
    catch (error) { setUpload(null); notify?.(error.message || 'This image could not be used as a signature.', 'error'); }
    finally { setBusy(false); }
  };
  const toggleBg = async (value) => {
    setRemoveBg(value);
    if (!upload) return;
    setBusy(true);
    try { await storeUpload(upload.file, value, upload.id); } catch (error) { notify?.(error.message, 'error'); }
    finally { setBusy(false); }
  };

  const use = () => {
    if (mode === 'upload') { if (!upload) { notify?.('Choose an image of your signature first.', 'error'); return; } finish(upload.sig); return; }
    const canvas = canvasRef.current; const ctx = canvas.getContext('2d');
    if (mode === 'type') {
      if (!text.trim()) { notify?.('Type your name first.', 'error'); return; }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = 'italic 58px "Segoe Script", "Brush Script MT", cursive';
      ctx.fillText(text.trim(), canvas.width / 2, canvas.height / 2, canvas.width - 36);
    } else if (!inked) { notify?.('Draw your signature in the box before adding it.', 'error'); return; }
    const sig = canvasToSignature(canvas);
    if (!sig) { notify?.('Nothing to add yet.', 'error'); return; }
    finish(sig);
  };

  const switchMode = (next) => { setMode(next); if (next === 'draw' || next === 'type') requestAnimationFrame(clear); };
  const showCanvas = mode === 'draw' || mode === 'type';

  return (
    <div className="ep-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="ep-dialog" role="dialog" aria-modal="true" aria-labelledby="ep-sig-title">
        <header><span className="ep-dialog-icon"><Signature size={18} /></span><div><h2 id="ep-sig-title">Signatures</h2><p>Upload a signature or pick a saved one below. New signatures are saved automatically.</p></div><button type="button" className="ep-icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button></header>
        <div className="ep-seg" role="tablist">
          <button type="button" role="tab" aria-selected={mode === 'upload'} className={cx(mode === 'upload' && 'is-active')} onClick={() => switchMode('upload')}>Upload</button>
          <button type="button" role="tab" aria-selected={mode === 'draw'} className={cx(mode === 'draw' && 'is-active')} onClick={() => switchMode('draw')}>Draw</button>
          <button type="button" role="tab" aria-selected={mode === 'type'} className={cx(mode === 'type' && 'is-active')} onClick={() => switchMode('type')}>Type</button>
        </div>

        {mode === 'upload' && (
          <>
            <div className={cx('ep-sig-drop', upload && 'has-image')} onClick={() => fileRef.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); pickFile(e.dataTransfer.files?.[0]); }} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileRef.current?.click(); } }}>
              {upload ? <img src={upload.sig.data} alt="Signature preview" draggable="false" /> : <span><ImagePlus size={22} /><b>{busy ? 'Reading image…' : 'Click or drop an image of your signature'}</b><small>PNG, JPG, WebP · a photo on white paper works</small></span>}
            </div>
            <input ref={fileRef} className="hidden-input" type="file" accept={ACCEPT} onChange={(e) => { pickFile(e.target.files?.[0]); e.target.value = ''; }} />
            <label className="ep-check"><input type="checkbox" checked={removeBg} onChange={(e) => toggleBg(e.target.checked)} /> Remove white background</label>
            <div className="ep-sig-saved">
              <div className="ep-sig-saved-head">Saved signatures{presets.length ? ` (${presets.length})` : ''}</div>
              {presets.length ? (
                <div className="ep-sig-grid" role="listbox" aria-label="Saved signatures">
                  {presets.map((sig) => (
                    <div key={sig.id} className={cx('ep-sig-card', upload?.id === sig.id && 'is-new')}>
                      <button type="button" role="option" aria-selected={upload?.id === sig.id} className="ep-sig-pick" title="Use this signature" onClick={() => finish(sig)}><img src={sig.data} alt={sig.name || 'Saved signature'} draggable="false" /></button>
                      <button type="button" className="ep-sig-del" aria-label="Delete saved signature" title="Delete" onClick={() => { setPresets((list) => removeSignature(list, sig.id)); if (upload?.id === sig.id) setUpload(null); }}><Trash2 size={13} /></button>
                    </div>
                  ))}
                </div>
              ) : <div className="ep-sig-empty">No saved signatures yet. Upload, draw or type one and it will be kept here for next time.</div>}
            </div>
          </>
        )}

        {mode === 'type' && <label className="ep-field">Signature text<input value={text} onChange={(event) => setText(event.target.value)} maxLength={60} /></label>}
        {showCanvas && <canvas ref={canvasRef} width={680} height={220} className="ep-signature-canvas" onPointerDown={down} onPointerMove={move} />}

        {(mode === 'draw' || mode === 'type') && <div className="ep-dialog-row"><label className="ep-inline-field">Ink<input type="color" value={color} onChange={(event) => setColor(event.target.value)} /></label>{mode === 'draw' && <button type="button" className="ep-btn" onClick={clear}><RotateCcw size={14} /> Clear</button>}</div>}
        <footer><button type="button" className="ep-btn" onClick={onClose}>Cancel</button>{(mode !== 'upload' || upload) && <button type="button" className="ep-btn ep-btn-primary" onClick={use} disabled={busy}><Check size={15} /> {mode === 'upload' ? 'Use signature' : 'Save & use signature'}</button>}</footer>
      </section>
    </div>
  );
}
