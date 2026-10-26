import { AnimatePresence, motion } from 'motion/react';
import { Activity, Check, X } from 'lucide-react';
import { cx } from '../../utils/cx.js';

export default function Toast({ toast, setToast }) {
  return (
    <AnimatePresence>{toast && <motion.div key={`${toast.kind}:${toast.message}`} className={cx('toast-message', `toast-${toast.kind}`)} initial={{ opacity: 0, y: 14, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.985 }} transition={{ type: 'spring', stiffness: 440, damping: 30 }}><span className="toast-icon">{toast.kind === 'error' ? <X size={15}/> : toast.kind === 'info' ? <Activity size={15}/> : <Check size={15}/>}</span><span>{toast.message}</span><button onClick={() => setToast(null)}><X size={13}/></button></motion.div>}</AnimatePresence>
  );
}
