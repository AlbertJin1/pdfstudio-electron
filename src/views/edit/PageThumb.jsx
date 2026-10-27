import { useEffect, useRef, useState } from 'react';

/** Rendered thumbnails are cached per document so reopening the page picker is instant. */
const CACHE = new WeakMap();
const cacheFor = (pdfDoc) => { let map = CACHE.get(pdfDoc); if (!map) { map = new Map(); CACHE.set(pdfDoc, map); } return map; };
const THUMB_WIDTH = 160;

/** Lazily rendered page thumbnail. `eager` skips the viewport check (used for the single trigger thumbnail). */
export default function PageThumb({ pdfDoc, pageNumber, eager = false }) {
  const wrapRef = useRef(null);
  const cached = pdfDoc ? cacheFor(pdfDoc).get(pageNumber) : null;
  const [thumb, setThumb] = useState(cached || null);

  useEffect(() => {
    const node = wrapRef.current;
    if (!node || !pdfDoc) return undefined;
    const store = cacheFor(pdfDoc);
    const hit = store.get(pageNumber);
    if (hit) { setThumb(hit); return undefined; }
    setThumb(null);
    let cancelled = false; let task = null;
    const render = async () => {
      try {
        const page = await pdfDoc.getPage(pageNumber);
        if (cancelled) return;
        const rotation = page.rotate || 0;
        const base = page.getViewport({ scale: 1, rotation });
        const viewport = page.getViewport({ scale: THUMB_WIDTH / base.width, rotation });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
        const context = canvas.getContext('2d', { alpha: false });
        context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
        task = page.render({ canvasContext: context, viewport, background: '#fff' });
        await task.promise;
        if (cancelled) return;
        const entry = { src: canvas.toDataURL('image/jpeg', 0.72), ratio: base.height / base.width };
        store.set(pageNumber, entry); setThumb(entry);
      } catch { /* thumbnails are optional */ }
    };
    if (eager || typeof IntersectionObserver === 'undefined') { render(); return () => { cancelled = true; try { task?.cancel?.(); } catch { /* no-op */ } }; }
    const observer = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) { observer.disconnect(); render(); } }, { rootMargin: '160px' });
    observer.observe(node);
    return () => { cancelled = true; observer.disconnect(); try { task?.cancel?.(); } catch { /* no-op */ } };
  }, [pdfDoc, pageNumber, eager]);

  return <span ref={wrapRef} className="ep-thumb" style={{ aspectRatio: `1 / ${thumb?.ratio || 1.294}` }}>{thumb ? <img src={thumb.src} alt="" draggable="false" /> : <i />}</span>;
}
