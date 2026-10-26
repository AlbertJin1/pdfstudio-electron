import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPageThumbnail, loadPdfSource } from '../services/pdf/index.js';
import { normalizeBytes } from '../utils/files.js';
import { uid } from '../utils/id.js';

export function useWorkspace({ notify, setMode, setIsLoading, setLoadingLabel, setModal, confirmDelete, accessLockedRef, fileInputRef }) {
  const [pages, setPages] = useState([]);
  const pagesRef = useRef([]);
  const sourcesRef = useRef(new Map());
  const [, setSourceRevision] = useState(0);
  const [documents, setDocuments] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [search, setSearch] = useState('');
  const [draggingPageId, setDraggingPageId] = useState(null);
  const [dropCue, setDropCue] = useState(null);
  const [landedId, setLandedId] = useState(null);
  const landedTimer = useRef(null);
  const asIds = (value) => (Array.isArray(value) ? value : null); // click handlers pass an event object: never treat it as ids
  const suppressPageClickUntil = useRef(0);
  const historyRef = useRef([]);
  const redoRef = useRef([]);

  useEffect(() => { pagesRef.current = pages; }, [pages]);
  const commitPages = useCallback((producer) => {
    const current = pagesRef.current;
    const next = typeof producer === 'function' ? producer(current) : producer;
    if (next === current) return;
    historyRef.current.push(current);
    if (historyRef.current.length > 40) historyRef.current.shift();
    redoRef.current = [];
    pagesRef.current = next;
    setPages(next);
    if (next.length === 0) { setActiveId(null); setSelectedIds([]); }
    else {
      const oldActive = activeId;
      const newActive = next.some((page) => page.id === oldActive) ? oldActive : next[0].id;
      setActiveId(newActive);
      setSelectedIds((currentIds) => currentIds.filter((id) => next.some((page) => page.id === id)));
    }
  }, [activeId]);

  const undo = useCallback(() => {
    const previous = historyRef.current.pop();
    if (!previous) return notify('Nothing to undo.', 'info');
    redoRef.current.push(pagesRef.current);
    pagesRef.current = previous;
    setPages(previous);
    const active = previous.find((page) => page.id === activeId) || previous[0];
    setActiveId(active?.id || null);
    setSelectedIds(active ? [active.id] : []);
    notify('Last page change undone.', 'info');
  }, [activeId, notify]);
  const redo = useCallback(() => {
    const next = redoRef.current.pop();
    if (!next) return notify('Nothing to redo.', 'info');
    historyRef.current.push(pagesRef.current);
    pagesRef.current = next;
    setPages(next);
    const active = next.find((page) => page.id === activeId) || next[0];
    setActiveId(active?.id || null);
    setSelectedIds(active ? [active.id] : []);
    notify('Page change restored.', 'info');
  }, [activeId, notify]);

  const activePage = useMemo(() => pages.find((page) => page.id === activeId) || pages[0] || null, [pages, activeId]);
  const selectedPages = useMemo(() => pages.filter((page) => selectedIds.includes(page.id)), [pages, selectedIds]);
  const currentDocument = activePage ? documents.find((document) => document.id === activePage.sourceId) : null;
  const filteredPages = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return pages;
    return pages.filter((page, index) => `page ${index + 1} ${page.sourceName || ''} ${page.kind}`.toLowerCase().includes(query));
  }, [pages, search]);

  const addImportedItems = useCallback(async (items) => {
    if (!items?.length) return;
    setIsLoading(true);
    setLoadingLabel('Reading your files');
    const newPages = [];
    const newDocuments = [];
    try {
      for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
        const item = items[itemIndex];
        let bytes = normalizeBytes(item.bytes ?? item.data);
        if (!bytes.length) continue;
        let kind = item.kind || (item.mime === 'application/pdf' || item.name?.toLowerCase().endsWith('.pdf') ? 'pdf' : 'image');
        if (!['pdf', 'image'].includes(kind)) continue;
        const sourceId = uid();
        const source = { id: sourceId, name: item.name || `Document ${itemIndex + 1}`, originName: item.originName, path: item.path || '', mime: item.mime || (kind === 'pdf' ? 'application/pdf' : 'image/png'), kind, bytes, size: bytes.byteLength };
        let pageCount = 1;
        if (kind === 'pdf') {
          setLoadingLabel(`Reading ${source.name}`);
          try {
            source.pdf = await loadPdfSource(bytes);
          } catch (error) {
            const needsPassword = error?.name === 'PasswordException' || /password/i.test(error?.message || '');
            if (!needsPassword) throw error;
            let opened = false;
            for (let attempt = 0; attempt < 3 && !opened; attempt += 1) {
              const password = window.prompt(`This PDF is password-protected. Enter the password for “${source.name}”${attempt ? ` (attempt ${attempt + 1} of 3)` : ''}:`);
              if (password == null) break;
              try { source.pdf = await loadPdfSource(bytes, password); opened = true; }
              catch (passwordError) { if (passwordError?.name !== 'PasswordException' && !/password/i.test(passwordError?.message || '')) throw passwordError; }
            }
            if (!opened) { notify(`Skipped ${source.name}: password was not accepted.`, 'error'); continue; }
          }
          pageCount = source.pdf.numPages;
        } else if (!source.mime.startsWith('image/')) {
          source.mime = 'image/png';
        }
        sourcesRef.current.set(sourceId, source);
        newDocuments.push({ id: sourceId, name: source.name, kind, mime: source.mime, size: source.size, pageCount, path: source.path, originName: source.originName, importedAt: new Date() });
        for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
          newPages.push({ id: uid(), sourceId, sourceName: source.name, sourcePageIndex: kind === 'pdf' ? pageIndex : null, kind, rotation: 0, thumbnail: null, overlays: [], width: 595.28, height: 841.89 });
        }
      }
      if (!newPages.length) return;
      setDocuments((previous) => [...previous, ...newDocuments]);
      const current = pagesRef.current;
      historyRef.current.push(current);
      if (historyRef.current.length > 40) historyRef.current.shift();
      redoRef.current = [];
      const joined = [...current, ...newPages];
      pagesRef.current = joined;
      setPages(joined);
      setActiveId(newPages[0].id);
      setSelectedIds([newPages[0].id]);
      setMode('workspace');
      setSourceRevision((n) => n + 1);
      notify(`${newPages.length} page${newPages.length === 1 ? '' : 's'} added to your workspace.`);
      setLoadingLabel('Generating page previews');
      for (const page of newPages) {
        const thumbnail = await createPageThumbnail(page, sourcesRef.current);
        if (thumbnail) setPages((currentPages) => {
          const updated = currentPages.map((item) => item.id === page.id ? { ...item, thumbnail } : item);
          pagesRef.current = updated;
          return updated;
        });
      }
    } catch (error) {
      console.error(error);
      notify(error?.message || 'Could not open one of these files.', 'error');
    } finally {
      setIsLoading(false);
      setLoadingLabel('Preparing your workspace');
    }
  }, [notify]);

  const chooseFiles = useCallback(async () => {
    if (accessLockedRef.current) return;
    try {
      if (window.pdfStudio?.openFiles) {
        const items = await window.pdfStudio.openFiles();
        await addImportedItems(items);
      } else {
        fileInputRef.current?.click();
      }
    } catch (error) { notify(error?.message || 'Unable to open the file picker.', 'error'); }
  }, [addImportedItems, notify]);

  const handleBrowserFiles = useCallback(async (fileList) => {
    if (accessLockedRef.current) return;
    const items = await Promise.all([...fileList].map(async (file) => {
      const ext = file.name.split('.').pop().toLowerCase();
      let kind = ext === 'pdf' ? 'pdf' : 'image';
      let mime = file.type || (kind === 'pdf' ? 'application/pdf' : 'image/png');
      return { name: file.name, mime, kind, bytes: new Uint8Array(await file.arrayBuffer()) };
    }));
    await addImportedItems(items);
  }, [addImportedItems]);

  const selectPage = useCallback((page, event) => {
    setActiveId(page.id);
    if (event?.shiftKey) {
      const anchorIndex = pages.findIndex((item) => item.id === (selectedIds[0] || activeId));
      const targetIndex = pages.findIndex((item) => item.id === page.id);
      const [start, end] = [anchorIndex, targetIndex].sort((a, b) => a - b);
      setSelectedIds(pages.slice(start, end + 1).map((item) => item.id));
    } else if (event?.ctrlKey || event?.metaKey) {
      setSelectedIds((previous) => previous.includes(page.id) ? previous.filter((id) => id !== page.id) : [...previous, page.id]);
    } else {
      setSelectedIds([page.id]);
    }
  }, [activeId, pages, selectedIds]);

  const deleteSelected = useCallback((explicitIds) => {
    const ids = new Set(asIds(explicitIds) || (selectedIds.length ? selectedIds : activeId ? [activeId] : []));
    if (!ids.size) return;
    const before = pagesRef.current;
    const next = before.filter((page) => !ids.has(page.id));
    if (next.length === before.length) return;
    const firstGone = before.findIndex((page) => ids.has(page.id));
    commitPages(next);
    if (next.length) {
      const neighbour = next[Math.min(firstGone, next.length - 1)];
      setActiveId(neighbour.id);
      setSelectedIds([neighbour.id]);
    }
    notify(`${ids.size} page${ids.size > 1 ? 's' : ''} removed.`, 'info');
  }, [activeId, commitPages, notify, selectedIds]);

  const requestDeleteSelected = useCallback((explicitIds) => {
    const ids = [...new Set(asIds(explicitIds) || (selectedIds.length ? selectedIds : activeId ? [activeId] : []))];
    if (!ids.length) return;
    if (confirmDelete) {
      setModal({ type: 'confirm-delete', ids });
      return;
    }
    setModal(null);
    deleteSelected(ids);
  }, [activeId, deleteSelected, confirmDelete, selectedIds]);

  const rotateSelected = useCallback((angle, explicitIds) => {
    const ids = new Set(asIds(explicitIds) || (selectedIds.length ? selectedIds : activeId ? [activeId] : []));
    if (!ids.size) return;
    const next = pagesRef.current.map((page) => ids.has(page.id) ? { ...page, rotation: ((page.rotation + angle) % 360 + 360) % 360, thumbnail: null } : page);
    commitPages(next);
    for (const page of next.filter((item) => ids.has(item.id))) {
      createPageThumbnail(page, sourcesRef.current).then((thumbnail) => {
        if (thumbnail) setPages((current) => { const updated = current.map((item) => item.id === page.id ? { ...item, thumbnail } : item); pagesRef.current = updated; return updated; });
      });
    }
    notify(`Rotated ${ids.size} page${ids.size > 1 ? 's' : ''}.`, 'info');
  }, [activeId, commitPages, notify, selectedIds]);

  const duplicateSelected = useCallback((explicitIds) => {
    const duplicateIds = asIds(explicitIds) || selectedIds;
    const selected = pagesRef.current.filter((page) => duplicateIds.includes(page.id));
    if (!selected.length && activePage && !asIds(explicitIds)) selected.push(activePage);
    if (!selected.length) return;
    const duplicates = selected.map((page) => ({ ...page, id: uid(), overlays: (page.overlays || []).map((overlay) => ({ ...overlay })) }));
    const lastIndex = Math.max(...selected.map((page) => pagesRef.current.findIndex((item) => item.id === page.id)));
    const next = [...pagesRef.current];
    next.splice(lastIndex + 1, 0, ...duplicates);
    commitPages(next);
    setSelectedIds(duplicates.map((page) => page.id));
    setActiveId(duplicates[0].id);
    notify(`${duplicates.length} page${duplicates.length > 1 ? 's' : ''} duplicated.`);
  }, [activePage, commitPages, notify, selectedIds]);

  const addBlankPage = useCallback(() => {
    const page = { id: uid(), sourceId: null, sourceName: 'Blank page', sourcePageIndex: null, kind: 'blank', rotation: 0, thumbnail: null, overlays: [], width: 595.28, height: 841.89 };
    const index = activeId ? pagesRef.current.findIndex((item) => item.id === activeId) + 1 : pagesRef.current.length;
    const next = [...pagesRef.current];
    next.splice(Math.max(0, index), 0, page);
    commitPages(next);
    setActiveId(page.id);
    setSelectedIds([page.id]);
    createPageThumbnail(page, sourcesRef.current).then((thumbnail) => {
      if (thumbnail) setPages((current) => { const updated = current.map((item) => item.id === page.id ? { ...item, thumbnail } : item); pagesRef.current = updated; return updated; });
    });
    notify('Blank page inserted.');
  }, [activeId, commitPages, notify]);

  const movePage = useCallback((dragId, targetId, position = 'before') => {
    if (!dragId || !targetId || dragId === targetId) return;
    const current = pagesRef.current;
    const from = current.findIndex((page) => page.id === dragId);
    if (from < 0) return;
    const next = [...current];
    const [dragged] = next.splice(from, 1);
    const targetIndex = next.findIndex((page) => page.id === targetId);
    if (targetIndex < 0) return;
    const insertAt = targetIndex + (position === 'after' ? 1 : 0);
    next.splice(insertAt, 0, dragged);
    if (next.every((page, index) => page.id === current[index]?.id)) return;
    commitPages(next);
    setActiveId(dragged.id);
    setSelectedIds([dragged.id]);
    setLandedId(dragged.id);
    clearTimeout(landedTimer.current);
    landedTimer.current = setTimeout(() => setLandedId(null), 900);
    setDropCue(null);
    setDraggingPageId(null);
    notify(`Page moved to position ${next.findIndex((page) => page.id === dragged.id) + 1}.`, 'info');
  }, [commitPages, notify]);


  const removeDocument = useCallback((documentId) => {
    commitPages((current) => current.filter((page) => page.sourceId !== documentId));
    sourcesRef.current.delete(documentId);
    setDocuments((current) => current.filter((document) => document.id !== documentId));
    setSourceRevision((n) => n + 1);
    notify('Source removed from the workspace.', 'info');
  }, [commitPages, notify]);

  const handleDropFiles = async (event) => {
    event.preventDefault();
    if (accessLockedRef.current) return;
    const files = [...(event.dataTransfer?.files || [])];
    if (files.length) await handleBrowserFiles(files);
  };

  return {
    pages,
    pagesRef,
    sourcesRef,
    documents,
    selectedIds,
    setSelectedIds,
    activeId,
    setActiveId,
    search,
    setSearch,
    draggingPageId,
    setDraggingPageId,
    dropCue,
    setDropCue,
    landedId,
    setLandedId,
    suppressPageClickUntil,
    historyRef,
    redoRef,
    commitPages,
    undo,
    redo,
    activePage,
    selectedPages,
    currentDocument,
    filteredPages,
    chooseFiles,
    handleBrowserFiles,
    selectPage,
    deleteSelected,
    requestDeleteSelected,
    rotateSelected,
    duplicateSelected,
    addBlankPage,
    movePage,
    removeDocument,
    handleDropFiles,
  };
}
