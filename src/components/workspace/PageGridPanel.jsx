import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import { GripVertical, ListFilter, Search, X } from 'lucide-react';
import ActionButton from '../common/ActionButton.jsx';
import IconButton from '../common/IconButton.jsx';
import AddPagesCard from './AddPagesCard.jsx';
import PageCard from './PageCard.jsx';
import PageContextMenu from './PageContextMenu.jsx';

function DropPagePlaceholder({ page, position }) {
  // Keep the placeholder intentionally static during a drag; spring/layout animations
  // here force expensive grid measurements for every insertion change.
  return (
    <div className="page-drop-placeholder" aria-label={`Drop dragged page at position ${position}`}>
      <div className="page-drop-placeholder-top"><span>MOVE HERE</span><strong>{String(position).padStart(2, '0')}</strong></div>
      <div className="page-drop-placeholder-thumb">{page?.thumbnail ? <img src={page.thumbnail} alt="Dragged page preview" draggable="false" /> : <span>PDF</span>}</div>
      <div className="page-drop-placeholder-footer"><strong>Release to place</strong><small>Page position {position}</small></div>
    </div>
  );
}

export default function PageGridPanel({ landedId, duplicateSelected, requestDeleteSelected, pages, pagesRef, selectedIds, activeId, search, draggingPageId, dropCue, suppressPageClickUntil, filteredPages, setSelectedIds, setActiveId, setSearch, setModal, setDraggingPageId, setDropCue, commitPages, chooseFiles, handleBrowserFiles, selectPage, rotateSelected, movePage }) {
  const [menu, setMenu] = useState(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const dragSessionRef = useRef(null);

  useEffect(() => () => {
    const session = dragSessionRef.current;
    if (!session) return;
    if (session.raf) cancelAnimationFrame(session.raf);
    session.ghost?.remove();
    window.removeEventListener('pointermove', session.onMove);
    window.removeEventListener('pointerup', session.onUp);
    window.removeEventListener('pointercancel', session.onCancel);
    window.removeEventListener('keydown', session.onKeyDown);
    dragSessionRef.current = null;
  }, []);

  // Pointer-driven reorder avoids the browser's throttled HTML5 dragover loop. The
  // cursor-following page is moved on requestAnimationFrame, while React only updates
  // when the insertion target actually changes.
  const startPageDrag = useCallback((event, page) => {
    if (search.trim() || event.button !== 0 || dragSessionRef.current) return;
    const startedOnGrip = event.target?.closest?.('.page-drag-grip');
    if (!startedOnGrip && event.target?.closest?.('button, a, input, textarea, select, .page-card-hover-actions')) return;
    const source = event.currentTarget.closest('.page-card');
    if (!source) return;

    const session = {
      pointerId: event.pointerId,
      pageId: page.id,
      source,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      offsetX: event.clientX - source.getBoundingClientRect().left,
      offsetY: event.clientY - source.getBoundingClientRect().top,
      dragging: false,
      ghost: null,
      raf: 0,
      cue: null,
      onMove: null,
      onUp: null,
      onCancel: null,
      onKeyDown: null,
    };

    const sameCue = (a, b) => a?.id === b?.id && a?.position === b?.position && a?.edge === b?.edge;
    const updateCue = (next) => {
      if (sameCue(session.cue, next)) return;
      session.cue = next;
      setDropCue(next);
    };
    const createGhost = () => {
      if (session.ghost) return;
      const rect = source.getBoundingClientRect();
      const ghost = source.cloneNode(true);
      ghost.classList.add('page-drag-ghost', 'page-drag-ghost-live');
      ghost.classList.remove('page-dragging', 'page-selected', 'page-active', 'drop-before', 'drop-after', 'drop-edge-left', 'drop-edge-right', 'drop-edge-top', 'drop-edge-bottom', 'page-landed');
      ghost.removeAttribute('draggable');
      ghost.setAttribute('aria-hidden', 'true');
      Object.assign(ghost.style, {
        width: `${rect.width}px`, height: `${rect.height}px`, left: '0px', top: '0px',
        position: 'fixed', margin: '0', pointerEvents: 'none', zIndex: '2147483000',
        transformOrigin: '50% 12%', transition: 'none', animation: 'none',
        willChange: 'transform', contain: 'paint', backfaceVisibility: 'hidden',
      });
      ghost.style.transform = `translate3d(${session.x - session.offsetX}px, ${session.y - session.offsetY}px, 0) rotate(-1deg) scale(1.015)`;
      document.body.appendChild(ghost);
      session.ghost = ghost;
    };
    const renderFrame = () => {
      session.raf = 0;
      if (!session.dragging) return;
      const { x, y, lastX, lastY, ghost } = session;
      const dx = x - lastX;
      const dy = y - lastY;
      // A restrained tilt keeps the entire page readable while the compositor handles motion.
      const angle = Math.max(-4, Math.min(4, dx * 0.075 - dy * 0.025));
      if (ghost) ghost.style.transform = `translate3d(${x - session.offsetX}px, ${y - session.offsetY}px, 0) rotate(${angle}deg) scale(1.02)`;
      session.lastX = x;
      session.lastY = y;

      const hit = document.elementFromPoint(x, y);
      const target = hit?.closest?.('.page-card[data-page-id]');
      if (target && target.dataset.pageId !== session.pageId) {
        const rect = target.getBoundingClientRect();
        // Compare normalized distances: document cards are tall, so raw pixels made
        // vertical edges win too often and caused surprising insert positions.
        const normalizedX = (x - (rect.left + rect.width / 2)) / Math.max(1, rect.width);
        const normalizedY = (y - (rect.top + rect.height / 2)) / Math.max(1, rect.height);
        const horizontal = Math.abs(normalizedX) >= Math.abs(normalizedY);
        const position = horizontal ? (normalizedX < 0 ? 'before' : 'after') : (normalizedY < 0 ? 'before' : 'after');
        const edge = horizontal ? (normalizedX < 0 ? 'left' : 'right') : (normalizedY < 0 ? 'top' : 'bottom');
        updateCue({ id: target.dataset.pageId, position, edge });
      } else if (target && target.dataset.pageId === session.pageId) {
        updateCue(null);
      } else if (hit?.closest?.('.page-add-card')) {
        updateCue({ id: '__end__', position: 'after' });
      } else if (hit?.closest?.('.page-drop-placeholder')) {
        // The insertion placeholder is visual only; retain the current destination.
      } else {
        // Clear stale targets so releasing over blank space never moves a page unexpectedly.
        updateCue(null);
      }
    };
    const cleanup = (commit, cancelled = false) => {
      if (session.raf) cancelAnimationFrame(session.raf);
      session.ghost?.remove();
      window.removeEventListener('pointermove', session.onMove);
      window.removeEventListener('pointerup', session.onUp);
      window.removeEventListener('pointercancel', session.onCancel);
      window.removeEventListener('keydown', session.onKeyDown);
      if (session.dragging && commit && !cancelled) {
        const cue = session.cue;
        if (cue?.id === '__end__') {
          const lastPage = [...pagesRef.current].reverse().find((item) => item.id !== session.pageId);
          if (lastPage) movePage(session.pageId, lastPage.id, 'after');
        } else if (cue?.id && cue.id !== session.pageId) {
          movePage(session.pageId, cue.id, cue.position || 'before');
        }
      }
      if (session.dragging) {
        suppressPageClickUntil.current = Date.now() + 350;
        setDraggingPageId(null);
        setDropCue(null);
      }
      if (dragSessionRef.current === session) dragSessionRef.current = null;
    };
    session.onMove = (moveEvent) => {
      if (moveEvent.pointerId !== session.pointerId) return;
      session.x = moveEvent.clientX;
      session.y = moveEvent.clientY;
      if (!session.dragging) {
        if (Math.hypot(session.x - session.startX, session.y - session.startY) < 5) return;
        session.dragging = true;
        createGhost();
        suppressPageClickUntil.current = Date.now() + 1000;
        updateCue(null);
        setDraggingPageId(session.pageId);
      }
      moveEvent.preventDefault();
      if (!session.raf) session.raf = requestAnimationFrame(renderFrame);
    };
    session.onUp = (upEvent) => {
      if (upEvent.pointerId !== session.pointerId) return;
      // Flush the last pointer location before committing, rather than dropping one
      // frame behind when pointerup arrives just before the scheduled animation frame.
      session.x = upEvent.clientX;
      session.y = upEvent.clientY;
      if (session.dragging) {
        if (session.raf) cancelAnimationFrame(session.raf);
        session.raf = 0;
        renderFrame();
      }
      cleanup(true);
    };
    session.onCancel = (cancelEvent) => {
      if (cancelEvent.pointerId !== session.pointerId) return;
      cleanup(false, true);
    };
    session.onKeyDown = (keyEvent) => { if (keyEvent.key === 'Escape') cleanup(false, true); };
    dragSessionRef.current = session;
    window.addEventListener('pointermove', session.onMove, { passive: false });
    window.addEventListener('pointerup', session.onUp);
    window.addEventListener('pointercancel', session.onCancel);
    window.addEventListener('keydown', session.onKeyDown);
  }, [search, pagesRef, movePage, setDraggingPageId, setDropCue, suppressPageClickUntil]);
  const openMenu = useCallback((event, page) => {
    event.preventDefault();
    event.stopPropagation();
    const ids = selectedIds.includes(page.id) ? selectedIds : [page.id];
    if (!selectedIds.includes(page.id)) setSelectedIds([page.id]);
    setActiveId(page.id);
    setMenu({ x: event.clientX, y: event.clientY, pageId: page.id, ids });
  }, [selectedIds, setActiveId, setSelectedIds]);
  const pageIndexById = new Map(pages.map((item, index) => [item.id, index]));
  const pageById = new Map(pages.map((item) => [item.id, item]));
  const moveToEdge = useCallback((ids, edge) => {
    const set = new Set(ids);
    const current = pagesRef.current;
    const picked = current.filter((p) => set.has(p.id));
    const rest = current.filter((p) => !set.has(p.id));
    commitPages(edge === 'start' ? [...picked, ...rest] : [...rest, ...picked]);
    setSelectedIds(picked.map((p) => p.id));
  }, [commitPages, pagesRef, setSelectedIds]);
  return (
                  <div className="page-grid-panel"><div className="page-grid-toolbar"><div className="page-grid-title"><strong>Pages <span>{pages.length}</span></strong><small>{search.trim() ? 'Clear search to reorder pages' : 'Drag tiles to reorder · use arrows for precise moves'}</small></div><div className="page-grid-options"><div className="search-field"><Search size={14} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a page..." aria-label="Find a page" />{search && <button onClick={() => setSearch('')}><X size={12}/></button>}</div><IconButton icon={ListFilter} label="Reverse page order" onClick={() => commitPages([...pagesRef.current].reverse())} /></div></div>
                    <div className="page-grid-scroll"><div className={`page-grid${draggingPageId ? ' is-reordering' : ''}`}><AnimatePresence initial={false}>{(() => {
      const draggedPage = draggingPageId ? pageById.get(draggingPageId) : null;
      const sourceIndex = draggingPageId ? (pageIndexById.get(draggingPageId) ?? -1) : -1;
      return filteredPages.map((page) => {
        const pageIndex = pageIndexById.get(page.id) ?? -1;
        const cuePosition = dropCue?.id === page.id ? dropCue.position : null;
        const cueEdge = dropCue?.id === page.id ? dropCue.edge : null;
        const targetIndex = pageIndex;
        const insertionIndex = targetIndex - (sourceIndex >= 0 && sourceIndex < targetIndex ? 1 : 0) + (cuePosition === 'after' ? 1 : 0);
        const destinationPosition = Math.max(1, insertionIndex + 1);
        return <Fragment key={page.id}>
          {cuePosition === 'before' && draggingPageId && <DropPagePlaceholder page={draggedPage} position={destinationPosition} />}
          <PageCard key={page.id} page={page} pageIndex={pageIndex} pages={pages} selectedIds={selectedIds} activeId={activeId} search={search} isReordering={!!draggingPageId} isDragging={draggingPageId === page.id} cuePosition={cuePosition} cueEdge={cueEdge} landedId={landedId} onContextMenu={openMenu} suppressPageClickUntil={suppressPageClickUntil} setSelectedIds={setSelectedIds} setActiveId={setActiveId} setModal={setModal} startPageDrag={startPageDrag} selectPage={selectPage} rotateSelected={rotateSelected} movePage={movePage} />
          {cuePosition === 'after' && draggingPageId && <DropPagePlaceholder page={draggedPage} position={destinationPosition} />}
        </Fragment>;
      });
    })()}</AnimatePresence>
    {draggingPageId && dropCue?.id === '__end__' && <DropPagePlaceholder page={pageById.get(draggingPageId)} position={pages.length} />}
    <AddPagesCard pagesRef={pagesRef} draggingPageId={draggingPageId} dropCue={dropCue} setDropCue={setDropCue} chooseFiles={chooseFiles} handleBrowserFiles={handleBrowserFiles} movePage={movePage} />
                    </div>{filteredPages.length === 0 && <div className="no-search-results"><Search size={22}/><strong>No pages match “{search}”</strong><ActionButton size="sm" onClick={() => setSearch('')}>Clear search</ActionButton></div>}</div>
                    <div className="page-grid-bottom"><span><GripVertical size={13} /> {pages.length} pages total</span><span>Shift-click range <b>·</b> Ctrl-click multiple <b>·</b> Drop at + to move to end</span></div>
                    {menu && <PageContextMenu menu={menu} pages={pages} onClose={closeMenu} rotateSelected={rotateSelected} duplicateSelected={duplicateSelected} requestDeleteSelected={requestDeleteSelected} movePage={movePage} moveToEdge={moveToEdge} selectAll={() => setSelectedIds(pagesRef.current.map((p) => p.id))} />}
                  </div>
  );
}
