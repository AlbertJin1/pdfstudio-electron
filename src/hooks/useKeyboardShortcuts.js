import { useEffect, useRef } from 'react';

const isEditable = (target) => Boolean(target && (target.matches?.('input, textarea, select') || target.isContentEditable));
const isPressable = (target) => Boolean(target && target.matches?.('button, a[href], [role="button"], [role="menuitem"], summary'));

/**
 * Global keyboard shortcuts. The latest props are kept in a ref so the single window listener never
 * works with stale selection / page data.
 *
 * Anywhere:      Ctrl+O open · Ctrl+1…5 sections · F1 guide · Ctrl+A is captured so it never selects app text
 * Page workspace (when not typing in a field, no dialog open):
 *   Ctrl+A select all · Ctrl+Shift+A / Esc clear selection · Ctrl+I invert selection
 *   ← → ↑ ↓ move between pages · Shift+arrows extend range · Home / End first / last (Shift extends)
 *   Ctrl+← / Ctrl+→ move selected pages earlier / later · Ctrl+Home / Ctrl+End move to start / end
 *   Space toggle the active page · Delete / Backspace remove · Ctrl+D duplicate
 *   R rotate right · Shift+R rotate left · Ctrl+Shift+N insert blank page · Ctrl+F find page
 *   Ctrl+S export PDF · Ctrl+Shift+S export selected pages · Ctrl+Z undo · Ctrl+Shift+Z / Ctrl+Y redo
 */
