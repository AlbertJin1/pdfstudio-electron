import { useRef, useState } from 'react';
import { Check, RotateCcw, Signature, X } from 'lucide-react';
import { cx } from '../../utils/cx.js';

export default function SignatureDialog({ onClose, onUse, notify }) {
  const canvasRef = useRef(null);
  const [mode, setMode] = useState('draw');
  const [text, setText] = useState('Your signature');
  const [color, setColor] = useState('#172033');
  const [inked, setInked] = useState(false);

  const point = (event) => {
    const canvas = canvasRef.current; const rect = canvas.getBoundingClientRect();
    return [(event.clientX - rect.left) * canvas.width / rect.width, (event.clientY - rect.top) * canvas.height / rect.height];
  };
  const down = (event) => {
    if (mode !== 'draw') return;
    const canvas = canvasRef.current; const ctx = canvas.getContext('2d');
    ctx.strokeStyle = color; ctx.lineWidth = 3.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(...point(event)); canvas.setPointerCapture?.(event.pointerId); setInked(true);
  };
  const move = (event) => {
    if (mode !== 'draw' || !event.buttons) return;
    const ctx = canvasRef.current.getContext('2d'); ctx.lineTo(...point(event)); ctx.stroke();
  };
  const clear = () => { const c = canvasRef.current; c.getContext('2d').clearRect(0, 0, c.width, c.height); setInked(false); };
  const use = () => {
    const canvas = canvasRef.current; const ctx = canvas.getContext('2d');
    if (mode === 'type') {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = 'italic 58px "Segoe Script", "Brush Script MT", cursive';
      ctx.fillText(text.trim() || 'Signature', canvas.width / 2, canvas.height / 2, canvas.width - 36);
    } else if (!inked) { notify?.('Draw your signature in the box before adding it.', 'error'); return; }
    onUse({ kind: 'signature', data: canvas.toDataURL('image/png'), mime: 'image/png', width: canvas.width, height: canvas.height, color });
  };

  return (
    <div className="ep-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="ep-dialog" role="dialog" aria-modal="true" aria-labelledby="ep-sig-title">
        <header><span className="ep-dialog-icon"><Signature size={18} /></span><div><h2 id="ep-sig-title">Create signature</h2><p>Draw it, or type your name in a signature style.</p></div><button type="button" className="ep-icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button></header>
        <div className="ep-seg"><button type="button" className={cx(mode === 'draw' && 'is-active')} onClick={() => { setMode('draw'); clear(); }}>Draw</button><button type="button" className={cx(mode === 'type' && 'is-active')} onClick={() => { setMode('type'); clear(); }}>Type</button></div>
        {mode === 'type' && <label className="ep-field">Signature text<input value={text} onChange={(event) => setText(event.target.value)} maxLength={60} /></label>}
        <canvas ref={canvasRef} width={680} height={220} className="ep-signature-canvas" onPointerDown={down} onPointerMove={move} />
        <div className="ep-dialog-row"><label className="ep-inline-field">Ink<input type="color" value={color} onChange={(event) => setColor(event.target.value)} /></label><button type="button" className="ep-btn" onClick={clear}><RotateCcw size={14} /> Clear</button></div>
        <footer><button type="button" className="ep-btn" onClick={onClose}>Cancel</button><button type="button" className="ep-btn ep-btn-primary" onClick={use}><Check size={15} /> Use signature</button></footer>
      </section>
    </div>
  );
}
