import { useCallback, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import { GripVertical, ListFilter, Search, X } from 'lucide-react';
import ActionButton from '../common/ActionButton.jsx';
import IconButton from '../common/IconButton.jsx';
import AddPagesCard from './AddPagesCard.jsx';
import PageCard from './PageCard.jsx';
import PageContextMenu from './PageContextMenu.jsx';

export default function PageGridPanel({ landedId, duplicateSelected, requestDeleteSelected, pages, pagesRef, selectedIds, activeId, search, draggingPageId, dropCue, suppressPageClickUntil, filteredPages, setSelectedIds, setActiveId, setSearch, setModal, setDraggingPageId, setDropCue, commitPages, chooseFiles, handleBrowserFiles, selectPage, rotateSelected, movePage }) {
  const [menu, setMenu] = useState(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const openMenu = useCallback((event, page) => {
    event.preventDefault();
    event.stopPropagation();
    const ids = selectedIds.includes(page.id) ? selectedIds : [page.id];
    if (!selectedIds.includes(page.id)) setSelectedIds([page.id]);
    setActiveId(page.id);
    setMenu({ x: event.clientX, y: event.clientY, pageId: page.id, ids });
  }, [selectedIds, setActiveId, setSelectedIds]);
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
                    <div className="page-grid-scroll"><div className="page-grid"><AnimatePresence initial={false}>{filteredPages.map((page) => {
      const pageIndex = pages.findIndex((item) => item.id === page.id);
      return <PageCard key={page.id} page={page} pageIndex={pageIndex} pages={pages} selectedIds={selectedIds} activeId={activeId} search={search} draggingPageId={draggingPageId} dropCue={dropCue} landedId={landedId} onContextMenu={openMenu} suppressPageClickUntil={suppressPageClickUntil} setSelectedIds={setSelectedIds} setActiveId={setActiveId} setModal={setModal} setDraggingPageId={setDraggingPageId} setDropCue={setDropCue} selectPage={selectPage} rotateSelected={rotateSelected} movePage={movePage} />;
                    })}</AnimatePresence>
    <AddPagesCard pagesRef={pagesRef} draggingPageId={draggingPageId} dropCue={dropCue} setDropCue={setDropCue} chooseFiles={chooseFiles} handleBrowserFiles={handleBrowserFiles} movePage={movePage} />
                    </div>{filteredPages.length === 0 && <div className="no-search-results"><Search size={22}/><strong>No pages match “{search}”</strong><ActionButton size="sm" onClick={() => setSearch('')}>Clear search</ActionButton></div>}</div>
                    <div className="page-grid-bottom"><span><GripVertical size={13} /> {pages.length} pages total</span><span>Shift-click range <b>·</b> Ctrl-click multiple <b>·</b> Drop at + to move to end</span></div>
                    {menu && <PageContextMenu menu={menu} pages={pages} onClose={closeMenu} rotateSelected={rotateSelected} duplicateSelected={duplicateSelected} requestDeleteSelected={requestDeleteSelected} movePage={movePage} moveToEdge={moveToEdge} selectAll={() => setSelectedIds(pagesRef.current.map((p) => p.id))} />}
                  </div>
  );
}
