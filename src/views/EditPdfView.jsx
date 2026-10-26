import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlignLeft, ArrowDownToLine, Bold, Check, ChevronLeft, ChevronRight, Circle,
  Eraser, FilePenLine, FileText, FolderOpen, Highlighter, ImagePlus, Italic, StickyNote,
  Minus, MousePointer2, Move, Pencil, PenLine, Redo2, RotateCcw, Save,
  ShieldCheck, Signature, Square, Stamp, Trash2, Type, Underline as UnderlineIcon,
  Undo2, X, ZoomIn, ZoomOut,
} from 'lucide-react';
import { loadPdfSource } from '../services/pdf/pdfjs.js';
import { exportEditedPdf } from '../services/pdf/edit.js';
import { saveInBrowser } from '../utils/download.js';
import { normalizeBytes } from '../utils/files.js';
import { cx } from '../utils/cx.js';

const TOOLS = [
  { id: 'select', label: 'Select', icon: MousePointer2, hint: 'Select, move, resize, or edit placed items' },
  { id: 'text', label: 'Add text', icon: Type, hint: 'Click the page to add editable text' },
  { id: 'signature', label: 'Signature', icon: Signature, hint: 'Draw or type a signature, then click the page' },
  { id: 'highlight', label: 'Highlight', icon: Highlighter, hint: 'Drag across content to highlight' },
  { id: 'underline', label: 'Underline', icon: UnderlineIcon, hint: 'Drag under content to add a line' },
  { id: 'strike', label: 'Strikeout', icon: Minus, hint: 'Drag across content to strike it through' },
  { id: 'draw', label: 'Freehand', icon: Pencil, hint: 'Draw on the page with your pointer' },
  { id: 'rect', label: 'Rectangle', icon: Square, hint: 'Drag to draw a rectangle' },
  { id: 'ellipse', label: 'Oval', icon: Circle, hint: 'Drag to draw an oval' },
  { id: 'line', label: 'Line', icon: PenLine, hint: 'Drag to draw a line' },
  { id: 'whiteout', label: 'Whiteout', icon: Eraser, hint: 'Cover visible content with a white shape; this is not secure redaction' },
  { id: 'stamp', label: 'Stamp', icon: Stamp, hint: 'Place a reusable status stamp' },
  { id: 'note', label: 'Note', icon: StickyNote, hint: 'Place a yellow comment note' },
  { id: 'image', label: 'Add image', icon: ImagePlus, hint: 'Place an image or scanned signature' },
];

