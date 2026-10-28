import { useEffect, useMemo, useRef } from 'react';
import { motion } from 'motion/react';
import { FileWarning, UploadCloud, X } from 'lucide-react';
import IconButton from './IconButton.jsx';
import { cx } from '../../utils/cx.js';
import { sentenceCase } from '../../utils/format.js';
import { uid } from '../../utils/id.js';
import { useFileDrop } from '../../hooks/useFileDrop.js';

/**
 * onDropFiles: optional (File[]) => void. When given, files can be dropped anywhere on the dialog (and the dimmed
 *   backdrop around it) and a full-card overlay confirms the target while dragging. dropHint = { title, subtitle,
 *   invalidTitle?, invalidSubtitle? } customises the overlay text.
 * Without onDropFiles the dialog still acts as a guard: dropping files while any dialog is open does nothing
 *   (instead of silently importing them into the workspace behind it).
 */
export default function Modal({ title, eyebrow, children, onClose, footer, wide = false, onDropFiles, dropHint, embedded = false }) {
  const cardRef = useRef(null);
  const { dragState, handlers: dropHandlers } = useFileDrop({ onDrop: onDropFiles, kind: dropHint?.kind });
  const titleId = useMemo(() => `dialog-title-${uid()}`, []);
  useEffect(() => {
    if (embedded) return undefined;
    const onKey = (event) => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [embedded, onClose]);
  // Move focus into the dialog (unless a field already grabbed it) and hand it back to the trigger when closing.
  useEffect(() => {
    if (embedded) return undefined;
    const previous = document.activeElement;
    const card = cardRef.current;
    if (card && !card.contains(document.activeElement)) {
      const target = card.querySelector('[data-autofocus]:not(:disabled)') || card.querySelector('.modal-footer .action-primary:not(:disabled)') || card.querySelector('.modal-footer .action-button:not(:disabled)') || card.querySelector('input:not(:disabled), select:not(:disabled), textarea:not(:disabled), button:not(:disabled)');
      (target || card).focus({ preventScroll: true });
    }
    return () => { if (previous && previous.isConnected) previous.focus?.({ preventScroll: true }); };
  }, [embedded]);
  const trapTab = (event) => {
    if (event.key !== 'Tab') return;
    const focusable = [...cardRef.current.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])')].filter((node) => node.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0]; const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  if (embedded) return <div className="embedded-modal-page" role="region" aria-labelledby={titleId} {...dropHandlers}>
    <div className="embedded-modal-head">{eyebrow && <div className="eyebrow">{sentenceCase(eyebrow)}</div>}<h2 id={titleId}>{title}</h2></div>
    <div className="embedded-modal-content">{children}</div>
    {footer && <div className="embedded-modal-footer">{footer}</div>}
    {dragState && <div className="modal-drop-overlay" data-state={dragState} aria-hidden="true"><div className="modal-drop-overlay-inner">{dragState === 'invalid' ? <FileWarning size={34} strokeWidth={1.6} /> : <UploadCloud size={34} strokeWidth={1.6} />}<strong>{dragState === 'invalid' ? (dropHint?.invalidTitle || 'Only supported files are accepted') : (dropHint?.title || 'Drop your files to continue')}</strong><span>{dragState === 'invalid' ? (dropHint?.invalidSubtitle || 'These files are not supported here.') : (dropHint?.subtitle || 'Release to add them.')}</span></div></div>}
  </div>;
  return <motion.div className="modal-backdrop" {...dropHandlers} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }}>
    <motion.div ref={cardRef} tabIndex={-1} onKeyDown={trapTab} className={cx('modal-card', wide && 'modal-wide')} role="dialog" aria-modal="true" aria-labelledby={titleId} initial={{ opacity: 0, y: 14, scale: 0.975 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.985 }} transition={{ type: 'spring', stiffness: 420, damping: 32, mass: 0.7 }}>
      <div className="modal-head"><div className="modal-head-copy">{eyebrow && <div className="eyebrow">{sentenceCase(eyebrow)}</div>}<h2 id={titleId}>{title}</h2></div><IconButton icon={X} label="Close dialog" onClick={onClose} /></div>
      <div className="modal-content">{children}</div>
      {footer && <div className="modal-footer">{footer}</div>}
      {dragState && <div className="modal-drop-overlay" data-state={dragState} aria-hidden="true"><div className="modal-drop-overlay-inner">
        {dragState === 'invalid' ? <FileWarning size={34} strokeWidth={1.6} /> : <UploadCloud size={34} strokeWidth={1.6} />}
        <strong>{dragState === 'invalid' ? (dropHint?.invalidTitle || 'Only PDF files are supported') : (dropHint?.title || 'Drop your file to continue')}</strong>
        <span>{dragState === 'invalid' ? (dropHint?.invalidSubtitle || 'This file doesn’t look like a PDF.') : (dropHint?.subtitle || 'Release to add it.')}</span>
      </div></div>}
    </motion.div>
  </motion.div>;
}
