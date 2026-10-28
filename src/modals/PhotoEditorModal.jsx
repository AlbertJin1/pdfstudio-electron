import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check, CheckCircle2, Crop, Download, FlipHorizontal, FlipVertical, ImagePlus, Info, Maximize2,
  RotateCcw, RotateCw, ShieldCheck, SlidersHorizontal, Sparkles, Trash2, Type, Upload, X,
} from 'lucide-react';
import ActionButton from '../components/common/ActionButton.jsx';
import Modal from '../components/common/Modal.jsx';
import { cleanPhotoStem, PHOTO_INPUT_EXTENSIONS, PHOTO_MAX_BYTES, PHOTO_MAX_PIXELS, photoOutputSpec, renderPhotoBlob, renderPhotoToCanvas } from '../services/photoEditor.js';
import { saveInBrowser } from '../utils/download.js';
import { cropFromDrag, fitCropRectToAspect, moveCropRect, resizeCropDimension, resizeCropRect } from '../services/photoCrop.js';
import { formatBytes } from '../utils/format.js';
import { cx } from '../utils/cx.js';

const MAX_FILES = 50;
let nextPhotoId = 1;
const INITIAL_CROP = { x: 0, y: 0, w: 1, h: 1 };
const ASPECTS = [
  { value: 'free', label: 'Free' }, { value: 'original', label: 'Original' }, { value: '1:1', label: '1:1' },
  { value: '4:3', label: '4:3' }, { value: '3:2', label: '3:2' }, { value: '5:4', label: '5:4' },
  { value: '16:9', label: '16:9' }, { value: '2:3', label: '2:3' }, { value: '9:16', label: '9:16' },
];
const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));

function pointOnStage(event, stage) {
  const rect = stage.getBoundingClientRect();
  return { x: clamp((event.clientX - rect.left) / rect.width), y: clamp((event.clientY - rect.top) / rect.height) };
}

function uniqueOutputName(file, ext, used) {
  const stem = cleanPhotoStem(file.name);
  let name = `${stem}-edited.${ext}`;
  let counter = 2;
  while (used.has(name.toLowerCase())) name = `${stem}-edited-${counter++}.${ext}`;
  used.add(name.toLowerCase());
  return name;
}

