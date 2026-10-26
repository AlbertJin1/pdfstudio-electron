import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { FilePenLine, FolderOpen, Save, ShieldCheck, X } from 'lucide-react';
import { loadPdfSource } from '../services/pdf/pdfjs.js';
import { exportEditedPdf } from '../services/pdf/edit.js';
import { detectUnderline, extractPageContent, renderRegionToDataUrl, sampleColors } from '../services/pdf/pageContent.js';
import { AUTO_SIZE_TYPES, COMMON_FONTS, TEXT_TYPES, baselineOf, fitTextPatch, layoutItem, resolveText } from '../services/pdf/textMetrics.js';
import { saveInBrowser } from '../utils/download.js';
import { normalizeBytes, uid } from '../utils/files.js';
import { cx } from '../utils/cx.js';
import ObjectView from './edit/ObjectView.jsx';
import Ruler, { RULER_SIZE } from './edit/Rulers.jsx';
import PageThumb from './edit/PageThumb.jsx';
import SignatureDialog from './edit/SignatureDialog.jsx';
import { ALL_TOOLS, DocBar, FormatBar, SidePanel, ToolRail } from './edit/panels.jsx';
import { alignItems, boundsOf, clamp, distributeItems, rectContains, rectsIntersect, transformItem, translateItem } from './edit/geometry.js';
import { buildSnapLines, snapMove, snapPoint, snapResize, snapThreshold } from './edit/snap.js';
import { formatUnit } from './edit/units.js';

