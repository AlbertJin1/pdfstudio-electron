import { useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import { LockKeyhole, RotateCcw, X, CircleAlert, LoaderCircle, WifiOff } from 'lucide-react';
import { formatAccessTime, shortDeviceId } from '../../utils/access.js';
import { cx } from '../../utils/cx.js';

/**
 * Full-screen lock shown while the Monitor administrator has disabled this device. It is rendered outside the
 * (inert) application shell. Real enforcement happens in the main process; this is the explanation + recovery UI.
 */
export default function AccessLockScreen({ access, checking, notice, dark, onRecheck, onQuit }) {
  const primaryRef = useRef(null);
  const quitRef = useRef(null);
  useEffect(() => { primaryRef.current?.focus(); }, []);
  const onKeyDown = (event) => {
    if (event.key === 'Escape') { event.preventDefault(); return; }
    if (event.key !== 'Tab') return;
    const first = primaryRef.current;
    const last = quitRef.current;
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  const disabledOn = formatAccessTime(access.updatedAt);
  const checkedAt = access.checkedAt ? new Date(access.checkedAt).toLocaleTimeString([], { timeStyle: 'short' }) : '';
  return <motion.div className={cx('access-lock', dark && 'theme-dark')} role="alertdialog" aria-modal="true" aria-labelledby="access-lock-title" aria-describedby="access-lock-desc" onKeyDown={onKeyDown}
    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
    <div className="access-lock-drag" aria-hidden="true" />
    <motion.div className="access-lock-card" initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 380, damping: 32 }}>
      <div className="access-lock-icon"><LockKeyhole size={26}/></div>
      <span className="access-lock-eyebrow">ACCESS DISABLED</span>
      <h1 id="access-lock-title">PDF Studio is disabled on this device</h1>
      <p id="access-lock-desc">An administrator has turned off PDF Studio for this computer. Your files were not changed or uploaded. Opening, converting and saving documents are unavailable until access is restored.</p>
      {access.reason && <blockquote className="access-lock-reason"><span>Message from the administrator</span><p>{access.reason}</p></blockquote>}
      <dl className="access-lock-details">
        <div><dt>Computer</dt><dd>{access.hostname || 'This device'}</dd></div>
        <div><dt>Device ID</dt><dd className="mono">{shortDeviceId(access.installId) || '—'}</dd></div>
        {access.updatedBy && <div><dt>Disabled by</dt><dd>{access.updatedBy}</dd></div>}
        {disabledOn && <div><dt>Disabled on</dt><dd>{disabledOn}</dd></div>}
      </dl>
      {access.offline && <div className="access-lock-note access-lock-note-warn" role="status"><WifiOff size={15}/><span>The monitor can’t be reached right now, so PDF Studio is showing the last known status. It will unlock automatically once the monitor confirms access is restored.</span></div>}
      {!access.offline && notice && <div className="access-lock-note" role="status"><CircleAlert size={15}/><span>{notice}</span></div>}
      <div className="access-lock-actions">
        <button ref={primaryRef} type="button" className="action-button action-primary" onClick={onRecheck} disabled={checking}>{checking ? <LoaderCircle size={15} className="update-status-spinner"/> : <RotateCcw size={15}/>}<span>{checking ? 'Checking…' : 'Check again'}</span></button>
        <button ref={quitRef} type="button" className="action-button action-secondary" onClick={onQuit}><X size={15}/><span>Quit PDF Studio</span></button>
      </div>
      <small className="access-lock-foot">PDF Studio re-checks automatically about every 30 seconds{checkedAt ? ` · last checked ${checkedAt}` : ''}.</small>
    </motion.div>
  </motion.div>;
}
