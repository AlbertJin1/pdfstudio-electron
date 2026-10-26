import { useEffect, useMemo, useRef } from 'react';
import { motion } from 'motion/react';
import { X } from 'lucide-react';
import IconButton from './IconButton.jsx';
import { cx } from '../../utils/cx.js';
import { sentenceCase } from '../../utils/format.js';
import { uid } from '../../utils/id.js';

export default function Modal({ title, eyebrow, children, onClose, footer, wide = false }) {
  const cardRef = useRef(null);
  const titleId = useMemo(() => `dialog-title-${uid()}`, []);
  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  // Move focus into the dialog (unless a field already grabbed it) and hand it back to the trigger when closing.
  useEffect(() => {
    const previous = document.activeElement;
    const card = cardRef.current;
    if (card && !card.contains(document.activeElement)) {
      const target = card.querySelector('.modal-footer .action-primary') || card.querySelector('.modal-footer .action-button') || card.querySelector('input, select, textarea, button');
      (target || card).focus({ preventScroll: true });
    }
    return () => { if (previous && previous.isConnected) previous.focus?.({ preventScroll: true }); };
  }, []);
  const trapTab = (event) => {
    if (event.key !== 'Tab') return;
    const focusable = [...cardRef.current.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])')].filter((node) => node.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0]; const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  return <motion.div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }}>
    <motion.div ref={cardRef} tabIndex={-1} onKeyDown={trapTab} className={cx('modal-card', wide && 'modal-wide')} role="dialog" aria-modal="true" aria-labelledby={titleId} initial={{ opacity: 0, y: 14, scale: 0.975 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.985 }} transition={{ type: 'spring', stiffness: 420, damping: 32, mass: 0.7 }}>
      <div className="modal-head"><div className="modal-head-copy">{eyebrow && <div className="eyebrow">{sentenceCase(eyebrow)}</div>}<h2 id={titleId}>{title}</h2></div><IconButton icon={X} label="Close dialog" onClick={onClose} /></div>
      <div className="modal-content">{children}</div>
      {footer && <div className="modal-footer">{footer}</div>}
    </motion.div>
  </motion.div>;
}
