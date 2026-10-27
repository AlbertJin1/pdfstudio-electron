import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Expand, ZoomIn, ZoomOut } from 'lucide-react';
import ActionButton from '../components/common/ActionButton.jsx';
import Modal from '../components/common/Modal.jsx';
import PagePreview from '../components/workspace/PagePreview.jsx';

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.25;
const clampZoom = (value) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(value * 100) / 100));

export default function PagePreviewModal({ pages, sources, modal, setModal, setActiveId, setSelectedIds }) {
  const [zoom, setZoom] = useState(1);
  const pageIndex = Math.max(0, pages.findIndex((page) => page.id === modal.pageId));
  const page = pages[pageIndex] || pages[0];

  const goToPage = useCallback((nextIndex) => {
    const nextPage = pages[nextIndex];
    if (!nextPage) return;
    setActiveId(nextPage.id);
    setSelectedIds([nextPage.id]);
    setZoom(1);
    setModal({ type: 'page-preview', pageId: nextPage.id });
  }, [pages, setActiveId, setSelectedIds, setModal]);
  const zoomIn = useCallback(() => setZoom((value) => clampZoom(value + ZOOM_STEP)), []);
  const zoomOut = useCallback(() => setZoom((value) => clampZoom(value - ZOOM_STEP)), []);
  const fitPage = useCallback(() => setZoom(1), []);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') return; // Modal owns Escape and restores focus to the thumbnail.
      const key = event.key;
      const lower = key.toLowerCase();
      let handled = true;
      if (key === 'ArrowLeft') goToPage(pageIndex - 1);
      else if (key === 'ArrowRight') goToPage(pageIndex + 1);
      else if (key === 'Home') goToPage(0);
      else if (key === 'End') goToPage(pages.length - 1);
      else if (key === '+' || key === '=' || key === 'Add' || ((event.ctrlKey || event.metaKey) && key === 'ArrowUp')) zoomIn();
      else if (key === '-' || key === '_' || key === 'Subtract' || ((event.ctrlKey || event.metaKey) && key === 'ArrowDown')) zoomOut();
      else if (key === '0' || lower === 'f') fitPage();
      else handled = false;
      if (handled) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [goToPage, pageIndex, pages.length, zoomIn, zoomOut, fitPage]);

  if (!pages.length || !page) return null;

  const handleWheel = (event) => {
    if (!(event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    if (event.deltaY < 0) zoomIn();
    else if (event.deltaY > 0) zoomOut();
  };

  return (
    <Modal
      title={`Page ${pageIndex + 1} · Full-page viewer`}
      eyebrow="Fullscreen page view"
      wide
      onClose={() => setModal(null)}
      footer={<>
        <ActionButton icon={ChevronLeft} disabled={pageIndex <= 0} onClick={() => goToPage(pageIndex - 1)}>Previous page</ActionButton>
        <ActionButton icon={ChevronRight} disabled={pageIndex >= pages.length - 1} onClick={() => goToPage(pageIndex + 1)}>Next page</ActionButton>
        <span className="page-preview-shortcut-help">← / → pages · + / − zoom · 0 or F fit · Esc close</span>
        <ActionButton variant="primary" onClick={() => setModal(null)}>Close viewer</ActionButton>
      </>}
    >
      <div className="page-preview-modal">
        <div className="page-preview-toolbar">
          <div className="page-preview-meta">
            <div><strong>{page.sourceName || 'Untitled page'}</strong><span>Use the controls or keyboard shortcuts to inspect the entire page</span></div>
            <span className="page-preview-counter">{pageIndex + 1} / {pages.length}</span>
          </div>
          <div className="page-preview-zoom-controls" aria-label="Page zoom controls">
            <button type="button" className="page-preview-zoom-button" title="Zoom out (−)" aria-label="Zoom out" disabled={zoom <= MIN_ZOOM} onClick={zoomOut}><ZoomOut size={16} /></button>
            <output className="page-preview-zoom-level" aria-live="polite">{Math.round(zoom * 100)}%</output>
            <button type="button" className="page-preview-zoom-button" title="Zoom in (+)" aria-label="Zoom in" disabled={zoom >= MAX_ZOOM} onClick={zoomIn}><ZoomIn size={16} /></button>
            <button type="button" className="page-preview-fit-button" title="Fit entire page (0 or F)" onClick={fitPage}><Expand size={14} /> Fit page</button>
          </div>
        </div>
        <div className={`page-preview-canvas-stage${zoom > 1 ? ' is-zoomed' : ''}`} onWheel={handleWheel}>
          <PagePreview page={page} sources={sources} zoom={zoom} showQuickTools={false} fitToStage />
        </div>
      </div>
    </Modal>
  );
}
