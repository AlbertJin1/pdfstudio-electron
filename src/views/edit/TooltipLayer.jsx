import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * One tooltip for the whole editor.
 *
 * Any element inside `rootRef` can opt in with data attributes (see `tipProps` in panels.jsx):
 *   data-tip="Add text"  data-tip-keys="T"  data-tip-hint="Click to type…"  data-tip-side="right|left|top|bottom"
 * A single set of delegated listeners serves every control, so toolbars stay cheap to render, and the bubble is
 * portaled to <body> so no overflow:hidden panel can clip it. It flips at screen edges, and moving between
 * neighbouring controls shows the next tip instantly instead of re-running the hover delay.
 */
export default function TooltipLayer({ rootRef }) {
  const [tip, setTip] = useState(null);
  const bubbleRef = useRef(null);
  const timerRef = useRef(0);
  const targetRef = useRef(null);
  const visibleRef = useRef(false);

  useEffect(() => { visibleRef.current = Boolean(tip); }, [tip]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;

    const hide = () => {
      window.clearTimeout(timerRef.current);
      targetRef.current = null;
      setTip(null);
    };
    const show = (el, instant) => {
      targetRef.current = el;
      window.clearTimeout(timerRef.current);
      const run = () => {
        if (targetRef.current !== el || !el.isConnected) return;
        const r = el.getBoundingClientRect();
        setTip({
          text: el.dataset.tip,
          keys: el.dataset.tipKeys || '',
          hint: el.dataset.tipHint || '',
          side: el.dataset.tipSide || 'bottom',
          rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height },
        });
      };
      const delay = Number(el.dataset.tipDelay ?? 380);
      if (instant || visibleRef.current || delay <= 0) run(); else timerRef.current = window.setTimeout(run, delay);
    };

    const onOver = (event) => {
      const el = event.target.closest?.('[data-tip]');
      if (!el || !root.contains(el)) { if (targetRef.current) hide(); return; }
      if (el === targetRef.current) return;
      show(el, false);
    };
    const onOut = (event) => {
      const current = targetRef.current;
      if (!current) return;
      const to = event.relatedTarget;
      if (to instanceof Node && current.contains(to)) return;
      hide();
    };
    const onFocusIn = (event) => {
      const el = event.target.closest?.('[data-tip]');
      // Only keyboard focus shows a tip; mouse focus would pin it open after a click.
      if (el && el.matches(':focus-visible')) show(el, true);
    };
    const onKey = (event) => { if (event.key === 'Escape') hide(); };

    root.addEventListener('pointerover', onOver);
    root.addEventListener('pointerout', onOut);
    root.addEventListener('pointerdown', hide, true);
    root.addEventListener('focusin', onFocusIn);
    root.addEventListener('focusout', hide);
    root.addEventListener('keydown', onKey);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('blur', hide);
    window.addEventListener('resize', hide);
    return () => {
      hide();
      root.removeEventListener('pointerover', onOver);
      root.removeEventListener('pointerout', onOut);
      root.removeEventListener('pointerdown', hide, true);
      root.removeEventListener('focusin', onFocusIn);
      root.removeEventListener('focusout', hide);
      root.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('blur', hide);
      window.removeEventListener('resize', hide);
    };
  }, [rootRef]);

  // Measure the rendered bubble, then place it beside its target (flipping when it would leave the window).
  useLayoutEffect(() => {
    const node = bubbleRef.current;
    if (!tip || !node) return;
    const { width: w, height: h } = node.getBoundingClientRect();
    const { rect: r } = tip;
    const gap = 9; const margin = 8; const vw = window.innerWidth; const vh = window.innerHeight;
    let side = tip.side;
    if (side === 'right' && r.right + gap + w > vw - margin) side = 'left';
    else if (side === 'left' && r.left - gap - w < margin) side = 'right';
    else if (side === 'bottom' && r.bottom + gap + h > vh - margin) side = 'top';
    else if (side === 'top' && r.top - gap - h < margin) side = 'bottom';
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    let x; let y;
    if (side === 'right' || side === 'left') {
      x = side === 'right' ? r.right + gap : r.left - gap - w;
      y = clamp(r.top + r.height / 2 - h / 2, margin, vh - h - margin);
      node.style.setProperty('--arrow', `${r.top + r.height / 2 - y}px`);
    } else {
      x = clamp(r.left + r.width / 2 - w / 2, margin, vw - w - margin);
      y = side === 'bottom' ? r.bottom + gap : r.top - gap - h;
      node.style.setProperty('--arrow', `${r.left + r.width / 2 - x}px`);
    }
    node.dataset.side = side;
    node.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    node.style.visibility = 'visible';
  }, [tip]);

  if (!tip) return null;
  return createPortal(
    <div ref={bubbleRef} className="ep-tooltip" role="tooltip" style={{ visibility: 'hidden' }}>
      <span className="ep-tooltip-row"><span className="ep-tooltip-text">{tip.text}</span>{tip.keys && <kbd>{tip.keys}</kbd>}</span>
      {tip.hint && <span className="ep-tooltip-hint">{tip.hint}</span>}
    </div>,
    document.body,
  );
}
