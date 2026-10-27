import { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ShieldCheck } from 'lucide-react';

/**
 * Full-app busy indicator. Sits ABOVE dialogs (--z-loader > --z-modal) so the layering is
 * Main -> Modal -> Loader. While visible it also swallows Escape/Tab so a dialog underneath
 * can't be closed or tabbed into mid-operation.
 */
function LoaderCard({ label }) {
  const cardRef = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    cardRef.current?.focus({ preventScroll: true });
    const block = (event) => {
      if (event.key === 'Escape' || event.key === 'Tab') { event.preventDefault(); event.stopPropagation(); cardRef.current?.focus({ preventScroll: true }); }
    };
    window.addEventListener('keydown', block, true);
    return () => {
      window.removeEventListener('keydown', block, true);
      if (previous && previous.isConnected) previous.focus?.({ preventScroll: true });
    };
  }, []);
  return (
    <motion.div ref={cardRef} tabIndex={-1} className="loader-card" role="alertdialog" aria-modal="true" aria-busy="true" aria-live="polite" aria-label={label} initial={{ opacity: 0, y: 10, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 4, scale: 0.985 }} transition={{ type: 'spring', stiffness: 420, damping: 32 }}>
      <div className="loader-mark" aria-hidden="true">
        <svg viewBox="0 0 56 56" className="loader-ring">
          <circle className="loader-track" cx="28" cy="28" r="24" />
          <circle className="loader-arc" cx="28" cy="28" r="24" pathLength="100" />
        </svg>
        <ShieldCheck className="loader-icon" size={20} strokeWidth={2} />
      </div>
      <strong className="loader-title">{label}</strong>
      <span className="loader-note">Keeping everything on this device</span>
      <span className="loader-bar" aria-hidden="true"><i /></span>
    </motion.div>
  );
}

export default function LoadingOverlay({ isLoading, loadingLabel }) {
  return (
    <AnimatePresence>
      {isLoading && (
        <motion.div className="loader-overlay" key="loader" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }}>
          <LoaderCard label={loadingLabel} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
