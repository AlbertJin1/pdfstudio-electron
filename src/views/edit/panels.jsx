import { useEffect, useRef, useState } from 'react';
import {
  AlignCenter, AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignHorizontalSpaceBetween,
  AlignLeft, AlignRight, AlignStartHorizontal, AlignStartVertical, AlignVerticalSpaceBetween, Bold, BringToFront,
  Circle, Copy, Strikethrough, Eraser, FileText, Frame, Grid3x3, Highlighter, ImagePlus, Italic, Lock, Magnet, Minus, MousePointer2, PenLine,
  Pencil, Redo2, Ruler, SendToBack, Signature, Square, Stamp, StickyNote, Trash2, Type, Underline as UnderlineIcon, Undo2, Unlock, ZoomIn, ZoomOut,
  MoveHorizontal, Replace, Plus, X, Scan, Check, FolderOpen, Save, SlidersHorizontal, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, ChevronsLeft, ChevronsRight,
} from 'lucide-react';
import { COMMON_FONTS, FONT_FAMILIES, TEXT_TYPES, findUnsupported } from '../../services/pdf/textMetrics.js';
import { cx } from '../../utils/cx.js';
import NumField from './NumField.jsx';
import PagePicker from './PagePicker.jsx';
import { UNIT_DEFS } from './units.js';

export const EDIT_TOOLS = [
  { id: 'select', label: 'Edit', icon: MousePointer2, key: 'V', hint: 'Click text or an image on the page to edit, move or resize it' },
  { id: 'text', label: 'Add text', icon: Type, key: 'T', hint: 'Click to type, or drag to draw a text box' },
  { id: 'image', label: 'Add image', icon: ImagePlus, key: 'I', hint: 'Choose an image, then click the page to place it' },
];
export const MARKUP_TOOLS = [
  { id: 'signature', label: 'Signature', icon: Signature, hint: 'Pick a saved signature or upload, draw or type one, then click the page' },
  { id: 'highlight', label: 'Highlight', icon: Highlighter, hint: 'Drag across content to highlight it' },
  { id: 'underline', label: 'Underline', icon: UnderlineIcon, hint: 'Drag under content to underline it' },
  { id: 'strike', label: 'Strikeout', icon: Minus, hint: 'Drag across content to strike it through' },
  { id: 'draw', label: 'Freehand', icon: Pencil, hint: 'Draw on the page with your pointer' },
  { id: 'rect', label: 'Rectangle', icon: Square, hint: 'Drag to draw a rectangle' },
  { id: 'ellipse', label: 'Oval', icon: Circle, hint: 'Drag to draw an oval' },
  { id: 'line', label: 'Line', icon: PenLine, hint: 'Drag to draw a line (Shift keeps it straight)' },
  { id: 'whiteout', label: 'Whiteout', icon: Eraser, hint: 'Cover content with white. This is not secure redaction' },
  { id: 'stamp', label: 'Stamp', icon: Stamp, hint: 'Place a status stamp' },
  { id: 'note', label: 'Note', icon: StickyNote, hint: 'Place a yellow comment note' },
];
export const ALL_TOOLS = [...EDIT_TOOLS, ...MARKUP_TOOLS];
export const STAMPS = ['APPROVED', 'DRAFT', 'CONFIDENTIAL', 'RECEIVED', 'PAID', 'REVIEWED'];
const SIZES = [6, 8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 72];

/** Splits "Zoom out (Ctrl+-)" into the name and its shortcut so the tooltip can render the keys as a badge. */
const splitLabel = (label) => {
  const match = /^(.*?)\s*\(([^()]*)\)\s*$/.exec(label || '');
  if (!match) return { text: label || '', keys: '', hint: '' };
  const inner = match[2].trim();
  if (inner.length > 14) return { text: match[1], keys: '', hint: inner.charAt(0).toUpperCase() + inner.slice(1) };
  return { text: match[1], keys: inner, hint: '' };
};
/** Data attributes read by <TooltipLayer>. Spread onto any element that should show the editor tooltip. */
export const tipProps = (text, { keys = '', hint = '', side = 'bottom', delay } = {}) => ({
  'data-tip': text,
  ...(keys ? { 'data-tip-keys': keys } : {}),
  ...(hint ? { 'data-tip-hint': hint } : {}),
  'data-tip-side': side,
  ...(delay != null ? { 'data-tip-delay': delay } : {}),
});