export function useKeyboardShortcuts(props) {
  const ref = useRef(props);
  ref.current = props;
  const anchorRef = useRef({ id: null, lastActive: null });

  useEffect(() => {
    const focusCard = (id) => requestAnimationFrame(() => {
      document.querySelector(`[data-page-id="${id}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });

    const onKeyDown = (event) => {
      const p = ref.current;
      if (p.accessLockedRef.current || event.defaultPrevented) return;
      const key = event.key;
      const lower = key.length === 1 ? key.toLowerCase() : key;
      const mod = event.ctrlKey || event.metaKey;
      const editing = isEditable(event.target);
      const pages = p.pagesRef.current;
      const inWorkspace = p.mode === 'workspace' && !p.modal;

      if (key === 'Escape') {
        if (p.modal) { p.setModal(null); return; }
        if (editing && event.target.closest?.('.search-field') && p.search) { p.setSearch(''); return; }
        if (!editing && inWorkspace && p.selectedIds.length) { p.setSelectedIds([]); }
        return;
      }

      // Never let the browser select all the text in the app (outside real text fields).
      if (mod && lower === 'a' && !editing) {
        event.preventDefault();
        if (p.modal) return;
        if (event.shiftKey) { if (inWorkspace) p.setSelectedIds([]); return; }
        if (inWorkspace && pages.length) {
          p.setSelectedIds(pages.map((page) => page.id));
          if (!p.activeId) p.setActiveId(pages[0].id);
        }
        return;
      }

      if (key === 'F1') { event.preventDefault(); if (!p.modal) p.setModal({ type: 'guide' }); return; }
      if (p.modal) return;
      // Edit PDF owns its own save/undo/delete shortcuts; do not send those keystrokes
      // to the page-management workspace while its dedicated editor is active.
      if (p.mode === 'edit' || p.mode === 'photo') return;

      if (mod && lower === 'f' && p.mode === 'workspace' && pages.length) {
        event.preventDefault();
        document.querySelector('.page-grid-panel .search-field input')?.focus();
        return;
      }
      if (editing) return;

      if (mod && lower === 'o') { event.preventDefault(); p.chooseFiles(); return; }
      if (mod && ['1', '2', '3', '4', '5'].includes(key)) {
        event.preventDefault();
        p.setMode({ 1: 'home', 2: 'workspace', 3: 'convert', 4: 'history', 5: 'settings' }[key]);
        return;
      }
      if (mod && lower === 's') {
        event.preventDefault();
        if (!pages.length) return;
        if (event.shiftKey && p.selectedIds.length) p.setModal({ type: 'export-selected' });
        else p.setModal({ type: 'export' });
        return;
      }
      if (mod && lower === 'z') { event.preventDefault(); if (event.shiftKey) p.redo(); else p.undo(); return; }
      if (mod && lower === 'y') { event.preventDefault(); p.redo(); return; }

      if (p.mode !== 'workspace' || !pages.length) return;

      const searching = Boolean(p.search?.trim());
      const visible = searching ? p.filteredPages : pages;
      const selectedSet = new Set(p.selectedIds);
      const activeIndex = Math.max(0, visible.findIndex((page) => page.id === p.activeId));

      if (mod && lower === 'd') { event.preventDefault(); if (p.selectedIds.length || p.activeId) p.duplicateSelected(p.selectedIds.length ? p.selectedIds : undefined); return; }
      if (mod && lower === 'i') { event.preventDefault(); p.setSelectedIds(pages.filter((page) => !selectedSet.has(page.id)).map((page) => page.id)); return; }
      if (mod && event.shiftKey && lower === 'n') { event.preventDefault(); p.addBlankPage(); return; }
      if (mod) {
        // Ctrl + arrows / Home / End reorder the selected pages.
        const ids = p.selectedIds.length ? p.selectedIds : (p.activeId ? [p.activeId] : []);
        if (!ids.length || searching) return;
        const set = new Set(ids);
        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(key)) {
          event.preventDefault();
          const back = key === 'ArrowLeft' || key === 'ArrowUp';
          const next = [...pages];
          if (back) { for (let i = 1; i < next.length; i += 1) if (set.has(next[i].id) && !set.has(next[i - 1].id)) [next[i - 1], next[i]] = [next[i], next[i - 1]]; }
          else { for (let i = next.length - 2; i >= 0; i -= 1) if (set.has(next[i].id) && !set.has(next[i + 1].id)) [next[i + 1], next[i]] = [next[i], next[i + 1]]; }
          if (next.some((page, i) => page.id !== pages[i].id)) { p.commitPages(next); focusCard(ids[0]); }
          return;
        }
        if (key === 'Home' || key === 'End') {
          event.preventDefault();
          const picked = pages.filter((page) => set.has(page.id));
          const rest = pages.filter((page) => !set.has(page.id));
          const next = key === 'Home' ? [...picked, ...rest] : [...rest, ...picked];
          if (next.some((page, i) => page.id !== pages[i].id)) { p.commitPages(next); focusCard(ids[0]); }
          return;
        }
        return;
      }

      // Selection / navigation
      const navKeys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
      if (navKeys.includes(key) && !event.altKey) {
        if (isPressable(event.target) && (key === 'ArrowLeft' || key === 'ArrowRight') && event.target.closest?.('.workspace-toolbar, .page-card-hover-actions')) return;
        event.preventDefault();
        const cards = [...document.querySelectorAll('.page-grid .page-card')];
        let columns = 1;
        if (cards.length) { const top = cards[0].getBoundingClientRect().top; columns = Math.max(1, cards.filter((c) => Math.abs(c.getBoundingClientRect().top - top) < 4).length); }
        let target = activeIndex;
        if (key === 'ArrowLeft') target = activeIndex - 1;
        else if (key === 'ArrowRight') target = activeIndex + 1;
        else if (key === 'ArrowUp') target = activeIndex - columns;
        else if (key === 'ArrowDown') target = activeIndex + columns;
        else if (key === 'Home') target = 0;
        else target = visible.length - 1;
        target = Math.max(0, Math.min(visible.length - 1, target));
        const targetPage = visible[target];
        if (!targetPage) return;
        if (event.shiftKey) {
          if (anchorRef.current.lastActive !== p.activeId || !anchorRef.current.id) anchorRef.current.id = p.activeId || visible[0].id;
          const anchorIndex = Math.max(0, visible.findIndex((page) => page.id === anchorRef.current.id));
          const [start, end] = [anchorIndex, target].sort((a, b) => a - b);
          p.setSelectedIds(visible.slice(start, end + 1).map((page) => page.id));
        } else {
          anchorRef.current.id = targetPage.id;
          p.setSelectedIds([targetPage.id]);
        }
        anchorRef.current.lastActive = targetPage.id;
        p.setActiveId(targetPage.id);
        focusCard(targetPage.id);
        return;
      }

      if (key === ' ' && !isPressable(event.target) && p.activeId) {
        event.preventDefault();
        p.setSelectedIds(selectedSet.has(p.activeId) ? p.selectedIds.filter((id) => id !== p.activeId) : [...p.selectedIds, p.activeId]);
        return;
      }
      if ((key === 'Delete' || key === 'Backspace') && !event.shiftKey) {
        if (p.selectedIds.length) { event.preventDefault(); p.requestDeleteSelected(p.selectedIds); }
        return;
      }
      if (lower === 'r' && !event.altKey) {
        const ids = p.selectedIds.length ? p.selectedIds : (p.activeId ? [p.activeId] : []);
        if (ids.length) { event.preventDefault(); p.rotateSelected(event.shiftKey ? -90 : 90, ids); }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
