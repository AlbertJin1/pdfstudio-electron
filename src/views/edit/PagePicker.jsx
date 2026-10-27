import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { cx } from '../../utils/cx.js';
import PageThumb from './PageThumb.jsx';

/**
 * Page navigation: previous / next plus a dropdown that shows every page as a thumbnail.
 * The thumbnail grid only mounts while open, so a long document costs nothing until it is needed.
 * `changes` maps a 1-based page number to the count of edits on that page.
 */
export default function PagePicker({ pdfDoc, pageNumber, pageCount, onPage, changes }) {
  const [open, setOpen] = useState(false);
  const [focusPage, setFocusPage] = useState(pageNumber);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const gridRef = useRef(null);
  const listId = useId();

  const close = useCallback((restoreFocus = true) => { setOpen(false); if (restoreFocus) triggerRef.current?.focus({ preventScroll: true }); }, []);
  const toggle = () => { if (!open) setFocusPage(pageNumber); setOpen((value) => !value); };
  const choose = useCallback((n) => { onPage(n); close(); }, [close, onPage]);

  // Close on outside press; focus + reveal the current page when opening.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event) => { if (!rootRef.current?.contains(event.target)) setOpen(false); };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const node = gridRef.current?.querySelector(`[data-page="${focusPage}"]`);
    if (node) { node.focus({ preventScroll: true }); node.scrollIntoView({ block: 'nearest' }); }
  }, [open, focusPage]);

  const columns = () => {
    const grid = gridRef.current; if (!grid) return 1;
    return Math.max(1, getComputedStyle(grid).gridTemplateColumns.split(' ').length);
  };
  const onGridKey = (event) => {
    event.stopPropagation(); // keep the editor's global shortcuts (arrows, space, letters) out of the picker
    const key = event.key; let next = focusPage;
    if (key === 'Escape') { event.preventDefault(); close(); return; }
    if (key === 'Enter' || key === ' ') { event.preventDefault(); choose(focusPage); return; }
    if (key === 'ArrowRight') next += 1; else if (key === 'ArrowLeft') next -= 1;
    else if (key === 'ArrowDown') next += columns(); else if (key === 'ArrowUp') next -= columns();
    else if (key === 'Home') next = 1; else if (key === 'End') next = pageCount;
    else if (key === 'PageDown') next += columns() * 2; else if (key === 'PageUp') next -= columns() * 2;
    else return;
    event.preventDefault();
    setFocusPage(Math.min(pageCount, Math.max(1, next)));
  };

  return (
    <div className="ep-pager" ref={rootRef}>
      <button type="button" className="ep-icon-btn" title="Previous page (PgUp at top of page)" aria-label="Previous page" onClick={() => onPage(pageNumber - 1)} disabled={pageNumber <= 1}><ChevronLeft size={16} /></button>
      <button type="button" ref={triggerRef} className={cx('ep-pagepick', open && 'is-open')} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined} title="Choose a page" onClick={toggle}
        onKeyDown={(event) => { if (event.key === 'ArrowDown' && !open) { event.preventDefault(); event.stopPropagation(); toggle(); } }}>
        <PageThumb pdfDoc={pdfDoc} pageNumber={pageNumber} eager />
        <span className="ep-pagepick-label"><b>Page {pageNumber}</b><small>of {pageCount}</small></span>
        <ChevronDown size={14} className="ep-pagepick-caret" />
      </button>
      <button type="button" className="ep-icon-btn" title="Next page (PgDn at bottom of page)" aria-label="Next page" onClick={() => onPage(pageNumber + 1)} disabled={pageNumber >= pageCount}><ChevronRight size={16} /></button>
      {open && (
        <div className="ep-pagemenu" role="dialog" aria-label="Pages">
          <div className="ep-pagemenu-head"><span>Pages</span><small>{pageCount} total · arrow keys to move, Enter to open</small></div>
          <div className="ep-pagegrid" id={listId} ref={gridRef} role="listbox" aria-label="Pages" onKeyDown={onGridKey}>
            {Array.from({ length: pageCount }, (_, i) => i + 1).map((n) => {
              const edits = changes?.(n) || 0;
              return (
                <button type="button" role="option" key={n} data-page={n} aria-selected={n === pageNumber} tabIndex={n === focusPage ? 0 : -1} className={cx('ep-pageopt', n === pageNumber && 'is-active')} onClick={() => choose(n)} title={edits ? `Page ${n} · ${edits} edit${edits === 1 ? '' : 's'}` : `Page ${n}`}>
                  <PageThumb pdfDoc={pdfDoc} pageNumber={n} />
                  <span>{n}</span>
                  {edits > 0 && <small aria-label={`${edits} edits`}>{edits}</small>}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
