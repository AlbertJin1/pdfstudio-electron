import { useEffect, useRef, useState } from 'react';
import { FileText, LockKeyhole, Type } from 'lucide-react';
import ActionButton from '../common/ActionButton.jsx';
import { renderPageCanvas } from '../../services/pdf/index.js';

export default function PagePreview({ page, sources, onAddText, onAddBlock, zoom = 1, showQuickTools = true, fitToStage = false }) {
  const holderRef = useRef(null);
  const [renderError, setRenderError] = useState('');
  const zoomRef = useRef(zoom);
  const fitLayoutRef = useRef(null);
  zoomRef.current = zoom;
  const renderZoomKey = fitToStage ? 1 : zoom;

  useEffect(() => {
    fitLayoutRef.current?.();
  }, [zoom, fitToStage]);
  useEffect(() => {
    let alive = true;
    let renderedCanvas = null;
    const holder = holderRef.current;
    const paperWrap = holder?.parentElement;
    const fitStage = fitToStage ? holder?.closest('.page-preview-canvas-stage') : null;
    if (!holder || !page) return undefined;
    holder.innerHTML = '';
    setRenderError('');

    // The expanded preview uses a canvas-sized paper wrapper. This keeps overlay
    // coordinates anchored to the actual page instead of the full modal viewport.
    const fitRenderedPage = () => {
      if (!alive || !fitToStage || !fitStage || !renderedCanvas || !paperWrap) return;
      const stageRect = fitStage.getBoundingClientRect();
      const maxWidth = Math.max(1, stageRect.width - 34);
      const maxHeight = Math.max(1, stageRect.height - 34);
      const fitScale = Math.min(maxWidth / renderedCanvas.width, maxHeight / renderedCanvas.height, 1);
      const scale = fitScale * Math.max(0.1, zoomRef.current || 1);
      const displayWidth = Math.max(1, Math.floor(renderedCanvas.width * scale));
      const displayHeight = Math.max(1, Math.floor(renderedCanvas.height * scale));
      renderedCanvas.style.width = `${displayWidth}px`;
      renderedCanvas.style.height = `${displayHeight}px`;
      holder.style.width = `${displayWidth}px`;
      holder.style.height = `${displayHeight}px`;
      paperWrap.style.width = `${displayWidth}px`;
      paperWrap.style.height = `${displayHeight}px`;
    };

    fitLayoutRef.current = fitRenderedPage;
    const resizeObserver = fitToStage && fitStage && typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => fitRenderedPage())
      : null;
    if (resizeObserver) resizeObserver.observe(fitStage);

    renderPageCanvas(page, sources, fitToStage ? 2400 : Math.round(900 * zoom), true).then((canvas) => {
      if (!alive || !holderRef.current) return;
      renderedCanvas = canvas;
      canvas.className = 'preview-rendered-canvas';
      canvas.style.display = 'block';
      if (fitToStage) {
        canvas.style.width = `${canvas.width}px`;
        canvas.style.height = `${canvas.height}px`;
      } else {
        canvas.style.width = '100%';
        canvas.style.height = 'auto';
      }
      holderRef.current.innerHTML = '';
      holderRef.current.appendChild(canvas);
      if (fitToStage) fitRenderedPage();
    }).catch((error) => { if (alive) setRenderError(error?.message || 'Preview unavailable'); });
    return () => {
      alive = false;
      resizeObserver?.disconnect();
    };
  }, [page?.id, page?.rotation, page?.kind, page?.sourcePageIndex, sources, renderZoomKey, fitToStage]);

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
    {showQuickTools && <div className="preview-quick-tools">
      <ActionButton size="sm" icon={Type} onClick={onAddText}>Add text</ActionButton>
      <ActionButton size="sm" icon={LockKeyhole} onClick={onAddBlock}>Cover area</ActionButton>
    </div>}
  </div>;
}