const Btn = ({ icon: Icon, label, active, side = 'bottom', ...rest }) => {
  const { text, keys, hint } = splitLabel(label);
  return <button type="button" className={cx('ep-icon-btn', active && 'is-active')} {...tipProps(text, { keys, hint, side })} aria-label={keys ? `${text} (${keys})` : text} aria-pressed={active === undefined ? undefined : !!active} {...rest}><Icon size={17} strokeWidth={1.85} aria-hidden="true" /></button>;
};

/** Vertical tool rail (icons + labels, or icons only with hover tooltips). In `row` layout it becomes a compact top strip. */
export function ToolRail({ tool, onTool, collapsed = false, onToggle, layout = 'column' }) {
  const row = layout === 'row';
  const iconOnly = collapsed || row;
  const side = row ? 'bottom' : 'right';
  const render = (list) => list.map(({ id, label, icon: Icon, hint, key }) => (
    <button type="button" key={id} className={cx('ep-tool', tool === id && 'is-active')} onClick={() => onTool(id)} {...tipProps(label, { keys: key, hint, side, delay: iconOnly ? 120 : 650 })} aria-label={key ? `${label} (${key})` : label} aria-pressed={tool === id}>
      <Icon size={18} strokeWidth={1.9} aria-hidden="true" /><span className="ep-tool-label">{label}</span>{key && <kbd>{key}</kbd>}
    </button>
  ));
  return (
    <aside className={cx('ep-rail', collapsed && 'is-collapsed', row && 'is-row')} aria-label="Editing tools">
      <div className="ep-rail-inner">
        <div className="ep-rail-group" role="group" aria-label="Edit"><div className="ep-rail-label">Edit</div>{render(EDIT_TOOLS)}</div>
        <div className="ep-rail-group" role="group" aria-label="Mark up"><div className="ep-rail-label">Mark up</div>{render(MARKUP_TOOLS)}</div>
        {onToggle && !row && (
          <button type="button" className="ep-rail-toggle" onClick={onToggle} {...tipProps(collapsed ? 'Expand tools' : 'Collapse tools', { keys: '[', side: 'right', delay: 120 })} aria-label={collapsed ? 'Expand editing tools' : 'Collapse editing tools'} aria-expanded={!collapsed}>
            {collapsed ? <ChevronsRight size={17} strokeWidth={1.9} aria-hidden="true" /> : <ChevronsLeft size={17} strokeWidth={1.9} aria-hidden="true" />}<span className="ep-tool-label">Collapse</span>
          </button>
        )}
      </div>
    </aside>
  );
}

