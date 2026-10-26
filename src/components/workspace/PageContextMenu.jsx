import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronsLeft, ChevronsRight, ArrowLeft, ArrowRight, Copy, CheckSquare, RotateCcw, RotateCw, Trash2 } from 'lucide-react';

/* Right-click dropdown for page tiles. Acts on every selected page when the clicked page is part of
   the selection, otherwise on the clicked page alone. */
export default function PageContextMenu({ menu, pages, onClose, rotateSelected, duplicateSelected, requestDeleteSelected, movePage, moveToEdge, selectAll }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: menu.x, top: menu.y });
  const count = menu.ids.length;
  const plural = count > 1 ? `${count} pages` : 'page';
  const index = pages.findIndex((p) => p.id === menu.pageId);
  const single = count === 1;

  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    const m = 8;
    setPos({
      left: Math.max(m, Math.min(menu.x, window.innerWidth - el.offsetWidth - m)),
      top: Math.max(m, Math.min(menu.y, window.innerHeight - el.offsetHeight - m)),
    });
    el.querySelector('button:not(:disabled)')?.focus({ preventScroll: true });
  }, [menu.x, menu.y]);

  useEffect(() => {
    const close = () => onClose();
    const onDown = (e) => { if (!ref.current?.contains(e.target)) onClose(); };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault(); e.stopPropagation();
        const items = [...ref.current.querySelectorAll('button:not(:disabled)')];
        const at = items.indexOf(document.activeElement);
        const next = e.key === 'ArrowDown' ? (at + 1) % items.length : (at - 1 + items.length) % items.length;
        items[next]?.focus();
      }
    };
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('contextmenu', onDown, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', close);
    window.addEventListener('blur', close);
    window.addEventListener('wheel', close, { passive: true });
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('contextmenu', onDown, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('blur', close);
      window.removeEventListener('wheel', close);
    };
  }, [onClose]);

  const run = (fn) => () => { onClose(); fn(); };
  const Item = ({ icon: Icon, label, hint, onClick, disabled, danger }) => (
    <button type="button" role="menuitem" disabled={disabled} className={`ctx-item${danger ? ' ctx-danger' : ''}`} onClick={run(onClick)}>
      <Icon size={15} /><span>{label}</span>{hint && <kbd>{hint}</kbd>}
    </button>
  );

  return createPortal(
    <div ref={ref} className="page-ctx-menu" role="menu" aria-label="Page actions" style={{ left: pos.left, top: pos.top }} onContextMenu={(e) => e.preventDefault()}>
      <div className="ctx-title">{count > 1 ? `${count} pages selected` : `Page ${String(index + 1).padStart(2, '0')}`}</div>
      <Item icon={RotateCcw} label={`Rotate ${plural} left`} onClick={() => rotateSelected(-90, menu.ids)} />
      <Item icon={RotateCw} label={`Rotate ${plural} right`} onClick={() => rotateSelected(90, menu.ids)} />
      <Item icon={Copy} label={`Duplicate ${plural}`} onClick={() => duplicateSelected(menu.ids)} />
      <div className="ctx-sep" />
      <Item icon={ArrowLeft} label="Move earlier" disabled={!single || index <= 0} onClick={() => movePage(menu.pageId, pages[index - 1]?.id, 'before')} />
      <Item icon={ArrowRight} label="Move later" disabled={!single || index >= pages.length - 1} onClick={() => movePage(menu.pageId, pages[index + 1]?.id, 'after')} />
      <Item icon={ChevronsLeft} label="Move to start" disabled={index === 0 && single} onClick={() => moveToEdge(menu.ids, 'start')} />
      <Item icon={ChevronsRight} label="Move to end" disabled={index === pages.length - 1 && single} onClick={() => moveToEdge(menu.ids, 'end')} />
      <div className="ctx-sep" />
      <Item icon={CheckSquare} label="Select all pages" hint="" onClick={selectAll} />
      <Item icon={Trash2} label={`Delete ${plural}`} hint="Del" danger onClick={() => requestDeleteSelected(menu.ids)} />
    </div>,
    document.body,
  );
}