const STAMPS = ['APPROVED', 'DRAFT', 'CONFIDENTIAL', 'RECEIVED', 'PAID', 'REVIEWED'];
const DEFAULT_COLOR = '#313b50';
const idFor = () => globalThis.crypto?.randomUUID?.() || `edit-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const cleanName = (value) => String(value || 'document.pdf').replace(/\.pdf$/i, '');

export default function EditPdfView({ active = true, documents = [], sourcesRef, initialDocument, notify }) {
  const [pdfDoc, setPdfDoc] = useState(null);
  const [sourceBytes, setSourceBytes] = useState(null);
  const [fileName, setFileName] = useState('');
  const [loadedSourceId, setLoadedSourceId] = useState(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [activeTool, setActiveTool] = useState('select');
  const [annotationsByPage, setAnnotationsByPage] = useState({});
  const [selectedId, setSelectedId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [highlightColor, setHighlightColor] = useState('#f6d64a');
  const [fontSize, setFontSize] = useState(16);
  const [fontStyle, setFontStyle] = useState('regular');
  const [lineWidth, setLineWidth] = useState(2.2);
  const [stampText, setStampText] = useState('APPROVED');
  const [zoom, setZoom] = useState(1);
  const [dimensions, setDimensions] = useState(null);
  const [stageSize, setStageSize] = useState({ width: 900, height: 700 });
  const [draftAnnotation, setDraftAnnotation] = useState(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [signatureOpen, setSignatureOpen] = useState(false);
  const [signatureMode, setSignatureMode] = useState('draw');
  const [signatureText, setSignatureText] = useState('Your signature');
  const [signatureColor, setSignatureColor] = useState('#172033');
  const [hasSignatureInk, setHasSignatureInk] = useState(false);
  const [pendingImage, setPendingImage] = useState(null);
  const [notice, setNotice] = useState('');
  const canvasRef = useRef(null);
  const stageRef = useRef(null);
  const surfaceRef = useRef(null);
  const signatureCanvasRef = useRef(null);
  const fileInputRef = useRef(null);
  const imageInputRef = useRef(null);
  const interactionRef = useRef(null);
  const hasAutoLoadedRef = useRef(false);
  const annotationMapRef = useRef({});
  const undoStackRef = useRef([]);
  const redoStackRef = useRef([]);
  const editStartRef = useRef(null);

  const pageCount = pdfDoc?.numPages || 0;
  const currentKey = String(pageNumber - 1);
  const annotations = annotationsByPage[currentKey] || [];
  const selectedAnnotation = annotations.find((item) => item.id === selectedId) || null;
  const activeToolInfo = TOOLS.find((tool) => tool.id === activeTool) || TOOLS[0];

  const assignMap = useCallback((next, markDirty = true) => {
    annotationMapRef.current = next;
    setAnnotationsByPage(next);
    if (markDirty) setDirty(true);
  }, []);

  const commitMap = useCallback((next) => {
    undoStackRef.current.push(annotationMapRef.current);
    if (undoStackRef.current.length > 100) undoStackRef.current.shift();
    redoStackRef.current = [];
    assignMap(next, true);
  }, [assignMap]);

  const changeCurrent = useCallback((producer) => {
    const before = annotationMapRef.current;
    const key = String(pageNumber - 1);
    const list = before[key] || [];
    const nextList = typeof producer === 'function' ? producer(list) : producer;
    if (nextList === list) return;
    commitMap({ ...before, [key]: nextList });
  }, [commitMap, pageNumber]);

  const loadDocument = useCallback(async ({ name, bytes, pdf, sourceId = null }) => {
    try {
      setBusy(true);
      setNotice('Opening PDF…');
      const normalized = normalizeBytes(bytes).slice();
      const loaded = pdf || await loadPdfSource(normalized);
      // Touch the first page early so invalid or encrypted files fail here with a useful message.
      await loaded.getPage(1);
      setPdfDoc(loaded);
      setSourceBytes(normalized);
      setFileName(name || 'document.pdf');
      setLoadedSourceId(sourceId || null);
      setPageNumber(1);
      setAnnotationsByPage({});
      annotationMapRef.current = {};
      undoStackRef.current = [];
      redoStackRef.current = [];
      setSelectedId(null);
      setEditingId(null);
      setDraftAnnotation(null);
      setDirty(false);
      setZoom(1);
      setNotice('');
    } catch (error) {
      console.error('Unable to load PDF for editing', error);
      const detail = /password|encrypted/i.test(error?.message || '')
        ? 'This PDF is password-protected. Open an unlocked copy to edit and save it.'
        : (error?.message || 'The selected file could not be opened as a PDF.');
      setNotice(detail);
      notify?.(detail, 'error');
    } finally {
      setBusy(false);
    }
  }, [notify]);

  useEffect(() => {
    if (!active || hasAutoLoadedRef.current || pdfDoc || !initialDocument || initialDocument.kind !== 'pdf' || !sourcesRef?.current) return;
    const source = sourcesRef.current.get(initialDocument.id);
    if (!source?.bytes) return;
    hasAutoLoadedRef.current = true;
    loadDocument({ name: source.name, bytes: source.bytes, pdf: source.pdf, sourceId: source.id });
  }, [active, initialDocument?.id, pdfDoc, loadDocument, sourcesRef]); // keep editor state when navigating between sections

  const openPdf = useCallback(async () => {
    if (dirty && !window.confirm('You have unsaved edits. Opening another PDF will discard those edits. Continue?')) return;
    if (window.pdfStudio?.openFiles) {
      try {
        const items = await window.pdfStudio.openFiles();
        const file = items?.find((item) => item.kind === 'pdf' || item.mime === 'application/pdf' || /\.pdf$/i.test(item.name || ''));
        if (!file) {
          if (items?.length) notify?.('Choose a PDF file to use the Edit PDF workspace.', 'error');
          return;
        }
        await loadDocument({ name: file.name, bytes: file.bytes });
      } catch (error) {
        notify?.(error?.message || 'Could not open the selected PDF.', 'error');
      }
      return;
    }
    fileInputRef.current?.click();
  }, [dirty, loadDocument, notify]);

  const switchToWorkspacePdf = useCallback(async (event) => {
    const sourceId = event.target.value;
    if (!sourceId || sourceId === loadedSourceId) return;
    if (dirty && !window.confirm('You have unsaved edits. Switching PDFs will discard those edits. Continue?')) return;
    const source = sourcesRef?.current?.get(sourceId);
    if (!source?.bytes || source.kind !== 'pdf') {
      notify?.('That PDF is no longer available in the current workspace.');
      return;
    }
    await loadDocument({ name: source.name, bytes: source.bytes, pdf: source.pdf, sourceId: source.id });
  }, [dirty, loadedSourceId, loadDocument, notify, sourcesRef]);

  const onPdfInputChange = useCallback(async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
      notify?.('Please choose a PDF file.', 'error');
      return;
    }
    await loadDocument({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
  }, [loadDocument, notify]);

  useEffect(() => {
    if (!stageRef.current || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) setStageSize({ width: rect.width, height: rect.height });
    });
    observer.observe(stageRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!pdfDoc || !canvasRef.current) return undefined;
    let cancelled = false;
    let renderTask;
    const renderPage = async () => {
      try {
        const page = await pdfDoc.getPage(pageNumber);
        if (cancelled) return;
        const base = page.getViewport({ scale: 1, rotation: page.rotate || 0 });
        const availableWidth = Math.max(220, stageSize.width - 68);
        const availableHeight = Math.max(260, stageSize.height - 58);
        const fit = Math.min(availableWidth / base.width, availableHeight / base.height, 1.28);
        const scale = Math.max(0.25, fit * zoom);
        const viewport = page.getViewport({ scale, rotation: page.rotate || 0 });
        const canvas = canvasRef.current;
        const context = canvas?.getContext('2d', { alpha: false });
        if (!canvas || !context) return;
        const outputScale = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        context.fillStyle = '#fff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        renderTask = page.render({ canvasContext: context, viewport, transform: outputScale === 1 ? null : [outputScale, 0, 0, outputScale, 0, 0], background: '#fff' });
        await renderTask.promise;
        if (cancelled) return;
        setDimensions({ width: viewport.width, height: viewport.height, scale, baseWidth: base.width, baseHeight: base.height, rotation: page.rotate || 0 });
      } catch (error) {
        if (!cancelled && error?.name !== 'RenderingCancelledException') {
          console.error('PDF page rendering failed', error);
          setNotice(error?.message || 'This PDF page could not be rendered.');
        }
      }
    };
    renderPage();
    return () => { cancelled = true; try { renderTask?.cancel?.(); } catch { /* no-op */ } };
  }, [pdfDoc, pageNumber, zoom, stageSize.width, stageSize.height]);

  const toPercent = useCallback((event) => {
    const rect = surfaceRef.current?.getBoundingClientRect();
    if (!rect) return { x: 50, y: 50 };
    return { x: clamp((event.clientX - rect.left) / rect.width * 100, 0, 100), y: clamp((event.clientY - rect.top) / rect.height * 100, 0, 100) };
  }, []);

  const placeAnnotation = useCallback((annotation) => {
    const withId = { id: idFor(), ...annotation };
    changeCurrent((list) => [...list, withId]);
    setSelectedId(withId.id);
    setEditingId(withId.type === 'text' || withId.type === 'note' ? withId.id : null);
    if (withId.type === 'text' || withId.type === 'note') editStartRef.current = annotationMapRef.current;
    setActiveTool('select');
  }, [changeCurrent]);

  const pointerDownOnSurface = useCallback((event) => {
    if (!pdfDoc || busy) return;
    if (event.button !== 0) return;
    const position = toPercent(event);
    if (activeTool === 'select') {
      setSelectedId(null);
      setEditingId(null);
      return;
    }
    if (activeTool === 'text') {
      event.preventDefault();
      placeAnnotation({ type: 'text', x: position.x, y: position.y, w: 25, h: 6, text: '', color: DEFAULT_COLOR, size: Number(fontSize), fontStyle, lineWidth: Number(lineWidth) });
      return;
    }
    if (activeTool === 'signature') {
      if (!pendingImage?.kind || pendingImage.kind !== 'signature') {
        setSignatureOpen(true);
        return;
      }
      placeAnnotation({ type: 'signature', x: position.x, y: position.y, w: 30, h: 9, data: pendingImage.data, mime: 'image/png', color: signatureColor, size: Number(fontSize), lineWidth: Number(lineWidth) });
      setPendingImage(null);
      return;
    }
    if (activeTool === 'image') {
      if (!pendingImage?.data || pendingImage.kind === 'signature') {
        imageInputRef.current?.click();
        return;
      }
      const ratio = pendingImage.width && pendingImage.height ? pendingImage.height / pendingImage.width : 0.65;
      placeAnnotation({ type: 'image', x: position.x, y: position.y, w: 26, h: clamp(26 * ratio, 8, 35), data: pendingImage.data, mime: pendingImage.mime, lineWidth: Number(lineWidth) });
      setPendingImage(null);
      return;
    }
    if (activeTool === 'note') {
      placeAnnotation({ type: 'note', x: clamp(position.x, 0, 76), y: clamp(position.y, 0, 78), w: 24, h: 18, text: '', color: '#55461a', size: Number(fontSize), fontStyle: 'regular', lineWidth: Number(lineWidth) });
      return;
    }
    if (activeTool === 'stamp') {
      placeAnnotation({ type: 'stamp', x: clamp(position.x, 0, 70), y: clamp(position.y, 0, 90), w: 28, h: 7, text: stampText, color, size: Number(fontSize), fontStyle: 'bold', lineWidth: Number(lineWidth) });
      return;
    }

    const startAnnotations = annotationMapRef.current;
    const draft = {
      id: idFor(), type: activeTool, x: position.x, y: position.y, w: 0.2, h: 0.2,
      color: activeTool === 'highlight' ? highlightColor : color, size: Number(fontSize), fontStyle, lineWidth: Number(lineWidth),
      opacity: activeTool === 'highlight' ? 0.34 : 1,
      points: activeTool === 'draw' ? [position] : undefined,
      startPoint: activeTool === 'line' ? position : undefined,
      endPoint: activeTool === 'line' ? position : undefined,
    };
    interactionRef.current = { type: 'draw', tool: activeTool, start: position, startAnnotations, draft };
    setDraftAnnotation(draft);
    surfaceRef.current?.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }, [activeTool, busy, color, highlightColor, fontSize, fontStyle, lineWidth, pdfDoc, pendingImage, placeAnnotation, signatureColor, stampText, toPercent]);

  const pointerMoveOnSurface = useCallback((event) => {
    const interaction = interactionRef.current;
    if (!interaction || !surfaceRef.current) return;
    const position = toPercent(event);
    if (interaction.type === 'draw') {
      const start = interaction.start;
      if (interaction.tool === 'draw') {
        const old = interaction.draft;
        const points = [...(old.points || []), position];
        const xs = points.map((point) => point.x);
        const ys = points.map((point) => point.y);
        const x = Math.min(...xs);
        const y = Math.min(...ys);
        interaction.draft = { ...old, points, x, y, w: Math.max(0.25, Math.max(...xs) - x), h: Math.max(0.25, Math.max(...ys) - y) };
      } else {
        interaction.draft = { ...interaction.draft, x: Math.min(start.x, position.x), y: Math.min(start.y, position.y), w: Math.max(0.2, Math.abs(position.x - start.x)), h: Math.max(0.2, Math.abs(position.y - start.y)), ...(interaction.tool === 'line' ? { startPoint: start, endPoint: position } : {}) };
      }
      setDraftAnnotation({ ...interaction.draft });
      return;
    }
    const deltaX = position.x - interaction.start.x;
    const deltaY = position.y - interaction.start.y;
    const key = String(pageNumber - 1);
    const current = annotationMapRef.current;
    const list = current[key] || [];
    const nextList = list.map((annotation) => {
      if (annotation.id !== interaction.id) return annotation;
      if (interaction.type === 'resize') {
        return { ...annotation, w: clamp(interaction.original.w + deltaX, 1, 100 - interaction.original.x), h: clamp(interaction.original.h + deltaY, 1, 100 - interaction.original.y) };
      }
      return { ...annotation, x: clamp(interaction.original.x + deltaX, 0, 100 - interaction.original.w), y: clamp(interaction.original.y + deltaY, 0, 100 - interaction.original.h) };
    });
    assignMap({ ...current, [key]: nextList }, true);
  }, [assignMap, pageNumber, toPercent]);

  const pointerUpOnSurface = useCallback(() => {
    const interaction = interactionRef.current;
    if (!interaction) return;
    if (interaction.type === 'draw') {
      const draft = interaction.draft;
      const enough = interaction.tool === 'draw'
        ? (draft.points?.length || 0) > 1
        : draft.w > 0.65 || draft.h > 0.65;
      const normalized = { ...draft };
      if (interaction.tool === 'highlight') normalized.h = Math.max(2.8, normalized.h);
      if (interaction.tool === 'underline' || interaction.tool === 'strike' || interaction.tool === 'line') normalized.h = Math.max(1.2, normalized.h);
      if (enough) {
        const key = String(pageNumber - 1);
        const next = { ...interaction.startAnnotations, [key]: [...(interaction.startAnnotations[key] || []), normalized] };
        commitMap(next);
        setSelectedId(normalized.id);
      } else {
        setNotice('Drag on the page to draw the selected mark.');
      }
      setDraftAnnotation(null);
    } else {
      const before = interaction.startAnnotations;
      if (JSON.stringify(before) !== JSON.stringify(annotationMapRef.current)) {
        undoStackRef.current.push(before);
        if (undoStackRef.current.length > 100) undoStackRef.current.shift();
        redoStackRef.current = [];
      }
    }
    interactionRef.current = null;
  }, [commitMap, pageNumber]);

  const beginAnnotationInteraction = useCallback((event, annotation, type = 'move') => {
    if (editingId === annotation.id) return;
    if (activeTool !== 'select') return;
    event.stopPropagation();
    event.preventDefault();
    const start = toPercent(event);
    interactionRef.current = { type, id: annotation.id, start, original: { x: annotation.x, y: annotation.y, w: annotation.w, h: annotation.h }, startAnnotations: annotationMapRef.current };
    setSelectedId(annotation.id);
    surfaceRef.current?.setPointerCapture?.(event.pointerId);
  }, [activeTool, editingId, toPercent]);

  const startTextEdit = useCallback((event, annotation) => {
    if (activeTool !== 'select') return;
    event.stopPropagation();
    setSelectedId(annotation.id);
    setEditingId(annotation.id);
    editStartRef.current = annotationMapRef.current;
  }, [activeTool]);

  const finishTextEdit = useCallback(() => {
    const before = editStartRef.current;
    if (before && JSON.stringify(before) !== JSON.stringify(annotationMapRef.current)) {
      undoStackRef.current.push(before);
      if (undoStackRef.current.length > 100) undoStackRef.current.shift();
      redoStackRef.current = [];
    }
    editStartRef.current = null;
    setEditingId(null);
  }, []);

  const updateSelected = useCallback((patch) => {
    if (!selectedId) return;
    changeCurrent((list) => list.map((item) => item.id === selectedId ? { ...item, ...patch } : item));
  }, [changeCurrent, selectedId]);

  const removeSelected = useCallback(() => {
    if (!selectedId) return;
    changeCurrent((list) => list.filter((item) => item.id !== selectedId));
    setSelectedId(null);
    setEditingId(null);
  }, [changeCurrent, selectedId]);

  const undo = useCallback(() => {
    const previous = undoStackRef.current.pop();
    if (!previous) { notify?.('Nothing to undo in the Edit PDF workspace.', 'info'); return; }
    redoStackRef.current.push(annotationMapRef.current);
    assignMap(previous, true);
    setSelectedId(null);
  }, [assignMap, notify]);

  const redo = useCallback(() => {
    const next = redoStackRef.current.pop();
    if (!next) { notify?.('Nothing to redo in the Edit PDF workspace.', 'info'); return; }
    undoStackRef.current.push(annotationMapRef.current);
    assignMap(next, true);
    setSelectedId(null);
  }, [assignMap, notify]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (!active) return;
      const target = event.target;
      const editingField = target instanceof HTMLElement && (target.matches('textarea, input, select, [contenteditable="true"]'));
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !editingField) { event.preventDefault(); event.shiftKey ? redo() : undo(); }
      else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y' && !editingField) { event.preventDefault(); redo(); }
      else if ((event.key === 'Delete' || event.key === 'Backspace') && !editingField && selectedId && activeTool === 'select') { event.preventDefault(); removeSelected(); }
      else if (event.key === 'Escape') { setDraftAnnotation(null); interactionRef.current = null; setEditingId(null); setSelectedId(null); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active, activeTool, redo, removeSelected, selectedId, undo]);

  const savePdf = useCallback(async () => {
    if (!pdfDoc || !sourceBytes) {
      notify?.('Open a PDF before saving edits.', 'error');
      return;
    }
    try {
      finishTextEdit();
      setBusy(true);
      setNotice('Applying edits and preparing the PDF…');
      const savedBytes = await exportEditedPdf(sourceBytes, pdfDoc, annotationMapRef.current, { title: `${cleanName(fileName)} (edited)` });
      const suggestedName = `${cleanName(fileName)}-edited.pdf`;
      let result;
      if (window.pdfStudio?.saveFile) {
        result = await window.pdfStudio.saveFile({ name: suggestedName, data: savedBytes, filters: [{ name: 'PDF document', extensions: ['pdf'] }] });
      } else {
        result = await saveInBrowser(savedBytes, suggestedName, 'application/pdf');
      }
      if (result?.canceled) {
        setNotice('Save cancelled. Your edits are still in this session.');
      } else {
        setDirty(false);
        setNotice('Edited PDF saved. The original file was left unchanged.');
        notify?.('Edited PDF saved successfully.', 'success');
      }
    } catch (error) {
      console.error('Unable to save edited PDF', error);
      const message = error?.message || 'PDF Studio could not save this edited PDF.';
      setNotice(message);
      notify?.(message, 'error');
    } finally {
      setBusy(false);
    }
  }, [fileName, finishTextEdit, notify, pdfDoc, sourceBytes]);

  useEffect(() => {
    const onEditorShortcut = (event) => {
      if (!active) return;
      const modifier = event.ctrlKey || event.metaKey;
      if (!modifier) return;
      const key = event.key.toLowerCase();
      if (key === 's') { event.preventDefault(); event.stopPropagation(); savePdf(); }
      else if (key === 'o' && !(event.target instanceof HTMLElement && event.target.matches('textarea, input, select'))) { event.preventDefault(); event.stopPropagation(); openPdf(); }
    };
    window.addEventListener('keydown', onEditorShortcut);
    return () => window.removeEventListener('keydown', onEditorShortcut);
  }, [active, openPdf, savePdf]);

  const handleImageInput = useCallback(async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      notify?.('Choose an image file for this tool.', 'error');
      return;
    }
    try {
      const data = new Uint8Array(await file.arrayBuffer());
      const image = new Image();
      const url = URL.createObjectURL(new Blob([data], { type: file.type }));
      try {
        image.src = url;
        await image.decode();
        const imageCanvas = document.createElement('canvas');
        imageCanvas.width = image.naturalWidth;
        imageCanvas.height = image.naturalHeight;
        const imageContext = imageCanvas.getContext('2d');
        if (!imageContext) throw new Error('Image conversion is not available.');
        imageContext.drawImage(image, 0, 0);
        setPendingImage({ kind: 'image', data: imageCanvas.toDataURL('image/png'), mime: 'image/png', width: image.naturalWidth, height: image.naturalHeight, name: file.name });
      } finally {
        URL.revokeObjectURL(url);
      }
      setActiveTool('image');
      setNotice(`Image ready: ${file.name}. Click on the PDF page to place it.`);
    } catch (error) {
      notify?.(error?.message || 'Could not read that image.', 'error');
    }
  }, [notify]);

  const setTool = useCallback((toolId) => {
    if (!pdfDoc) {
      setNotice('Open a PDF to start editing.');
      return;
    }
    setSelectedId(null);
    setEditingId(null);
    setActiveTool(toolId);
    if (toolId === 'signature') setSignatureOpen(true);
    if (toolId === 'image') imageInputRef.current?.click();
  }, [pdfDoc]);

  const signaturePointerDown = useCallback((event) => {
    if (signatureMode !== 'draw') return;
    const canvas = signatureCanvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    const rect = canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) * canvas.width / rect.width;
    const y = (event.clientY - rect.top) * canvas.height / rect.height;
    context.strokeStyle = signatureColor;
    context.lineWidth = 3.4;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.beginPath();
    context.moveTo(x, y);
    canvas.setPointerCapture?.(event.pointerId);
    setHasSignatureInk(true);
  }, [signatureColor, signatureMode]);

  const signaturePointerMove = useCallback((event) => {
    if (signatureMode !== 'draw' || !event.buttons) return;
    const canvas = signatureCanvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    const rect = canvas.getBoundingClientRect();
    context.lineTo((event.clientX - rect.left) * canvas.width / rect.width, (event.clientY - rect.top) * canvas.height / rect.height);
    context.stroke();
  }, [signatureMode]);

  const clearSignature = useCallback(() => {
    const canvas = signatureCanvasRef.current;
    canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
    setHasSignatureInk(false);
  }, []);

  const saveSignature = useCallback(() => {
    const canvas = signatureCanvasRef.current;
    if (!canvas) return;
    if (signatureMode === 'type') {
      const context = canvas.getContext('2d');
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = signatureColor;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.font = 'italic 58px cursive';
      context.fillText(signatureText.trim() || 'Signature', canvas.width / 2, canvas.height / 2, canvas.width - 36);
    } else if (!hasSignatureInk) {
      notify?.('Draw your signature in the box before adding it.', 'error');
      return;
    }
    setPendingImage({ kind: 'signature', data: canvas.toDataURL('image/png'), mime: 'image/png', width: canvas.width, height: canvas.height });
    setSignatureOpen(false);
    setActiveTool('signature');
    setNotice('Signature ready. Click on the PDF page to place it.');
  }, [hasSignatureInk, notify, signatureMode, signatureColor, signatureText]);

  const renderedAnnotations = useMemo(() => draftAnnotation ? [...annotations, draftAnnotation] : annotations, [annotations, draftAnnotation]);

  return (
    <section className="edit-pdf-view">
      <input ref={fileInputRef} className="hidden-input" type="file" accept="application/pdf,.pdf" onChange={onPdfInputChange} />
      <input ref={imageInputRef} className="hidden-input" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/bmp" onChange={handleImageInput} />
      <header className="ed-page-header">
        <div className="ed-header-copy">
          <div className="ed-eyebrow"><FilePenLine size={15} /> PDF editing studio</div>
          <h1>Edit PDF</h1>
          <p>Add text, signatures, highlights, shapes, stamps, and images directly to a PDF, then save a new copy.</p>
        </div>
        <div className="ed-header-actions">
          {documents.some((document) => document.kind === 'pdf' && sourcesRef?.current?.has(document.id)) && <select className="ed-existing-doc-select" aria-label="Choose a PDF already in your workspace" value={loadedSourceId || ''} onChange={switchToWorkspacePdf} disabled={busy}><option value="">Workspace PDFs…</option>{documents.filter((document) => document.kind === 'pdf' && sourcesRef?.current?.has(document.id)).map((document) => <option key={document.id} value={document.id}>{document.name}</option>)}</select>}
          <button type="button" className="ed-button ed-button-secondary" onClick={openPdf} disabled={busy}><FolderOpen size={16} /> Open PDF</button>
          <button type="button" className="ed-button ed-button-primary" onClick={savePdf} disabled={!pdfDoc || busy}><Save size={16} /> {busy ? 'Working…' : 'Save as PDF'}{dirty && <span className="ed-unsaved-dot" title="Unsaved edits" />}</button>
        </div>
      </header>

      {notice && <div className={cx('ed-notice', /saved successfully/i.test(notice) && 'ed-notice-success')} role="status"><span>{notice}</span><button type="button" onClick={() => setNotice('')} aria-label="Dismiss notice"><X size={14} /></button></div>}

      {!pdfDoc ? (
        <div className="ed-empty-state">
          <div className="ed-empty-icon"><FilePenLine size={30} /></div>
          <h2>Make changes to your PDF</h2>
          <p>Open a PDF to add text, signatures, highlights, shapes, images, and review marks. Your original file stays unchanged.</p>
          <button type="button" className="ed-button ed-button-primary" onClick={openPdf} disabled={busy}><FolderOpen size={17} /> Choose a PDF to edit</button>
          <div className="ed-empty-points"><span><ShieldCheck size={15} /> Processed on this device</span><span><Save size={15} /> Save as a new PDF</span></div>
        </div>
      ) : (
        <div className="ed-editor-shell">
          <aside className="ed-tools-panel" aria-label="PDF editing tools">
            <div className="ed-panel-label">TOOLS</div>
            {TOOLS.map((tool) => {
              const Icon = tool.icon;
              return <button type="button" key={tool.id} className={cx('ed-tool-button', activeTool === tool.id && 'is-active')} onClick={() => setTool(tool.id)} title={tool.hint} aria-pressed={activeTool === tool.id}><Icon size={17} /><span>{tool.label}</span></button>;
            })}
            <div className="ed-tool-tip"><strong>{activeToolInfo.label}</strong><span>{activeToolInfo.hint}</span></div>
          </aside>

          <aside className="ed-pages-panel" aria-label="Page navigation">
            <div className="ed-panel-title"><span>Pages</span><b>{pageCount}</b></div>
            <div className="ed-page-list">
              {Array.from({ length: pageCount }, (_, index) => index + 1).map((page) => (
                <button type="button" key={page} className={cx('ed-page-thumbnail', pageNumber === page && 'is-active')} onClick={() => { finishTextEdit(); setPageNumber(page); setSelectedId(null); }}>
                  <span className="ed-mini-page"><FileText size={18} /><i /><i /><i /></span>
                  <span>Page {page}</span>
                  {(annotationsByPage[String(page - 1)] || []).length > 0 && <small>{annotationsByPage[String(page - 1)].length} edits</small>}
                </button>
              ))}
            </div>
            <div className="ed-pages-footer"><span>Original pages</span><span>{pageCount}</span></div>
          </aside>

          <main className="ed-document-panel">
            <div className="ed-document-toolbar">
              <div className="ed-document-name"><FileText size={16} /><span title={fileName}>{fileName}</span>{dirty && <em>Unsaved</em>}</div>
              <div className="ed-page-control">
                <button type="button" onClick={() => { finishTextEdit(); setPageNumber((n) => Math.max(1, n - 1)); setSelectedId(null); }} disabled={pageNumber <= 1} aria-label="Previous page"><ChevronLeft size={16} /></button>
                <label><input aria-label="Current page" type="number" min={1} max={pageCount} value={pageNumber} onChange={(event) => { const n = Number(event.target.value); if (n >= 1 && n <= pageCount) { finishTextEdit(); setPageNumber(n); setSelectedId(null); } }} /><span>/ {pageCount}</span></label>
                <button type="button" onClick={() => { finishTextEdit(); setPageNumber((n) => Math.min(pageCount, n + 1)); setSelectedId(null); }} disabled={pageNumber >= pageCount} aria-label="Next page"><ChevronRight size={16} /></button>
              </div>
              <div className="ed-zoom-controls"><button type="button" onClick={() => setZoom((z) => clamp(Number((z - 0.1).toFixed(2)), 0.55, 2))} disabled={zoom <= 0.55} title="Zoom out"><ZoomOut size={16} /></button><span>{Math.round(zoom * 100)}%</span><button type="button" onClick={() => setZoom((z) => clamp(Number((z + 0.1).toFixed(2)), 0.55, 2))} disabled={zoom >= 2} title="Zoom in"><ZoomIn size={16} /></button></div>
              <div className="ed-history-controls"><button type="button" onClick={undo} disabled={!undoStackRef.current.length} title="Undo (Ctrl+Z)"><Undo2 size={16} /></button><button type="button" onClick={redo} disabled={!redoStackRef.current.length} title="Redo (Ctrl+Y)"><Redo2 size={16} /></button></div>
            </div>

            <div className="ed-stage" ref={stageRef}>
              <div className="ed-workspace-hint"><MousePointer2 size={13} /> {activeTool === 'select' ? 'Select an item to move, resize, or edit it.' : activeToolInfo.hint}</div>
              <div className="ed-canvas-center">
                <div ref={surfaceRef} className={cx('ed-page-surface', `tool-${activeTool}`)} style={dimensions ? { width: dimensions.width, height: dimensions.height } : undefined} onPointerDown={pointerDownOnSurface} onPointerMove={pointerMoveOnSurface} onPointerUp={pointerUpOnSurface} onPointerCancel={pointerUpOnSurface}>
                  <canvas ref={canvasRef} className="ed-pdf-canvas" aria-label={`PDF page ${pageNumber}`} />
                  <div className="ed-annotation-layer">
                    {renderedAnnotations.map((annotation) => <Annotation key={annotation.id} annotation={annotation} dimensions={dimensions} selected={selectedId === annotation.id} editing={editingId === annotation.id} activeTool={activeTool} onPointerDown={(event) => beginAnnotationInteraction(event, annotation)} onDoubleClick={(event) => startTextEdit(event, annotation)} onTextChange={(value) => {
                      const key = String(pageNumber - 1);
                      const current = annotationMapRef.current;
                      const list = current[key] || [];
                      assignMap({ ...current, [key]: list.map((item) => item.id === annotation.id ? { ...item, text: value } : item) }, true);
                    }} onFinishText={finishTextEdit} onResizePointerDown={(event) => beginAnnotationInteraction(event, annotation, 'resize')} />)}
                  </div>
                </div>
              </div>
            </div>
            <footer className="ed-document-footer"><span>Page {pageNumber} of {pageCount}</span><span>{annotations.length} annotation{annotations.length === 1 ? '' : 's'} on this page</span><span><ShieldCheck size={13} /> Local editing</span></footer>
          </main>

          <aside className="ed-properties-panel" aria-label="Properties">
            <div className="ed-properties-heading"><span>Properties</span>{selectedAnnotation && <button type="button" onClick={removeSelected} title="Delete selected item"><Trash2 size={15} /></button>}</div>
            {selectedAnnotation ? (
              <div className="ed-property-group">
                <span className="ed-property-kicker">SELECTED ITEM</span>
                <strong className="ed-selected-type">{selectedAnnotation.type.charAt(0).toUpperCase() + selectedAnnotation.type.slice(1)}</strong>
                {['text', 'stamp', 'note'].includes(selectedAnnotation.type) && <label className="ed-field-label">Text<textarea rows={3} value={selectedAnnotation.text || ''} onChange={(event) => updateSelected({ text: event.target.value })} /></label>}
                {selectedAnnotation.type !== 'signature' && selectedAnnotation.type !== 'image' && <label className="ed-field-label">Color<input type="color" value={selectedAnnotation.color || DEFAULT_COLOR} onChange={(event) => updateSelected({ color: event.target.value })} /></label>}
                {['text', 'stamp', 'note'].includes(selectedAnnotation.type) && <label className="ed-field-label">Font size <span>{selectedAnnotation.size || 16} pt</span><input type="range" min="6" max="72" value={selectedAnnotation.size || 16} onChange={(event) => updateSelected({ size: Number(event.target.value) })} /></label>}
                {['rect', 'ellipse', 'line', 'underline', 'strike', 'draw', 'stamp'].includes(selectedAnnotation.type) && <label className="ed-field-label">Line width <span>{selectedAnnotation.lineWidth || 2} pt</span><input type="range" min="0.5" max="10" step="0.5" value={selectedAnnotation.lineWidth || 2} onChange={(event) => updateSelected({ lineWidth: Number(event.target.value) })} /></label>}
                {['highlight', 'whiteout'].includes(selectedAnnotation.type) && <label className="ed-field-label">Opacity <span>{Math.round((selectedAnnotation.opacity ?? 1) * 100)}%</span><input type="range" min="10" max="100" value={Math.round((selectedAnnotation.opacity ?? 1) * 100)} onChange={(event) => updateSelected({ opacity: Number(event.target.value) / 100 })} /></label>}
                <button type="button" className="ed-danger-button" onClick={removeSelected}><Trash2 size={15} /> Delete item</button>
              </div>
            ) : (
              <div className="ed-property-group">
                <span className="ed-property-kicker">DEFAULT STYLE</span>
                <label className="ed-field-label">Color<input type="color" value={activeTool === 'highlight' ? highlightColor : color} onChange={(event) => activeTool === 'highlight' ? setHighlightColor(event.target.value) : setColor(event.target.value)} /></label>
                <label className="ed-field-label">Text size <span>{fontSize} pt</span><input type="range" min="6" max="72" value={fontSize} onChange={(event) => setFontSize(Number(event.target.value))} /></label>
                <label className="ed-field-label">Line width <span>{lineWidth} pt</span><input type="range" min="0.5" max="10" step="0.5" value={lineWidth} onChange={(event) => setLineWidth(Number(event.target.value))} /></label>
                <div className="ed-font-style-row"><button type="button" className={cx(fontStyle === 'bold' && 'is-active')} onClick={() => setFontStyle((s) => s === 'bold' ? 'regular' : 'bold')} title="Bold"><Bold size={15} /></button><button type="button" className={cx(fontStyle === 'italic' && 'is-active')} onClick={() => setFontStyle((s) => s === 'italic' ? 'regular' : 'italic')} title="Italic"><Italic size={15} /></button><button type="button" className={cx(fontStyle === 'regular' && 'is-active')} onClick={() => setFontStyle('regular')} title="Regular"><AlignLeft size={15} /></button></div>
                {activeTool === 'stamp' && <label className="ed-field-label">Stamp text<select value={stampText} onChange={(event) => setStampText(event.target.value)}>{STAMPS.map((stamp) => <option key={stamp}>{stamp}</option>)}</select></label>}
                <div className="ed-tip-card"><ShieldCheck size={16} /><p>Edits are added to a new PDF copy. The original PDF is not overwritten.</p></div>
                <div className="ed-shortcut-list"><span><kbd>Ctrl</kbd> + <kbd>Z</kbd><small>Undo</small></span><span><kbd>Ctrl</kbd> + <kbd>Y</kbd><small>Redo</small></span><span><kbd>Del</kbd><small>Remove selection</small></span></div>
              </div>
            )}
            <div className="ed-properties-bottom"><button type="button" className="ed-button ed-button-primary" onClick={savePdf} disabled={busy}><ArrowDownToLine size={15} /> Save edited PDF</button><small>{dirty ? 'You have unsaved edits.' : 'Changes are only in this session until saved.'}</small></div>
          </aside>
        </div>
      )}

      {signatureOpen && <div className="ed-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSignatureOpen(false); }}>
        <section className="ed-signature-dialog" role="dialog" aria-modal="true" aria-labelledby="ed-signature-title">
          <header><div><span className="ed-dialog-icon"><Signature size={18} /></span><div><h2 id="ed-signature-title">Create signature</h2><p>Draw it with your mouse or type a signature style.</p></div></div><button type="button" onClick={() => setSignatureOpen(false)} aria-label="Close signature dialog"><X size={18} /></button></header>
          <div className="ed-signature-tabs"><button type="button" className={cx(signatureMode === 'draw' && 'is-active')} onClick={() => { setSignatureMode('draw'); setHasSignatureInk(false); }}>Draw signature</button><button type="button" className={cx(signatureMode === 'type' && 'is-active')} onClick={() => { setSignatureMode('type'); setHasSignatureInk(false); }}>Type signature</button></div>
          {signatureMode === 'type' && <label className="ed-field-label ed-signature-type-field">Signature text<input value={signatureText} onChange={(event) => setSignatureText(event.target.value)} maxLength={60} placeholder="Type your name" /></label>}
          <div className="ed-signature-canvas-wrap"><canvas ref={signatureCanvasRef} width={680} height={220} className="ed-signature-canvas" onPointerDown={signaturePointerDown} onPointerMove={signaturePointerMove} /></div>
          <div className="ed-signature-options"><label>Ink color<input type="color" value={signatureColor} onChange={(event) => setSignatureColor(event.target.value)} /></label><button type="button" className="ed-button ed-button-secondary" onClick={clearSignature}><RotateCcw size={14} /> Clear</button></div>
          <footer><button type="button" className="ed-button ed-button-secondary" onClick={() => setSignatureOpen(false)}>Cancel</button><button type="button" className="ed-button ed-button-primary" onClick={saveSignature}><Check size={15} /> Use signature</button></footer>
        </section>
      </div>}
    </section>
  );
}

function Annotation({ annotation, dimensions, selected, editing, activeTool, onPointerDown, onDoubleClick, onTextChange, onFinishText, onResizePointerDown }) {
  const scale = dimensions?.scale || 1;
  const style = {
    left: `${annotation.x}%`, top: `${annotation.y}%`, width: `${Math.max(annotation.w || 0.25, 0.25)}%`, height: `${Math.max(annotation.h || 0.25, 0.25)}%`,
    color: annotation.color || DEFAULT_COLOR,
    fontSize: `${Math.max(4, (Number(annotation.size) || 16) * scale)}px`,
    opacity: annotation.type === 'highlight' ? (annotation.opacity ?? 0.34) : (annotation.type === 'whiteout' ? 1 : (annotation.opacity ?? 1)),
    pointerEvents: activeTool === 'select' ? 'auto' : 'none',
  };
  const isText = ['text', 'stamp', 'note'].includes(annotation.type);
  if (annotation.type === 'highlight') style.backgroundColor = annotation.color || '#f6d64a';
  if (annotation.type === 'whiteout') style.backgroundColor = '#fff';
  if (annotation.type === 'rect' || annotation.type === 'stamp') style.border = `${Math.max(0.8, (Number(annotation.lineWidth) || 2) * scale)}px solid ${annotation.color || DEFAULT_COLOR}`;
  if (annotation.type === 'ellipse') { style.border = `${Math.max(0.8, (Number(annotation.lineWidth) || 2) * scale)}px solid ${annotation.color || DEFAULT_COLOR}`; style.borderRadius = '50%'; }
  if (annotation.type === 'note') { style.backgroundColor = '#fff3b5'; style.border = '1px solid #e9ca62'; style.padding = '3px'; style.color = '#55461a'; }
  if (annotation.fontStyle === 'bold' || annotation.type === 'stamp') style.fontWeight = 800;
  if (annotation.fontStyle === 'italic') style.fontStyle = 'italic';
  if (annotation.type === 'stamp') { style.textAlign = 'center'; style.display = 'grid'; style.placeItems = 'center'; style.fontWeight = 800; style.letterSpacing = '.08em'; }
  if (annotation.type === 'signature' || annotation.type === 'image') { style.display = 'flex'; style.alignItems = 'stretch'; style.justifyContent = 'stretch'; }
  return (
    <div className={cx('ed-annotation', `ed-annotation-${annotation.type}`, selected && 'is-selected', editing && 'is-editing', activeTool === 'select' && 'can-select')} style={style} onPointerDown={onPointerDown} onDoubleClick={onDoubleClick} role={isText ? 'group' : undefined} aria-label={isText ? annotation.text || 'Text annotation' : `${annotation.type} annotation`}>
      {annotation.type === 'signature' || annotation.type === 'image' ? <img draggable="false" src={annotation.data} alt={annotation.type === 'signature' ? 'Signature' : 'Placed image'} /> : null}
      {annotation.type === 'draw' && <FreehandPath annotation={annotation} />}
      {['line', 'underline', 'strike'].includes(annotation.type) && <svg className="ed-line-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><line x1={annotation.type === 'line' && annotation.startPoint ? clamp((annotation.startPoint.x - annotation.x) / Math.max(annotation.w, 0.2) * 100, 0, 100) : 0} y1={annotation.type === 'line' && annotation.startPoint ? clamp((annotation.startPoint.y - annotation.y) / Math.max(annotation.h, 0.2) * 100, 0, 100) : (annotation.type === 'strike' ? 50 : 100)} x2={annotation.type === 'line' && annotation.endPoint ? clamp((annotation.endPoint.x - annotation.x) / Math.max(annotation.w, 0.2) * 100, 0, 100) : 100} y2={annotation.type === 'line' && annotation.endPoint ? clamp((annotation.endPoint.y - annotation.y) / Math.max(annotation.h, 0.2) * 100, 0, 100) : (annotation.type === 'strike' ? 50 : 100)} stroke={annotation.color || DEFAULT_COLOR} strokeWidth={Math.max(1, (Number(annotation.lineWidth) || 2) * 1.5)} vectorEffect="non-scaling-stroke" /></svg>}
      {isText && (editing ? <textarea autoFocus value={annotation.text || ''} onChange={(event) => onTextChange(event.target.value)} onBlur={onFinishText} onPointerDown={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.blur(); } }} placeholder="Type here…" aria-label="Edit annotation text" /> : <span>{annotation.text || (annotation.type === 'text' ? 'Double-click to edit' : annotation.type === 'stamp' ? 'APPROVED' : '')}</span>)}
      {selected && activeTool === 'select' && <button type="button" className="ed-resize-handle" onPointerDown={onResizePointerDown} aria-label="Resize selected annotation" title="Drag to resize"><Move size={10} /></button>}
    </div>
  );
}

function FreehandPath({ annotation }) {
  const points = annotation.points || [];
  if (points.length < 2) return null;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs); const maxX = Math.max(...xs);
  const minY = Math.min(...ys); const maxY = Math.max(...ys);
  const width = Math.max(0.25, maxX - minX); const height = Math.max(0.25, maxY - minY);
  const polyline = points.map((point) => `${(point.x - minX) / width * 100},${(point.y - minY) / height * 100}`).join(' ');
  return <svg className="ed-freehand-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polyline points={polyline} fill="none" stroke={annotation.color || DEFAULT_COLOR} strokeWidth={Math.max(1.2, (Number(annotation.lineWidth) || 2) * 1.5)} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" /></svg>;
}
