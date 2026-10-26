import { motion } from 'motion/react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  FileText,
  GripVertical,
  MoreHorizontal,
  RotateCw,
  Type,
} from 'lucide-react';
import IconButton from '../common/IconButton.jsx';
import { interactiveSpring } from '../../constants/motion.js';
import { cx } from '../../utils/cx.js';
import { extName } from '../../utils/format.js';

export default function PageCard({ landedId, onContextMenu, page, pageIndex, pages, selectedIds, activeId, search, draggingPageId, dropCue, suppressPageClickUntil, setSelectedIds, setActiveId, setModal, setDraggingPageId, setDropCue, selectPage, rotateSelected, movePage }) {
  const selected = selectedIds.includes(page.id);
  const cuePosition = dropCue?.id === page.id ? dropCue.position : null;
  const pageNumber = String(pageIndex + 1).padStart(2, '0');
  return (
    <motion.div layout="position" initial={{ opacity: 0, y: 8, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }} whileHover={{ y: -2 }} transition={interactiveSpring}
      className={cx('page-card', selected && 'page-selected', activeId === page.id && 'page-active', draggingPageId === page.id && 'page-dragging', cuePosition === 'before' && 'drop-before', cuePosition === 'after' && 'drop-after', landedId === page.id && 'page-landed')}
      data-page-id={page.id}
      draggable={!search.trim()}
      aria-label={`Page ${pageIndex + 1}. Drag to reorder. Click to select.`}
      title={search.trim() ? 'Clear the page search to reorder pages' : 'Drag this page to reorder it'}
      onContextMenu={(event) => onContextMenu?.(event, page)}
      onDragStart={(event) => {
        if (search.trim()) { event.preventDefault(); return; }
        setDraggingPageId(page.id);
        suppressPageClickUntil.current = Date.now() + 350;
        setDropCue(null);
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('application/x-pdfstudio-page', page.id);
        event.dataTransfer.setData('text/plain', page.id);
        try {
          // Custom drag image: a tilted, lifted copy of the tile that follows the cursor.
          const source = event.currentTarget;
          const box = source.getBoundingClientRect();
          const ghost = source.cloneNode(true);
          ghost.classList.add('page-drag-ghost');
          ghost.classList.remove('page-dragging', 'page-selected', 'page-active');
          ghost.style.width = `${box.width}px`;
          ghost.style.height = `${box.height}px`;
          document.body.appendChild(ghost);
          event.dataTransfer.setDragImage(ghost, event.clientX - box.left, event.clientY - box.top);
          setTimeout(() => ghost.remove(), 0);
        } catch { /* Drag-image support varies by platform. */ }
      }}
      onDragOver={(event) => {
        const draggedId = event.dataTransfer?.getData('application/x-pdfstudio-page') || draggingPageId;
        if (!draggedId || draggedId === page.id || search.trim()) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        const rect = event.currentTarget.getBoundingClientRect();
        const position = event.clientX < rect.left + rect.width / 2 ? 'before' : 'after';
        setDropCue((currentCue) => currentCue?.id === page.id && currentCue?.position === position ? currentCue : { id: page.id, position });
      }}
      onDrop={(event) => {
        const draggedId = event.dataTransfer?.getData('application/x-pdfstudio-page') || draggingPageId;
        if (!draggedId || draggedId === page.id) return;
        event.preventDefault();
        event.stopPropagation();
        const rect = event.currentTarget.getBoundingClientRect();
        const position = dropCue?.id === page.id ? dropCue.position : (event.clientX < rect.left + rect.width / 2 ? 'before' : 'after');
        movePage(draggedId, page.id, position);
      }}
      onDragEnd={() => { suppressPageClickUntil.current = Date.now() + 350; setDraggingPageId(null); setDropCue(null); }}
      onClick={(event) => { if (Date.now() < suppressPageClickUntil.current) { event.preventDefault(); return; } selectPage(page, event); }}>
      <div className="page-card-top"><span className={cx('page-number-badge', selected && 'badge-selected')}>{pageNumber}</span><span className="page-drag-grip" aria-hidden="true"><GripVertical size={14} /></span><div className="page-card-hover-actions"><IconButton icon={ArrowLeft} label={`Move page ${pageIndex + 1} earlier`} size={12} disabled={pageIndex === 0 || !!search.trim()} onClick={(event) => { event.stopPropagation(); movePage(page.id, pages[pageIndex - 1]?.id, 'before'); }} /><IconButton icon={ArrowRight} label={`Move page ${pageIndex + 1} later`} size={12} disabled={pageIndex === pages.length - 1 || !!search.trim()} onClick={(event) => { event.stopPropagation(); movePage(page.id, pages[pageIndex + 1]?.id, 'after'); }} /><IconButton icon={RotateCw} label={`Rotate page ${pageIndex + 1}`} size={12} onClick={(event) => { event.stopPropagation(); rotateSelected(90, [page.id]); }} /><IconButton icon={MoreHorizontal} label={`More actions for page ${pageIndex + 1}`} size={12} onClick={(event) => { event.stopPropagation(); setActiveId(page.id); setSelectedIds([page.id]); setModal({ type: 'page-menu', pageId: page.id }); }} /></div></div>
      <div className="page-thumb-zone">{page.thumbnail ? <img src={page.thumbnail} alt={`Page ${pageIndex + 1}`} draggable="false" /> : <div className="page-thumb-placeholder"><FileText size={27} /><span>Rendering…</span></div>}{!!page.overlays?.length && <span className="page-overlay-badge"><Type size={11} /> {page.overlays.length}</span>}</div>
      <div className="page-card-footer"><div><strong>Page {pageNumber}</strong><small>{page.kind === 'image' ? extName(page.sourceName) + ' image' : page.kind === 'blank' ? 'Blank page' : `PDF page ${page.sourcePageIndex + 1}`}</small></div><span className={cx('page-check', selected && 'page-check-on')}>{selected && <Check size={12} />}</span></div>
    </motion.div>
  );
}