export default function PhotoEditorModal({ setModal, notify, embedded = false, onSessionChange }) {
  const [items, setItems] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [reading, setReading] = useState(false);
  const [working, setWorking] = useState(false);
  const [cropMode, setCropMode] = useState(false);
  const [cropEnabled, setCropEnabled] = useState(false);
  const [cropRect, setCropRect] = useState(INITIAL_CROP);
  const [cropAspect, setCropAspect] = useState('free');
  const [cropWidthDraft, setCropWidthDraft] = useState(null);
  const [cropHeightDraft, setCropHeightDraft] = useState(null);
  const [brightness, setBrightness] = useState(100);
  const [contrast, setContrast] = useState(100);
  const [saturation, setSaturation] = useState(100);
  const [blur, setBlur] = useState(0);
  const [grayscale, setGrayscale] = useState(false);
  const [sepia, setSepia] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [flipHorizontal, setFlipHorizontal] = useState(false);
  const [flipVertical, setFlipVertical] = useState(false);
  const [watermark, setWatermark] = useState('');
  const [watermarkPosition, setWatermarkPosition] = useState('bottom-right');
  const [watermarkColor, setWatermarkColor] = useState('#ffffff');
  const [watermarkOpacity, setWatermarkOpacity] = useState(70);
  const [watermarkSize, setWatermarkSize] = useState(4);
  const [maxWidth, setMaxWidth] = useState('');
  const [maxHeight, setMaxHeight] = useState('');
  const [format, setFormat] = useState('source');
  const [quality, setQuality] = useState(92);
  const [jpegBackground, setJpegBackground] = useState('#ffffff');
  const [busyMessage, setBusyMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [previewSize, setPreviewSize] = useState(null);
  const fileInputRef = useRef(null);
  const previewCanvasRef = useRef(null);
  const cropStageRef = useRef(null);
  const cropDragRef = useRef(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const active = items.find((item) => item.id === activeId) || null;
  const imageAspect = active?.width && active?.height ? active.width / active.height : 1;

  useEffect(() => () => { itemsRef.current.forEach((item) => URL.revokeObjectURL(item.url)); }, []);
  useEffect(() => { onSessionChange?.({ hasPhotos: items.length > 0, busy: working || reading }); }, [items.length, working, reading, onSessionChange]);
  useEffect(() => { setCropWidthDraft(null); setCropHeightDraft(null); }, [activeId]);

  const editing = useMemo(() => ({
    cropEnabled, crop: cropRect, brightness, contrast, saturation, blur, grayscale, sepia, rotation,
    flipHorizontal, flipVertical, watermark, watermarkPosition, watermarkColor, watermarkOpacity,
    watermarkSize, maxWidth, maxHeight, format, quality, jpegBackground,
  }), [cropEnabled, cropRect, brightness, contrast, saturation, blur, grayscale, sepia, rotation, flipHorizontal, flipVertical, watermark, watermarkPosition, watermarkColor, watermarkOpacity, watermarkSize, maxWidth, maxHeight, format, quality, jpegBackground]);

  const addFiles = useCallback(async (incoming) => {
    const incomingFiles = Array.from(incoming || []);
    if (!incomingFiles.length) return;
    if (working || reading) return;
    setReading(true); setErrorMessage('');
    const accepted = [];
    const problems = [];
    try {
      for (const file of incomingFiles) {
        if (itemsRef.current.length + accepted.length >= MAX_FILES) { problems.push(`Only ${MAX_FILES} photos can be loaded at once.`); break; }
        const name = file.name || 'photo.png';
        if (!PHOTO_INPUT_EXTENSIONS.test(name)) { problems.push(`${name}: use PNG, JPG, WebP, or BMP.`); continue; }
        if (!file.size) { problems.push(`${name}: file is empty.`); continue; }
        if (file.size > PHOTO_MAX_BYTES) { problems.push(`${name}: larger than 80 MB.`); continue; }
        if (itemsRef.current.some((item) => item.name === name && item.size === file.size) || accepted.some((item) => item.name === name && item.size === file.size)) continue;
        let bitmap;
        try { bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
        catch { problems.push(`${name}: the image could not be decoded.`); continue; }
        const width = bitmap.width; const height = bitmap.height;
        bitmap.close?.();
        if (!width || !height || width * height > PHOTO_MAX_PIXELS) { problems.push(`${name}: images must be no larger than 80 megapixels.`); continue; }
        accepted.push({ id: nextPhotoId++, name, file, size: file.size, width, height, url: URL.createObjectURL(file) });
      }
      if (accepted.length) {
        setItems((current) => [...current, ...accepted]);
        setActiveId((current) => current ?? accepted[0].id);
      }
      if (problems.length) setErrorMessage(problems.slice(0, 3).join(' · ') + (problems.length > 3 ? ` · and ${problems.length - 3} more` : ''));
    } finally { setReading(false); }
  }, [working, reading]);

  useEffect(() => {
    if (!active || cropMode || !previewCanvasRef.current) { setPreviewSize(null); return undefined; }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const canvas = previewCanvasRef.current;
        const rendered = await renderPhotoToCanvas(active.file, editing, canvas, () => !cancelled && previewCanvasRef.current === canvas);
        if (cancelled || !rendered || !previewCanvasRef.current) return;
        setPreviewSize({ width: rendered.width, height: rendered.height, mime: rendered.mime });
      } catch (error) {
        if (!cancelled) { setPreviewSize(null); setErrorMessage(error?.message || 'Could not preview this image.'); }
      }
    }, 140);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [active?.id, active?.file, editing, cropMode]);

  const removeItem = (id) => {
    const target = itemsRef.current.find((item) => item.id === id);
    if (target) URL.revokeObjectURL(target.url);
    setItems((current) => {
      const rest = current.filter((item) => item.id !== id);
      setActiveId((currentId) => currentId === id ? (rest[0]?.id ?? null) : currentId);
      return rest;
    });
    setCropMode(false); setCropEnabled(false); setCropRect(INITIAL_CROP); setCropWidthDraft(null); setCropHeightDraft(null);
  };

  const resetEdits = () => {
    setCropMode(false); setCropEnabled(false); setCropRect(INITIAL_CROP); setCropAspect('free'); setCropWidthDraft(null); setCropHeightDraft(null);
    setBrightness(100); setContrast(100); setSaturation(100); setBlur(0); setGrayscale(false); setSepia(false);
    setRotation(0); setFlipHorizontal(false); setFlipVertical(false); setWatermark(''); setWatermarkPosition('bottom-right');
    setWatermarkColor('#ffffff'); setWatermarkOpacity(70); setWatermarkSize(4); setMaxWidth(''); setMaxHeight('');
    setFormat('source'); setQuality(92); setJpegBackground('#ffffff'); setErrorMessage('');
  };

  const startCrop = () => {
    if (!active) return;
    setCropMode(true); setErrorMessage('');
    if (!cropEnabled) setCropRect(INITIAL_CROP);
  };

  const handleCropAspectChange = (nextAspect) => {
    setCropAspect(nextAspect);
    setCropRect((current) => fitCropRectToAspect(current, nextAspect, imageAspect));
    setCropEnabled(true);
    setCropWidthDraft(null); setCropHeightDraft(null);
  };

  const onCropPointerDown = (event) => {
    if (!cropStageRef.current || event.button !== 0 || !active) return;
    const point = pointOnStage(event, cropStageRef.current);
    const target = event.target;
    const handleNode = target?.closest?.('[data-crop-handle]');
    const moveNode = !handleNode && target?.closest?.('[data-crop-move]');
    const mode = handleNode ? 'resize' : moveNode && cropEnabled ? 'move' : 'new';
    const handle = handleNode?.getAttribute('data-crop-handle') || null;
    cropDragRef.current = { mode, handle, startPoint: point, startRect: { ...cropRect }, pointerId: event.pointerId };
    cropStageRef.current.setPointerCapture?.(event.pointerId);
    event.preventDefault();
    if (mode === 'new') {
      setCropEnabled(true);
      setCropRect({ x: point.x, y: point.y, w: 0.005, h: 0.005 });
    }
  };

  const onCropPointerMove = (event) => {
    const drag = cropDragRef.current;
    if (!drag || !cropStageRef.current || (drag.pointerId != null && event.pointerId !== drag.pointerId)) return;
    const point = pointOnStage(event, cropStageRef.current);
    if (drag.mode === 'new') setCropRect(cropFromDrag(drag.startPoint, point, cropAspect, imageAspect));
    else if (drag.mode === 'move') setCropRect(moveCropRect(drag.startRect, point.x - drag.startPoint.x, point.y - drag.startPoint.y));
    else if (drag.mode === 'resize') setCropRect(resizeCropRect(drag.startRect, drag.handle, point, cropAspect, imageAspect));
  };

  const onCropPointerUp = (event) => {
    if (event?.pointerId != null && cropDragRef.current?.pointerId != null && event.pointerId !== cropDragRef.current.pointerId) return;
    cropDragRef.current = null;
  };

  const applyCropDimension = (axis, draftValue) => {
    if (!active || draftValue == null || String(draftValue).trim() === '') return;
    const value = Number(draftValue);
    if (!Number.isFinite(value) || value <= 0) return;
    setCropRect((current) => resizeCropDimension(current, axis, value, active.width, active.height, cropAspect, imageAspect));
    setCropEnabled(true);
  };

  const applyCrop = () => {
    const valid = cropRect.w >= 0.005 && cropRect.h >= 0.005 && (cropRect.w < 0.999 || cropRect.h < 0.999);
    setCropEnabled(valid);
    if (!valid) setCropRect(INITIAL_CROP);
    setCropMode(false); setCropWidthDraft(null); setCropHeightDraft(null);
  };
  const resetCrop = () => { setCropEnabled(false); setCropRect(INITIAL_CROP); setCropMode(false); setCropAspect('free'); setCropWidthDraft(null); setCropHeightDraft(null); };

  const snapshot = (file) => ({ ...editing, file });

  const exportCurrent = async () => {
    if (!active || working || reading) return;
    setWorking(true); setErrorMessage(''); setBusyMessage(`Preparing ${active.name}…`);
    try {
      const result = await renderPhotoBlob(active.file, snapshot(active.file));
      const name = `${cleanPhotoStem(active.name)}-edited.${result.ext}`;
      const data = new Uint8Array(await result.blob.arrayBuffer());
      const saved = window.pdfStudio?.saveFile
        ? await window.pdfStudio.saveFile({ name, data, filters: [{ name: `${result.ext.toUpperCase()} image`, extensions: [result.ext] }] })
        : await saveInBrowser(result.blob, name, result.mime);
      if (!saved?.canceled) notify?.(`Saved ${name}.`, 'success');
    } catch (error) { setErrorMessage(error?.message || 'Could not export this photo.'); }
    finally { setBusyMessage(''); setWorking(false); }
  };

  const exportAll = async () => {
    if (!items.length || working || reading) return;
    setWorking(true); setErrorMessage('');
    const usedNames = new Set();
    let written = 0;
    try {
      const { default: JSZip } = await import('jszip');
      const zip = new JSZip();
      for (let index = 0; index < items.length; index += 1) {
        const item = items[index];
        setBusyMessage(`Editing ${index + 1} of ${items.length}: ${item.name}`);
        const result = await renderPhotoBlob(item.file, snapshot(item.file));
        const name = uniqueOutputName(item.file, result.ext, usedNames);
        zip.file(name, result.blob);
        written += 1;
      }
      setBusyMessage('Packing edited photos into a ZIP…');
      const archive = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 4 } });
      const name = `Photo-Studio-Edited-${new Date().toISOString().slice(0, 10)}.zip`;
      const saved = window.pdfStudio?.saveFile
        ? await window.pdfStudio.saveFile({ name, data: new Uint8Array(await archive.arrayBuffer()), filters: [{ name: 'ZIP archive', extensions: ['zip'] }] })
        : await saveInBrowser(archive, name, 'application/zip');
      if (!saved?.canceled) notify?.(`Exported ${written} edited photo${written === 1 ? '' : 's'} in a ZIP file.`, 'success');
    } catch (error) { setErrorMessage(error?.message || 'Could not export the selected photos.'); }
    finally { setBusyMessage(''); setWorking(false); }
  };

  const handleClose = () => { if (!working && !reading) setModal(null); };
  const activeOutput = active ? photoOutputSpec(active.file, format) : null;
  const cropPx = active && cropEnabled ? `${Math.max(1, Math.round(cropRect.w * active.width))} × ${Math.max(1, Math.round(cropRect.h * active.height))} px crop` : 'Full image';

  return (
    <Modal embedded={embedded} title={embedded ? 'Photo Editing' : 'Photo editor'} eyebrow="PHOTO TOOLS · LOCAL EDITING" wide onClose={handleClose} onDropFiles={addFiles} dropHint={{ kind: 'image', title: 'Drop photos to add them to the editor', subtitle: 'PNG, JPG, WebP, and BMP files are supported.' }}
      footer={embedded ? <><ActionButton onClick={() => fileInputRef.current?.click()} disabled={working || reading} icon={Upload}>Add photos</ActionButton><ActionButton icon={Download} onClick={exportCurrent} disabled={!active || working || reading}>{working ? 'Processing…' : 'Export current photo'}</ActionButton><ActionButton variant="primary" icon={Download} onClick={exportAll} disabled={!items.length || working || reading}>{items.length > 1 ? `Export all (${items.length}) as ZIP` : 'Export as ZIP'}</ActionButton></> : <><ActionButton onClick={handleClose} disabled={working || reading}>Close</ActionButton><ActionButton icon={Download} onClick={exportCurrent} disabled={!active || working || reading}>{working ? 'Processing…' : 'Export current photo'}</ActionButton><ActionButton variant="primary" icon={Download} onClick={exportAll} disabled={!items.length || working || reading}>{items.length > 1 ? `Export all (${items.length}) as ZIP` : 'Export as ZIP'}</ActionButton></>}> 
      <input ref={fileInputRef} type="file" accept=".png,.jpg,.jpeg,.webp,.bmp,image/png,image/jpeg,image/webp,image/bmp" multiple className="hidden-input" onChange={(event) => { addFiles(event.target.files); event.target.value = ''; }} />
      <div className="photo-editor-shell">
        <div className="photo-editor-topline">
          <div><strong>Crop, rotate, watermark, and refine your photos</strong><p>Original files stay untouched. Exported images are re-encoded locally to remove EXIF/GPS metadata. The current edits are reused for each photo in a batch.</p></div>
          <div className="photo-editor-header-actions">{!embedded && <button className="pe-button" onClick={() => fileInputRef.current?.click()} disabled={working || reading}><Upload size={14} /> Add photos</button>}<button className="pe-button" onClick={resetEdits} disabled={!active || working}><RotateCcw size={14} /> Reset edits</button></div>
        </div>

        {!items.length ? <button type="button" className="pe-empty" onClick={() => fileInputRef.current?.click()} disabled={reading}><span><ImagePlus size={30} /></span><strong>{reading ? 'Reading photos…' : 'Add photos to start editing'}</strong><small>{embedded ? 'Choose files or drag photos into this workspace.' : 'Choose files or drag photos into this dialog.'} Up to {MAX_FILES} images can be edited in one batch.</small></button> : <div className="photo-editor-layout">
          <aside className="pe-photo-list" aria-label="Loaded photos">
            <div className="pe-list-heading"><strong>Photos</strong><span>{items.length}/{MAX_FILES}</span></div>
            <div className="pe-photo-items">
              {items.map((item) => <div className={cx('pe-photo-item', item.id === activeId && 'is-active')} key={item.id}>
                <button type="button" className="pe-photo-select" onClick={() => { setActiveId(item.id); setCropMode(false); cropDragRef.current = null; }} title={`Edit ${item.name}`}>
                  <img src={item.url} alt="" /><span className="pe-photo-copy"><strong>{item.name}</strong><small>{item.width.toLocaleString()} × {item.height.toLocaleString()}</small><small>{formatBytes(item.size)}</small></span>
                </button>
                <button type="button" className="pe-photo-remove" aria-label={`Remove ${item.name}`} title="Remove photo" onClick={() => removeItem(item.id)} disabled={working}><X size={13} /></button>
              </div>)}
            </div>
            <button className="pe-text-button" onClick={() => { itemsRef.current.forEach((item) => URL.revokeObjectURL(item.url)); setItems([]); setActiveId(null); setCropMode(false); setCropEnabled(false); setCropRect(INITIAL_CROP); }} disabled={working || reading}><Trash2 size={13} /> Clear list</button>
          </aside>

          <section className="pe-editor-main">
            <div className={cx('pe-preview-wrap', cropMode && 'is-crop-mode')}>
              <div className="pe-preview-toolbar"><span><Sparkles size={13} /> Live preview</span><span>{cropMode ? (cropEnabled ? 'Drag inside the box to move · Use handles to resize · Drag outside to replace' : 'Drag to select crop area') : previewSize ? `${previewSize.width.toLocaleString()} × ${previewSize.height.toLocaleString()} px` : 'Rendering preview…'}</span></div>
              <div className="pe-preview-stage">
                {cropMode && active ? <div className="pe-source-frame" ref={cropStageRef} onPointerDown={onCropPointerDown} onPointerMove={onCropPointerMove} onPointerUp={onCropPointerUp} onPointerCancel={onCropPointerUp} onLostPointerCapture={onCropPointerUp}>
                  <img className="pe-source-image" src={active.url} alt={`Crop preview of ${active.name}`} draggable="false" />
                  {cropEnabled && <div className="pe-crop-box" data-crop-move="true" style={{ left: `${cropRect.x * 100}%`, top: `${cropRect.y * 100}%`, width: `${cropRect.w * 100}%`, height: `${cropRect.h * 100}%` }}>
                    <span className="pe-crop-dimensions" data-crop-move="true">{Math.max(1, Math.round(cropRect.w * active.width))} × {Math.max(1, Math.round(cropRect.h * active.height))} px</span>
                    <span className="pe-crop-move-hint" data-crop-move="true" aria-hidden="true">Drag to move</span>
                    {['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map((handle) => <button key={handle} type="button" className={`pe-crop-handle pe-crop-handle-${handle}`} data-crop-handle={handle} aria-label={`Resize crop ${({ nw: 'top left', n: 'top', ne: 'top right', e: 'right', se: 'bottom right', s: 'bottom', sw: 'bottom left', w: 'left' })[handle]}`} title="Drag to resize crop" />)}
                  </div>}
                </div> : <canvas ref={previewCanvasRef} className="pe-rendered-canvas" aria-label={active ? `Edited preview of ${active.name}` : 'Image preview'} />}
                {working && <div className="pe-processing-overlay"><span className="pe-spinner"/><strong>{busyMessage || 'Processing photos…'}</strong></div>}
              </div>
              <div className="pe-preview-footer"><span>{active.name}</span><span>{cropPx}</span><span>{formatBytes(active.size)} original</span></div>
            </div>

            <div className="pe-edit-toolbar">
              <button className={cx('pe-tool-button', cropMode && 'is-selected')} onClick={cropMode ? applyCrop : startCrop} disabled={!active || working}>{cropMode ? <Check size={15} /> : <Crop size={15} />}{cropMode ? 'Apply crop' : 'Crop'}</button>
              {cropMode ? <><button className="pe-tool-button" onClick={resetCrop}><RotateCcw size={15} /> Reset crop</button><label className="pe-crop-ratio">Aspect<select value={cropAspect} onChange={(event) => handleCropAspectChange(event.target.value)}>{ASPECTS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label></> : <>
                <button className="pe-tool-button" onClick={() => setRotation((value) => (value + 270) % 360)} title="Rotate 90 degrees counter-clockwise" disabled={working}><RotateCcw size={15} /> Rotate left</button>
                <button className="pe-tool-button" onClick={() => setRotation((value) => (value + 90) % 360)} title="Rotate 90 degrees clockwise" disabled={working}><RotateCw size={15} /> Rotate right</button>
                <button className={cx('pe-tool-button', flipHorizontal && 'is-selected')} onClick={() => setFlipHorizontal((value) => !value)} disabled={working}><FlipHorizontal size={15} /> Flip H</button>
                <button className={cx('pe-tool-button', flipVertical && 'is-selected')} onClick={() => setFlipVertical((value) => !value)} disabled={working}><FlipVertical size={15} /> Flip V</button>
              </>}
            </div>

            {cropMode && active && <div className="pe-crop-size-controls">
              <div className="pe-crop-size-fields">
                <label>Width (px)<input type="number" min="1" max={active.width} step="1" value={cropWidthDraft ?? Math.max(1, Math.round(cropRect.w * active.width))} onChange={(event) => setCropWidthDraft(event.target.value)} onBlur={() => { applyCropDimension('w', cropWidthDraft); setCropWidthDraft(null); }} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} aria-label="Crop width in pixels" /></label>
                <label>Height (px)<input type="number" min="1" max={active.height} step="1" value={cropHeightDraft ?? Math.max(1, Math.round(cropRect.h * active.height))} onChange={(event) => setCropHeightDraft(event.target.value)} onBlur={() => { applyCropDimension('h', cropHeightDraft); setCropHeightDraft(null); }} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} aria-label="Crop height in pixels" /></label>
              </div>
              <span>Drag inside the box to move it. Drag any handle to resize. The crop stays inside the photo.</span>
            </div>}

            <div className="pe-options-grid">
              <section className="pe-option-card">
                <div className="pe-option-title"><SlidersHorizontal size={14} /><strong>Light & color</strong><button type="button" className="pe-mini-reset" onClick={() => { setBrightness(100); setContrast(100); setSaturation(100); setBlur(0); setGrayscale(false); setSepia(false); }}>Reset</button></div>
                <RangeSetting label="Brightness" value={brightness} min={25} max={200} unit="%" onChange={setBrightness} />
                <RangeSetting label="Contrast" value={contrast} min={25} max={200} unit="%" onChange={setContrast} />
                <RangeSetting label="Saturation" value={saturation} min={0} max={200} unit="%" onChange={setSaturation} />
                <RangeSetting label="Blur" value={blur} min={0} max={8} unit=" px" step={0.5} onChange={setBlur} />
                <div className="pe-toggle-row"><label><input type="checkbox" checked={grayscale} onChange={(event) => setGrayscale(event.target.checked)} /> Grayscale</label><label><input type="checkbox" checked={sepia} onChange={(event) => setSepia(event.target.checked)} /> Sepia</label></div>
              </section>

              <section className="pe-option-card">
                <div className="pe-option-title"><Type size={14} /><strong>Text watermark</strong></div>
                <label className="pe-field-label">Watermark text<input className="form-input" value={watermark} onChange={(event) => setWatermark(event.target.value)} maxLength={300} placeholder="e.g. © Your Name" /></label>
                <div className="pe-watermark-controls"><label className="pe-field-label">Position<select className="form-input" value={watermarkPosition} onChange={(event) => setWatermarkPosition(event.target.value)}><option value="top-left">Top left</option><option value="top-right">Top right</option><option value="center">Center</option><option value="bottom-left">Bottom left</option><option value="bottom-right">Bottom right</option></select></label><label className="pe-field-label">Color<input className="pe-color-input" type="color" value={watermarkColor} onChange={(event) => setWatermarkColor(event.target.value)} /></label></div>
                <RangeSetting label="Opacity" value={watermarkOpacity} min={5} max={100} unit="%" onChange={setWatermarkOpacity} />
                <RangeSetting label="Text size" value={watermarkSize} min={1} max={15} unit="%" onChange={setWatermarkSize} />
              </section>

              <section className="pe-option-card">
                <div className="pe-option-title"><Maximize2 size={14} /><strong>Resize & output</strong></div>
                <div className="pe-resize-row"><label className="pe-field-label">Width (px)<input className="form-input" type="number" min="1" max="16384" value={maxWidth} onChange={(event) => setMaxWidth(event.target.value)} placeholder="Keep current" /></label><label className="pe-field-label">Height (px)<input className="form-input" type="number" min="1" max="16384" value={maxHeight} onChange={(event) => setMaxHeight(event.target.value)} placeholder="Keep current" /></label></div>
                <label className="pe-field-label">Export format<select className="form-input" value={format} onChange={(event) => setFormat(event.target.value)}><option value="source">Same as source (where supported)</option><option value="png">PNG — lossless</option><option value="jpg">JPG — smaller photo files</option><option value="webp">WebP — modern format</option></select></label>
                {activeOutput?.mime !== 'image/png' && <RangeSetting label="Quality" value={quality} min={40} max={100} unit="%" onChange={setQuality} />}
                {activeOutput?.mime === 'image/jpeg' && <label className="pe-field-label pe-background-field">JPEG background<input className="pe-color-input" type="color" value={jpegBackground} onChange={(event) => setJpegBackground(event.target.value)} /></label>}
                <div className="pe-security-note"><ShieldCheck size={14} /><span>EXIF, GPS, camera serials, and embedded metadata are removed by re-encoding.</span></div>
              </section>
            </div>
          </section>
        </div>}

        {reading && <div className="pe-status"><span className="pe-spinner" /> Reading image files…</div>}
        {busyMessage && <div className="pe-status"><span className="pe-spinner" /> {busyMessage}</div>}
        {errorMessage && <div className="pe-error" role="alert"><Info size={15} /><span>{errorMessage}</span><button onClick={() => setErrorMessage('')} aria-label="Dismiss error"><X size={13} /></button></div>}
        <div className="pe-footer-note"><CheckCircle2 size={14} /><span>Local processing · No cloud upload · Original images are never overwritten</span></div>
      </div>
    </Modal>
  );
}

function RangeSetting({ label, value, min, max, unit, step = 1, onChange }) {
  const stopRangePropagation = (event) => event.stopPropagation();
  return <label className="pe-range-setting"><span>{label}<strong>{value}{unit}</strong></span><input type="range" min={min} max={max} step={step} value={value} draggable="false" aria-label={label} onChange={(event) => onChange(Number(event.target.value))} onPointerDown={stopRangePropagation} onPointerMove={stopRangePropagation} onPointerUp={stopRangePropagation} onPointerCancel={stopRangePropagation} onMouseDown={stopRangePropagation} onClick={stopRangePropagation} /></label>;
}
