import { AnimatePresence, motion } from 'motion/react';
import {
  PackageCheck,
  Search,
  ShieldCheck,
  MonitorDown,
  CheckCircle,
  CircleAlert,
  LoaderCircle,
} from 'lucide-react';
import ActionButton from '../../components/common/ActionButton.jsx';
import { cx } from '../../utils/cx.js';
import { formatBytes } from '../../utils/format.js';

export default function UpdatesTab({ updateState, readyUpdate, appVersion, checkForUpdates }) {
  return (
    <div className="settings-panel updater-panel">
                    <div className="settings-panel-title"><span className="settings-symbol settings-symbol-blue"><MonitorDown size={18}/></span><div><h2>Updates & downloads</h2><p>PDF Studio checks when it opens and quietly prepares verified updates while you keep working.</p></div></div>
                    <div className="update-current-version"><div className="update-version-icon"><PackageCheck size={20}/></div><div><span>Installed version</span><strong>PDF Studio {appVersion}</strong><small>Windows · portable EXE</small></div><span className="update-local-label"><span/> Local app</span></div>
                    <div className="settings-divider"/>
                    <div className="update-actions"><ActionButton icon={updateState.status === 'checking' ? LoaderCircle : Search} variant="primary" disabled={updateState.status === 'checking' || updateState.status === 'downloading' || updateState.status === 'applying'} onClick={checkForUpdates}>{updateState.status === 'checking' ? 'Checking for updates…' : 'Check for updates'}</ActionButton>{updateState.status === 'downloading' && <span className="update-background-note"><LoaderCircle size={14}/> Downloading securely in the background. You can keep working.</span>}</div>
                    <motion.div layout className={cx('update-status-card', `update-status-${updateState.status}`)} role="status" aria-live="polite" initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }}><span className="update-status-icon">{updateState.status === 'checking' || updateState.status === 'downloading' || updateState.status === 'applying' ? <LoaderCircle className="update-status-spinner" size={18}/> : updateState.status === 'error' ? <CircleAlert size={18}/> : updateState.status === 'ready' || updateState.status === 'up-to-date' ? <CheckCircle size={18}/> : <MonitorDown size={18}/>}</span><div className="update-status-copy"><strong>{updateState.status === 'checking' ? 'Checking for updates' : updateState.status === 'downloading' ? `Downloading version ${updateState.latestVersion || ''}`.trim() : updateState.status === 'ready' ? `Version ${updateState.latestVersion || readyUpdate?.version || ''} is ready` : updateState.status === 'applying' ? 'Applying update' : updateState.status === 'up-to-date' ? 'You’re up to date' : updateState.status === 'error' ? 'Could not check for updates' : 'Automatic updates enabled'}</strong><p>{updateState.message || 'PDF Studio checks for verified updates when the application opens.'}</p></div></motion.div>
                    <AnimatePresence initial={false}>{updateState.status === 'downloading' && <motion.div className="update-progress-wrap" key="update-progress" initial={{ opacity: 0, height: 0, y: -4 }} animate={{ opacity: 1, height: 'auto', y: 0 }} exit={{ opacity: 0, height: 0, y: -4 }} transition={{ duration: 0.2 }}><div className="update-progress-meta"><span>{updateState.percent == null ? 'Downloading…' : `${Math.round(updateState.percent)}%`}</span><span>{updateState.downloadedBytes != null ? `${formatBytes(updateState.downloadedBytes)}${updateState.totalBytes ? ` of ${formatBytes(updateState.totalBytes)}` : ''}` : 'Preparing update package'}</span></div><div className="update-progress-track"><motion.div className={cx('update-progress-value', updateState.percent == null && 'update-progress-indeterminate')} animate={{ width: updateState.percent == null ? '34%' : `${Math.min(100, Math.max(0, updateState.percent))}%` }} transition={{ duration: 0.18, ease: 'easeOut' }}/></div></motion.div>}</AnimatePresence>
                    <div className="settings-note update-safety-note"><ShieldCheck size={18}/><div><strong>Verified before installing</strong><p>Update files are checked for integrity before they are staged. When an update is ready, PDF Studio asks whether to restart and apply it now or wait until later.</p></div></div>
                  </div>
  );
}
