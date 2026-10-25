import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, AlignLeft, ArrowDownToLine, ArrowDownUp, ArrowLeft, ArrowRight, ArrowUpRight,
  BadgeCheck, BookOpen, Check, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight,
  CircleHelp, Clock3, Cloud, Command, Copy, Download, FileArchive, FileCheck2, FileImage,
  FilePlus2, FileStack, FileText, Files, FolderOpen, Gauge, GripVertical, HardDrive,
  History, ImagePlus, Layers3, LayoutDashboard, ListFilter, LockKeyhole, Maximize2,
  Minimize2, Minus, Moon, MoreHorizontal, PackageCheck, PanelRightClose, PanelRightOpen,
  Plus, Redo2, RotateCcw, RotateCw, Search, Settings2, ShieldCheck, Sparkles, Split,
  Sun, Trash2, Type, Undo2, Upload, WandSparkles, X, ZoomIn, ZoomOut, Scissors,
} from 'lucide-react';
import { composePdf, createPageThumbnail, isImage, isPdf, loadPdfSource, normalizeBytes, pdfToDocx, renderPageCanvas, renderPdfImages, uid } from './lib/pdfWorkspace.js';

const initialTools = [
  { label: 'Merge & organize', description: 'Reorder, rotate, duplicate and combine pages', icon: Layers3, tone: 'lavender', mode: 'workspace' },
  { label: 'PDF to Word', description: 'Turn selectable PDF text into an editable DOCX', icon: FileText, tone: 'blue', action: 'word' },
  { label: 'PDF to images', description: 'Export pages as high-quality PNG or JPG', icon: FileImage, tone: 'orange', action: 'images' },
  { label: 'Images to PDF', description: 'Build a polished PDF from your image files', icon: ImagePlus, tone: 'green', mode: 'workspace' },
];

function cx(...parts) { return parts.filter(Boolean).join(' '); }
function formatBytes(size = 0) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
function extName(name = '') { return name.split('.').pop()?.toUpperCase() || 'FILE'; }

function IconButton({ icon: Icon, label, onClick, disabled = false, active = false, className = '', size = 16, variant = 'ghost' }) {
  return <button type="button" title={label} aria-label={label} onClick={onClick} disabled={disabled} className={cx('icon-button', `icon-button-${variant}`, active && 'is-active', className)}><Icon size={size} strokeWidth={1.85} /></button>;
}
function ActionButton({ icon: Icon, children, onClick, disabled = false, variant = 'secondary', className = '' }) {
  return <button type="button" disabled={disabled} onClick={onClick} className={cx('action-button', `action-${variant}`, className)}>{Icon && <Icon size={16} strokeWidth={1.9} />}<span>{children}</span></button>;
}
function SectionLabel({ children, trailing }) { return <div className="section-label"><span>{children}</span>{trailing}</div>; }

function PagePreview({ page, sources, onAddText, onAddBlock, zoom = 1 }) {
  const holderRef = useRef(null);
  const [renderError, setRenderError] = useState('');
  useEffect(() => {
    let alive = true;
    const holder = holderRef.current;
    if (!holder || !page) return undefined;
    holder.innerHTML = '';
    setRenderError('');
    renderPageCanvas(page, sources, Math.round(900 * zoom), true).then((canvas) => {
      if (!alive || !holderRef.current) return;
      canvas.className = 'preview-rendered-canvas';
      canvas.style.width = '100%';
      canvas.style.height = 'auto';
      canvas.style.display = 'block';
      holderRef.current.innerHTML = '';
      holderRef.current.appendChild(canvas);
    }).catch((error) => { if (alive) setRenderError(error?.message || 'Preview unavailable'); });
    return () => { alive = false; };
  }, [page?.id, page?.rotation, page?.kind, page?.sourcePageIndex, sources, zoom]);

  return <div className="preview-stage">
    <div className="preview-paper-wrap">
      <div ref={holderRef} className="preview-paper" />
      {!!page?.overlays?.length && <div className="preview-annotations" aria-hidden="true">
        {page.overlays.map((overlay, index) => overlay.type === 'rect'
          ? <div key={`${page.id}-overlay-${index}`} className="annotation-rect" style={{ left: `${overlay.x}%`, top: `${overlay.y}%`, width: `${overlay.width || 30}%`, height: `${overlay.height || 8}%`, background: overlay.color || '#232638' }} />
          : <div key={`${page.id}-overlay-${index}`} className="annotation-text" style={{ left: `${overlay.x}%`, top: `${overlay.y}%`, color: overlay.color || '#6e54ea', fontSize: `clamp(8px, ${Number(overlay.size || 18) / 5.4}px, 24px)` }}>{overlay.text}</div>)}
      </div>}
      {renderError && <div className="preview-error"><FileText size={26} /><span>{renderError}</span></div>}
      {page && <div className="paper-page-tag">PAGE {page.sourcePageIndex != null ? page.sourcePageIndex + 1 : '—'}</div>}
    </div>
    <div className="preview-quick-tools">
      <button type="button" onClick={onAddText}><Type size={14} /> Add text</button>
      <button type="button" onClick={onAddBlock}><LockKeyhole size={14} /> Cover area</button>
    </div>
  </div>;
}

function Modal({ title, eyebrow, children, onClose, footer, wide = false }) {
  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className={cx('modal-card', wide && 'modal-wide')} role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal-head"><div>{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h2>{title}</h2></div><IconButton icon={X} label="Close dialog" onClick={onClose} /></div>
      <div className="modal-content">{children}</div>
      {footer && <div className="modal-footer">{footer}</div>}
    </div>
  </div>;
}

