import { memo, useEffect, useRef } from 'react';
import { TEXT_RENDER_STYLE, TEXT_TYPES, layoutItem, resolveText } from '../../services/pdf/textMetrics.js';
import { cx } from '../../utils/cx.js';

const ALL_HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const SIDE_HANDLES = ['w', 'e'];
const LINE_TYPES = new Set(['line', 'underline', 'strike', 'draw']);

function Strokes({ item, scale }) {
  const w = Math.max(1, item.w * scale); const h = Math.max(1, item.h * scale);
  const rel = (p) => `${(p.x - item.x) * scale},${(p.y - item.y) * scale}`;
  const stroke = item.color || '#313b50';
  const sw = Math.max(0.8, (Number(item.lineWidth) || 2) * scale);
  let body = null;
  if (item.type === 'draw') body = <polyline points={(item.points || []).map(rel).join(' ')} fill="none" stroke={stroke} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />;
  else {
    const a = item.type === 'line' && item.startPoint ? rel(item.startPoint) : `0,${(item.type === 'strike' ? item.h * 0.52 : item.h) * scale}`;
    const b = item.type === 'line' && item.endPoint ? rel(item.endPoint) : `${w},${(item.type === 'strike' ? item.h * 0.52 : item.h) * scale}`;
    const [x1, y1] = a.split(','); const [x2, y2] = b.split(',');
    body = <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={stroke} strokeWidth={sw} strokeLinecap="round" />;
  }
  return <svg className="ep-strokes" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">{body}</svg>;
}

function EditableText({ item, scale, editing, onTextChange, onFinish, onFormatKey }) {
  const ref = useRef(null);
  const t = resolveText(item);
  const textLayout = layoutItem(item);
  useEffect(() => {
    const el = ref.current;
    if (!editing || !el) return;
    // preventScroll: focusing must never scroll the page stage, which would look like the text jumping.
    el.focus({ preventScroll: true });
    // Editing an existing PDF text object should replace the text on first typing, not silently append.
    // The user can click at a specific caret position or press an arrow key to make a partial edit.
    el.setSelectionRange(0, el.value.length);
    el.scrollLeft = 0; el.scrollTop = 0;
  }, [editing]);
  // Static text and the textarea share ONE style object, so entering edit mode cannot move or re-flow the glyphs.
  const boxH = Math.max(Number(item.h) || 0, textLayout.autoH);
  const common = {
    ...TEXT_RENDER_STYLE,
    fontFamily: t.cssFamily, fontSize: `${t.size * scale}px`, lineHeight: `${t.size * t.lineHeight * scale}px`,
    fontWeight: t.cssBold ? 700 : 400, fontStyle: t.cssItalic ? 'italic' : 'normal', textAlign: t.align,
    textAlignLast: t.align === 'justify' ? 'left' : 'auto',
    textDecoration: [t.underline && 'underline', t.strike && 'line-through'].filter(Boolean).join(' ') || 'none',
    letterSpacing: item.type === 'stamp' ? '.06em' : 'normal',
    padding: `${t.pad * scale}px`, color: item.color || '#000',
    whiteSpace: t.reflow ? 'pre-wrap' : 'pre', overflowWrap: t.reflow ? 'anywhere' : 'normal',
    minHeight: `${boxH * scale}px`,
    // After TEXT_RENDER_STYLE (which resets text-indent): flowing paragraphs keep their first-line indent.
    textIndent: `${(t.firstIndent || 0) * scale}px`,
  };
  if (editing) {
    const middle = t.valign === 'middle';
    // A textarea cannot vertically centre its text, so give it the same top offset the centred static text has.
    const style = { ...common, ...(middle ? { paddingTop: `${(t.pad + Math.max(0, (Number(item.h) - textLayout.autoH) / 2)) * scale}px` } : null) };
    // Leave a few px of room at the right so the end-of-text caret never makes the field scroll sideways.
    if (!t.reflow && t.align === 'left') style.width = 'calc(100% + 4px)';
    const keepStill = (event) => { const el = event.currentTarget; if (el.scrollLeft || el.scrollTop) { el.scrollLeft = 0; el.scrollTop = 0; } };
    return <textarea ref={ref} className="ep-text-input" style={style} wrap={t.reflow ? 'soft' : 'off'} spellCheck value={item.text || ''} placeholder="Type here" aria-label="Edit text"
      onChange={(event) => onTextChange(item.id, event.target.value)} onBlur={onFinish} onScroll={keepStill}
      onKeyDown={(event) => { event.stopPropagation(); const k = event.key.toLowerCase(); if ((event.ctrlKey || event.metaKey) && !event.shiftKey && ['b', 'i', 'u'].includes(k)) { event.preventDefault(); onFormatKey?.(k); return; } if (event.key === 'Escape' || (event.key === 'Enter' && (event.ctrlKey || event.metaKey))) { event.preventDefault(); event.currentTarget.blur(); } }} />;
  }
  return <div className={cx('ep-text', t.valign === 'middle' && 'is-middle')} style={common}>{item.text}</div>;
}

function ObjectView({ item, scale, selected, editing, interactive, showHandles, onTextChange, onFinish, onFormatKey }) {
  if (item.deleted || item.hidden) return null;
  const isText = TEXT_TYPES.has(item.type);
  const sw = Math.max(0.8, (Number(item.lineWidth) || 2) * scale);
  const style = { left: item.x * scale, top: item.y * scale, width: Math.max(1, item.w * scale), height: Math.max(1, item.h * scale) };
  if (item.type === 'highlight') { style.background = item.color || '#f6d64a'; style.opacity = item.opacity ?? 0.34; style.mixBlendMode = 'multiply'; }
  else if (item.type === 'whiteout') style.background = '#fff';
  else if (item.type === 'rect') { style.border = `${sw}px solid ${item.color}`; style.opacity = item.opacity ?? 1; }
  else if (item.type === 'ellipse') { style.border = `${sw}px solid ${item.color}`; style.borderRadius = '50%'; style.opacity = item.opacity ?? 1; }
  else if (item.type === 'stamp') { style.border = `${sw}px solid ${item.color}`; }
  else if (item.type === 'note') { style.background = '#fff3b5'; style.border = '1px solid #e9ca62'; }
  const handles = !showHandles ? [] : isText ? SIDE_HANDLES : ALL_HANDLES;
  const imageLike = item.type === 'image' || item.type === 'signature' || item.type === 'imageedit';
  return (
    <div data-obj={item.id} className={cx('ep-obj', `ep-obj-${item.type}`, selected && 'is-selected', editing && 'is-editing', interactive && 'can-select', LINE_TYPES.has(item.type) && 'is-thin')} style={style}>
      {isText && <EditableText item={item} scale={scale} editing={editing} onTextChange={onTextChange} onFinish={onFinish} onFormatKey={onFormatKey} />}
      {imageLike && (item.data ? <img src={item.data} alt="" draggable="false" style={{ opacity: item.opacity ?? 1 }} /> : <span className="ep-img-loading" />)}
      {LINE_TYPES.has(item.type) && <Strokes item={item} scale={scale} />}
      {handles.map((handle) => <i key={handle} data-handle={handle} className={`ep-handle ep-handle-${handle}`} />)}
      {editing && <i data-grip="move" className="ep-grip" title="Drag to move" />}
    </div>
  );
}

export default memo(ObjectView);
