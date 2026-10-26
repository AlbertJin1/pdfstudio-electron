import { memo } from 'react';
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

function PageCard({ landedId, onContextMenu, page, pageIndex, pages, selectedIds, activeId, search, isReordering, isDragging, cuePosition, suppressPageClickUntil, setSelectedIds, setActiveId, setModal, startPageDrag, selectPage, rotateSelected, movePage }) {
  const selected = selectedIds.includes(page.id);
  const pageNumber = String(pageIndex + 1).padStart(2, '0');
  return (
    <motion.div
      layout={isReordering ? false : 'position'}
      initial={{ opacity: 0, y: 8, scale: 0.985 }}
      animate={isDragging ? { opacity: 0, y: 0, scale: 0.98 } : { opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      whileHover={isReordering ? undefined : { y: -2 }}
      transition={isReordering ? { duration: 0 } : interactiveSpring}
      className={cx('page-card', selected && 'page-selected', activeId === page.id && 'page-active', isDragging && 'page-dragging', cuePosition === 'before' && 'drop-before', cuePosition === 'after' && 'drop-after', landedId === page.id && 'page-landed')}
      data-page-id={page.id}
      draggable={false}
      aria-label={`Page ${pageIndex + 1}. Drag the grip to reorder. Click to select.`}
      title={search.trim() ? 'Clear the page search to reorder pages' : 'Drag this page to reorder it'}
      onContextMenu={(event) => onContextMenu?.(event, page)}
      onPointerDown={(event) => startPageDrag(event, page)}
      onClick={(event) => { if (Date.now() < suppressPageClickUntil.current) { event.preventDefault(); return; } selectPage(page, event); }}
    >
      <div className="page-card-top">
        <span className={cx('page-number-badge', selected && 'badge-selected')}>{pageNumber}</span>
        <button
          type="button"
          className="page-drag-grip"
          aria-label={`Drag page ${pageIndex + 1} to reorder`}
          title="Drag to reorder"
          disabled={!!search.trim()}
          onClick={(event) => event.stopPropagation()}
        ><GripVertical size={14} /></button>
        <div className="page-card-hover-actions">
          <IconButton icon={ArrowLeft} label={`Move page ${pageIndex + 1} earlier`} size={12} disabled={pageIndex === 0 || !!search.trim()} onClick={(event) => { event.stopPropagation(); movePage(page.id, pages[pageIndex - 1]?.id, 'before'); }} />
          <IconButton icon={ArrowRight} label={`Move page ${pageIndex + 1} later`} size={12} disabled={pageIndex === pages.length - 1 || !!search.trim()} onClick={(event) => { event.stopPropagation(); movePage(page.id, pages[pageIndex + 1]?.id, 'after'); }} />
          <IconButton icon={RotateCw} label={`Rotate page ${pageIndex + 1}`} size={12} onClick={(event) => { event.stopPropagation(); rotateSelected(90, [page.id]); }} />
          <IconButton icon={MoreHorizontal} label={`More actions for page ${pageIndex + 1}`} size={12} onClick={(event) => { event.stopPropagation(); setActiveId(page.id); setSelectedIds([page.id]); setModal({ type: 'page-menu', pageId: page.id }); }} />
        </div>
      </div>
      <div className="page-thumb-zone">{page.thumbnail ? <img src={page.thumbnail} alt={`Page ${pageIndex + 1}`} draggable="false" /> : <div className="page-thumb-placeholder"><FileText size={27} /><span>Rendering…</span></div>}{!!page.overlays?.length && <span className="page-overlay-badge"><Type size={11} /> {page.overlays.length}</span>}</div>
      <div className="page-card-footer"><div><strong>Page {pageNumber}</strong><small>{page.kind === 'image' ? extName(page.sourceName) + ' image' : page.kind === 'blank' ? 'Blank page' : `PDF page ${page.sourcePageIndex + 1}`}</small></div><span className={cx('page-check', selected && 'page-check-on')}>{selected && <Check size={12} />}</span></div>
    </motion.div>
  );
}

export default memo(PageCard);