function App() {
  const [pages, setPages] = useState([]);
  const pagesRef = useRef([]);
  const sourcesRef = useRef(new Map());
  const [sourceRevision, setSourceRevision] = useState(0);
  const [documents, setDocuments] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [mode, setMode] = useState('home');
  const [isLoading, setIsLoading] = useState(false);
  const [loadingLabel, setLoadingLabel] = useState('Preparing your workspace');
  const [search, setSearch] = useState('');
  const [dark, setDark] = useState(() => { try { return localStorage.getItem('pdfstudio-theme') === 'dark'; } catch { return false; } });
  const [maximized, setMaximized] = useState(false);
  const [toast, setToast] = useState(null);
  const [modal, setModal] = useState(null);
  const [textValue, setTextValue] = useState('Confidential');
  const [textColor, setTextColor] = useState('#6e54ea');
  const [textSize, setTextSize] = useState('18');
  const [coverColor, setCoverColor] = useState('#242638');
  const [exportTitle, setExportTitle] = useState('');
  const [exportAuthor, setExportAuthor] = useState('PDF Studio');
  const [exportPageNumbers, setExportPageNumbers] = useState(false);
  const [exportWatermark, setExportWatermark] = useState('');
  const [splitMode, setSplitMode] = useState('each');
  const [splitEvery, setSplitEvery] = useState('2');
  const [splitRanges, setSplitRanges] = useState('1-3, 4-6');
  const [imageFormat, setImageFormat] = useState('png');
  const [imageQuality, setImageQuality] = useState('92');
  const [showInspector, setShowInspector] = useState(true);
  const [draggingPageId, setDraggingPageId] = useState(null);
  const [dropCue, setDropCue] = useState(null);
  const [previewZoom, setPreviewZoom] = useState(1);
  const [appVersion, setAppVersion] = useState('3.0.0');
  const fileInputRef = useRef(null);
  const suppressPageClickUntil = useRef(0);
  const historyRef = useRef([]);
  const redoRef = useRef([]);

  useEffect(() => { pagesRef.current = pages; }, [pages]);
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    try { localStorage.setItem('pdfstudio-theme', dark ? 'dark' : 'light'); } catch { /* local storage is optional */ }
  }, [dark]);
  useEffect(() => {
    window.pdfStudio?.version?.().then((version) => setAppVersion(version)).catch(() => {});
    window.pdfStudio?.isMaximized?.().then(setMaximized).catch(() => {});
    const unsubscribe = window.pdfStudio?.onMaximizedChanged?.(setMaximized);
    return () => unsubscribe?.();
  }, []);
  useEffect(() => {
    if (!toast) return undefined;
    const id = window.setTimeout(() => setToast(null), 3600);
    return () => window.clearTimeout(id);
  }, [toast]);

  const notify = useCallback((message, kind = 'success') => setToast({ message, kind }), []);
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
  const selectedPageNumbers = useMemo(() => selectedPages.map((page) => pages.findIndex((item) => item.id === page.id) + 1), [pages, selectedPages]);
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
    const ids = new Set(explicitIds || (selectedIds.length ? selectedIds : activeId ? [activeId] : []));
    if (!ids.size) return;
    const next = pagesRef.current.filter((page) => !ids.has(page.id));
    if (next.length === pagesRef.current.length) return;
    commitPages(next);
    notify(`${ids.size} page${ids.size > 1 ? 's' : ''} removed.`, 'info');
  }, [activeId, commitPages, notify, selectedIds]);

  const rotateSelected = useCallback((angle, explicitIds) => {
    const ids = new Set(explicitIds || (selectedIds.length ? selectedIds : activeId ? [activeId] : []));
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
    const duplicateIds = explicitIds || selectedIds;
    const selected = pagesRef.current.filter((page) => duplicateIds.includes(page.id));
    if (!selected.length && activePage) selected.push(activePage);
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
    setDropCue(null);
    setDraggingPageId(null);
    notify(`Page moved to position ${next.findIndex((page) => page.id === dragged.id) + 1}.`, 'info');
  }, [commitPages, notify]);

  const addTextOverlay = useCallback(() => {
    if (!activePage) return notify('Choose a page before adding text.', 'info');
    commitPages((current) => current.map((page) => selectedIds.includes(page.id) ? { ...page, overlays: [...(page.overlays || []), { type: 'text', text: textValue.trim() || 'Text', x: 9, y: 15, size: Number(textSize) || 18, color: textColor }] } : page));
    setModal(null);
    notify(`Text added to ${selectedIds.length || 1} page${(selectedIds.length || 1) > 1 ? 's' : ''}.`);
  }, [activePage, commitPages, notify, selectedIds, textColor, textSize, textValue]);

  const addCoverOverlay = useCallback(() => {
    if (!activePage) return notify('Choose a page before covering an area.', 'info');
    commitPages((current) => current.map((page) => selectedIds.includes(page.id) ? { ...page, overlays: [...(page.overlays || []), { type: 'rect', x: 9, y: 16, width: 36, height: 7, color: coverColor }] } : page));
    setModal(null);
    notify('Cover block added. Note: a cover overlay is not a certified redaction.');
  }, [activePage, commitPages, coverColor, notify, selectedIds]);

  const doExportPdf = useCallback(async (onlySelected = false) => {
    const exportPages = onlySelected ? selectedPages : pages;
    if (!exportPages.length) return notify('There are no pages to export.', 'error');
    setIsLoading(true); setLoadingLabel('Building your PDF');
    try {
      const bytes = await composePdf(exportPages, sourcesRef.current, { title: exportTitle || 'PDF Studio document', author: exportAuthor || 'PDF Studio', pageNumbers: exportPageNumbers, watermark: exportWatermark });
      const name = `${(exportTitle || (documents.length === 1 ? documents[0].name.replace(/\.[^.]+$/, '') : 'PDF-Studio-document')).replace(/[\\/:*?"<>|]/g, '-').slice(0, 100)}.pdf`;
      let result;
      if (window.pdfStudio?.saveFile) result = await window.pdfStudio.saveFile({ name, data: bytes, filters: [{ name: 'PDF document', extensions: ['pdf'] }] });
      else result = await saveInBrowser(bytes, name, 'application/pdf');
      if (result?.canceled) return;
      setModal(null);
      notify(`PDF exported${result?.filePath ? ` to ${result.filePath}` : ''}.`);
    } catch (error) { console.error(error); notify(error?.message || 'PDF export failed.', 'error'); }
    finally { setIsLoading(false); setLoadingLabel('Preparing your workspace'); }
  }, [documents, exportAuthor, exportPageNumbers, exportTitle, exportWatermark, notify, pages, selectedPages]);

  const saveInBrowser = async (data, name, mime) => {
    const blob = new Blob([data], { type: mime || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = name; link.click();
    URL.revokeObjectURL(url);
    return { canceled: false };
  };

  const convertToWord = useCallback(async () => {
    if (!pages.length) return notify('Open a PDF before converting it to Word.', 'info');
    setIsLoading(true); setLoadingLabel('Extracting text and preparing DOCX');
    try {
      const pdfBytes = await composePdf(pages, sourcesRef.current, { title: 'Converted PDF', author: exportAuthor });
      const docxBytes = await pdfToDocx(pdfBytes);
      const baseName = (exportTitle || 'PDF-Studio-converted').replace(/[\\/:*?"<>|]/g, '-').slice(0, 100);
      const result = window.pdfStudio?.saveFile ? await window.pdfStudio.saveFile({ name: `${baseName}.docx`, data: docxBytes, filters: [{ name: 'Word document', extensions: ['docx'] }] }) : await saveInBrowser(docxBytes, `${baseName}.docx`, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      if (!result?.canceled) { setModal(null); notify('Editable Word document exported. Complex layouts and images may need manual adjustment.'); }
    } catch (error) { console.error(error); notify(error?.message || 'PDF-to-Word conversion failed.', 'error'); }
    finally { setIsLoading(false); setLoadingLabel('Preparing your workspace'); }
  }, [exportAuthor, exportTitle, notify, pages]);

  const convertToImages = useCallback(async () => {
    if (!pages.length) return notify('Open a document before exporting images.', 'info');
    const exportPages = selectedPages.length > 0 ? selectedPages : pages;
    setIsLoading(true); setLoadingLabel('Rendering pages as images');
    try {
      const pdfBytes = await composePdf(exportPages, sourcesRef.current, { title: 'PDF Studio image export', author: exportAuthor });
      const pdf = await loadPdfSource(pdfBytes);
      const sourceId = uid();
      const map = new Map([[sourceId, { id: sourceId, name: 'Export', mime: 'application/pdf', kind: 'pdf', bytes: pdfBytes, pdf }]]);
      const rasterPages = Array.from({ length: pdf.numPages }, (_, index) => ({ id: uid(), sourceId, kind: 'pdf', sourcePageIndex: index, rotation: 0, overlays: [] }));
      const outputs = await renderPdfImages(map, rasterPages, { format: imageFormat, quality: Number(imageQuality) / 100, maxDimension: 1900 });
      if (window.pdfStudio?.saveBatch) {
        const result = await window.pdfStudio.saveBatch(outputs);
        if (result?.canceled) return;
        setModal(null); notify(`${result.count} image${result.count === 1 ? '' : 's'} exported to ${result.folder}.`);
      } else {
        for (const output of outputs) await saveInBrowser(output.data, output.name, imageFormat === 'jpeg' ? 'image/jpeg' : 'image/png');
        setModal(null); notify(`${outputs.length} images exported.`);
      }
    } catch (error) { console.error(error); notify(error?.message || 'Image export failed.', 'error'); }
    finally { setIsLoading(false); setLoadingLabel('Preparing your workspace'); }
  }, [exportAuthor, imageFormat, imageQuality, notify, pages, selectedPages]);

  const splitPdf = useCallback(async () => {
    if (!pages.length) return notify('Open a PDF before splitting.', 'info');
    let groups = [];
    if (splitMode === 'each') groups = pages.map((page) => [page]);
    else if (splitMode === 'every') {
      const size = Math.max(1, Math.min(500, Number(splitEvery) || 2));
      for (let index = 0; index < pages.length; index += size) groups.push(pages.slice(index, index + size));
    } else {
      const ranges = splitRanges.split(',').map((part) => part.trim()).filter(Boolean);
      for (const range of ranges) {
        const match = range.match(/^(\d+)\s*(?:-\s*(\d+))?$/);
        if (!match) return notify(`Invalid page range: “${range}”. Use values such as 1-3, 5, 8-10.`, 'error');
        const start = Number(match[1]); const end = Number(match[2] || match[1]);
        if (start < 1 || end < start || end > pages.length) return notify(`Range “${range}” is outside the current 1–${pages.length} page workspace.`, 'error');
        groups.push(pages.slice(start - 1, end));
      }
    }
    setIsLoading(true); setLoadingLabel('Preparing split files');
    try {
      const outputs = [];
      for (let index = 0; index < groups.length; index += 1) {
        const bytes = await composePdf(groups[index], sourcesRef.current, { title: `PDF Studio split ${index + 1}`, author: exportAuthor });
        outputs.push({ name: `split-${String(index + 1).padStart(2, '0')}.pdf`, data: bytes });
      }
      if (window.pdfStudio?.saveBatch) {
        const result = await window.pdfStudio.saveBatch(outputs);
        if (result?.canceled) return;
        setModal(null); notify(`${result.count} PDF file${result.count === 1 ? '' : 's'} saved to ${result.folder}.`);
      } else {
        for (const output of outputs) await saveInBrowser(output.data, output.name, 'application/pdf');
        setModal(null); notify(`${outputs.length} split files exported.`);
      }
    } catch (error) { console.error(error); notify(error?.message || 'Could not split this workspace.', 'error'); }
    finally { setIsLoading(false); setLoadingLabel('Preparing your workspace'); }
  }, [exportAuthor, notify, pages, splitEvery, splitMode, splitRanges]);

  const removeDocument = useCallback((documentId) => {
    commitPages((current) => current.filter((page) => page.sourceId !== documentId));
    sourcesRef.current.delete(documentId);
    setDocuments((current) => current.filter((document) => document.id !== documentId));
    setSourceRevision((n) => n + 1);
    notify('Source removed from the workspace.', 'info');
  }, [commitPages, notify]);

  useEffect(() => {
    const onKeyDown = (event) => {
      const target = event.target;
      const editing = target && (target.matches('input, textarea, select') || target.isContentEditable);
      if (event.key === 'Escape') { if (modal) setModal(null); return; }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'o') { event.preventDefault(); chooseFiles(); return; }
      if ((event.ctrlKey || event.metaKey) && ['1', '2', '3', '4'].includes(event.key)) {
        event.preventDefault();
        const destination = { '1': 'home', '2': 'workspace', '3': 'convert', '4': 'history' }[event.key];
        setMode(destination);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); if (pagesRef.current.length) setModal({ type: 'export' }); return; }
      if (!editing && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) redo(); else undo(); return; }
      if (!editing && (event.key === 'Delete' || event.key === 'Backspace')) { if (selectedIds.length) { event.preventDefault(); deleteSelected(); } }
      if (!editing && event.key === 'ArrowLeft' && activePage) { const i = pagesRef.current.findIndex((page) => page.id === activePage.id); if (i > 0) { setActiveId(pagesRef.current[i - 1].id); setSelectedIds([pagesRef.current[i - 1].id]); } }
      if (!editing && event.key === 'ArrowRight' && activePage) { const i = pagesRef.current.findIndex((page) => page.id === activePage.id); if (i < pagesRef.current.length - 1) { setActiveId(pagesRef.current[i + 1].id); setSelectedIds([pagesRef.current[i + 1].id]); } }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activePage, chooseFiles, deleteSelected, modal, redo, selectedIds, undo]);

  const handleDropFiles = async (event) => {
    event.preventDefault();
    const files = [...(event.dataTransfer?.files || [])];
    if (files.length) await handleBrowserFiles(files);
  };

  const startTool = (tool) => {
    if (tool.action === 'word') { if (!pages.length) chooseFiles(); else setModal({ type: 'word' }); }
    else if (tool.action === 'images') { if (!pages.length) chooseFiles(); else setModal({ type: 'images' }); }
    else { setMode(tool.mode || 'workspace'); if (!pages.length) chooseFiles(); }
  };

  return <div className={cx('app-shell', dark && 'theme-dark')} onDragOver={(event) => event.preventDefault()} onDrop={handleDropFiles}>
    <input ref={fileInputRef} type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.webp,.bmp,.gif,.tif,.tiff,.docx" className="hidden-input" onChange={(event) => { if (event.target.files?.length) handleBrowserFiles(event.target.files); event.target.value = ''; }} />

    <header className="titlebar">
      <div className="titlebar-brand" onClick={() => setMode('home')} role="button" tabIndex={0}>
        <div className="brand-mark"><FileStack size={19} strokeWidth={2.3} /><span className="brand-spark">✦</span></div>
        <div className="brand-wordmark"><strong>PDF<span>Studio</span></strong><small>DESKTOP WORKSPACE</small></div>
      </div>
      <div className="titlebar-center"><span className="titlebar-dot" /> Local workspace <span className="titlebar-separator">/</span> {mode === 'home' ? 'Overview' : mode === 'workspace' ? 'Page workspace' : mode === 'settings' ? 'Preferences' : mode === 'convert' ? 'Conversion studio' : mode === 'history' ? 'Recent sources' : 'Workspace'}</div>
      <div className="window-controls">
        <button type="button" title="Minimize" onClick={() => window.pdfStudio?.minimize?.()}><Minus size={14} /></button>
        <button type="button" title={maximized ? 'Restore' : 'Maximize'} onClick={() => window.pdfStudio?.toggleMaximize?.()}>{maximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />}</button>
        <button type="button" title="Close" className="window-close" onClick={() => window.pdfStudio?.close?.()}><X size={15} /></button>
      </div>
    </header>

    <div className="app-body">
      <aside className="sidebar">
        <div className="sidebar-scroll">
          <SectionLabel>Workspace</SectionLabel>
          <button title="Overview (Ctrl/Cmd+1)" aria-label="Overview" aria-current={mode === 'home' ? 'page' : undefined} className={cx('nav-item', mode === 'home' && 'nav-active')} onClick={() => setMode('home')}><LayoutDashboard size={17} /><span>Overview</span><span className="nav-key">⌘ 1</span></button>
          <button title="Page workspace (Ctrl/Cmd+2)" aria-label="Page workspace" aria-current={mode === 'workspace' ? 'page' : undefined} className={cx('nav-item', mode === 'workspace' && 'nav-active')} onClick={() => setMode('workspace')}><Files size={17} /><span>Page workspace</span>{pages.length > 0 && <span className="nav-count">{pages.length}</span>}</button>
          <button title="Conversion studio (Ctrl/Cmd+3)" aria-label="Conversion studio" aria-current={mode === 'convert' ? 'page' : undefined} className={cx('nav-item', mode === 'convert' && 'nav-active')} onClick={() => setMode('convert')}><WandSparkles size={17} /><span>Convert files</span><span className="nav-new">TOOLS</span></button>
          <button title="Recent sources (Ctrl/Cmd+4)" aria-label="Recent sources" aria-current={mode === 'history' ? 'page' : undefined} className={cx('nav-item', mode === 'history' && 'nav-active')} onClick={() => setMode('history')}><History size={17} /><span>Recent sources</span></button>

          <div className="sidebar-divider" />
          <SectionLabel trailing={<IconButton icon={Plus} label="Add documents" size={15} onClick={chooseFiles} />} >Your documents</SectionLabel>
          {documents.length === 0 ? <button className="empty-docs-link" onClick={chooseFiles}><FolderOpen size={17} /><span>Add your first file</span><ChevronRight size={14} /></button> : <div className="document-list">
            {documents.map((document) => <div className={cx('document-list-item', currentDocument?.id === document.id && 'document-current')} key={document.id}>
              <div className={cx('file-type-mini', document.kind === 'pdf' ? 'file-pdf' : 'file-image')}>{document.kind === 'pdf' ? <FileText size={14} /> : <FileImage size={14} />}</div>
              <button className="document-label" title={document.name} onClick={() => {
                const page = pages.find((item) => item.sourceId === document.id);
                if (page) { setActiveId(page.id); setSelectedIds([page.id]); setMode('workspace'); }
              }}><span>{document.name}</span><small>{document.pageCount} {document.pageCount === 1 ? 'page' : 'pages'} · {formatBytes(document.size)}</small></button>
              <IconButton icon={X} label={`Remove ${document.name}`} size={13} className="document-remove" onClick={() => removeDocument(document.id)} />
            </div>)}
          </div>}

          <div className="sidebar-divider" />
          <SectionLabel>Quick tools</SectionLabel>
          <button className="quick-nav" onClick={() => setModal({ type: 'split' })} disabled={!pages.length}><span className="quick-icon quick-violet"><Split size={15} /></span><span>Split PDF</span></button>
          <button className="quick-nav" onClick={() => setModal({ type: 'word' })} disabled={!pages.length}><span className="quick-icon quick-blue"><FileText size={15} /></span><span>PDF to Word</span></button>
          <button className="quick-nav" onClick={() => setModal({ type: 'images' })} disabled={!pages.length}><span className="quick-icon quick-orange"><FileImage size={15} /></span><span>Export images</span></button>
        </div>
        <div className="sidebar-footer">
          <div className="privacy-card"><div className="privacy-icon"><ShieldCheck size={17} /></div><div><strong>Your files stay yours</strong><p>Processed on this device. No uploads.</p></div><CheckCircle2 size={15} className="privacy-check" /></div>
          <button className="account-row" onClick={() => setMode('settings')}><div className="account-avatar">JA</div><div className="account-meta"><strong>PDF Studio</strong><small>Personal workspace · v{appVersion}</small></div><Settings2 size={16} className="account-settings" /></button>
        </div>
      </aside>

      <main className="main-panel">
        <div className="topbar">
          <div className="breadcrumbs"><span onClick={() => setMode('home')}>Studio</span><ChevronRight size={14} /><strong>{mode === 'home' ? 'Overview' : mode === 'workspace' ? 'Page workspace' : mode === 'convert' ? 'Conversion studio' : mode === 'history' ? 'Recent sources' : 'Preferences'}</strong>{activePage && mode === 'workspace' && <><ChevronRight size={14} /><span className="crumb-muted">{activePage.sourceName}</span></>}</div>
          <div className="topbar-actions"><div className="local-badge"><span /> Saved locally</div><IconButton icon={dark ? Sun : Moon} label={dark ? 'Switch to light theme' : 'Switch to dark theme'} onClick={() => setDark((value) => !value)} /><IconButton icon={CircleHelp} label="About PDF Studio" onClick={() => setModal({ type: 'about' })} /></div>
        </div>

        {mode === 'home' && <section className="home-view animate-fade-up">
          <div className="welcome-row"><div><div className="eyebrow welcome-eyebrow"><Sparkles size={13} /> YOUR DOCUMENT SPACE</div><h1>Your next document<br /><span>starts here.</span></h1><p>A thoughtful toolkit for organising, editing and transforming PDFs — without sending your files anywhere.</p><div className="welcome-actions"><ActionButton icon={Plus} variant="primary" onClick={chooseFiles}>Open documents <span className="shortcut-hint">Ctrl O</span></ActionButton><ActionButton icon={FolderOpen} onClick={() => setMode('workspace')}>Go to workspace</ActionButton></div></div><div className="hero-art" aria-hidden="true"><div className="hero-orbit orbit-one"/><div className="hero-orbit orbit-two"/><div className="hero-spark spark-a">✦</div><div className="hero-spark spark-b">✧</div><div className="hero-back-sheet sheet-a"/><div className="hero-back-sheet sheet-b"/><div className="hero-document"><div className="hero-doc-top"><span>PDF</span><FileText size={19} /></div><div className="hero-doc-line line-wide"/><div className="hero-doc-line"/><div className="hero-doc-line line-short"/><div className="hero-chart"><i/><i/><i/><i/><i/><i/></div><div className="hero-doc-foot"><span>DOCUMENT</span><span>01 / 12</span></div></div><div className="hero-float-badge"><span><Check size={15} /></span><div><strong>Ready to export</strong><small>Everything in one place</small></div></div><div className="hero-float-type"><FileStack size={17} /><span>PDF + Images</span></div></div></div>

          <div className="home-stats"><div className="stat-card"><span className="stat-icon stat-purple"><Files size={17} /></span><div><small>Pages in workspace</small><strong>{pages.length}</strong></div><span className="stat-foot">Current session</span></div><div className="stat-card"><span className="stat-icon stat-mint"><HardDrive size={17} /></span><div><small>Sources opened</small><strong>{documents.length}</strong></div><span className="stat-foot">Local files</span></div><div className="stat-card"><span className="stat-icon stat-orange"><Activity size={17} /></span><div><small>Workspace status</small><strong className="status-ready">Ready to work</strong></div><span className="stat-foot"><span className="online-dot" /> All systems ready</span></div></div>

          <div className="section-heading"><div><h2>What would you like to do?</h2><p>Start with a task or open a file to unlock the full workspace.</p></div><span className="section-heading-note"><Sparkles size={14} /> Built for focused work</span></div>
          <div className="tool-card-grid">{initialTools.map((tool) => <button key={tool.label} className="tool-card" onClick={() => startTool(tool)}><div className={cx('tool-card-icon', `tone-${tool.tone}`)}><tool.icon size={21} strokeWidth={1.8} /></div><div className="tool-card-copy"><strong>{tool.label}</strong><span>{tool.description}</span></div><span className="tool-card-arrow"><ArrowUpRight size={17} /></span></button>)}</div>
          <div className="bottom-callout"><div className="callout-glyph"><LockKeyhole size={19} /></div><div><strong>Private by design.</strong><span>Your documents are processed locally on your computer. PDF Studio does not upload them to a cloud service.</span></div><button onClick={() => setModal({ type: 'about' })}>Learn more <ArrowRight size={14} /></button></div>
        </section>}

        {mode === 'workspace' && <section className="workspace-view animate-fade-up">
          <div className="workspace-heading"><div><div className="eyebrow"><span className="eyebrow-dot" /> PAGE MANAGEMENT</div><h1>Page workspace</h1><p>Arrange your pages exactly how you want them. Drag to reorder, select multiple pages, then export a clean PDF.</p></div><div className="workspace-heading-actions"><ActionButton icon={FolderOpen} onClick={chooseFiles}>Add files</ActionButton><ActionButton icon={Download} variant="primary" disabled={!pages.length} onClick={() => setModal({ type: 'export' })}>Export PDF <ChevronDown size={14} /></ActionButton></div></div>
          {pages.length === 0 ? <div className="workspace-empty"><div className="empty-illustration"><div className="empty-sheet sheet-back"/><div className="empty-sheet sheet-middle"/><div className="empty-sheet sheet-front"><FilePlus2 size={32} /></div><span className="empty-plus"><Plus size={14} /></span></div><h2>Make room for your pages</h2><p>Bring PDFs and images into one workspace, reorder them, then export everything as a single PDF.</p><ActionButton icon={Upload} variant="primary" onClick={chooseFiles}>Choose files</ActionButton><span className="empty-or">or drop files anywhere in this window</span></div> : <>
            <div className="workspace-toolbar"><div className="toolbar-group"><IconButton icon={Undo2} label="Undo (Ctrl+Z)" onClick={undo} disabled={!historyRef.current.length} /><IconButton icon={Redo2} label="Redo (Ctrl+Shift+Z)" onClick={redo} disabled={!redoRef.current.length} /><span className="toolbar-rule"/><IconButton icon={RotateCcw} label="Rotate left" onClick={() => rotateSelected(-90)} disabled={!selectedIds.length && !activePage} /><IconButton icon={RotateCw} label="Rotate right" onClick={() => rotateSelected(90)} disabled={!selectedIds.length && !activePage} /><IconButton icon={Copy} label="Duplicate selected pages" onClick={duplicateSelected} disabled={!pages.length} /><IconButton icon={Trash2} label="Delete selected pages" onClick={deleteSelected} disabled={!selectedIds.length} /></div><div className="toolbar-group"><span className="selection-indicator">{selectedIds.length || 0} selected</span><span className="toolbar-rule"/><IconButton icon={Type} label="Add text overlay" onClick={() => setModal({ type: 'text' })} disabled={!pages.length} /><IconButton icon={LockKeyhole} label="Add cover block" onClick={() => setModal({ type: 'cover' })} disabled={!pages.length} /><IconButton icon={Plus} label="Insert blank page" onClick={addBlankPage} /><span className="toolbar-rule"/><IconButton icon={PanelRightClose} label="Hide preview panel" active={showInspector} onClick={() => setShowInspector((value) => !value)} /></div></div>
            <div className={cx('workspace-content', !showInspector && 'inspector-hidden')}>
              <div className="page-grid-panel"><div className="page-grid-toolbar"><div className="page-grid-title"><strong>Pages <span>{pages.length}</span></strong><small>{search.trim() ? 'Clear search to reorder pages' : 'Drag tiles to reorder · use arrows for precise moves'}</small></div><div className="page-grid-options"><div className="search-field"><Search size={14} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a page..." aria-label="Find a page" />{search && <button onClick={() => setSearch('')}><X size={12}/></button>}</div><IconButton icon={ListFilter} label="Reverse page order" onClick={() => commitPages([...pagesRef.current].reverse())} /></div></div>
                <div className="page-grid-scroll"><div className="page-grid">{filteredPages.map((page) => {
                  const pageIndex = pages.findIndex((item) => item.id === page.id);
                  const selected = selectedIds.includes(page.id);
                  const cuePosition = dropCue?.id === page.id ? dropCue.position : null;
                  const pageNumber = String(pageIndex + 1).padStart(2, '0');
                  return <div key={page.id}
                    className={cx('page-card', selected && 'page-selected', activeId === page.id && 'page-active', draggingPageId === page.id && 'page-dragging', cuePosition === 'before' && 'drop-before', cuePosition === 'after' && 'drop-after')}
                    draggable={!search.trim()}
                    aria-label={`Page ${pageIndex + 1}. Drag to reorder. Click to select.`}
                    title={search.trim() ? 'Clear the page search to reorder pages' : 'Drag this page to reorder it'}
                    onDragStart={(event) => {
                      if (search.trim()) { event.preventDefault(); return; }
                      setDraggingPageId(page.id);
                      suppressPageClickUntil.current = Date.now() + 350;
                      setDropCue(null);
                      event.dataTransfer.effectAllowed = 'move';
                      event.dataTransfer.setData('application/x-pdfstudio-page', page.id);
                      event.dataTransfer.setData('text/plain', page.id);
                      try { event.dataTransfer.setDragImage(event.currentTarget, 32, 28); } catch { /* Drag-image support varies by platform. */ }
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
                  </div>;
                })}
                <button type="button" className={cx('page-add-card', dropCue?.id === '__end__' && 'page-add-hover')} onClick={chooseFiles} onDragOver={(event) => {
                  const draggedId = event.dataTransfer?.getData('application/x-pdfstudio-page') || draggingPageId;
                  if (draggedId) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDropCue((cue) => cue?.id === '__end__' ? cue : { id: '__end__', position: 'after' }); }
                  else if (Array.from(event.dataTransfer?.types || []).includes('Files')) { event.preventDefault(); event.currentTarget.classList.add('page-add-hover'); }
                }} onDragLeave={(event) => { event.currentTarget.classList.remove('page-add-hover'); setDropCue((cue) => cue?.id === '__end__' ? null : cue); }} onDrop={(event) => {
                  const draggedId = event.dataTransfer?.getData('application/x-pdfstudio-page') || draggingPageId;
                  event.currentTarget.classList.remove('page-add-hover');
                  if (draggedId && pagesRef.current.length) { event.preventDefault(); event.stopPropagation(); const lastPage = pagesRef.current[pagesRef.current.length - 1]; movePage(draggedId, lastPage.id, 'after'); }
                  else if (event.dataTransfer?.files?.length) { event.preventDefault(); event.stopPropagation(); handleBrowserFiles([...event.dataTransfer.files]); }
                  setDropCue(null);
                }} aria-label="Add PDF or image pages">
                  <span className="page-add-icon"><Plus size={24} strokeWidth={1.8} /></span><strong>Add pages</strong><span>PDF or image</span><kbd>Browse files</kbd>
                </button>
                </div>{filteredPages.length === 0 && <div className="no-search-results"><Search size={22}/><strong>No pages match “{search}”</strong><button onClick={() => setSearch('')}>Clear search</button></div>}</div>
                <div className="page-grid-bottom"><span><GripVertical size={13} /> {pages.length} pages total</span><span>Shift-click range <b>·</b> Ctrl/Cmd-click multiple <b>·</b> Drop at + to move to end</span></div>
              </div>
              {showInspector && <aside className="inspector-panel"><div className="inspector-head"><div><div className="eyebrow">LIVE PREVIEW</div><h3>Page details</h3></div><IconButton icon={PanelRightOpen} label="Hide preview" onClick={() => setShowInspector(false)} /></div>
                {activePage ? <><div className="inspector-page-meta"><div className="inspector-doc-icon"><FileText size={17} /></div><div className="inspector-doc-copy"><strong>Page {pages.findIndex((page) => page.id === activePage.id) + 1}</strong><span title={activePage.sourceName}>{activePage.sourceName}</span></div><span className="inspector-page-count">{pages.findIndex((page) => page.id === activePage.id) + 1} / {pages.length}</span></div>
                <div className="inspector-preview-wrap"><PagePreview page={activePage} sources={sourcesRef.current} zoom={previewZoom} onAddText={() => setModal({ type: 'text' })} onAddBlock={() => setModal({ type: 'cover' })} /></div>
                <div className="preview-zoom-row"><span><ZoomIn size={14} /> Preview scale</span><div><button onClick={() => setPreviewZoom((value) => Math.max(0.6, +(value - 0.1).toFixed(1)))} disabled={previewZoom <= 0.6}><ZoomOut size={13}/></button><span>{Math.round(previewZoom * 100)}%</span><button onClick={() => setPreviewZoom((value) => Math.min(1.4, +(value + 0.1).toFixed(1)))} disabled={previewZoom >= 1.4}><ZoomIn size={13}/></button></div></div>
                <div className="inspector-properties"><SectionLabel>Page properties</SectionLabel><div className="property-row"><span>Position in document</span><strong>{String(pages.findIndex((page) => page.id === activePage.id) + 1).padStart(2, '0')} <span className="property-total">/ {pages.length}</span></strong></div><div className="property-row"><span>Source type</span><strong>{activePage.kind === 'pdf' ? 'PDF document' : activePage.kind === 'image' ? 'Image file' : 'Blank page'}</strong></div><div className="property-row"><span>Orientation</span><strong>{activePage.rotation % 180 === 0 ? 'Portrait' : 'Landscape'}</strong></div><div className="property-row"><span>Overlay objects</span><strong>{activePage.overlays?.length || 0}</strong></div></div>
                <div className="inspector-actions"><ActionButton icon={RotateCcw} onClick={() => { setSelectedIds([activePage.id]); rotateSelected(-90); }}>Rotate left</ActionButton><ActionButton icon={Scissors} onClick={() => { setSelectedIds([activePage.id]); setModal({ type: 'export-selected' }); }}>Export page</ActionButton></div></> : <div className="inspector-empty"><FileText size={30}/><p>Select a page to preview it here.</p></div>}
              </aside>}
            </div>
          </>}
        </section>}

        {mode === 'convert' && <section className="conversion-view animate-fade-up"><div className="workspace-heading"><div><div className="eyebrow"><Sparkles size={13} /> CONVERSION STUDIO</div><h1>Make your files work harder.</h1><p>Convert your current workspace or open a file to get started. Conversion runs locally on your device.</p></div><ActionButton icon={FolderOpen} onClick={chooseFiles}>Add files</ActionButton></div><div className="conversion-grid">
          <button className="conversion-card" onClick={() => pages.length ? setModal({ type: 'word' }) : chooseFiles()}><div className="conversion-card-art art-word"><FileText size={38}/><span>W</span></div><div className="conversion-card-body"><span className="conversion-tag">EDITABLE TEXT</span><h3>PDF to Word</h3><p>Extract selectable text into a DOCX document with page breaks. Complex layouts may need a little cleanup.</p><div className="conversion-card-action">Convert to .docx <ArrowRight size={15}/></div></div></button>
          <button className="conversion-card" onClick={() => pages.length ? setModal({ type: 'images' }) : chooseFiles()}><div className="conversion-card-art art-image"><FileImage size={38}/><span>PNG</span></div><div className="conversion-card-body"><span className="conversion-tag">HIGH-QUALITY OUTPUT</span><h3>PDF to images</h3><p>Render each current page to PNG or JPG. Great for sharing a page or preparing a visual preview.</p><div className="conversion-card-action">Export images <ArrowRight size={15}/></div></div></button>
          <button className="conversion-card" onClick={chooseFiles}><div className="conversion-card-art art-doc"><ImagePlus size={38}/><span>JPG</span></div><div className="conversion-card-body"><span className="conversion-tag">IMAGE WORKFLOW</span><h3>Images to PDF</h3><p>Open PNG, JPG, WEBP, BMP or GIF files. Image pages join the same sortable workspace.</p><div className="conversion-card-action">Choose images <ArrowRight size={15}/></div></div></button>
          <button className="conversion-card" onClick={() => pages.length ? setModal({ type: 'split' }) : chooseFiles()}><div className="conversion-card-art art-split"><Split size={38}/><span>01 / 02</span></div><div className="conversion-card-body"><span className="conversion-tag">PAGE CONTROL</span><h3>Split PDF</h3><p>Split the current workspace into individual pages, fixed page groups, or custom page ranges.</p><div className="conversion-card-action">Configure split <ArrowRight size={15}/></div></div></button>
        </div><div className="conversion-footnote"><ShieldCheck size={17}/><span><strong>Local-first processing.</strong> Files are opened and transformed on this computer. No cloud upload or account is required.</span></div></section>}

        {mode === 'history' && <section className="history-view animate-fade-up"><div className="workspace-heading"><div><div className="eyebrow">YOUR LOCAL SESSION</div><h1>Recent sources</h1><p>Files currently loaded into this workspace.</p></div><ActionButton icon={FolderOpen} onClick={chooseFiles}>Add files</ActionButton></div>{documents.length ? <div className="history-table"><div className="history-table-head"><span>DOCUMENT</span><span>TYPE</span><span>SIZE</span><span>PAGES</span><span /></div>{documents.map((document) => <div className="history-table-row" key={document.id}><div className="history-file"><div className={cx('file-type-mini', document.kind === 'pdf' ? 'file-pdf' : 'file-image')}>{document.kind === 'pdf' ? <FileText size={15}/> : <FileImage size={15}/>}</div><div><strong>{document.name}</strong><small>{document.path || 'Added to current session'}</small></div></div><span>{extName(document.name)}</span><span>{formatBytes(document.size)}</span><span>{document.pageCount}</span><ActionButton icon={ArrowRight} onClick={() => { const p = pages.find((page) => page.sourceId === document.id); if (p) { setActiveId(p.id); setSelectedIds([p.id]); setMode('workspace'); } }}>Open</ActionButton></div>)}</div> : <div className="history-empty"><Clock3 size={30}/><h3>No sources yet</h3><p>Files that you open in PDF Studio will appear here for this session.</p><ActionButton icon={FolderOpen} variant="primary" onClick={chooseFiles}>Open files</ActionButton></div>}</section>}

        {mode === 'settings' && <section className="settings-view animate-fade-up"><div className="workspace-heading"><div><div className="eyebrow">PERSONALIZE YOUR WORKSPACE</div><h1>Preferences</h1><p>Make PDF Studio feel right for the way you work.</p></div></div><div className="settings-card"><div className="settings-card-heading"><span className="settings-symbol"><Sun size={18}/></span><div><h3>Appearance</h3><p>Choose a comfortable theme for your workspace.</p></div></div><div className="theme-choice-row"><button className={cx('theme-choice', !dark && 'theme-choice-active')} onClick={() => setDark(false)}><span className="theme-preview theme-preview-light"><i/><i/><i/></span><span><strong>Light</strong><small>Clear, bright surfaces</small></span>{!dark && <CheckCircle2 size={17}/>}</button><button className={cx('theme-choice', dark && 'theme-choice-active')} onClick={() => setDark(true)}><span className="theme-preview theme-preview-dark"><i/><i/><i/></span><span><strong>Dark</strong><small>Low-light workspace</small></span>{dark && <CheckCircle2 size={17}/>}</button></div><div className="settings-card-heading settings-security"><span className="settings-symbol settings-symbol-green"><ShieldCheck size={18}/></span><div><h3>Privacy and files</h3><p>All file work stays on your device. There is no sign-in and no cloud upload in this build.</p></div></div><div className="settings-version"><span>PDF Studio Cross-platform</span><strong>Version {appVersion}</strong></div></div></section>}
      </main>
    </div>

    {isLoading && <div className="loading-overlay"><div className="loading-card"><div className="loading-spinner"><span/><span/><span/></div><strong>{loadingLabel}</strong><span>Keeping everything on this device</span></div></div>}
    {toast && <div className={cx('toast-message', `toast-${toast.kind}`)}><span className="toast-icon">{toast.kind === 'error' ? <X size={15}/> : toast.kind === 'info' ? <Activity size={15}/> : <Check size={15}/>}</span><span>{toast.message}</span><button onClick={() => setToast(null)}><X size={13}/></button></div>}

    {modal?.type === 'export' && <Modal title="Export PDF" eyebrow="FINALIZE YOUR DOCUMENT" onClose={() => setModal(null)} footer={<><ActionButton onClick={() => setModal(null)}>Cancel</ActionButton><ActionButton variant="primary" icon={Download} onClick={() => doExportPdf(false)}>Export {pages.length} pages</ActionButton></>}>
      <div className="modal-intro"><div className="modal-hero-icon modal-hero-purple"><FileCheck2 size={22}/></div><div><strong>Ready for its next destination.</strong><p>Your page order, rotations and current overlays will be included in the exported PDF.</p></div></div>
      <label className="form-label">Document title<input className="form-input" value={exportTitle} onChange={(event) => setExportTitle(event.target.value)} placeholder="My final document" /></label>
      <label className="form-label">Author<input className="form-input" value={exportAuthor} onChange={(event) => setExportAuthor(event.target.value)} placeholder="PDF Studio" /></label>
      <div className="form-options"><label className="check-option"><input type="checkbox" checked={exportPageNumbers} onChange={(event) => setExportPageNumbers(event.target.checked)}/><span><strong>Add page numbers</strong><small>Place a small number at the bottom of each page.</small></span></label><label className="form-label">Text watermark <input className="form-input" value={exportWatermark} onChange={(event) => setExportWatermark(event.target.value)} placeholder="Optional · e.g. DRAFT" /></label></div>
      <div className="modal-note"><ShieldCheck size={15}/><span>PDF export runs locally. Password encryption and guaranteed file-size reduction are not included in this rebuild yet.</span></div>
    </Modal>}

    {modal?.type === 'export-selected' && <Modal title="Export selected page" eyebrow="QUICK EXPORT" onClose={() => setModal(null)} footer={<><ActionButton onClick={() => setModal(null)}>Cancel</ActionButton><ActionButton variant="primary" icon={Download} onClick={() => doExportPdf(true)}>Save selected PDF</ActionButton></>}><div className="modal-intro"><div className="modal-hero-icon modal-hero-blue"><FileText size={22}/></div><div><strong>{selectedPages.length || 1} page{(selectedPages.length || 1) === 1 ? '' : 's'} selected</strong><p>Export the selected page(s) as a separate PDF, retaining their current order.</p></div></div></Modal>}

    {modal?.type === 'word' && <Modal title="Convert PDF to Word" eyebrow="EDITABLE DOCUMENT" onClose={() => setModal(null)} footer={<><ActionButton onClick={() => setModal(null)}>Cancel</ActionButton><ActionButton variant="primary" icon={FileText} onClick={convertToWord}>Create DOCX</ActionButton></>}><div className="modal-intro"><div className="modal-hero-icon modal-hero-blue"><FileText size={22}/></div><div><strong>Create an editable Word document</strong><p>PDF Studio extracts selectable text and arranges it into editable paragraphs with page breaks.</p></div></div><div className="conversion-summary"><div><span>Pages to convert</span><strong>{pages.length}</strong></div><div><span>Output format</span><strong>.DOCX</strong></div><div><span>Processing</span><strong>On this device</strong></div></div><div className="modal-note"><Activity size={15}/><span>Text extraction is best for digital PDFs. Scanned pages without an OCR text layer and complex tables/images may not convert accurately.</span></div></Modal>}

    {modal?.type === 'images' && <Modal title="Export pages as images" eyebrow="IMAGE EXPORT" onClose={() => setModal(null)} footer={<><ActionButton onClick={() => setModal(null)}>Cancel</ActionButton><ActionButton variant="primary" icon={Download} onClick={convertToImages}>Export {selectedPages.length ? selectedPages.length : pages.length} pages</ActionButton></>}><div className="modal-intro"><div className="modal-hero-icon modal-hero-orange"><FileImage size={22}/></div><div><strong>Make each page a shareable image</strong><p>{selectedPages.length ? 'Only your selected pages will be exported.' : 'No page selection found, so all pages in the workspace will be exported.'}</p></div></div><label className="form-label">Image format<div className="segmented-choice"><button className={cx(imageFormat === 'png' && 'segment-active')} onClick={() => setImageFormat('png')}><span>PNG</span><small>Sharper text</small></button><button className={cx(imageFormat === 'jpeg' && 'segment-active')} onClick={() => setImageFormat('jpeg')}><span>JPEG</span><small>Smaller photos</small></button></div></label>{imageFormat === 'jpeg' && <label className="form-label">JPEG quality <div className="range-row"><input type="range" min="40" max="100" value={imageQuality} onChange={(event) => setImageQuality(event.target.value)}/><strong>{imageQuality}%</strong></div></label>}<div className="modal-note"><HardDrive size={15}/><span>Choose an output folder in the next step. Each page will be rendered at high resolution.</span></div></Modal>}

    {modal?.type === 'split' && <Modal title="Split workspace" eyebrow="CREATE SEPARATE PDFS" onClose={() => setModal(null)} footer={<><ActionButton onClick={() => setModal(null)}>Cancel</ActionButton><ActionButton variant="primary" icon={Split} onClick={splitPdf}>Split into files</ActionButton></>}><div className="modal-intro"><div className="modal-hero-icon modal-hero-purple"><Split size={22}/></div><div><strong>Choose how to split your {pages.length}-page workspace</strong><p>Each output will be saved as a separate PDF in the folder you choose.</p></div></div><div className="split-options"><label className={cx('split-option', splitMode === 'each' && 'split-option-active')}><input type="radio" checked={splitMode === 'each'} onChange={() => setSplitMode('each')}/><span><strong>Every page</strong><small>{pages.length} separate PDF files</small></span><Files size={17}/></label><label className={cx('split-option', splitMode === 'every' && 'split-option-active')}><input type="radio" checked={splitMode === 'every'} onChange={() => setSplitMode('every')}/><span><strong>Group pages</strong><small>Create a new PDF after every N pages</small></span><input className="compact-number" type="number" min="1" max="500" value={splitEvery} onChange={(event) => { setSplitEvery(event.target.value); setSplitMode('every'); }}/></label><label className={cx('split-option', splitMode === 'ranges' && 'split-option-active')}><input type="radio" checked={splitMode === 'ranges'} onChange={() => setSplitMode('ranges')}/><span><strong>Custom ranges</strong><small>For example: 1-3, 4, 6-8</small></span><ChevronRight size={16}/></label>{splitMode === 'ranges' && <label className="form-label range-input-label">Page ranges<input className="form-input" value={splitRanges} onChange={(event) => setSplitRanges(event.target.value)} placeholder="1-3, 4, 6-8" /></label>}</div></Modal>}

    {modal?.type === 'text' && <Modal title="Add text overlay" eyebrow="ANNOTATE PAGE" onClose={() => setModal(null)} footer={<><ActionButton onClick={() => setModal(null)}>Cancel</ActionButton><ActionButton variant="primary" icon={Type} onClick={addTextOverlay}>Apply text</ActionButton></>}><div className="modal-intro"><div className="modal-hero-icon modal-hero-purple"><Type size={22}/></div><div><strong>Add a text overlay to the selected page</strong><p>Text is embedded in the PDF when exported. It is an overlay and does not modify existing PDF text objects.</p></div></div><label className="form-label">Text to add<input className="form-input" value={textValue} onChange={(event) => setTextValue(event.target.value)} placeholder="Type something..." autoFocus /></label><div className="form-two-col"><label className="form-label">Text size<select className="form-input" value={textSize} onChange={(event) => setTextSize(event.target.value)}><option value="12">12 pt — small</option><option value="18">18 pt — medium</option><option value="24">24 pt — large</option><option value="36">36 pt — heading</option></select></label><label className="form-label">Text color<div className="color-picker-row"><input type="color" value={textColor} onChange={(event) => setTextColor(event.target.value)}/><span>{textColor.toUpperCase()}</span></div></label></div><div className="modal-note"><AlignLeft size={15}/><span>New text appears near the upper-left area of the page. Select multiple pages to apply it to all of them.</span></div></Modal>}

    {modal?.type === 'cover' && <Modal title="Add a cover block" eyebrow="ANNOTATE PAGE" onClose={() => setModal(null)} footer={<><ActionButton onClick={() => setModal(null)}>Cancel</ActionButton><ActionButton variant="primary" icon={LockKeyhole} onClick={addCoverOverlay}>Add cover block</ActionButton></>}><div className="modal-intro"><div className="modal-hero-icon modal-hero-dark"><LockKeyhole size={22}/></div><div><strong>Cover a visible area</strong><p>This places a solid shape over part of the page. It is not a certified redaction and may not remove underlying text from the PDF structure.</p></div></div><label className="form-label">Cover color<div className="color-picker-row"><input type="color" value={coverColor} onChange={(event) => setCoverColor(event.target.value)}/><span>{coverColor.toUpperCase()}</span></div></label><div className="modal-note modal-note-warning"><ShieldCheck size={15}/><span>For sensitive information, use a dedicated redaction workflow that permanently removes content and verify the exported file before sharing.</span></div></Modal>}

    {modal?.type === 'page-menu' && <Modal title="Page actions" eyebrow="PAGE OPTIONS" onClose={() => setModal(null)} footer={<ActionButton onClick={() => setModal(null)}>Done</ActionButton>}><div className="page-menu-list"><button onClick={() => { rotateSelected(-90, [modal.pageId]); setActiveId(modal.pageId); setSelectedIds([modal.pageId]); setModal(null); }}><RotateCcw size={17}/><span><strong>Rotate left</strong><small>Turn the page 90° counter-clockwise.</small></span></button><button onClick={() => { rotateSelected(90, [modal.pageId]); setActiveId(modal.pageId); setSelectedIds([modal.pageId]); setModal(null); }}><RotateCw size={17}/><span><strong>Rotate right</strong><small>Turn the page 90° clockwise.</small></span></button><button onClick={() => { duplicateSelected([modal.pageId]); setModal(null); }}><Copy size={17}/><span><strong>Duplicate page</strong><small>Insert a copy after this page.</small></span></button><button className="page-menu-danger" onClick={() => { deleteSelected([modal.pageId]); setModal(null); }}><Trash2 size={17}/><span><strong>Delete page</strong><small>Remove this page from the workspace.</small></span></button></div></Modal>}

    {modal?.type === 'about' && <Modal title="PDF Studio" eyebrow="A BETTER WAY TO WORK WITH PDFS" onClose={() => setModal(null)} footer={<ActionButton variant="primary" onClick={() => setModal(null)}>Back to workspace</ActionButton>}><div className="about-brand"><div className="about-brand-icon"><FileStack size={26}/><span>✦</span></div><div><h3>PDF Studio <span>Cross-platform</span></h3><p>Version {appVersion} · Electron + React + Tailwind CSS</p></div></div><p className="about-copy">A modern desktop workspace for organizing pages, combining PDFs and images, adding simple overlays, and exporting common document formats. Designed to run locally on Windows, macOS and Linux.</p><div className="about-capabilities"><div><CheckCircle2 size={16}/><span>Local-first file workflow</span></div><div><CheckCircle2 size={16}/><span>Sortable pages and PDF export</span></div><div><CheckCircle2 size={16}/><span>PNG/JPEG and editable DOCX output</span></div></div><div className="modal-note"><BookOpen size={15}/><span>Developer: Jessie Albert Regualos. The original Windows .NET source is retained in the project’s legacy-windows folder for reference.</span></div></Modal>}
  </div>;
}

export default App;
