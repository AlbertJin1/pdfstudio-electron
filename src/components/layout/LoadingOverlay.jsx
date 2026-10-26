import { AnimatePresence, motion } from 'motion/react';

export default function LoadingOverlay({ isLoading, loadingLabel }) {
  return (
    <AnimatePresence>{isLoading && <motion.div className="loading-overlay" key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><motion.div className="loading-card" initial={{ opacity: 0, y: 8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 4, scale: 0.99 }} transition={{ type: 'spring', stiffness: 420, damping: 32 }}><div className="loading-spinner"><span/><span/><span/></div><strong>{loadingLabel}</strong><span>Keeping everything on this device</span></motion.div></motion.div>}</AnimatePresence>
  );
}