const CSS_PT = 96 / 72;
const PREFS_KEY = 'pdfstudio.editor.view.v1';
const PANEL_PREFS_KEY = 'pdfstudio.editor.panels.v1';
const loadPanels = () => { try { return { tools: true, pages: true, properties: true, ...JSON.parse(localStorage.getItem(PANEL_PREFS_KEY) || '{}') }; } catch { return { tools: true, pages: true, properties: true }; } };
const DEFAULT_VIEW = {
  unit: 'in', rulers: true, grid: false, gridSize: 18, showGuides: true, guidesLocked: false, showMargins: false, marginLink: false,
  snap: true, snapObjects: true, snapPage: true, snapGuides: true, snapMargins: true, snapGrid: true, lockAspect: true,
  margins: { top: 36, right: 36, bottom: 36, left: 36 },
};
const loadView = () => { try { return { ...DEFAULT_VIEW, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') }; } catch { return DEFAULT_VIEW; } };
const cleanName = (value) => String(value || 'document.pdf').replace(/\.pdf$/i, '');
const LAYOUT_KEYS = ['text', 'size', 'font', 'fontName', 'fontRef', 'bold', 'italic', 'lineHeight', 'align', 'reflow', 'w'];
const PRISTINE_KEYS = ['x', 'y', 'text', 'size', 'font', 'fontName', 'bold', 'italic', 'underline', 'strike', 'color', 'align', 'lineHeight'];
const EMPTY_GUIDES = { v: [], h: [] };
const PREVIEW_FONT_LOADS = new Set();
async function loadPreviewFont(family, bold = false, italic = false, embeddedBytes = null) {
  const name = String(family || '').trim();
  if (!name || typeof FontFace === 'undefined' || (!embeddedBytes?.length && !window.pdfStudio?.findFont)) return;
  const key = `${name.toLowerCase()}|${bold ? 1 : 0}|${italic ? 1 : 0}`;
  if (PREVIEW_FONT_LOADS.has(key)) return;
  PREVIEW_FONT_LOADS.add(key);
  try {
    let bytes = embeddedBytes;
    const signature = bytes?.length >= 4 ? String.fromCharCode(...bytes.slice(0, 4)) : '';
    if (!(signature === '\u0000\u0001\u0000\u0000' || signature === 'OTTO' || signature === 'true' || signature === 'typ1')) {
      bytes = await window.pdfStudio.findFont({ family: name, bold, italic });
    }
    if (!bytes?.length) return;
    const url = URL.createObjectURL(new Blob([bytes], { type: 'font/ttf' }));
    const face = new FontFace(name, `url("${url}")`, { weight: bold ? '700' : '400', style: italic ? 'italic' : 'normal' });
    await face.load();
    document.fonts.add(face);
    URL.revokeObjectURL(url);
  } catch { PREVIEW_FONT_LOADS.delete(key); /* fallback stack is still usable */ }
}

const EMPTY_LIST = [];
const FONT_IDS = new Set(['helvetica', 'times', 'courier']);

const isPristine = (item) => {
  if (!item.orig || item.deleted || item.replaced) return false;
  const keys = item.type === 'imageedit' ? ['x', 'y', 'w', 'h'] : PRISTINE_KEYS;
  return keys.every((k) => (typeof item[k] === 'number' ? Math.abs(item[k] - item.orig[k]) < 0.01 : (item[k] || false) === (item.orig[k] || false)));
};

function refit(next) {
  if (!AUTO_SIZE_TYPES.has(next.type)) return next;
  const before = next.__prev;
  const patch = fitTextPatch(next);
  if (!patch) return next;
  const out = { ...next, ...patch };
  const r = resolveText(next);
  if (!r.reflow && patch.w != null && before) {
    if (r.align === 'center') out.x = next.x + (before.w - patch.w) / 2;
    else if (r.align === 'right') out.x = next.x + (before.w - patch.w);
  }
  delete out.__prev;
  return out;
}

function applyPatch(item, patch) {
  const next = { ...item, ...patch };
  if (Object.keys(patch).some((key) => LAYOUT_KEYS.includes(key)) && AUTO_SIZE_TYPES.has(item.type)) {
    next.__prev = item;
    if ('w' in patch) next.reflow = true;
    return refit(next);
  }
  return next;
}

const detach = (item) => {
  const copy = { ...item, id: uid() };
  if (copy.type === 'textedit') copy.type = 'text';
  if (copy.type === 'imageedit') copy.type = 'image';
  delete copy.blockId; delete copy.src; delete copy.cover; delete copy.orig; delete copy.replaced; delete copy.deleted;
  return copy;
};

async function readImageFile(file) {
  const data = new Uint8Array(await file.arrayBuffer());
  const url = URL.createObjectURL(new Blob([data], { type: file.type }));
  try {
    const image = new Image(); image.src = url; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d'); if (!context) throw new Error('Image conversion is not available.');
    context.drawImage(image, 0, 0);
    return { data: canvas.toDataURL('image/png'), mime: 'image/png', width: image.naturalWidth, height: image.naturalHeight, name: file.name };
  } finally { URL.revokeObjectURL(url); }
}

function resizeRect(o, handle, dx, dy, minW, minH, aspect) {
  let w = o.w; let h = o.h;
  if (handle.includes('e')) w = o.w + dx;
  if (handle.includes('w')) w = o.w - dx;
  if (handle.includes('s')) h = o.h + dy;
  if (handle.includes('n')) h = o.h - dy;
  w = Math.max(minW, w); h = Math.max(minH, h);
  if (aspect) {
    if (handle.length === 2) { const f = Math.max(w / o.w, h / o.h); w = o.w * f; h = o.h * f; }
    else if (handle === 'e' || handle === 'w') h = w / aspect;
    else w = h * aspect;
  }
  return { x: handle.includes('w') ? o.x + o.w - w : o.x, y: handle.includes('n') ? o.y + o.h - h : o.y, w, h };
}

/** Rulers + cursor readout subscribe to a tiny bus so pointer moves don't re-render the whole editor. */
function useCursor(bus) {
  const [point, setPoint] = useState(null);
  useEffect(() => { bus.current.add(setPoint); return () => bus.current.delete(setPoint); }, [bus]);
  return point;
}
function RulersLayer({ bus, view, unit, scale, base, band, onGuideStart }) {
  const cursor = useCursor(bus);
  return (
    <>
      <div className="ep-ruler-corner" aria-hidden="true">{unit}</div>
      <Ruler orientation="h" length={view.w} origin={view.ox} scale={scale} pageLength={base.w} unit={unit} band={band?.x} cursor={cursor?.x} onGuideStart={onGuideStart} />
      <Ruler orientation="v" length={view.h} origin={view.oy} scale={scale} pageLength={base.h} unit={unit} band={band?.y} cursor={cursor?.y} onGuideStart={onGuideStart} />
    </>
  );
}
function Coords({ bus, unit }) {
  const p = useCursor(bus);
  return <span className="ep-coords">{p ? `${formatUnit(p.x, unit)}, ${formatUnit(p.y, unit)} ${unit}` : '–'}</span>;
}

export default function EditPdfView({ active = true, documents = [], sourcesRef, initialDocument, initialFile, standalone = false, notify, onDirtyChange, onTabTitleChange, onCloseTab }) {
  const [pdfDoc, setPdfDoc] = useState(null);
  const [sourceBytes, setSourceBytes] = useState(null);
  const [fileName, setFileName] = useState('');
  const [loadedSourceId, setLoadedSourceId] = useState(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [base, setBase] = useState(null);
  const [tool, setToolState] = useState('select');
  const [ann, setAnn] = useState({});
  const [historyVersion, setHistoryVersion] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [defaults, setDefaultsState] = useState({ color: '#000000', highlight: '#f6d64a', lineWidth: 2 });
  const [textDefaults, setTextDefaults] = useState({ font: 'helvetica', size: 12, bold: false, italic: false, color: '#000000', align: 'left', lineHeight: 1.2 });
  const [stampText, setStampText] = useState('APPROVED');
  const [view, setViewState] = useState(loadView);
  const [zoom, setZoom] = useState({ mode: 'page', value: CSS_PT });
  const [stageSize, setStageSize] = useState({ width: 900, height: 700 });
  const [measure, setMeasure] = useState({ ox: 0, oy: 0, w: 0, h: 0 });
  const [content, setContent] = useState({ key: '', blocks: [], images: [] });
  const [guidesByPage, setGuidesByPage] = useState({});
  const [draftGuide, setDraftGuide] = useState(null);
  const [snapHits, setSnapHits] = useState([]);
  const [marquee, setMarquee] = useState(null);
  const [draft, setDraft] = useState(null);
  const [alignTo, setAlignTo] = useState('page');
  const [tab, setTab] = useState('format');
  const [panels, setPanels] = useState(loadPanels);
  useEffect(() => { try { localStorage.setItem(PANEL_PREFS_KEY, JSON.stringify(panels)); } catch { /* storage may be disabled */ } }, [panels]);
  const togglePanel = useCallback((key) => setPanels((old) => ({ ...old, [key]: !old[key] })), []);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [signatureOpen, setSignatureOpen] = useState(false);
  const [pendingImage, setPendingImage] = useState(null);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [panning, setPanning] = useState(false);

  const annRef = useRef({});
  const undoRef = useRef([]);
  const redoRef = useRef([]);
  const ixRef = useRef(null);
  const editStartRef = useRef(null);
  const nudgeRef = useRef(0);
  const clipboardRef = useRef([]);
  const canvasRef = useRef(null);
  const kRef = useRef(1);
  const stageRef = useRef(null);
  const surfaceRef = useRef(null);
  const fileInputRef = useRef(null);
  const imageInputRef = useRef(null);
  const replaceInputRef = useRef(null);
  const cursorBus = useRef(new Set());
  const hasAutoLoadedRef = useRef(false);
  const contentKeyRef = useRef('');
  const docKeyRef = useRef(0);
  const spaceRef = useRef(false);
  const panRef = useRef(null);

  const pageCount = pdfDoc?.numPages || 0;
  const pageKey = String(pageNumber - 1);
  const items = ann[pageKey] || EMPTY_LIST;
  const pageGuides = guidesByPage[pageKey] || EMPTY_GUIDES;
  const toolInfo = ALL_TOOLS.find((t) => t.id === tool) || ALL_TOOLS[0];
  const margins = view.margins;

  const setView = useCallback((patch) => setViewState((prev) => { const next = { ...prev, ...patch }; try { localStorage.setItem(PREFS_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ } return next; }), []);
  const setMargins = useCallback((value) => setView({ margins: value }), [setView]);

  // ---- zoom ---------------------------------------------------------------------------------
  const scale = useMemo(() => {
    if (!base) return 1;
    const availW = Math.max(200, stageSize.width - 72); const availH = Math.max(200, stageSize.height - 72);
    const raw = zoom.mode === 'width' ? availW / base.w : zoom.mode === 'page' ? Math.min(availW / base.w, availH / base.h, 3) : zoom.value;
    return clamp(raw, 0.2, 12000 / Math.max(base.w, base.h));
  }, [base, stageSize, zoom]);
  const zoomPercent = Math.round(scale / CSS_PT * 100);
  const zoomStep = useCallback((dir) => {
    const list = [10, 25, 33, 50, 67, 75, 100, 125, 150, 200, 300, 400, 600, 800];
    const next = dir > 0 ? list.find((p) => p > zoomPercent + 0.5) : [...list].reverse().find((p) => p < zoomPercent - 0.5);
    if (next) setZoom({ mode: 'custom', value: next / 100 * CSS_PT });
  }, [zoomPercent]);

  // ---- model --------------------------------------------------------------------------------
  const applyAnn = useCallback((next, markDirty = true) => { annRef.current = next; setAnn(next); if (markDirty) setDirty(true); }, []);
  const pushHistory = useCallback((before) => {
    undoRef.current.push(before); if (undoRef.current.length > 120) undoRef.current.shift();
    redoRef.current = []; setHistoryVersion((v) => v + 1);
  }, []);
  const commitAnn = useCallback((next, before = annRef.current) => { pushHistory(before); applyAnn(next, true); }, [applyAnn, pushHistory]);
  const pageList = useCallback(() => annRef.current[pageKey] || [], [pageKey]);
  const withList = useCallback((list, map = annRef.current) => ({ ...map, [pageKey]: list }), [pageKey]);
  const itemsById = useCallback((ids) => pageList().filter((i) => ids.includes(i.id)), [pageList]);

  const prune = useCallback((keep) => {
    const map = annRef.current; let changed = false; const next = {};
    for (const [key, list] of Object.entries(map)) {
      const filtered = list.filter((i) => keep.includes(i.id) || !isPristine(i));
      if (filtered.length !== list.length) changed = true;
      next[key] = filtered;
    }
    if (changed) applyAnn(next, false);
  }, [applyAnn]);

  const setSelection = useCallback((ids) => { setSelectedIds(ids); prune(ids); }, [prune]);

  const finishEditing = useCallback(() => {
    const id = editingId; if (!id) return;
    const before = editStartRef.current;
    const item = pageList().find((i) => i.id === id);
    setEditingId(null); editStartRef.current = null;
    if (item && item.type === 'text' && !(item.text || '').trim()) {
      applyAnn(withList(pageList().filter((i) => i.id !== id)), false);
      setSelectedIds([]); return;
    }
    if (before && before !== annRef.current && JSON.stringify(before) !== JSON.stringify(annRef.current)) { pushHistory(before); setDirty(true); }
    prune(item ? [id] : []);
  }, [applyAnn, editingId, pageList, prune, pushHistory, withList]);

  const startEditing = useCallback((id) => { editStartRef.current = annRef.current; setSelectedIds([id]); setEditingId(id); }, []);

  const patchItems = useCallback((ids, patch, record = true) => {
    const before = annRef.current;
    const list = pageList().map((i) => (ids.includes(i.id) ? applyPatch(i, typeof patch === 'function' ? patch(i) : patch) : i));
    if (record && editingId && ids.includes(editingId)) applyAnn(withList(list), true);
    else if (record) commitAnn(withList(list), before);
    else applyAnn(withList(list), true);
  }, [applyAnn, commitAnn, editingId, pageList, withList]);

  const undo = useCallback(() => {
    const previous = undoRef.current.pop();
    if (!previous) { notify?.('Nothing to undo.', 'info'); return; }
    redoRef.current.push(annRef.current); applyAnn(previous, true); setSelectedIds([]); setEditingId(null); setHistoryVersion((v) => v + 1);
  }, [applyAnn, notify]);
  const redo = useCallback(() => {
    const next = redoRef.current.pop();
    if (!next) { notify?.('Nothing to redo.', 'info'); return; }
    undoRef.current.push(annRef.current); applyAnn(next, true); setSelectedIds([]); setEditingId(null); setHistoryVersion((v) => v + 1);
  }, [applyAnn, notify]);

  // ---- loading ------------------------------------------------------------------------------
  const loadDocument = useCallback(async ({ name, bytes, pdf, sourceId = null }) => {
    try {
      setBusy(true); setNotice('Opening PDF…');
      const normalized = normalizeBytes(bytes).slice();
      const loaded = pdf || await loadPdfSource(normalized);
      await loaded.getPage(1);
      docKeyRef.current += 1; contentKeyRef.current = '';
      setPdfDoc(loaded); setSourceBytes(normalized); setFileName(name || 'document.pdf'); setLoadedSourceId(sourceId || null);
      setPageNumber(1); setBase(null); setContent({ key: '', blocks: [], images: [] });
      annRef.current = {}; setAnn({}); undoRef.current = []; redoRef.current = []; setHistoryVersion((v) => v + 1);
      setSelectedIds([]); setEditingId(null); setDraft(null); setGuidesByPage({}); setDirty(false); setZoom({ mode: 'page', value: CSS_PT }); setNotice('');
    } catch (error) {
      console.error('Unable to load PDF for editing', error);
      const detail = /password|encrypted/i.test(error?.message || '') ? 'This PDF is password-protected. Open an unlocked copy to edit and save it.' : (error?.message || 'The selected file could not be opened as a PDF.');
      setNotice(detail); notify?.(detail, 'error');
    } finally { setBusy(false); }
  }, [notify]);

  useEffect(() => {
    if (!active || hasAutoLoadedRef.current || pdfDoc || !initialDocument || initialDocument.kind !== 'pdf' || !sourcesRef?.current) return;
    const source = sourcesRef.current.get(initialDocument.id);
    if (!source?.bytes) return;
    hasAutoLoadedRef.current = true;
    loadDocument({ name: source.name, bytes: source.bytes, pdf: source.pdf, sourceId: source.id });
  }, [active, initialDocument?.id, pdfDoc, loadDocument, sourcesRef]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!initialFile?.bytes || hasAutoLoadedRef.current) return;
    hasAutoLoadedRef.current = true;
    loadDocument({ name: initialFile.name, bytes: initialFile.bytes });
  }, [initialFile, loadDocument]);

  const openPdf = useCallback(async () => {
    if (dirty && !window.confirm('You have unsaved edits. Opening another PDF will discard those edits. Continue?')) return;
    if (window.pdfStudio?.openFiles) {
      try {
        const files = await window.pdfStudio.openFiles({ pdfOnly: true });
        const file = files?.find((f) => f.kind === 'pdf' || f.mime === 'application/pdf' || /\.pdf$/i.test(f.name || ''));
        if (!file) { if (files?.length) notify?.('Choose a PDF file to use the Edit PDF workspace.', 'error'); return; }
        await loadDocument({ name: file.name, bytes: file.bytes });
      } catch (error) { notify?.(error?.message || 'Could not open the selected PDF.', 'error'); }
      return;
    }
    fileInputRef.current?.click();
  }, [dirty, loadDocument, notify]);

  const switchToWorkspacePdf = useCallback(async (event) => {
    const sourceId = event.target.value;
    if (!sourceId || sourceId === loadedSourceId) return;
    if (dirty && !window.confirm('You have unsaved edits. Switching PDFs will discard those edits. Continue?')) return;
    const source = sourcesRef?.current?.get(sourceId);
    if (!source?.bytes || source.kind !== 'pdf') { notify?.('That PDF is no longer available in the current workspace.'); return; }
    await loadDocument({ name: source.name, bytes: source.bytes, pdf: source.pdf, sourceId: source.id });
  }, [dirty, loadedSourceId, loadDocument, notify, sourcesRef]);

  const onPdfInputChange = useCallback(async (event) => {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') { notify?.('Please choose a PDF file.', 'error'); return; }
    await loadDocument({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
  }, [loadDocument, notify]);

  const onDropFile = useCallback(async (event) => {
    const file = [...(event.dataTransfer?.files || [])].find((f) => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
    if (!file) return;
    event.preventDefault();
    if (dirty && !window.confirm('You have unsaved edits. Opening another PDF will discard those edits. Continue?')) return;
    await loadDocument({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
  }, [dirty, loadDocument]);

  // Publish editor state to the host tab so its title and close behaviour stay in sync.
  useEffect(() => { onDirtyChange?.(Boolean(dirty)); }, [dirty, onDirtyChange]);
  useEffect(() => { onTabTitleChange?.(pdfDoc ? `${dirty ? '● ' : ''}${fileName}` : 'Edit PDF'); }, [dirty, fileName, onTabTitleChange, pdfDoc]);

  // Window title and close guard remain active for legacy standalone editor launches.
  useEffect(() => {
    const title = pdfDoc ? `${dirty ? '• ' : ''}${fileName} - Edit PDF - PDF Studio` : 'PDF Studio - Edit PDF';
    if (standalone) { document.title = title; window.pdfStudio?.setEditorTitle?.(title); }
  }, [dirty, fileName, pdfDoc, standalone]);
  useEffect(() => {
    if (!standalone || !dirty) return undefined;
    const guard = (event) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [dirty, standalone]);

  // ---- page size, rendering, content ----------------------------------------------------------
  useEffect(() => {
    if (!stageRef.current || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver((entries) => { const r = entries[0]?.contentRect; if (r) setStageSize({ width: r.width, height: r.height }); });
    observer.observe(stageRef.current);
    return () => observer.disconnect();
  }, [pdfDoc]);

  useEffect(() => {
    if (!pdfDoc) return undefined;
    let cancelled = false;
    pdfDoc.getPage(pageNumber).then((page) => {
      if (cancelled) return;
      const v = page.getViewport({ scale: 1, rotation: page.rotate || 0 });
      setBase({ w: v.width, h: v.height, rotation: page.rotate || 0 });
    }).catch((error) => setNotice(error?.message || 'This PDF page could not be read.'));
    return () => { cancelled = true; };
  }, [pdfDoc, pageNumber]);

  useEffect(() => {
    if (!pdfDoc || !base || !canvasRef.current) return undefined;
    let cancelled = false; let task;
    (async () => {
      try {
        const page = await pdfDoc.getPage(pageNumber);
        if (cancelled) return;
        const viewport = page.getViewport({ scale, rotation: page.rotate || 0 });
        let out = Math.min(window.devicePixelRatio || 1, 2);
        while (viewport.width * viewport.height * out * out > 24e6 && out > 1) out = Math.max(1, out - 0.25);
        const buffer = document.createElement('canvas');
        buffer.width = Math.floor(viewport.width * out); buffer.height = Math.floor(viewport.height * out);
        const context = buffer.getContext('2d', { alpha: false });
        context.fillStyle = '#fff'; context.fillRect(0, 0, buffer.width, buffer.height);
        task = page.render({ canvasContext: context, viewport, transform: out === 1 ? null : [out, 0, 0, out, 0, 0], background: '#fff' });
        await task.promise;
        if (cancelled || !canvasRef.current) return;
        const canvas = canvasRef.current;
        canvas.width = buffer.width; canvas.height = buffer.height;
        canvas.getContext('2d', { alpha: false }).drawImage(buffer, 0, 0);
        kRef.current = buffer.width / base.w;
        const key = `${docKeyRef.current}:${pageNumber}`;
        if (contentKeyRef.current !== key) {
          contentKeyRef.current = key;
          const found = await extractPageContent(page, page.getViewport({ scale: 1, rotation: page.rotate || 0 }), pageNumber - 1);
          if (!cancelled || contentKeyRef.current === key) setContent({ key, ...found });
        }
      } catch (error) {
        if (!cancelled && error?.name !== 'RenderingCancelledException') { console.error('PDF page rendering failed', error); setNotice(error?.message || 'This PDF page could not be rendered.'); }
      }
    })();
    return () => { cancelled = true; try { task?.cancel?.(); } catch { /* no-op */ } };
  }, [pdfDoc, pageNumber, scale, base]);

  const pageContent = content.key === `${docKeyRef.current}:${pageNumber}` ? content : { blocks: [], images: [] };

  // ---- ruler alignment --------------------------------------------------------------------------
  const measureNow = useCallback(() => {
    const stage = stageRef.current; const surface = surfaceRef.current;
    if (!stage || !surface) return;
    const s = stage.getBoundingClientRect(); const p = surface.getBoundingClientRect();
    setMeasure((prev) => (Math.abs(prev.ox - (p.left - s.left)) < 0.3 && Math.abs(prev.oy - (p.top - s.top)) < 0.3 && prev.w === s.width && prev.h === s.height ? prev : { ox: p.left - s.left, oy: p.top - s.top, w: s.width, h: s.height }));
  }, []);
  useLayoutEffect(() => { measureNow(); }, [measureNow, scale, base, stageSize, view.rulers, pdfDoc, pageNumber]);
  useEffect(() => {
    const stage = stageRef.current; if (!stage) return undefined;
    let raf = 0;
    const onScroll = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(measureNow); };
    stage.addEventListener('scroll', onScroll, { passive: true });
    return () => { stage.removeEventListener('scroll', onScroll); cancelAnimationFrame(raf); };
  }, [measureNow, pdfDoc]);

  useEffect(() => {
    const stage = stageRef.current; if (!stage) return undefined;
    const onWheel = (event) => {
      if (event.shiftKey && !(event.ctrlKey || event.metaKey)) { event.preventDefault(); stage.scrollLeft += event.deltaY || event.deltaX; return; }
      if (!(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      setZoom((z) => ({ mode: 'custom', value: clamp((z.mode === 'custom' ? z.value : scale) * (event.deltaY < 0 ? 1.1 : 1 / 1.1), 0.2, 12) }));
    };
    stage.addEventListener('wheel', onWheel, { passive: false });
    return () => stage.removeEventListener('wheel', onWheel);
  }, [scale, pdfDoc]);

  // ---- geometry helpers --------------------------------------------------------------------------
  const toPt = useCallback((event) => {
    const rect = surfaceRef.current?.getBoundingClientRect();
    if (!rect || !base) return { x: 0, y: 0 };
    return { x: (event.clientX - rect.left) / (rect.width / base.w), y: (event.clientY - rect.top) / (rect.height / base.h) };
  }, [base]);

  const snapSet = useCallback((excludeIds = [], overrides = {}) => {
    const objects = [];
    for (const i of pageList()) if (!excludeIds.includes(i.id) && !i.deleted && !i.hidden) objects.push({ x: i.x, y: i.y, w: i.w, h: i.h });
    const done = new Set(pageList().map((i) => i.blockId).filter(Boolean));
    for (const b of [...pageContent.blocks, ...pageContent.images]) if (!done.has(b.id)) objects.push({ x: b.x, y: b.y, w: b.w, h: b.h });
    return buildSnapLines({
      pageW: base.w, pageH: base.h, margins: view.showMargins && view.snapMargins ? margins : null, guides: view.showGuides ? pageGuides : null, objects,
      flags: { page: view.snapPage, margins: view.showMargins && view.snapMargins, guides: view.snapGuides && view.showGuides, objects: view.snapObjects, grid: view.snapGrid && view.grid, gridSize: view.gridSize, ...overrides },
    });
  }, [base, margins, pageContent, pageGuides, pageList, view]);
  const snapping = (event) => view.snap && !event.altKey;

  // ---- materialising existing content ------------------------------------------------------------
  const ensureBlockItem = useCallback((block) => {
    const existing = pageList().find((i) => i.blockId === block.id);
    if (existing) return existing.id;
    const colors = sampleColors(canvasRef.current, kRef.current, block);
    let item;
    if (block.kind === 'image') {
      item = { id: uid(), type: 'imageedit', blockId: block.id, src: { x: block.x, y: block.y, w: block.w, h: block.h }, cover: colors.bg, x: block.x, y: block.y, w: block.w, h: block.h, data: null, orig: { x: block.x, y: block.y, w: block.w, h: block.h } };
    } else {
      const f = block.font;
      if (f?.name) {
        // Prefer the source PDF's own font program when it is embedded and usable; otherwise the
        // main process finds an installed file or downloads an allow-listed open-font substitute.
        void pdfDoc?.getPage(pageNumber).then((page) => {
          let embedded = null;
          try { if (f.ref && page.commonObjs.has(f.ref)) embedded = page.commonObjs.get(f.ref)?.data || null; } catch { /* use managed font lookup */ }
          return loadPreviewFont(f.name, !!f.bold, !!f.italic, embedded);
        }).catch(() => loadPreviewFont(f.name, !!f.bold, !!f.italic));
      }
      const underline = detectUnderline(canvasRef.current, kRef.current, block, colors.bg, colors.fg);
      item = {
        id: uid(), type: 'textedit', blockId: block.id, src: { x: block.x, y: block.y, w: block.w, h: block.h }, cover: colors.bg,
        text: block.text, size: block.size, font: f.family, fontName: f.name || '', fontRef: f.ref || '', bold: f.bold, italic: f.italic, origBold: f.bold, origItalic: f.italic,
        underline, strike: false, color: colors.fg, align: block.align, lineHeight: block.lineHeight, reflow: false, pad: 0, x: block.x, w: block.w, h: block.h,
        origFont: { font: f.family, fontName: f.name || '', fontRef: f.ref || '' },
      };
      const layout = layoutItem(item);
      item.y = block.firstBaseline - baselineOf(layout, 0, 0);
      // Keep the initial selection on the PDF's measured glyph bounds. Once text changes,
      // the regular auto-fit path expands the box to fit the replacement content.
      item.h = Math.max(1, block.h);
      item.orig = { x: item.x, y: item.y, text: item.text, size: item.size, font: item.font, fontName: item.fontName, bold: item.bold, italic: item.italic, underline, strike: false, color: item.color, align: item.align, lineHeight: item.lineHeight };
    }
    applyAnn(withList([...pageList(), item]), false);
    if (block.kind === 'image' && pdfDoc) {
      const key = pageKey; const itemId = item.id;
      pdfDoc.getPage(pageNumber).then((page) => renderRegionToDataUrl(page, block)).then((data) => {
        const list = annRef.current[key] || [];
        if (list.some((i) => i.id === itemId)) applyAnn({ ...annRef.current, [key]: list.map((i) => (i.id === itemId ? { ...i, data } : i)) }, false);
      }).catch(() => notify?.('This image could not be extracted for editing.', 'error'));
    }
    return item.id;
  }, [applyAnn, notify, pageKey, pageList, pageNumber, pdfDoc, withList]);

  // ---- tools --------------------------------------------------------------------------------------
  const setTool = useCallback((id) => {
    if (!pdfDoc) { setNotice('Open a PDF to start editing.'); return; }
    if (editingId) finishEditing();
    setSelection([]); setToolState(id);
    if (id === 'signature') setSignatureOpen(true);
    if (id === 'image') imageInputRef.current?.click();
  }, [editingId, finishEditing, pdfDoc, setSelection]);

  const placeItem = useCallback((item, before = annRef.current) => {
    commitAnn(withList([...pageList(), item]), before);
    setSelectedIds([item.id]); setToolState('select');
  }, [commitAnn, pageList, withList]);

  const handleImageInput = useCallback(async (event) => {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) { notify?.('Choose an image file for this tool.', 'error'); return; }
    try { setPendingImage({ kind: 'image', ...(await readImageFile(file)) }); setToolState('image'); setNotice(`Image ready: ${file.name}. Click the page to place it.`); }
    catch (error) { notify?.(error?.message || 'Could not read that image.', 'error'); }
  }, [notify]);

  const handleReplaceInput = useCallback(async (event) => {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file || !selectedIds[0]) return;
    try { const img = await readImageFile(file); patchItems([selectedIds[0]], { data: img.data, replaced: true }); }
    catch (error) { notify?.(error?.message || 'Could not read that image.', 'error'); }
  }, [notify, patchItems, selectedIds]);

  // ---- guides & margins dragging ------------------------------------------------------------------
  const setGuides = useCallback((key, guides) => setGuidesByPage((prev) => ({ ...prev, [key]: guides })), []);
  const beginGuideDrag = useCallback((axis, index, event) => {
    if (!base) return;
    event.preventDefault();
    const key = pageKey; const set = snapSet([], { guides: false });
    const thr = snapThreshold(scale);
    const posOf = (e) => { const pt = toPt(e); let value = axis === 'v' ? pt.x : pt.y; if (view.snap && !e.altKey) { const s = snapPoint(pt, set, thr); value = axis === 'v' ? s.x : s.y; } return value; };
    setDraftGuide({ axis, index, pos: posOf(event) });
    const move = (e) => setDraftGuide({ axis, index, pos: posOf(e) });
    const up = (e) => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      const pos = posOf(e); const limit = axis === 'v' ? base.w : base.h;
      const current = guidesByPageRef.current[key] || EMPTY_GUIDES;
      const list = [...(current[axis] || [])];
      const inside = pos >= 0 && pos <= limit;
      if (index >= 0) { if (inside) list[index] = pos; else list.splice(index, 1); }
      else if (inside) list.push(pos);
      setGuides(key, { ...current, [axis]: list }); setDraftGuide(null);
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  }, [base, pageKey, scale, setGuides, snapSet, toPt, view.snap]);
  const guidesByPageRef = useRef({});
  guidesByPageRef.current = guidesByPage;

  const beginMarginDrag = useCallback((side, event) => {
    event.preventDefault();
    const move = (e) => {
      const pt = toPt(e);
      const raw = side === 'left' ? pt.x : side === 'right' ? base.w - pt.x : side === 'top' ? pt.y : base.h - pt.y;
      const value = clamp(raw, 0, (side === 'left' || side === 'right' ? base.w : base.h) / 2 - 1);
      setViewState((prev) => ({ ...prev, margins: prev.marginLink ? { top: value, right: value, bottom: value, left: value } : { ...prev.margins, [side]: value } }));
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); setViewState((prev) => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prev)); } catch { /* ignore */ } return prev; }); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  }, [base, toPt]);

  const onGuides = useCallback((op, axis, index, value) => {
    const current = pageGuides; const list = [...(current[axis] || [])];
    if (op === 'add') list.push(value); else if (op === 'remove') list.splice(index, 1); else list[index] = clamp(value, 0, axis === 'v' ? base.w : base.h);
    setGuides(pageKey, { ...current, [axis]: list });
  }, [base, pageGuides, pageKey, setGuides]);

  // ---- pointer interaction on the page -------------------------------------------------------------
  const selectedItems = useMemo(() => items.filter((i) => selectedIds.includes(i.id)), [items, selectedIds]);
  const single = selectedItems.length === 1 ? selectedItems[0] : null;

  const stagePointerDown = (event) => {
    if (!(event.button === 1 || (event.button === 0 && spaceRef.current))) return;
    const stage = stageRef.current; if (!stage) return;
    event.preventDefault(); event.stopPropagation();
    panRef.current = { x: event.clientX, y: event.clientY, left: stage.scrollLeft, top: stage.scrollTop };
    stage.setPointerCapture?.(event.pointerId); setPanning(true);
  };
  const stagePointerMove = (event) => {
    const pan = panRef.current;
    if (pan) { const stage = stageRef.current; stage.scrollLeft = pan.left - (event.clientX - pan.x); stage.scrollTop = pan.top - (event.clientY - pan.y); return; }
    if (!ixRef.current) cursorBus.current.forEach((fn) => fn(toPt(event)));
  };
  const stagePointerUp = () => { if (panRef.current) { panRef.current = null; setPanning(false); } };

  const surfaceDown = (event) => {
    if (!pdfDoc || busy || event.button !== 0 || !base || spaceRef.current) return;
    const target = event.target;
    if (target.closest('textarea')) return;
    const pt = toPt(event);
    const guideEl = target.closest('[data-guide]');
    if (guideEl) { if (!view.guidesLocked) beginGuideDrag(guideEl.dataset.axis, Number(guideEl.dataset.index), event); return; }
    const marginEl = target.closest('[data-margin]');
    if (marginEl && !view.guidesLocked) { beginMarginDrag(marginEl.dataset.margin, event); return; }
    if (tool === 'select') selectDown(event, pt); else createDown(event, pt);
  };

  const startMove = (event, ids, pt, editOnClick) => {
    const list = pageList(); const originals = list.filter((i) => ids.includes(i.id));
    ixRef.current = { type: 'move', ids, originals, startPt: pt, startClient: { x: event.clientX, y: event.clientY }, before: annRef.current, moved: false, editOnClick, set: snapSet(ids) };
    surfaceRef.current?.setPointerCapture?.(event.pointerId);
  };

  const selectDown = (event, pt) => {
    const target = event.target;
    const handleEl = target.closest('[data-handle]');
    if (handleEl && single) {
      const original = single; const imageLike = ['image', 'signature', 'imageedit'].includes(original.type);
      ixRef.current = { type: 'resize', id: original.id, handle: handleEl.dataset.handle, original, startPt: pt, before: annRef.current, aspect: (imageLike ? !event.shiftKey : event.shiftKey) && view.lockAspect !== false ? original.w / original.h : 0, set: snapSet([original.id]) };
      surfaceRef.current?.setPointerCapture?.(event.pointerId); event.preventDefault(); return;
    }
    const objEl = target.closest('[data-obj]'); const blockEl = target.closest('[data-block]');
    if (objEl || blockEl) {
      event.preventDefault();
      if (editingId) finishEditing();
      let id;
      if (objEl) id = objEl.dataset.obj;
      else { const block = [...pageContent.blocks, ...pageContent.images].find((b) => b.id === blockEl.dataset.block); if (!block) return; id = ensureBlockItem(block); }
      const item = pageList().find((i) => i.id === id); if (!item || item.deleted) return;
      let ids;
      if (event.shiftKey) { ids = selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id]; setSelection(ids); if (!ids.includes(id)) return; }
      else if (selectedIds.includes(id)) ids = selectedIds;
      else { ids = [id]; setSelection(ids); }
      startMove(event, ids, pt, !event.shiftKey && ids.length === 1 && TEXT_TYPES.has(item.type) && item.type !== 'stamp');
      return;
    }
    if (editingId) finishEditing();
    ixRef.current = { type: 'marquee', start: pt, additive: event.shiftKey, base: event.shiftKey ? selectedIds : [], pageItems: pageList() };
    if (!event.shiftKey) setSelection([]);
    surfaceRef.current?.setPointerCapture?.(event.pointerId);
  };

  const createDown = (event, rawPt) => {
    if (editingId) finishEditing();
    setSelection([]);
    const set = snapping(event) ? snapSet() : null;
    const pt = set ? snapPoint(rawPt, set, snapThreshold(scale)) : rawPt;
    const before = annRef.current; const d = textDefaults;
    if (tool === 'text') {
      ixRef.current = { type: 'text', start: pt, before, startClient: { x: event.clientX, y: event.clientY }, dragged: false, set };
      surfaceRef.current?.setPointerCapture?.(event.pointerId); event.preventDefault(); return;
    }
    if (tool === 'signature') {
      if (pendingImage?.kind !== 'signature') { setSignatureOpen(true); return; }
      const w = 170; placeItem({ id: uid(), type: 'signature', x: pt.x, y: pt.y, w, h: w * pendingImage.height / pendingImage.width, data: pendingImage.data, mime: 'image/png' }, before); setPendingImage(null); return;
    }
    if (tool === 'image') {
      if (pendingImage?.kind !== 'image') { imageInputRef.current?.click(); return; }
      const w = Math.min(base.w * 0.4, pendingImage.width * 0.75); placeItem({ id: uid(), type: 'image', x: pt.x, y: pt.y, w, h: w * pendingImage.height / pendingImage.width, data: pendingImage.data, mime: pendingImage.mime }, before); setPendingImage(null); return;
    }
    if (tool === 'note') { const item = { id: uid(), type: 'note', x: pt.x, y: pt.y, w: 150, h: 100, text: '', color: '#55461a', size: 11, font: 'helvetica' }; commitAnn(withList([...pageList(), item]), before); startEditing(item.id); setToolState('select'); editStartRef.current = annRef.current; return; }
    if (tool === 'stamp') { placeItem({ id: uid(), type: 'stamp', x: pt.x - 75, y: pt.y - 20, w: 150, h: 40, text: stampText, color: defaults.color === '#000000' ? '#b4232a' : defaults.color, size: 18, lineWidth: defaults.lineWidth, font: 'helvetica' }, before); return; }
    const isHighlight = tool === 'highlight';
    const first = { id: uid(), type: tool, x: pt.x, y: pt.y, w: 0.2, h: 0.2, color: isHighlight ? defaults.highlight : defaults.color, lineWidth: defaults.lineWidth, opacity: isHighlight ? 0.34 : 1, points: tool === 'draw' ? [pt] : undefined, startPoint: tool === 'line' ? pt : undefined, endPoint: tool === 'line' ? pt : undefined };
    ixRef.current = { type: 'draw', tool, start: pt, before, draft: first, set };
    setDraft(first); surfaceRef.current?.setPointerCapture?.(event.pointerId); event.preventDefault();
  };

  const surfaceMove = (event) => {
    const pt = toPt(event);
    cursorBus.current.forEach((fn) => fn(pt));
    const ix = ixRef.current; if (!ix || !base) return;
    const thr = snapThreshold(scale);
    if (ix.type === 'move') {
      if (!ix.moved && Math.hypot(event.clientX - ix.startClient.x, event.clientY - ix.startClient.y) < 3) return;
      ix.moved = true;
      let dx = pt.x - ix.startPt.x; let dy = pt.y - ix.startPt.y;
      if (event.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      const b = boundsOf(ix.originals);
      let hits = [];
      if (snapping(event)) { const s = snapMove({ x: b.x + dx, y: b.y + dy, w: b.w, h: b.h }, ix.set, thr); dx += s.dx; dy += s.dy; hits = s.hits; }
      dx = clamp(dx, 8 - (b.x + b.w), base.w - 8 - b.x); dy = clamp(dy, 8 - (b.y + b.h), base.h - 8 - b.y);
      const originals = new Map(ix.originals.map((i) => [i.id, i]));
      applyAnn(withList(pageList().map((i) => (originals.has(i.id) ? translateItem(originals.get(i.id), dx, dy) : i)), ix.before), true);
      setSnapHits(hits); return;
    }
    if (ix.type === 'resize') {
      const o = ix.original; const text = TEXT_TYPES.has(o.type);
      const minW = text ? Math.max(12, (o.size || 12) * 1.5) : 4; const minH = text ? o.h : 4;
      let rect = resizeRect(o, ix.handle, pt.x - ix.startPt.x, pt.y - ix.startPt.y, minW, minH, ix.aspect);
      let hits = [];
      if (snapping(event) && !ix.aspect) { const s = snapResize(rect, ix.handle, ix.set, thr, minW); rect = { ...rect, ...s.rect }; hits = s.hits; }
      const next = text ? applyPatch(o, { x: rect.x, w: rect.w, reflow: true }) : transformItem(o, { x: o.x, y: o.y, w: o.w, h: o.h }, rect);
      applyAnn(withList(pageList().map((i) => (i.id === o.id ? next : i)), ix.before), true);
      setSnapHits(hits); return;
    }
    if (ix.type === 'text') {
      if (!ix.dragged && Math.hypot(event.clientX - ix.startClient.x, event.clientY - ix.startClient.y) < 5) return;
      ix.dragged = true; ix.end = pt;
      setDraft({ id: 'draft', type: 'rect', x: Math.min(ix.start.x, pt.x), y: Math.min(ix.start.y, pt.y), w: Math.abs(pt.x - ix.start.x), h: Math.abs(pt.y - ix.start.y), color: '#6757d9', lineWidth: 0.8, dashed: true }); return;
    }
    if (ix.type === 'draw') {
      const p = ix.set && ix.tool !== 'draw' && snapping(event) ? snapPoint(pt, ix.set, thr) : pt;
      const s = ix.start; const old = ix.draft;
      if (ix.tool === 'draw') {
        const points = [...old.points, pt]; const xs = points.map((q) => q.x); const ys = points.map((q) => q.y);
        ix.draft = { ...old, points, x: Math.min(...xs), y: Math.min(...ys), w: Math.max(0.25, Math.max(...xs) - Math.min(...xs)), h: Math.max(0.25, Math.max(...ys) - Math.min(...ys)) };
      } else {
        let end = p;
        if (ix.tool === 'line' && event.shiftKey) { const ddx = Math.abs(end.x - s.x); const ddy = Math.abs(end.y - s.y); end = ddx > ddy ? { x: end.x, y: s.y } : { x: s.x, y: end.y }; }
        ix.draft = { ...old, x: Math.min(s.x, end.x), y: Math.min(s.y, end.y), w: Math.max(0.2, Math.abs(end.x - s.x)), h: Math.max(0.2, Math.abs(end.y - s.y)), ...(ix.tool === 'line' ? { startPoint: s, endPoint: end } : {}) };
      }
      setDraft({ ...ix.draft }); setSnapHits(p.hits || []); return;
    }
    if (ix.type === 'marquee') {
      const rect = { x: Math.min(ix.start.x, pt.x), y: Math.min(ix.start.y, pt.y), w: Math.abs(pt.x - ix.start.x), h: Math.abs(pt.y - ix.start.y) };
      setMarquee(rect); ix.rect = rect;
    }
  };

  const surfaceUp = () => {
    const ix = ixRef.current; if (!ix) return;
    ixRef.current = null; setSnapHits([]);
    if (ix.type === 'move') {
      if (ix.moved) { const changed = JSON.stringify(ix.before) !== JSON.stringify(annRef.current); if (changed) pushHistory(ix.before); }
      else if (ix.editOnClick) startEditing(ix.ids[0]);
    } else if (ix.type === 'resize') {
      if (JSON.stringify(ix.before) !== JSON.stringify(annRef.current)) pushHistory(ix.before);
    } else if (ix.type === 'text') {
      const d = textDefaults; const lh = d.size * d.lineHeight; const pad = 2;
      const dragged = ix.dragged && ix.end && Math.abs(ix.end.x - ix.start.x) > 14;
      const x = dragged ? Math.min(ix.start.x, ix.end.x) : ix.start.x - pad;
      const item = { id: uid(), type: 'text', x, y: dragged ? Math.min(ix.start.y, ix.end.y) : ix.start.y - lh / 2 - pad, w: dragged ? Math.abs(ix.end.x - ix.start.x) : d.size * 3, h: lh + 2 * pad, text: '', font: d.font, fontName: d.fontName || '', underline: !!d.underline, strike: !!d.strike, size: d.size, bold: d.bold, italic: d.italic, color: d.color, align: d.align, lineHeight: d.lineHeight, reflow: !!dragged };
      applyAnn(withList([...pageList(), item], ix.before), false);
      editStartRef.current = ix.before; setSelectedIds([item.id]); setEditingId(item.id); setToolState('select'); setDraft(null);
    } else if (ix.type === 'draw') {
      const d = ix.draft; const enough = ix.tool === 'draw' ? (d.points?.length || 0) > 1 : d.w > 2 || d.h > 2;
      if (enough) {
        const out = { ...d };
        if (ix.tool === 'highlight') out.h = Math.max(10, out.h);
        if (['underline', 'strike', 'line'].includes(ix.tool)) out.h = Math.max(1.5, out.h);
        commitAnn(withList([...pageList(), out], ix.before), ix.before); setSelectedIds([out.id]);
      } else setNotice('Drag on the page to draw the selected mark.');
      setDraft(null);
    } else if (ix.type === 'marquee') {
      const rect = ix.rect; setMarquee(null);
      if (!rect || (rect.w < 3 && rect.h < 3)) return;
      const hit = ix.pageItems.filter((i) => !i.deleted && rectsIntersect(rect, i)).map((i) => i.id);
      const done = new Set(ix.pageItems.map((i) => i.blockId).filter(Boolean));
      const extra = [...pageContent.blocks, ...pageContent.images].filter((b) => !done.has(b.id) && rectContains(rect, b)).map((b) => ensureBlockItem(b));
      setSelection([...new Set([...ix.base, ...hit, ...extra])]);
    }
  };

  // ---- commands ------------------------------------------------------------------------------------
  const deleteSelected = useCallback(() => {
    if (!selectedIds.length) return;
    const before = annRef.current;
    const list = pageList().flatMap((i) => {
      if (!selectedIds.includes(i.id)) return [i];
      return i.blockId ? [{ ...i, deleted: true }] : [];
    });
    commitAnn(withList(list), before); setSelectedIds([]); setEditingId(null);
  }, [commitAnn, pageList, selectedIds, withList]);

  const duplicateSelected = useCallback(() => {
    if (!selectedItems.length) return;
    const copies = selectedItems.map((i) => translateItem(detach(i), 12, 12));
    commitAnn(withList([...pageList(), ...copies])); setSelectedIds(copies.map((c) => c.id));
  }, [commitAnn, pageList, selectedItems, withList]);

  const reorder = useCallback((where) => {
    const list = pageList(); const chosen = list.filter((i) => selectedIds.includes(i.id)); const rest = list.filter((i) => !selectedIds.includes(i.id));
    commitAnn(withList(where === 'front' ? [...rest, ...chosen] : [...chosen, ...rest]));
  }, [commitAnn, pageList, selectedIds, withList]);

  const nudge = useCallback((dx, dy) => {
    if (!selectedIds.length) return;
    const before = annRef.current; const now = Date.now();
    const list = pageList().map((i) => (selectedIds.includes(i.id) ? translateItem(i, dx, dy) : i));
    if (now - nudgeRef.current > 700) pushHistory(before);
    nudgeRef.current = now; applyAnn(withList(list), true);
  }, [applyAnn, pageList, pushHistory, selectedIds, withList]);

  const doAlign = useCallback((mode) => {
    if (!selectedItems.length || !base) return;
    let target = { x: 0, y: 0, w: base.w, h: base.h };
    if (alignTo === 'margins') target = { x: margins.left, y: margins.top, w: base.w - margins.left - margins.right, h: base.h - margins.top - margins.bottom };
    else if (alignTo === 'selection' && selectedItems.length > 1) target = boundsOf(selectedItems);
    const moved = new Map(alignItems(selectedItems, mode, target).map((i) => [i.id, i]));
    commitAnn(withList(pageList().map((i) => moved.get(i.id) || i)));
  }, [alignTo, base, commitAnn, margins, pageList, selectedItems, withList]);

  const doDistribute = useCallback((axis) => {
    if (selectedItems.length < 3) return;
    const moved = new Map(distributeItems(selectedItems, axis).map((i) => [i.id, i]));
    commitAnn(withList(pageList().map((i) => moved.get(i.id) || i)));
  }, [commitAnn, pageList, selectedItems, withList]);

  const goToPage = useCallback((n) => {
    if (!Number.isFinite(n)) return;
    const next = clamp(Math.round(n), 1, pageCount || 1);
    if (next === pageNumber) return;
    if (editingId) finishEditing();
    setSelectedIds([]); setPageNumber(next);
  }, [editingId, finishEditing, pageCount, pageNumber]);

  const textTargets = selectedItems.filter((i) => TEXT_TYPES.has(i.type));
  const styleSource = textTargets[0];
  const formatStyle = styleSource ? { ...resolveText(styleSource), color: styleSource.color || '#000000' } : { ...textDefaults, family: textDefaults.font, fontName: textDefaults.fontName || '' };
  const onFormat = useCallback((patch) => {
    let next = patch;
    if ('font' in patch) {
      const choice = patch.font;
      const original = textTargets[0]?.origFont;
      if (choice === '__original__' && original) next = { ...patch, font: original.font, fontName: original.fontName, fontRef: original.fontRef, bold: textTargets[0].origBold, italic: textTargets[0].origItalic };
      else if (FONT_IDS.has(choice)) next = { ...patch, font: choice, fontName: '', fontRef: '' };
      else { const common = COMMON_FONTS.find((f) => f.name === choice); next = { ...patch, font: common?.base || 'helvetica', fontName: choice, fontRef: '' }; }
    }
    if (textTargets.length) patchItems(textTargets.map((i) => i.id), next);
    else setTextDefaults((prev) => ({ ...prev, ...next }));
  }, [patchItems, textTargets]);
  const onFormatKey = useCallback((key) => {
    const target = pageList().find((i) => i.id === editingId); if (!target) return;
    const r = resolveText(target);
    patchItems([target.id], key === 'b' ? { bold: !r.bold } : key === 'i' ? { italic: !r.italic } : { underline: !r.underline });
  }, [editingId, pageList, patchItems]);

  // ---- keyboard ------------------------------------------------------------------------------------
  useEffect(() => {
    const onKeyDown = (event) => {
      if (!active || !pdfDoc) return;
      const target = event.target;
      const typing = target instanceof HTMLElement && target.matches('textarea, input, select, [contenteditable="true"]');
      const mod = event.ctrlKey || event.metaKey; const key = event.key.toLowerCase();
      if (mod && key === 'z' && !typing) { event.preventDefault(); if (event.shiftKey) redo(); else undo(); }
      else if (mod && key === 'y' && !typing) { event.preventDefault(); redo(); }
      else if (typing) return;
      else if (mod && key === 'd') { event.preventDefault(); duplicateSelected(); }
      else if (mod && key === 'c' && selectedItems.length) { clipboardRef.current = selectedItems.map((i) => ({ ...i })); }
      else if (mod && key === 'v' && clipboardRef.current.length) { event.preventDefault(); const copies = clipboardRef.current.map((i) => translateItem(detach(i), 12, 12)); commitAnn(withList([...pageList(), ...copies])); setSelectedIds(copies.map((c) => c.id)); clipboardRef.current = copies.map((c) => ({ ...c })); }
      else if (mod && key === 'a') { event.preventDefault(); setSelection(pageList().filter((i) => !i.deleted).map((i) => i.id)); }
      else if (mod && key === '0') { event.preventDefault(); setZoom({ mode: 'page', value: CSS_PT }); }
      else if (mod && key === '1') { event.preventDefault(); setZoom({ mode: 'custom', value: CSS_PT }); }
      else if (mod && key === '2') { event.preventDefault(); setZoom({ mode: 'width', value: CSS_PT }); }
      else if (mod && (key === '=' || key === '+' || event.code === 'NumpadAdd')) { event.preventDefault(); zoomStep(1); }
      else if (mod && (key === '-' || key === '_' || event.code === 'NumpadSubtract')) { event.preventDefault(); zoomStep(-1); }
      else if (mod && key === 'w' && (standalone || onCloseTab)) { event.preventDefault(); if (standalone) window.pdfStudio?.closeEditor?.(); else onCloseTab?.(); }
      else if (mod) return;
      else if (key === ' ') { event.preventDefault(); if (!spaceRef.current) { spaceRef.current = true; setSpaceHeld(true); } }
      else if (key === 'delete' || key === 'backspace') { if (selectedIds.length && tool === 'select') { event.preventDefault(); deleteSelected(); } }
      else if (key.startsWith('arrow') && selectedIds.length) { event.preventDefault(); const step = event.shiftKey ? 10 : 1; nudge(key === 'arrowleft' ? -step : key === 'arrowright' ? step : 0, key === 'arrowup' ? -step : key === 'arrowdown' ? step : 0); }
      else if (key.startsWith('arrow')) { event.preventDefault(); const st = stageRef.current; const amount = event.shiftKey ? 320 : 80; st?.scrollBy({ left: key === 'arrowleft' ? -amount : key === 'arrowright' ? amount : 0, top: key === 'arrowup' ? -amount : key === 'arrowdown' ? amount : 0 }); }
      else if (key === 'pagedown' || key === 'pageup') {
        event.preventDefault();
        const st = stageRef.current; const dir = key === 'pagedown' ? 1 : -1;
        const edge = dir > 0 ? st.scrollTop + st.clientHeight >= st.scrollHeight - 2 : st.scrollTop <= 2;
        if (!edge) st.scrollBy({ top: dir * st.clientHeight * 0.9 });
        else if (dir > 0 && pageNumber < pageCount) { goToPage(pageNumber + 1); requestAnimationFrame(() => { st.scrollTop = 0; }); }
        else if (dir < 0 && pageNumber > 1) { goToPage(pageNumber - 1); requestAnimationFrame(() => { st.scrollTop = st.scrollHeight; }); }
      }
      else if (key === 'home') { event.preventDefault(); goToPage(1); }
      else if (key === 'end') { event.preventDefault(); goToPage(pageCount); }
      else if (key === 'enter' && single && TEXT_TYPES.has(single.type) && !editingId) { event.preventDefault(); startEditing(single.id); }
      else if (key === 'escape') { setDraft(null); ixRef.current = null; setMarquee(null); setSnapHits([]); if (selectedIds.length) setSelection([]); else setToolState('select'); }
      else if (key === 'v') setTool('select');
      else if (key === 't') setTool('text');
      else if (key === 'i') setTool('image');
    };
    const onKeyUp = (event) => { if (event.key === ' ' && spaceRef.current) { spaceRef.current = false; setSpaceHeld(false); } };
    window.addEventListener('keydown', onKeyDown); window.addEventListener('keyup', onKeyUp);
    return () => { window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp); };
  }, [active, commitAnn, deleteSelected, duplicateSelected, editingId, goToPage, nudge, onCloseTab, pageCount, pageList, pageNumber, pdfDoc, redo, selectedIds, selectedItems, setSelection, setTool, single, standalone, startEditing, tool, undo, withList, zoomStep]);

  // ---- save ----------------------------------------------------------------------------------------
  const savePdf = useCallback(async () => {
    if (!pdfDoc || !sourceBytes) { notify?.('Open a PDF before saving edits.', 'error'); return; }
    try {
      finishEditing(); setBusy(true); setNotice('Applying edits and preparing the PDF…');
      const clean = {};
      for (const [key, list] of Object.entries(annRef.current)) clean[key] = list.filter((i) => !isPristine(i) && !(i.type === 'text' && !(i.text || '').trim()));
      const bytes = await exportEditedPdf(sourceBytes, pdfDoc, clean, { title: `${cleanName(fileName)} (edited)`, findFont: window.pdfStudio?.findFont });
      const name = `${cleanName(fileName)}-edited.pdf`;
      const result = window.pdfStudio?.saveFile ? await window.pdfStudio.saveFile({ name, data: bytes, filters: [{ name: 'PDF document', extensions: ['pdf'] }] }) : await saveInBrowser(bytes, name, 'application/pdf');
      if (result?.canceled) setNotice('Save cancelled. Your edits are still in this session.');
      else { setDirty(false); setNotice('Edited PDF saved. The original file was left unchanged.'); notify?.('Edited PDF saved successfully.', 'success'); }
    } catch (error) {
      console.error('Unable to save edited PDF', error);
      const message = error?.message || 'PDF Studio could not save this edited PDF.';
      setNotice(message); notify?.(message, 'error');
    } finally { setBusy(false); }
  }, [fileName, finishEditing, notify, pdfDoc, sourceBytes]);

  useEffect(() => {
    const onShortcut = (event) => {
      if (!active || !(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === 's') { event.preventDefault(); event.stopPropagation(); savePdf(); }
      else if (key === 'o' && !(event.target instanceof HTMLElement && event.target.matches('textarea, input, select'))) { event.preventDefault(); event.stopPropagation(); openPdf(); }
    };
    window.addEventListener('keydown', onShortcut);
    return () => window.removeEventListener('keydown', onShortcut);
  }, [active, openPdf, savePdf]);

  // ---- render --------------------------------------------------------------------------------------
  const onTextChange = useCallback((id, value) => {
    const key = pageKey;
    const list = (annRef.current[key] || []).map((i) => (i.id === id ? applyPatch(i, { text: value }) : i));
    applyAnn({ ...annRef.current, [key]: list }, true);
  }, [applyAnn, pageKey]);

  const covered = useMemo(() => new Set(items.map((i) => i.blockId).filter(Boolean)), [items]);
  const selectionBounds = selectedItems.length ? boundsOf(selectedItems) : null;
  const band = selectionBounds ? { x: { start: selectionBounds.x, end: selectionBounds.x + selectionBounds.w }, y: { start: selectionBounds.y, end: selectionBounds.y + selectionBounds.h } } : null;
  const px = (v) => v * scale;
  const interactive = tool === 'select';
  const gridPx = view.gridSize * scale;
  const hasWorkspacePdfs = documents.some((d) => d.kind === 'pdf' && sourcesRef?.current?.has(d.id));
  const surfaceStyle = base ? { width: px(base.w), height: px(base.h) } : undefined;
  if (surfaceStyle && view.grid && gridPx > 5) {
    surfaceStyle.backgroundImage = 'linear-gradient(to right, rgba(60,80,200,.16) 1px, transparent 1px), linear-gradient(to bottom, rgba(60,80,200,.16) 1px, transparent 1px)';
    surfaceStyle.backgroundSize = `${gridPx}px ${gridPx}px`;
  }
  const guides = view.showGuides ? pageGuides : EMPTY_GUIDES;
  const activeDraftIndex = draftGuide ? `${draftGuide.axis}${draftGuide.index}` : null;

  return (
    <section className={cx('ep-view', standalone && 'is-standalone')} onDragOver={(event) => event.preventDefault()} onDrop={onDropFile}>
      <input ref={fileInputRef} className="hidden-input" type="file" accept="application/pdf,.pdf" onChange={onPdfInputChange} />
      <input ref={imageInputRef} className="hidden-input" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/bmp" onChange={handleImageInput} />
      <input ref={replaceInputRef} className="hidden-input" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/bmp" onChange={handleReplaceInput} />
      <header className="ep-header">
        <div><h1><FilePenLine size={20} /> Edit PDF</h1><p>Edit existing text and images, add your own, and line everything up with rulers, guides and margins.</p></div>
        <div className="ep-header-actions">
          {!standalone && hasWorkspacePdfs && <select className="ep-select" aria-label="Choose a PDF already in your workspace" value={loadedSourceId || ''} onChange={switchToWorkspacePdf} disabled={busy}><option value="">Workspace PDFs…</option>{documents.filter((d) => d.kind === 'pdf' && sourcesRef?.current?.has(d.id)).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>}
          <button type="button" className="ep-btn" onClick={openPdf} disabled={busy}><FolderOpen size={16} /> Open PDF</button>
          <button type="button" className="ep-btn ep-btn-primary" onClick={savePdf} disabled={!pdfDoc || busy}><Save size={16} /> {busy ? 'Working…' : 'Save as PDF'}{dirty && <span className="ep-dot" title="Unsaved edits" />}</button>
        </div>
      </header>

      {notice && <div className={cx('ep-notice', /saved/i.test(notice) && 'is-ok')} role="status"><span>{notice}</span><button type="button" onClick={() => setNotice('')} aria-label="Dismiss"><X size={14} /></button></div>}

      {!pdfDoc ? (
        <div className="ep-empty">
          <div className="ep-empty-icon"><FilePenLine size={30} /></div>
          <h2>Edit text, images and layout in your PDF</h2>
          <p>Open a PDF, click any text or image to change it, and use guides and margins to keep it aligned. Your original file stays unchanged.</p>
          <button type="button" className="ep-btn ep-btn-primary" onClick={openPdf} disabled={busy}><FolderOpen size={17} /> Choose a PDF to edit</button>
          <div className="ep-empty-points"><span><ShieldCheck size={15} /> Processed on this device</span><span><Save size={15} /> Saved as a new PDF</span></div>
        </div>
      ) : (
        <div className={cx('ep-shell', !panels.tools && 'is-tools-collapsed', !panels.pages && 'is-pages-collapsed', !panels.properties && 'is-properties-collapsed', panels.pages && 'is-pages-open')}>
          <ToolRail tool={tool} onTool={setTool} collapsed={!panels.tools} />
          <aside className="ep-pages" aria-label="Pages" aria-hidden={!panels.pages}>
            <div className="ep-pages-title"><span>Pages</span><b>{pageCount}</b></div>
            <div className="ep-pages-list">
              {Array.from({ length: pageCount }, (_, i) => i + 1).map((n) => (
                <button type="button" key={n} className={cx('ep-page-btn', n === pageNumber && 'is-active')} onClick={() => goToPage(n)}>
                  <PageThumb pdfDoc={pdfDoc} pageNumber={n} /><span>{n}</span>{(ann[String(n - 1)] || []).filter((i) => !isPristine(i)).length > 0 && <small>{(ann[String(n - 1)] || []).filter((i) => !isPristine(i)).length}</small>}
                </button>
              ))}
            </div>
          </aside>

          <main className="ep-main">
            <DocBar fileName={fileName} dirty={dirty} pageNumber={pageNumber} pageCount={pageCount} onPage={goToPage} zoomPercent={zoomPercent} zoomMode={zoom.mode} onZoomStep={zoomStep}
              onZoomPreset={(p) => setZoom({ mode: 'custom', value: p / 100 * CSS_PT })} onFit={(mode) => setZoom({ mode, value: CSS_PT })}
              canUndo={undoRef.current.length > 0 && historyVersion >= 0} canRedo={redoRef.current.length > 0} onUndo={undo} onRedo={redo} view={view} setView={setView} panels={panels} onTogglePanel={togglePanel} />
            <FormatBar original={styleSource?.origFont?.fontName || (styleSource?.origFont ? 'PDF font' : '')} style={formatStyle} onStyle={onFormat} hasTextTarget={textTargets.length > 0} selectionCount={selectedItems.length} alignTo={alignTo} setAlignTo={setAlignTo}
              onAlign={doAlign} onDistribute={doDistribute} canAlign={selectedItems.length > 0} canDistribute={selectedItems.length >= 3} />
            <div className={cx('ep-canvas-area', view.rulers && 'has-rulers')} style={{ '--ep-ruler': `${RULER_SIZE}px` }}>
              {view.rulers && base && <RulersLayer bus={cursorBus} view={measure} unit={view.unit} scale={scale} base={base} band={band} onGuideStart={beginGuideDrag} />}
              <div className={cx('ep-stage', spaceHeld && 'is-pan', panning && 'is-panning')} ref={stageRef} onPointerDownCapture={stagePointerDown} onPointerMove={stagePointerMove} onPointerUp={stagePointerUp} onPointerCancel={stagePointerUp} onPointerLeave={() => cursorBus.current.forEach((fn) => fn(null))} onAuxClick={(event) => event.preventDefault()}>
                <div className="ep-hint-pill">{tool === 'select' ? 'Click text or an image to edit it. Drag to move it.' : toolInfo.hint}</div>
                <div className="ep-page-wrap">
                  <div ref={surfaceRef} className={cx('ep-surface', `tool-${tool}`, editingId && 'is-editing')} style={surfaceStyle} onPointerDown={surfaceDown} onPointerMove={surfaceMove} onPointerUp={surfaceUp} onPointerCancel={surfaceUp}>
                    <canvas ref={canvasRef} className="ep-canvas" style={surfaceStyle} aria-label={`PDF page ${pageNumber}`} />
                    {base && (
                      <>
                        {view.showMargins && (
                          <div className="ep-margins" aria-hidden="true">
                            <div className="ep-margin-box" style={{ left: px(margins.left), top: px(margins.top), right: px(margins.right), bottom: px(margins.bottom) }} />
                            {['left', 'right', 'top', 'bottom'].map((side) => <i key={side} data-margin={side} className={cx('ep-margin-line', `is-${side}`, view.guidesLocked && 'is-locked')} style={side === 'left' ? { left: px(margins.left) } : side === 'right' ? { right: px(margins.right) } : side === 'top' ? { top: px(margins.top) } : { bottom: px(margins.bottom) }} title={`${side} margin: drag to adjust`} />)}
                          </div>
                        )}
                        <div className="ep-covers" aria-hidden="true">{items.filter((i) => i.src && (i.type === 'textedit' || i.data || i.deleted)).map((i) => <i key={i.id} style={{ left: px(i.src.x - 0.75), top: px(i.src.y - 0.75), width: px(i.src.w + 1.5), height: px(i.src.h + 1.5), background: i.cover }} />)}</div>
                        {interactive && <div className="ep-blocks">{[...pageContent.blocks, ...pageContent.images].filter((b) => !covered.has(b.id)).map((b) => <i key={b.id} data-block={b.id} className={cx('ep-block', b.kind === 'image' && 'is-image')} style={{ left: px(b.x - 1), top: px(b.y - 1), width: px(b.w + 2), height: px(b.h + 2) }} />)}</div>}
                        <div className="ep-objects">
                          {items.map((i) => <ObjectView key={i.id} item={i} scale={scale} selected={selectedIds.includes(i.id)} editing={editingId === i.id} interactive={interactive} showHandles={interactive && single?.id === i.id && !i.deleted} onTextChange={onTextChange} onFinish={finishEditing} onFormatKey={onFormatKey} />)}
                          {draft && (draft.dashed ? <div className="ep-draft-box" style={{ left: px(draft.x), top: px(draft.y), width: px(draft.w), height: px(draft.h) }} /> : <ObjectView item={draft} scale={scale} selected={false} editing={false} interactive={false} showHandles={false} onTextChange={onTextChange} onFinish={finishEditing} />)}
                          {selectedItems.length > 1 && selectionBounds && <div className="ep-group-box" style={{ left: px(selectionBounds.x), top: px(selectionBounds.y), width: px(selectionBounds.w), height: px(selectionBounds.h) }} />}
                        </div>
                        <div className="ep-guides">
                          {['v', 'h'].map((axis) => (guides[axis] || []).map((pos, index) => (activeDraftIndex === `${axis}${index}` ? null : <i key={`${axis}${index}`} data-guide data-axis={axis} data-index={index} className={cx('ep-guide', `is-${axis}`, view.guidesLocked && 'is-locked')} style={axis === 'v' ? { left: px(pos) } : { top: px(pos) }} title={`${formatUnit(pos, view.unit, true)}. Drag to move, drag off the page to remove`} />)))}
                          {draftGuide && <i className={cx('ep-guide is-draft', `is-${draftGuide.axis}`, (draftGuide.pos < 0 || draftGuide.pos > (draftGuide.axis === 'v' ? base.w : base.h)) && 'is-removing')} style={draftGuide.axis === 'v' ? { left: px(draftGuide.pos) } : { top: px(draftGuide.pos) }}><b>{formatUnit(draftGuide.pos, view.unit, true)}</b></i>}
                          {snapHits.map((hit, index) => <i key={`s${index}`} className={cx('ep-snap', `is-${hit.axis}`, `k-${hit.kind}`)} style={hit.axis === 'v' ? { left: px(hit.pos), top: hit.from != null ? px(hit.from) : 0, bottom: hit.to != null ? `calc(100% - ${px(hit.to)}px)` : 0 } : { top: px(hit.pos), left: hit.from != null ? px(hit.from) : 0, right: hit.to != null ? `calc(100% - ${px(hit.to)}px)` : 0 }} />)}
                        </div>
                        {marquee && <div className="ep-marquee" style={{ left: px(marquee.x), top: px(marquee.y), width: px(marquee.w), height: px(marquee.h) }} />}
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
            <footer className="ep-status"><span>Page {pageNumber} of {pageCount}</span><Coords bus={cursorBus} unit={view.unit} /><span>{zoomPercent}%</span><span>{items.filter((i) => !isPristine(i)).length} change{items.filter((i) => !isPristine(i)).length === 1 ? '' : 's'} on this page</span><span className="ep-status-end"><ShieldCheck size={13} /> Local editing</span></footer>
          </main>

          <SidePanel tab={tab} setTab={setTab} unit={view.unit} setUnit={(unit) => setView({ unit })} selected={selectedItems} single={single}
            onPatch={(patch) => single && patchItems([single.id], patch)} onDelete={deleteSelected} onDuplicate={duplicateSelected} onOrder={reorder} onReplaceImage={() => replaceInputRef.current?.click()}
            defaults={defaults} setDefaults={(patch) => setDefaultsState((prev) => ({ ...prev, ...patch }))} stampText={stampText} setStampText={setStampText} tool={tool}
            pageSize={base || { w: 612, h: 792 }} view={view} setView={setView} margins={margins} setMargins={setMargins} guides={pageGuides} onGuides={onGuides}
            onApplyGuidesAll={() => { const all = {}; for (let n = 0; n < pageCount; n += 1) all[String(n)] = { v: [...(pageGuides.v || [])], h: [...(pageGuides.h || [])] }; setGuidesByPage(all); notify?.('Guides copied to every page.', 'success'); }}
            onClearGuides={() => setGuides(pageKey, EMPTY_GUIDES)} onSave={savePdf} busy={busy} dirty={dirty} />
        </div>
      )}

      {signatureOpen && <SignatureDialog notify={notify} onClose={() => { setSignatureOpen(false); setToolState('select'); }} onUse={(signature) => { setPendingImage(signature); setSignatureOpen(false); setToolState('signature'); setNotice('Signature ready. Click the page to place it.'); }} />}
    </section>
  );
}
