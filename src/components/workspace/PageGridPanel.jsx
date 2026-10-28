import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { GripVertical, ListFilter, Search, X } from 'lucide-react';
import ActionButton from '../common/ActionButton.jsx';
import IconButton from '../common/IconButton.jsx';
import AddPagesCard from './AddPagesCard.jsx';
import PageCard from './PageCard.jsx';
import PageContextMenu from './PageContextMenu.jsx';

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

  // Pointer-driven reorder with a LIVE placeholder.
  //  - The dragged tile stays in the grid as a hollow slot and moves to the slot under the cursor;
  //    the tiles in between glide one slot over (motion layout animation) so the placeholder always
  //    shows exactly where the page will land.
  //  - Hit-testing uses the SLOT rectangles measured once at drag start. The number of grid items never
  //    changes during a drag, so slot positions are stable even while tiles are animating, which means
  //    the cursor target can never feed back on itself (no flicker).
  //  - On release the floating page flies into the placeholder before the move is committed.
  const startPageDrag = useCallback((event, page) => {
    if (search.trim() || event.button !== 0 || dragSessionRef.current) return;
    const startedOnGrip = event.target?.closest?.('.page-drag-grip');
    if (!startedOnGrip && event.target?.closest?.('button, a, input, textarea, select, .page-card-hover-actions')) return;
    const source = event.currentTarget.closest('.page-card');
    const scroller = source?.closest('.page-grid-scroll');
    if (!source || !scroller) return;

    const session = {
      pointerId: event.pointerId, pageId: page.id, source, scroller,
      startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, lastX: event.clientX, lastY: event.clientY,
      offsetX: event.clientX - source.getBoundingClientRect().left, offsetY: event.clientY - source.getBoundingClientRect().top,
      dragging: false, finishing: false, ghost: null, raf: 0, cue: null,
      slots: [], addRect: null, sourceIndex: -1, base: { left: 0, top: 0 },
      onMove: null, onUp: null, onCancel: null, onKeyDown: null,
    };

    const sameCue = (a, b) => a?.id === b?.id && a?.position === b?.position && a?.index === b?.index;
    const updateCue = (next) => {
      if (sameCue(session.cue, next)) return;
      session.cue = next;
      setDropCue(next);
    };
    const toContent = (r, base) => ({ left: r.left - base.left + scroller.scrollLeft, right: r.right - base.left + scroller.scrollLeft, top: r.top - base.top + scroller.scrollTop, bottom: r.bottom - base.top + scroller.scrollTop });
    const measure = () => {
      const base = scroller.getBoundingClientRect();
      session.base = { left: base.left, top: base.top };
      session.slots = [...scroller.querySelectorAll('.page-card[data-page-id]')].map((node) => ({ id: node.dataset.pageId, ...toContent(node.getBoundingClientRect(), base) }));
      session.sourceIndex = session.slots.findIndex((slot) => slot.id === session.pageId);
      const add = scroller.querySelector('.page-add-card');
      session.addRect = add ? toContent(add.getBoundingClientRect(), base) : null;
    };
    // Viewport-space rectangle of a slot right now (accounts for any scrolling since measure()).
    const slotViewportRect = (index) => {
      const slot = session.slots[index];
      if (!slot) return null;
      return { left: slot.left + session.base.left - scroller.scrollLeft, top: slot.top + session.base.top - scroller.scrollTop };
    };
    const createGhost = () => {
      if (session.ghost) return;
      const rect = source.getBoundingClientRect();
      const ghost = source.cloneNode(true);
      ghost.classList.add('page-drag-ghost', 'page-drag-ghost-live');
      ghost.classList.remove('page-dragging', 'page-selected', 'page-active', 'page-landed');
      ghost.removeAttribute('draggable');
      ghost.setAttribute('aria-hidden', 'true');
      ghost.querySelector('.page-drop-label')?.remove();
      Object.assign(ghost.style, {
        width: `${rect.width}px`, height: `${rect.height}px`, left: '0px', top: '0px',
        position: 'fixed', margin: '0', pointerEvents: 'none', zIndex: '2147483000',
        transformOrigin: '50% 12%', transition: 'none', animation: 'none', opacity: '1', translate: 'none', scale: 'none', rotate: 'none',
        willChange: 'transform', contain: 'paint', backfaceVisibility: 'hidden',
      });
      ghost.style.transform = `translate3d(${session.x - session.offsetX}px, ${session.y - session.offsetY}px, 0) rotate(-1deg) scale(1.015)`;
      document.body.appendChild(ghost);
      session.ghost = ghost;
    };
    const resolveCue = (x, y) => {
      const bounds = scroller.getBoundingClientRect();
      if (x < bounds.left - 24 || x > bounds.right + 24 || y < bounds.top - 24 || y > bounds.bottom + 24) return null;
      const cx = x - session.base.left + scroller.scrollLeft;
      const cy = y - session.base.top + scroller.scrollTop;
      const count = session.slots.length;
      const add = session.addRect;
      if (add && cx >= add.left && cx <= add.right && cy >= add.top && cy <= add.bottom) return { id: '__end__', index: count - 1 };
      let best = -1;
      let bestDistance = Infinity;
      session.slots.forEach((slot, index) => {
        const dx = Math.max(slot.left - cx, 0, cx - slot.right);
        const dy = Math.max(slot.top - cy, 0, cy - slot.bottom);
        const distance = dx * dx + dy * dy * 4;
        if (distance < bestDistance) { bestDistance = distance; best = index; }
      });
      return best < 0 ? null : { id: null, index: best };
    };
    const toCue = (hit) => {
      if (!hit || hit.index === session.sourceIndex) return null; // dropping on its own slot changes nothing
      const rest = pagesRef.current.filter((item) => item.id !== session.pageId);
      if (!rest.length) return null;
      const at = Math.max(0, Math.min(hit.index, rest.length));
      const target = at < rest.length ? rest[at] : rest[rest.length - 1];
      return { id: hit.id === '__end__' ? '__end__' : target.id, position: at < rest.length ? 'before' : 'after', index: at, targetId: target.id };
    };
    const renderFrame = () => {
      session.raf = 0;
      if (!session.dragging || session.finishing) return;
      const { x, y, lastX, ghost } = session;
      const dx = x - lastX;
      const angle = Math.max(-4, Math.min(4, dx * 0.075));
      if (ghost) ghost.style.transform = `translate3d(${x - session.offsetX}px, ${y - session.offsetY}px, 0) rotate(${angle}deg) scale(1.02)`;
      session.lastX = x;
      session.lastY = y;
      const bounds = scroller.getBoundingClientRect();
      const edge = 56;
      let step = 0;
      if (y < bounds.top + edge) step = -Math.ceil((bounds.top + edge - y) / 4);
      else if (y > bounds.bottom - edge) step = Math.ceil((y - (bounds.bottom - edge)) / 4);
      if (step) scroller.scrollTop += Math.max(-24, Math.min(24, step));
      updateCue(toCue(resolveCue(x, y)));
      if (step) session.raf = requestAnimationFrame(renderFrame);
    };
    const detach = () => {
      window.removeEventListener('pointermove', session.onMove);
      window.removeEventListener('pointerup', session.onUp);
      window.removeEventListener('pointercancel', session.onCancel);
      window.removeEventListener('keydown', session.onKeyDown);
    };
    const settle = (commitCue) => {
      if (commitCue) {
        if (commitCue.id === '__end__') {
          const lastPage = [...pagesRef.current].reverse().find((item) => item.id !== session.pageId);
          if (lastPage) movePage(session.pageId, lastPage.id, 'after');
        } else if (commitCue.targetId) {
          movePage(session.pageId, commitCue.targetId, commitCue.position || 'before');
        }
      }
      session.ghost?.remove();
      suppressPageClickUntil.current = Date.now() + 350;
      setDraggingPageId(null);
      setDropCue(null);
      if (dragSessionRef.current === session) dragSessionRef.current = null;
    };
    // End of drag: the floating page glides into the placeholder (or back home on cancel) and only
    // then is the move committed, so the tile never appears twice.
    const finish = (commit) => {
      if (session.finishing) return;
      session.finishing = true;
      if (session.raf) cancelAnimationFrame(session.raf);
      session.raf = 0;
      detach();
      if (!session.dragging) { if (dragSessionRef.current === session) dragSessionRef.current = null; return; }
      const cue = commit ? session.cue : null;
      const destIndex = cue ? cue.index : session.sourceIndex;
      const dest = slotViewportRect(Math.max(0, Math.min(destIndex, session.slots.length - 1)));
      const ghost = session.ghost;
      const reduce = document.querySelector('.reduce-motion') || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      if (!ghost || !dest || reduce || !ghost.animate) { settle(cue); return; }
      const from = ghost.style.transform;
      const animation = ghost.animate([
        { transform: from, boxShadow: '0 16px 38px rgb(29 24 70 / .22)' },
        { transform: `translate3d(${dest.left}px, ${dest.top}px, 0) rotate(0deg) scale(1)`, boxShadow: '0 2px 6px rgb(29 24 70 / .08)' },
      ], { duration: 170, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'forwards' });
      animation.onfinish = () => settle(cue);
      animation.oncancel = () => settle(cue);
    };
    session.onMove = (moveEvent) => {
      if (moveEvent.pointerId !== session.pointerId || session.finishing) return;
      session.x = moveEvent.clientX;
      session.y = moveEvent.clientY;
      if (!session.dragging) {
        if (Math.hypot(session.x - session.startX, session.y - session.startY) < 5) return;
        session.dragging = true;
        measure();
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
      session.x = upEvent.clientX;
      session.y = upEvent.clientY;
      if (session.dragging && !session.finishing) {
        // Resolve the final pointer position synchronously so the drop matches where it was released.
        session.cue = toCue(resolveCue(session.x, session.y));
        if (session.ghost) session.ghost.style.transform = `translate3d(${session.x - session.offsetX}px, ${session.y - session.offsetY}px, 0) rotate(0deg) scale(1.02)`;
      }
      finish(true);
    };
    session.onCancel = (cancelEvent) => {
      if (cancelEvent.pointerId !== session.pointerId) return;
      finish(false);
    };
    session.onKeyDown = (keyEvent) => { if (keyEvent.key === 'Escape') finish(false); };
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
  // While dragging, preview the result: the dragged page sits at its prospective slot and the
  // pages in between shift over by one, so the hollow tile IS the landing placeholder.
  let displayPages = filteredPages;
  if (draggingPageId && dropCue && !search.trim()) {
    const dragged = pages.find((item) => item.id === draggingPageId);
    if (dragged) {
      const rest = pages.filter((item) => item.id !== draggingPageId);
      rest.splice(Math.max(0, Math.min(dropCue.index ?? rest.length, rest.length)), 0, dragged);
      displayPages = rest;
    }
  }
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
                    <motion.div layoutScroll className="page-grid-scroll"><div className={`page-grid${draggingPageId ? ' is-reordering' : ''}`}><AnimatePresence initial={false}>{displayPages.map((page, displayIndex) => {
        const pageIndex = pageIndexById.get(page.id) ?? -1;
        return <PageCard key={page.id} page={page} pageIndex={pageIndex} displayIndex={displayIndex} pages={pages} selectedIds={selectedIds} activeId={activeId} search={search} isReordering={!!draggingPageId} isDragging={draggingPageId === page.id} landedId={landedId} onContextMenu={openMenu} suppressPageClickUntil={suppressPageClickUntil} setSelectedIds={setSelectedIds} setActiveId={setActiveId} setModal={setModal} startPageDrag={startPageDrag} selectPage={selectPage} rotateSelected={rotateSelected} movePage={movePage} />;
      })}</AnimatePresence>
    <AddPagesCard pagesRef={pagesRef} draggingPageId={draggingPageId} dropCue={dropCue} setDropCue={setDropCue} chooseFiles={chooseFiles} handleBrowserFiles={handleBrowserFiles} movePage={movePage} />
                    </div>{filteredPages.length === 0 && <div className="no-search-results"><Search size={22}/><strong>No pages match “{search}”</strong><ActionButton size="sm" onClick={() => setSearch('')}>Clear search</ActionButton></div>}</motion.div>
                    <div className="page-grid-bottom"><span><GripVertical size={13} /> {pages.length} pages total</span><span>Shift-click range <b>·</b> Ctrl-click multiple <b>·</b> Drop at + to move to end</span></div>
                    {menu && <PageContextMenu menu={menu} pages={pages} onClose={closeMenu} rotateSelected={rotateSelected} duplicateSelected={duplicateSelected} requestDeleteSelected={requestDeleteSelected} movePage={movePage} moveToEdge={moveToEdge} selectAll={() => setSelectedIds(pagesRef.current.map((p) => p.id))} />}
                  </div>
  );
}
