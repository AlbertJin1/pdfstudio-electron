import { useEffect, useState } from 'react';
import { formatUnit, fromUnit } from './units.js';

/** Numeric input that shows a value in the chosen unit and commits points on Enter or blur. */
export default function NumField({ label, value, unit, onCommit, disabled, min, max, title }) {
  const [text, setText] = useState(formatUnit(value ?? 0, unit));
  useEffect(() => { setText(formatUnit(value ?? 0, unit)); }, [value, unit]);
  const commit = () => {
    const parsed = Number.parseFloat(text.replace(',', '.'));
    if (!Number.isFinite(parsed)) { setText(formatUnit(value ?? 0, unit)); return; }
    let pt = fromUnit(parsed, unit);
    if (min != null) pt = Math.max(min, pt);
    if (max != null) pt = Math.min(max, pt);
    if (Math.abs(pt - (value ?? 0)) > 0.001) onCommit(pt);
    else setText(formatUnit(value ?? 0, unit));
  };
  return (
    <label className="ep-num" title={title}>
      <span>{label}</span>
      <input type="text" inputMode="decimal" value={text} disabled={disabled} onChange={(event) => setText(event.target.value)} onBlur={commit}
        onKeyDown={(event) => { event.stopPropagation(); if (event.key === 'Enter') { event.currentTarget.blur(); } if (event.key === 'Escape') { setText(formatUnit(value ?? 0, unit)); event.currentTarget.blur(); } }} />
    </label>
  );
}
