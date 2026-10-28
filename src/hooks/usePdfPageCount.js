import { useEffect, useState } from 'react';
import { loadPdfSource } from '../services/pdf/index.js';

/** Page count of a picked PDF: null while reading (or no file), 0 when it can't be read. */
export function usePdfPageCount(file) {
  const [count, setCount] = useState(null);
  useEffect(() => {
    if (!file?.bytes) { setCount(null); return undefined; }
    let cancelled = false; let doc = null;
    setCount(null);
    loadPdfSource(file.bytes).then((pdf) => { doc = pdf; if (!cancelled) setCount(pdf.numPages); else pdf.destroy?.(); }).catch(() => { if (!cancelled) setCount(0); });
    return () => { cancelled = true; doc?.destroy?.(); };
  }, [file]);
  return count;
}
