import { useEffect, useRef } from 'react';
import { rulerSteps, toUnit } from './units.js';

export const RULER_SIZE = 22;

/** Canvas ruler aligned to the page origin; drag from it to pull out a guide. */
export default function Ruler({ orientation, length, origin, scale, pageLength, unit, band, cursor, onGuideStart }) {
  const ref = useRef(null);
  const horizontal = orientation === 'h';

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || length < 4) return;
    const dpr = window.devicePixelRatio || 1;
    const width = horizontal ? length : RULER_SIZE;
    const height = horizontal ? RULER_SIZE : length;
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const style = getComputedStyle(canvas);
    const ink = style.color;
    const accent = style.getPropertyValue('--ep-ruler-accent').trim() || '#6757d9';
    const paper = style.getPropertyValue('--ep-ruler-paper').trim() || '#fff';
    const outside = style.getPropertyValue('--ep-ruler-outside').trim() || '#eee';
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = outside; ctx.fillRect(0, 0, width, height);
    const a = Math.max(0, origin); const b = Math.min(length, origin + pageLength * scale);
    ctx.fillStyle = paper;
    if (horizontal) ctx.fillRect(a, 0, Math.max(0, b - a), height); else ctx.fillRect(0, a, width, Math.max(0, b - a));
    if (band) {
      ctx.fillStyle = accent; ctx.globalAlpha = 0.18;
      const s = origin + band.start * scale; const e = origin + band.end * scale;
      if (horizontal) ctx.fillRect(s, 0, Math.max(1, e - s), height); else ctx.fillRect(0, s, width, Math.max(1, e - s));
      ctx.globalAlpha = 1;
    }
    const { minorPt, sub, major } = rulerSteps(unit, scale);
    const first = Math.floor((-origin / scale) / minorPt);
    const last = Math.ceil(((length - origin) / scale) / minorPt);
    ctx.strokeStyle = ink; ctx.fillStyle = ink; ctx.lineWidth = 1; ctx.font = '10px Inter, system-ui, sans-serif'; ctx.textBaseline = 'top';
    for (let i = first; i <= last; i += 1) {
      const pos = Math.round(origin + i * minorPt * scale) + 0.5;
      const isMajor = i % sub === 0;
      const isMid = sub > 1 && sub % 2 === 0 && i % (sub / 2) === 0;
      const len = isMajor ? RULER_SIZE * 0.62 : isMid ? RULER_SIZE * 0.4 : RULER_SIZE * 0.24;
      ctx.globalAlpha = isMajor ? 0.9 : 0.55;
      ctx.beginPath();
      if (horizontal) { ctx.moveTo(pos, RULER_SIZE); ctx.lineTo(pos, RULER_SIZE - len); } else { ctx.moveTo(RULER_SIZE, pos); ctx.lineTo(RULER_SIZE - len, pos); }
      ctx.stroke();
      if (isMajor) {
        ctx.globalAlpha = 0.85;
        const label = String(Number((i / sub * major).toFixed(2)));
        if (horizontal) ctx.fillText(label, pos + 3, 2);
        else { ctx.save(); ctx.translate(2, pos - 3); ctx.rotate(-Math.PI / 2); ctx.textBaseline = 'top'; ctx.fillText(label, 0, 0); ctx.restore(); }
      }
    }
    ctx.globalAlpha = 1;
    if (cursor != null) {
      const pos = Math.round(origin + cursor * scale) + 0.5;
      ctx.strokeStyle = accent; ctx.beginPath();
      if (horizontal) { ctx.moveTo(pos, 0); ctx.lineTo(pos, height); } else { ctx.moveTo(0, pos); ctx.lineTo(width, pos); }
      ctx.stroke();
    }
    ctx.strokeStyle = style.getPropertyValue('--ep-ruler-edge').trim() || '#ccc';
    ctx.beginPath();
    if (horizontal) { ctx.moveTo(0, height - 0.5); ctx.lineTo(width, height - 0.5); } else { ctx.moveTo(width - 0.5, 0); ctx.lineTo(width - 0.5, height); }
    ctx.stroke();
  }, [band, cursor, horizontal, length, origin, pageLength, scale, unit]);

  return <canvas ref={ref} className={`ep-ruler ep-ruler-${orientation}`} onPointerDown={(event) => { if (event.button === 0) { event.preventDefault(); onGuideStart(horizontal ? 'h' : 'v', -1, event); } }} title="Drag onto the page to create a guide" aria-label={`${horizontal ? 'Horizontal' : 'Vertical'} ruler`} />;
}

export { toUnit };