/** Rulers / margins / grid / snapping as one dropdown, used when the document bar is too narrow for four separate buttons. */
function ViewMenu({ view, setView }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event) => { if (!rootRef.current?.contains(event.target)) setOpen(false); };
    const onKey = (event) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onDown, true); document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDown, true); document.removeEventListener('keydown', onKey); };
  }, [open]);
  const rows = [['rulers', Ruler, 'Rulers'], ['showMargins', Frame, 'Margin guides'], ['grid', Grid3x3, 'Grid'], ['snap', Magnet, 'Snapping']];
  return (
    <div className="ep-viewmenu" ref={rootRef}>
      <Btn icon={SlidersHorizontal} label="View options" active={open} onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open} />
      {open && (
        <div className="ep-menu" role="menu" aria-label="View options">
          {rows.map(([key, Icon, label]) => (
            <button type="button" role="menuitemcheckbox" aria-checked={Boolean(view[key])} key={key} className={cx('ep-menu-item', view[key] && 'is-on')} onClick={() => setView({ [key]: !view[key] })}>
              <Icon size={16} strokeWidth={1.85} aria-hidden="true" /><span>{label}</span>{view[key] && <Check size={15} strokeWidth={2.2} aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function DocBar({ fileName, dirty, pdfDoc, pageNumber, pageCount, onPage, changes, zoomPercent, zoomMode, onZoomStep, onZoomPreset, onFit, canUndo, canRedo, onUndo, onRedo, view, setView, panels, onTogglePanel, onOpen, onSave, busy, workspaceDocs = [], loadedSourceId, onSwitchDoc, propsOpen }) {
  const presets = [25, 50, 75, 100, 125, 150, 200, 300, 400];
  const closest = presets.includes(zoomPercent) ? String(zoomPercent) : '';
  return (
    <div className="ep-docbar" role="toolbar" aria-label="Document controls">
      <div className="ep-docname" {...tipProps(fileName, { side: 'bottom' })}><FileText size={16} aria-hidden="true" /><span>{fileName}</span>{dirty && <em>Unsaved</em>}</div>
      {workspaceDocs.length > 0 && <select className="ep-select ep-ws-select" aria-label="Switch to a PDF already in your workspace" value={loadedSourceId || ''} onChange={onSwitchDoc} disabled={busy}><option value="">Workspace PDFs…</option>{workspaceDocs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>}
      <span className="ep-divider ep-divider-doc" />
      <PagePicker pdfDoc={pdfDoc} pageNumber={pageNumber} pageCount={pageCount} onPage={onPage} changes={changes} />
      <span className="ep-divider" />
      <div className="ep-group ep-group-zoom" role="group" aria-label="Zoom">
        <Btn icon={ZoomOut} label="Zoom out (Ctrl+-)" onClick={() => onZoomStep(-1)} />
        <select className="ep-select ep-zoom-select" aria-label="Zoom level" value={zoomMode === 'custom' ? closest : zoomMode} onChange={(event) => (['page', 'width'].includes(event.target.value) ? onFit(event.target.value) : onZoomPreset(Number(event.target.value)))}>
          <option value="page">Fit page{zoomMode === 'page' ? ` · ${zoomPercent}%` : ''}</option><option value="width">Fit width{zoomMode === 'width' ? ` · ${zoomPercent}%` : ''}</option>
          {zoomMode === 'custom' && !closest && <option value="">{zoomPercent}%</option>}
          {presets.map((p) => <option key={p} value={p}>{p}%</option>)}
        </select>
        <Btn icon={ZoomIn} label="Zoom in (Ctrl++)" onClick={() => onZoomStep(1)} />
        <span className="ep-seg-icons ep-fit-group">
          <Btn icon={Scan} label="Fit page (Ctrl+0)" active={zoomMode === 'page'} onClick={() => onFit('page')} />
          <Btn icon={MoveHorizontal} label="Fit width (Ctrl+2)" active={zoomMode === 'width'} onClick={() => onFit('width')} />
        </span>
      </div>
      <span className="ep-divider ep-divider-view" />
      <div className="ep-group ep-group-view" role="group" aria-label="View aids">
        <Btn icon={Ruler} label="Rulers" active={view.rulers} onClick={() => setView({ rulers: !view.rulers })} />
        <Btn icon={Frame} label="Margin guides" active={view.showMargins} onClick={() => setView({ showMargins: !view.showMargins })} />
        <Btn icon={Grid3x3} label="Grid" active={view.grid} onClick={() => setView({ grid: !view.grid })} />
        <Btn icon={Magnet} label="Snap to guides, margins and objects (hold Alt to bypass)" active={view.snap} onClick={() => setView({ snap: !view.snap })} />
      </div>
      <div className="ep-group ep-group-viewmenu"><ViewMenu view={view} setView={setView} /></div>
      <div className="ep-group ep-group-end">
        <Btn icon={Undo2} label="Undo (Ctrl+Z)" onClick={onUndo} disabled={!canUndo} />
        <Btn icon={Redo2} label="Redo (Ctrl+Y)" onClick={onRedo} disabled={!canRedo} />
        <span className="ep-divider" />
        <button type="button" className="ep-btn ep-btn-quiet" onClick={onOpen} disabled={busy} {...tipProps('Open PDF', { keys: 'Ctrl+O', side: 'bottom', delay: 200 })} aria-label="Open PDF (Ctrl+O)"><FolderOpen size={16} strokeWidth={1.85} aria-hidden="true" /><span className="ep-btn-label">Open</span></button>
        <button type="button" className="ep-btn ep-btn-primary ep-save" onClick={onSave} disabled={busy} {...tipProps('Save as PDF', { keys: 'Ctrl+S', hint: 'Saves a new copy. The original is untouched.', side: 'bottom', delay: 200 })} aria-label="Save as PDF (Ctrl+S)"><Save size={16} strokeWidth={1.9} aria-hidden="true" /><span className="ep-btn-label">{busy ? 'Working…' : 'Save as PDF'}</span>{dirty && <i className="ep-dot" aria-hidden="true" />}</button>
        <Btn icon={propsOpen ? PanelRightClose : PanelRightOpen} label="Properties ( ] )" active={propsOpen} side="bottom" onClick={() => onTogglePanel?.('properties')} />
      </div>
    </div>
  );
}

export function FormatBar({ original, style, onStyle, hasTextTarget, selectionCount, alignTo, setAlignTo, onAlign, onDistribute, canAlign, canDistribute }) {
  const AL = [['left', AlignStartVertical, 'Align left edges'], ['center', AlignCenterVertical, 'Align horizontal centres'], ['right', AlignEndVertical, 'Align right edges'], ['top', AlignStartHorizontal, 'Align top edges'], ['middle', AlignCenterHorizontal, 'Align vertical centres'], ['bottom', AlignEndHorizontal, 'Align bottom edges']];
  return (
    <div className="ep-formatbar">
      <div className="ep-group" role="group" aria-label="Text formatting">
        <span className={cx('ep-mode', hasTextTarget && 'is-live')} title={hasTextTarget ? 'Changes apply to the selected text' : 'Choose a style for the next text you add, or select text to restyle it'}>{hasTextTarget ? 'Selected text' : 'New text'}</span>
        <select className="ep-select ep-font-select" aria-label="Font" value={style.fontName || style.family} onChange={(event) => onStyle({ font: event.target.value })}>
          {original && <option value="__original__">Original: {original}</option>}
          {style.fontName && !original && !COMMON_FONTS.some((f) => f.name === style.fontName) && <option value={style.fontName}>{style.fontName}</option>}
          <optgroup label="PDF built-in">{Object.entries(FONT_FAMILIES).map(([id, f]) => <option key={id} value={id}>{f.label}</option>)}</optgroup>
          <optgroup label="Installed fonts">{COMMON_FONTS.map((f) => <option key={f.name} value={f.name}>{f.name}</option>)}</optgroup>
        </select>
        <input className="ep-size" aria-label="Font size" list="ep-sizes" type="number" min={4} max={300} step={1} value={Math.round(style.size * 10) / 10} onChange={(event) => { const v = Number(event.target.value); if (v >= 4 && v <= 300) onStyle({ size: v }); }} onKeyDown={(event) => event.stopPropagation()} />
        <datalist id="ep-sizes">{SIZES.map((s) => <option key={s} value={s} />)}</datalist>
        <Btn icon={Bold} label="Bold (Ctrl+B)" active={style.bold} onClick={() => onStyle({ bold: !style.bold })} />
        <Btn icon={Italic} label="Italic (Ctrl+I)" active={style.italic} onClick={() => onStyle({ italic: !style.italic })} />
        <Btn icon={UnderlineIcon} label="Underline (Ctrl+U)" active={style.underline} onClick={() => onStyle({ underline: !style.underline })} />
        <Btn icon={Strikethrough} label="Strikethrough" active={style.strike} onClick={() => onStyle({ strike: !style.strike })} />
        <span className="ep-sep" />
        <Btn icon={AlignLeft} label="Align text left" active={style.align === 'left'} onClick={() => onStyle({ align: 'left' })} />
        <Btn icon={AlignCenter} label="Centre text" active={style.align === 'center'} onClick={() => onStyle({ align: 'center' })} />
        <Btn icon={AlignRight} label="Align text right" active={style.align === 'right'} onClick={() => onStyle({ align: 'right' })} />
        <select className="ep-select ep-select-narrow" aria-label="Line spacing" title="Line spacing" value={String(style.lineHeight)} onChange={(event) => onStyle({ lineHeight: Number(event.target.value) })}>{[1, 1.15, 1.2, 1.5, 2].map((v) => <option key={v} value={v}>{v}×</option>)}</select>
        <label className="ep-color" title="Text colour"><input type="color" value={style.color} onChange={(event) => onStyle({ color: event.target.value })} aria-label="Text colour" /></label>
      </div>
      <div className="ep-group ep-group-arrange" role="group" aria-label="Align and distribute">
        <select className="ep-select ep-select-narrow" aria-label="Align to" value={alignTo} onChange={(event) => setAlignTo(event.target.value)} title="What to align the selection to">
          <option value="page">To page</option><option value="margins">To margins</option><option value="selection">To selection</option>
        </select>
        {AL.map(([mode, Icon, label]) => <Btn key={mode} icon={Icon} label={label} onClick={() => onAlign(mode)} disabled={!canAlign} />)}
        <Btn icon={AlignHorizontalSpaceBetween} label="Distribute horizontally (3+ items)" onClick={() => onDistribute('h')} disabled={!canDistribute} />
        <Btn icon={AlignVerticalSpaceBetween} label="Distribute vertically (3+ items)" onClick={() => onDistribute('v')} disabled={!canDistribute} />
        <span className="ep-hint">{selectionCount > 1 ? `${selectionCount} selected` : ''}</span>
      </div>
    </div>
  );
}

export function SidePanel({ tab, setTab, unit, setUnit, selected, single, onPatch, onDelete, onDuplicate, onOrder, onReplaceImage, defaults, setDefaults, stampText, setStampText, tool, pageSize, view, setView, margins, setMargins, guides, onGuides, onApplyGuidesAll, onClearGuides, onSave, busy, dirty, collapsed = false, onToggle, overlay = false }) {
  const lockAspect = view.lockAspect;
  const imageLike = single && ['image', 'signature', 'imageedit'].includes(single.type);
  const isText = single && TEXT_TYPES.has(single.type);
  const autoH = single && (single.type === 'text' || single.type === 'textedit');
  const unsupported = isText ? findUnsupported(single.text) : [];
  const setMargin = (side, value) => setMargins(view.marginLink ? { top: value, right: value, bottom: value, left: value } : { ...margins, [side]: value });
  const preset = (inches) => { const v = inches * 72; setMargins({ top: v, right: v, bottom: v, left: v }); setView({ showMargins: inches > 0 }); };
  return (
    <aside className={cx('ep-side', collapsed && 'is-collapsed')} aria-label="Properties">
      <button type="button" className="ep-side-expand" onClick={onToggle} tabIndex={collapsed && !overlay ? 0 : -1} aria-hidden={!collapsed || overlay} {...tipProps('Show properties', { keys: ']', side: 'left', delay: 120 })} aria-label="Expand properties panel"><ChevronsLeft size={16} strokeWidth={1.9} aria-hidden="true" /><span>Properties</span></button>
      <div className="ep-side-inner" inert={collapsed ? true : undefined}>
      <div className="ep-tabs-row"><div className="ep-tabs" role="tablist"><button type="button" role="tab" aria-selected={tab === 'format'} className={cx(tab === 'format' && 'is-active')} onClick={() => setTab('format')}>Properties</button><button type="button" role="tab" aria-selected={tab === 'guides'} className={cx(tab === 'guides' && 'is-active')} onClick={() => setTab('guides')}>Guides &amp; margins</button></div><button type="button" className="ep-icon-btn ep-collapse-btn" onClick={onToggle} {...tipProps(overlay ? 'Close properties' : 'Hide properties', { keys: ']', side: 'bottom', delay: 200 })} aria-label={overlay ? 'Close properties panel' : 'Collapse properties panel'} aria-expanded={!collapsed}>{overlay ? <X size={16} strokeWidth={1.9} aria-hidden="true" /> : <ChevronsRight size={16} strokeWidth={1.9} aria-hidden="true" />}</button></div>
      {tab === 'format' ? (
        <div className="ep-side-body">
          <section className="ep-section">
            <h3>{selected.length > 1 ? `${selected.length} items selected` : single ? ({ textedit: 'Existing text', imageedit: 'Existing image' }[single.type] || single.type.charAt(0).toUpperCase() + single.type.slice(1)) : 'Nothing selected'}</h3>
            {single ? (
              <>
                <div className="ep-grid2">
                  <NumField label="X" unit={unit} value={single.x} onCommit={(v) => onPatch({ x: v - 0 })} />
                  <NumField label="Y" unit={unit} value={single.y} onCommit={(v) => onPatch({ y: v })} />
                  <NumField label="W" unit={unit} value={single.w} min={2} onCommit={(v) => onPatch(isText ? { w: v, reflow: true } : { w: v, ...(lockAspect && imageLike ? { h: v * single.h / single.w } : {}) })} />
                  <NumField label="H" unit={unit} value={single.h} min={2} disabled={autoH} onCommit={(v) => onPatch({ h: v, ...(lockAspect && imageLike ? { w: v * single.w / single.h } : {}) })} />
                </div>
                {(imageLike || single.type === 'rect' || single.type === 'ellipse') && <button type="button" className={cx('ep-chip', lockAspect && 'is-active')} onClick={() => setView({ lockAspect: !lockAspect })}>{lockAspect ? <Lock size={13} /> : <Unlock size={13} />} Keep proportions</button>}
              </>
            ) : selected.length > 1 ? <p className="ep-note">Drag to move the group, or use the align and distribute buttons above.</p> : <p className="ep-note">Click text or an image on the page to edit it. Hold Shift to select several items.</p>}
            {unsupported.length > 0 && <p className="ep-warn">“{unsupported.slice(0, 6).join(' ')}” can’t be saved with the built-in PDF fonts and will be replaced.</p>}
          </section>
          {(single || (!selected.length)) && (
            <section className="ep-section">
              <h3>{single ? 'Appearance' : 'Defaults for new items'}</h3>
              {(!single || !['signature', 'image', 'imageedit'].includes(single.type)) && <label className="ep-field-row">Colour<input type="color" value={single ? (single.color || '#313b50') : (tool === 'highlight' ? defaults.highlight : defaults.color)} onChange={(event) => (single ? onPatch({ color: event.target.value }) : setDefaults(tool === 'highlight' ? { highlight: event.target.value } : { color: event.target.value }))} /></label>}
              {(!single || ['rect', 'ellipse', 'line', 'underline', 'strike', 'draw', 'stamp'].includes(single.type)) && <label className="ep-field-row">Line width <b>{(single?.lineWidth ?? defaults.lineWidth)} pt</b><input type="range" min="0.5" max="12" step="0.5" value={single?.lineWidth ?? defaults.lineWidth} onChange={(event) => (single ? onPatch({ lineWidth: Number(event.target.value) }) : setDefaults({ lineWidth: Number(event.target.value) }))} /></label>}
              {single && ['highlight', 'whiteout', 'rect', 'ellipse', 'image', 'signature', 'imageedit'].includes(single.type) && <label className="ep-field-row">Opacity <b>{Math.round((single.opacity ?? 1) * 100)}%</b><input type="range" min="10" max="100" value={Math.round((single.opacity ?? (single.type === 'highlight' ? 0.34 : 1)) * 100)} onChange={(event) => onPatch({ opacity: Number(event.target.value) / 100 })} /></label>}
              {!single && tool === 'stamp' && <label className="ep-field-row">Stamp<select className="ep-select" value={stampText} onChange={(event) => setStampText(event.target.value)}>{STAMPS.map((s) => <option key={s}>{s}</option>)}</select></label>}
              {single?.type === 'imageedit' && <button type="button" className="ep-btn" onClick={onReplaceImage}><Replace size={14} /> Replace image</button>}
              {single?.type === 'textedit' && <p className="ep-note">Text edits are overlaid on the original PDF. The editor samples the page background and preserves untouched PDF objects.</p>}
            </section>
          )}
          {selected.length > 0 && (
            <section className="ep-section ep-actions">
              <button type="button" className="ep-btn" onClick={onDuplicate}><Copy size={14} /> Duplicate</button>
              <button type="button" className="ep-btn" onClick={() => onOrder('front')}><BringToFront size={14} /> To front</button>
              <button type="button" className="ep-btn" onClick={() => onOrder('back')}><SendToBack size={14} /> To back</button>
              <button type="button" className="ep-btn ep-btn-danger" onClick={onDelete}><Trash2 size={14} /> Delete</button>
            </section>
          )}
          <section className="ep-section ep-keys"><details><summary>Keyboard shortcuts</summary><div className="ep-keys-list"><span><kbd>V</kbd><kbd>T</kbd><kbd>I</kbd> tools · <kbd>[</kbd> <kbd>]</kbd> side panels</span><span><kbd>Arrows</kbd> nudge · <kbd>Shift</kbd> ×10</span><span><kbd>Ctrl</kbd>+<kbd>D</kbd> duplicate</span><span><kbd>Alt</kbd> move: no snapping</span><span>Resizing: <kbd>Shift</kbd> proportions · <kbd>Alt</kbd> from centre · <kbd>Ctrl</kbd> no snapping · <kbd>Esc</kbd> cancel</span><span><kbd>Ctrl</kbd>+<kbd>+</kbd> <kbd>-</kbd> <kbd>0</kbd> <kbd>1</kbd> <kbd>2</kbd> zoom</span><span><kbd>Ctrl</kbd>+wheel zoom · <kbd>Shift</kbd>+wheel scroll sideways</span><span><kbd>Space</kbd>+drag or middle-drag: pan</span><span><kbd>PgUp</kbd> <kbd>PgDn</kbd> <kbd>Home</kbd> <kbd>End</kbd> pages</span><span><kbd>Ctrl</kbd>+<kbd>B</kbd> <kbd>I</kbd> <kbd>U</kbd> while typing</span><span><kbd>Esc</kbd> finish typing</span><span><kbd>Ctrl</kbd>+<kbd>W</kbd> close window</span></div></details></section>
        </div>
      ) : (
        <div className="ep-side-body">
          <section className="ep-section">
            <h3>Units</h3>
            <div className="ep-seg">{Object.entries(UNIT_DEFS).map(([id, def]) => <button type="button" key={id} className={cx(unit === id && 'is-active')} onClick={() => setUnit(id)} title={def.name}>{def.label}</button>)}</div>
            <p className="ep-note">Page size: {Number((pageSize.w / UNIT_DEFS[unit].pt).toFixed(2))} × {Number((pageSize.h / UNIT_DEFS[unit].pt).toFixed(2))} {unit}</p>
          </section>
          <section className="ep-section">
            <h3>Margin guides</h3>
            <div className="ep-presets">{[['None', 0], ['0.5"', 0.5], ['1"', 1], ['1.5"', 1.5]].map(([label, v]) => <button type="button" className="ep-chip" key={label} onClick={() => preset(v)}>{label}</button>)}</div>
            <div className="ep-grid2">{['top', 'bottom', 'left', 'right'].map((side) => <NumField key={side} label={side[0].toUpperCase() + side.slice(1)} unit={unit} value={margins[side]} min={0} max={(side === 'top' || side === 'bottom' ? pageSize.h : pageSize.w) / 2 - 1} onCommit={(v) => setMargin(side, v)} />)}</div>
            <div className="ep-toggles"><label><input type="checkbox" checked={view.showMargins} onChange={(event) => setView({ showMargins: event.target.checked })} /> Show margins</label><label><input type="checkbox" checked={view.marginLink} onChange={(event) => setView({ marginLink: event.target.checked })} /> Link all four</label><label><input type="checkbox" checked={view.snapMargins} onChange={(event) => setView({ snapMargins: event.target.checked })} /> Snap to margins</label></div>
          </section>
          <section className="ep-section">
            <h3>Guides on this page</h3>
            <div className="ep-guide-list">
              {[['v', 'Vertical'], ['h', 'Horizontal']].map(([axis, name]) => (guides[axis] || []).map((pos, index) => (
                <div className="ep-guide-row" key={`${axis}${index}`}><NumField label={axis === 'v' ? 'X' : 'Y'} unit={unit} value={pos} title={name} onCommit={(v) => onGuides('set', axis, index, v)} /><button type="button" className="ep-icon-btn" aria-label={`Remove ${name.toLowerCase()} guide`} onClick={() => onGuides('remove', axis, index)}><X size={14} /></button></div>
              )))}
              {!(guides.v?.length || guides.h?.length) && <p className="ep-note">Drag from the rulers onto the page, or add one below.</p>}
            </div>
            <div className="ep-presets"><button type="button" className="ep-chip" onClick={() => onGuides('add', 'v', 0, pageSize.w / 2)}><Plus size={12} /> Vertical</button><button type="button" className="ep-chip" onClick={() => onGuides('add', 'h', 0, pageSize.h / 2)}><Plus size={12} /> Horizontal</button></div>
            <div className="ep-presets"><button type="button" className="ep-chip" onClick={onApplyGuidesAll}>Copy to all pages</button><button type="button" className="ep-chip" onClick={onClearGuides}>Clear</button></div>
            <div className="ep-toggles"><label><input type="checkbox" checked={view.showGuides} onChange={(event) => setView({ showGuides: event.target.checked })} /> Show guides</label><label><input type="checkbox" checked={view.guidesLocked} onChange={(event) => setView({ guidesLocked: event.target.checked })} /> Lock guides</label></div>
          </section>
          <section className="ep-section">
            <h3>Grid</h3>
            <NumField label="Spacing" unit={unit} value={view.gridSize} min={2} onCommit={(v) => setView({ gridSize: v })} />
            <div className="ep-toggles"><label><input type="checkbox" checked={view.grid} onChange={(event) => setView({ grid: event.target.checked })} /> Show grid</label><label><input type="checkbox" checked={view.snapGrid} onChange={(event) => setView({ snapGrid: event.target.checked })} /> Snap to grid</label></div>
          </section>
          <section className="ep-section">
            <h3>Snapping</h3>
            <div className="ep-toggles"><label><input type="checkbox" checked={view.snap} onChange={(event) => setView({ snap: event.target.checked })} /> Snapping on</label><label><input type="checkbox" checked={view.snapObjects} onChange={(event) => setView({ snapObjects: event.target.checked })} /> Smart guides (other objects)</label><label><input type="checkbox" checked={view.snapPage} onChange={(event) => setView({ snapPage: event.target.checked })} /> Page edges and centre</label><label><input type="checkbox" checked={view.snapGuides} onChange={(event) => setView({ snapGuides: event.target.checked })} /> Guides</label></div>
          </section>
        </div>
      )}
      </div>
    </aside>
  );
}

