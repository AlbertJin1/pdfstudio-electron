import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { classifyDrag, dragHasFiles } from '../utils/pdfFiles.js';

/**
 * Turns an element into a file drop target.
 *
 *   const { dragState, handlers } = useFileDrop({ onDrop: (files) => ... });
 *   <div {...handlers}>…</div>
 *
 * - dragState is null (idle), 'valid' or 'invalid' (the dragged files can't be PDFs) so the UI can react.
 * - With no onDrop the target is a "guard": files dragged over it get a not-allowed cursor and a drop is
 *   swallowed, so it can never fall through to a parent handler (e.g. the app-wide "add to workspace" drop).
 * - A depth counter (not mouseenter/leave) is used because dragenter/dragleave also fire for every child
 *   element; a naive handler flickers and gets stuck. Window-level drop/dragend listeners reset it for the
 *   cases where the drag ends somewhere else.
 */
export function useFileDrop({ onDrop } = {}) {
  const [dragState, setDragState] = useState(null);
  const depth = useRef(0);
  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;
  const accepting = Boolean(onDrop);

  const reset = useCallback(() => { depth.current = 0; setDragState(null); }, []);

  useEffect(() => {
    if (!accepting) return undefined;
    window.addEventListener('drop', reset, true);
    window.addEventListener('dragend', reset, true);
    return () => { window.removeEventListener('drop', reset, true); window.removeEventListener('dragend', reset, true); };
  }, [accepting, reset]);

  // If the target stops accepting drops mid-drag (e.g. a task started), drop the highlight too.
  useEffect(() => { if (!accepting) reset(); }, [accepting, reset]);

  const handlers = useMemo(() => ({
    onDragEnter(event) {
      if (!dragHasFiles(event)) return;
      event.preventDefault();
      if (!onDropRef.current) return;
      depth.current += 1;
      setDragState(classifyDrag(event).state);
    },
    onDragOver(event) {
      if (!dragHasFiles(event)) return;
      event.preventDefault(); // required, otherwise the browser never fires `drop`
      event.dataTransfer.dropEffect = onDropRef.current ? 'copy' : 'none';
    },
    onDragLeave(event) {
      if (!dragHasFiles(event) || !onDropRef.current) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragState(null);
    },
    onDrop(event) {
      if (!dragHasFiles(event)) return;
      event.preventDefault();
      event.stopPropagation(); // keep the app-level handler from importing the file into the workspace
      reset();
      const handler = onDropRef.current;
      if (handler) handler(Array.from(event.dataTransfer.files || []), event);
    },
  }), [reset]);

  return { dragState, handlers };
}
