import { useEffect, useRef, useState } from 'react';
import { FileText, LockKeyhole, Type } from 'lucide-react';
import ActionButton from '../common/ActionButton.jsx';
import { renderPageCanvas } from '../../services/pdf/index.js';

export default function PagePreview({ page, sources, onAddText, onAddBlock, zoom = 1 }) {
  const holderRef = useRef(null);
  const [renderError, setRenderError] = useState('');
  useEffect(() => {
    let alive = true;
    const holder = holderRef.current;
    if (!holder || !page) return undefined;
    holder.innerHTML = '';
    setRenderError('');
    renderPageCanvas(page, sources, Math.round(900 * zoom), true).then((canvas) => {
      if (!alive || !holderRef.current) return;
      canvas.className = 'preview-rendered-canvas';
      canvas.style.width = '100%';
      canvas.style.height = 'auto';
      canvas.style.display = 'block';
      holderRef.current.innerHTML = '';
      holderRef.current.appendChild(canvas);
    }).catch((error) => { if (alive) setRenderError(error?.message || 'Preview unavailable'); });
    return () => { alive = false; };
  }, [page?.id, page?.rotation, page?.kind, page?.sourcePageIndex, sources, zoom]);

  return <div className="preview-stage">
    <div className="preview-paper-wrap">
      <div ref={holderRef} className="preview-paper" />
      {!!page?.overlays?.length && <div className="preview-annotations" aria-hidden="true">
        {page.overlays.map((overlay, index) => overlay.type === 'rect'
          ? <div key={`${page.id}-overlay-${index}`} className="annotation-rect" style={{ left: `${overlay.x}%`, top: `${overlay.y}%`, width: `${overlay.width || 30}%`, height: `${overlay.height || 8}%`, background: overlay.color || '#232638' }} />
          : <div key={`${page.id}-overlay-${index}`} className="annotation-text" style={{ left: `${overlay.x}%`, top: `${overlay.y}%`, color: overlay.color || '#6e54ea', fontSize: `clamp(8px, ${Number(overlay.size || 18) / 5.4}px, 24px)` }}>{overlay.text}</div>)}
      </div>}
      {renderError && <div className="preview-error"><FileText size={26} /><span>{renderError}</span></div>}
      {page && <div className="paper-page-tag">PAGE {page.sourcePageIndex != null ? page.sourcePageIndex + 1 : '—'}</div>}
    </div>
    <div className="preview-quick-tools">
      <ActionButton size="sm" icon={Type} onClick={onAddText}>Add text</ActionButton>
      <ActionButton size="sm" icon={LockKeyhole} onClick={onAddBlock}>Cover area</ActionButton>
    </div>
  </div>;
}
