import { useEffect, useRef, useState } from 'react';

/** Lazily rendered page thumbnail. */
export default function PageThumb({ pdfDoc, pageNumber }) {
  const wrapRef = useRef(null);
  const [src, setSrc] = useState('');
  const [ratio, setRatio] = useState(1.3);

  useEffect(() => {
    const node = wrapRef.current;
    if (!node || !pdfDoc) return undefined;
    let cancelled = false;
    const render = async () => {
      try {
        const page = await pdfDoc.getPage(pageNumber);
        const base = page.getViewport({ scale: 1, rotation: page.rotate || 0 });
        if (cancelled) return;
        setRatio(base.height / base.width);
        const scale = 150 / base.width;
        const viewport = page.getViewport({ scale, rotation: page.rotate || 0 });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
        const context = canvas.getContext('2d', { alpha: false });
        context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: context, viewport, background: '#fff' }).promise;
        if (!cancelled) setSrc(canvas.toDataURL('image/jpeg', 0.7));
      } catch { /* thumbnails are optional */ }
    };
    if (typeof IntersectionObserver === 'undefined') { render(); return () => { cancelled = true; }; }
    const observer = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) { observer.disconnect(); render(); } }, { rootMargin: '200px' });
    observer.observe(node);
    return () => { cancelled = true; observer.disconnect(); };
  }, [pdfDoc, pageNumber]);

  return <span ref={wrapRef} className="ep-thumb" style={{ aspectRatio: `1 / ${ratio}` }}>{src ? <img src={src} alt="" draggable="false" /> : <i />}</span>;
}
