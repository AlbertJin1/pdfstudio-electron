import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, LayoutGroup, MotionConfig, motion } from 'motion/react';
import {
  Activity, AlignLeft, ArrowDownToLine, ArrowDownUp, ArrowLeft, ArrowRight, ArrowUpRight,
  BadgeCheck, BookOpen, Check, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight,
  CircleHelp, Clock3, Cloud, Copy, Download, FileArchive, FileCheck2, FileImage,
  FilePlus2, FileText, Files, FolderOpen, Gauge, GripVertical, HardDrive,
  History, ImagePlus, Layers3, LayoutDashboard, ListFilter, LockKeyhole, Maximize2,
  Minimize2, Minus, Moon, MoreHorizontal, PackageCheck, PanelRightClose, PanelRightOpen,
  Plus, Redo2, RotateCcw, RotateCw, Search, Settings2, ShieldCheck, Sparkles, Split, SlidersHorizontal, FileOutput,
  Sun, Trash2, Type, Undo2, Upload, WandSparkles, X, ZoomIn, ZoomOut, Scissors, MonitorDown, CheckCircle, CircleAlert, LoaderCircle, Laptop, WifiOff,
} from 'lucide-react';
import { composePdf, createPageThumbnail, isImage, isPdf, loadPdfSource, normalizeBytes, pdfToDocx, renderPageCanvas, renderPdfImages, uid } from './lib/pdfWorkspace.js';

const initialTools = [
  { label: 'Merge & organize', description: 'Reorder, rotate, duplicate and combine pages', icon: Layers3, tone: 'lavender', mode: 'workspace' },
  { label: 'PDF to Word', description: 'Turn selectable PDF text into an editable DOCX', icon: FileText, tone: 'blue', action: 'word' },
  { label: 'PDF to images', description: 'Export pages as high-quality PNG or JPG', icon: FileImage, tone: 'orange', action: 'images' },
  { label: 'Images to PDF', description: 'Build a polished PDF from your image files', icon: ImagePlus, tone: 'green', mode: 'workspace' },
];


// Shared motion presets keep transitions coherent across the whole desktop UI.
const pageVariants = {
  initial: { opacity: 0, y: 10, scale: 0.997 },
  animate: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.22, ease: [0.22, 1, 0.36, 1] } },
  exit: { opacity: 0, y: -5, scale: 0.999, transition: { duration: 0.13, ease: 'easeIn' } },
};
const staggerVariants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.045, delayChildren: 0.025 } },
};
const staggerItemVariants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: 0.24, ease: [0.22, 1, 0.36, 1] } },
};
const interactiveSpring = { type: 'spring', stiffness: 480, damping: 32, mass: 0.55 };

function cx(...parts) { return parts.filter(Boolean).join(' '); }
function formatBytes(size = 0) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
function extName(name = '') { return name.split('.').pop()?.toUpperCase() || 'FILE'; }

const DEFAULT_PREFERENCES = Object.freeze({
  theme: 'light',
  accentTheme: 'violet',
  fontScale: 'standard',
  density: 'comfortable',
  highContrast: false,
  reduceMotion: false,
  confirmDelete: true,
  showInspector: true,
  defaultImageFormat: 'png',
  defaultImageQuality: 92,
});

function readPreferences() {
  try {
    const saved = JSON.parse(localStorage.getItem('pdfstudio-settings') || '{}');
    // Ignore any URL from older settings: the update endpoint is hardcoded in the Electron main process.
    delete saved.updateFeedUrl;
    const legacyTheme = localStorage.getItem('pdfstudio-theme');
    return {
      ...DEFAULT_PREFERENCES,
      ...saved,
      theme: saved.theme || legacyTheme || DEFAULT_PREFERENCES.theme,
      accentTheme: ['violet', 'blue', 'teal', 'green', 'rose', 'amber'].includes(saved.accentTheme) ? saved.accentTheme : DEFAULT_PREFERENCES.accentTheme,
      fontScale: ['standard', 'large', 'xlarge'].includes(saved.fontScale) ? saved.fontScale : DEFAULT_PREFERENCES.fontScale,
      density: ['comfortable', 'compact'].includes(saved.density) ? saved.density : DEFAULT_PREFERENCES.density,
      highContrast: Boolean(saved.highContrast),
      reduceMotion: Boolean(saved.reduceMotion),
      confirmDelete: saved.confirmDelete !== false,
      showInspector: saved.showInspector !== false,
      defaultImageFormat: saved.defaultImageFormat === 'jpeg' ? 'jpeg' : 'png',
      defaultImageQuality: Math.min(100, Math.max(40, Number(saved.defaultImageQuality) || 92)),
    };
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

function SettingToggle({ title, description, checked, onChange }) {
  return <label className="setting-toggle-row"><span className="setting-toggle-copy"><strong>{title}</strong><small>{description}</small></span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span className="setting-switch" aria-hidden="true" /></label>;
}

function IconButton({ icon: Icon, label, onClick, disabled = false, active = false, className = '', size = 16, variant = 'ghost' }) {
  return <button type="button" title={label} aria-label={label} aria-pressed={active || undefined} onClick={onClick} disabled={disabled} className={cx('icon-button', `icon-button-${variant}`, active && 'is-active', className)}><Icon size={size} strokeWidth={1.85} aria-hidden="true" /></button>;
}
/**
 * Every text button in the app goes through this component so hierarchy, sizing, focus and disabled states stay uniform.
 * variant: primary | secondary | ghost | danger     size: sm | md | lg     iconPosition: start | end
 */
function ActionButton({ icon: Icon, children, onClick, disabled = false, loading = false, variant = 'secondary', size = 'md', iconPosition = 'start', className = '', type = 'button', ...rest }) {
  const iconNode = loading ? <LoaderCircle size={16} strokeWidth={1.9} className="button-spinner" aria-hidden="true" /> : Icon ? <Icon size={16} strokeWidth={1.9} aria-hidden="true" /> : null;
  return <button type={type} disabled={disabled || loading} aria-busy={loading || undefined} onClick={onClick} className={cx('action-button', `action-${variant}`, size !== 'md' && `action-${size}`, loading && 'is-loading', className)} {...rest}>{iconPosition === 'start' && iconNode}<span className="action-label">{children}</span>{iconPosition === 'end' && iconNode}</button>;
}
function SectionLabel({ children, trailing }) { return <div className="section-label"><span>{children}</span>{trailing}</div>; }

const ACCENT_PRESETS = [
  { id: 'violet', label: 'Violet', color: '#6757d9', soft: '#f0edff' },
  { id: 'blue', label: 'Ocean blue', color: '#2469c7', soft: '#eaf3ff' },
  { id: 'teal', label: 'Teal', color: '#087f8c', soft: '#e4f7f7' },
  { id: 'green', label: 'Emerald', color: '#17845b', soft: '#e7f7ee' },
  { id: 'rose', label: 'Rose', color: '#c13e69', soft: '#fff0f4' },
  { id: 'amber', label: 'Amber', color: '#a85d09', soft: '#fff4e3' },
];

function ShortcutKeys({ keys = [] }) {
  const pieces = [];
  pieces.push(<kbd className="shortcut-mod-key" key="modifier">Ctrl</kbd>);
  keys.forEach((key, index) => {
    pieces.push(<span className="shortcut-plus" key={`plus-${index}`} aria-hidden="true">+</span>);
    pieces.push(<kbd key={`key-${index}`}>{key}</kbd>);
  });
  const readable = `Control + ${keys.join(' + ')}`;
  return <span className="shortcut-keys" aria-label={readable}>{pieces}</span>;
}

function PagePreview({ page, sources, onAddText, onAddBlock, zoom = 1 }) {
  const holderRef = useRef(null);
  const [renderError, setRenderError] = useState('');
  useEffect(() => {
    let alive = true;
    const holder = holderRef.current;
    if (!holder || !page) return undefined;
    holder.innerHTML = '';
    setRenderError('');
    renderPageCanvas(page, sources, Math.round(900 * zoom), true).then((canvas) => {
      if (!alive || !holderRef.current) return;
      canvas.className = 'preview-rendered-canvas';
      canvas.style.width = '100%';
      canvas.style.height = 'auto';
      canvas.style.display = 'block';
      holderRef.current.innerHTML = '';
      holderRef.current.appendChild(canvas);
    }).catch((error) => { if (alive) setRenderError(error?.message || 'Preview unavailable'); });
    return () => { alive = false; };
  }, [page?.id, page?.rotation, page?.kind, page?.sourcePageIndex, sources, zoom]);

  return <div className="preview-stage">
    <div className="preview-paper-wrap">
      <div ref={holderRef} className="preview-paper" />
      {!!page?.overlays?.length && <div className="preview-annotations" aria-hidden="true">
        {page.overlays.map((overlay, index) => overlay.type === 'rect'
          ? <div key={`${page.id}-overlay-${index}`} className="annotation-rect" style={{ left: `${overlay.x}%`, top: `${overlay.y}%`, width: `${overlay.width || 30}%`, height: `${overlay.height || 8}%`, background: overlay.color || '#232638' }} />
          : <div key={`${page.id}-overlay-${index}`} className="annotation-text" style={{ left: `${overlay.x}%`, top: `${overlay.y}%`, color: overlay.color || '#6e54ea', fontSize: `clamp(8px, ${Number(overlay.size || 18) / 5.4}px, 24px)` }}>{overlay.text}</div>)}
      </div>}
      {renderError && <div className="preview-error"><FileText size={26} /><span>{renderError}</span></div>}
      {page && <div className="paper-page-tag">PAGE {page.sourcePageIndex != null ? page.sourcePageIndex + 1 : '—'}</div>}
    </div>
    <div className="preview-quick-tools">
      <ActionButton size="sm" icon={Type} onClick={onAddText}>Add text</ActionButton>
      <ActionButton size="sm" icon={LockKeyhole} onClick={onAddBlock}>Cover area</ActionButton>
    </div>
  </div>;
}

function sentenceCase(text = '') { const lower = String(text).toLowerCase(); return lower.charAt(0).toUpperCase() + lower.slice(1); }

function Modal({ title, eyebrow, children, onClose, footer, wide = false }) {
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

/** Native-feeling window buttons for the frameless Windows window. */
function WindowControls({ maximized }) {
  const common = { width: 10, height: 10, viewBox: '0 0 10 10', fill: 'none', stroke: 'currentColor', strokeWidth: 1, 'aria-hidden': true };
  return <div className="window-controls">
    <button type="button" title="Minimize" aria-label="Minimize window" onClick={() => window.pdfStudio?.minimize?.()}><svg {...common}><path d="M0 5.5h10" /></svg></button>
    <button type="button" title={maximized ? 'Restore' : 'Maximize'} aria-label={maximized ? 'Restore window' : 'Maximize window'} onClick={() => window.pdfStudio?.toggleMaximize?.()}>{maximized ? <svg {...common}><path d="M2.5 2.5V.5h7v7h-2" /><rect x=".5" y="2.5" width="7" height="7" /></svg> : <svg {...common}><rect x=".5" y=".5" width="9" height="9" /></svg>}</button>
    <button type="button" title="Close" aria-label="Close window" className="window-close" onClick={() => window.pdfStudio?.close?.()}><svg {...common}><path d="M.5.5l9 9M9.5.5l-9 9" /></svg></button>
  </div>;
}

function formatAccessTime(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return '';
  try { return new Date(value * 1000).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }); } catch { return ''; }
}
function shortDeviceId(id = '') {
  return id.length > 14 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}

/**
 * Full-screen lock shown while the Monitor administrator has disabled this device. It is rendered outside the
 * (inert) application shell. Real enforcement happens in the main process; this is the explanation + recovery UI.
 */
function AccessLockScreen({ access, checking, notice, dark, onRecheck, onQuit }) {
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

function App() {
  const [pages, setPages] = useState([]);
  const pagesRef = useRef([]);
  const sourcesRef = useRef(new Map());
  const [sourceRevision, setSourceRevision] = useState(0);
  const [documents, setDocuments] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [mode, setMode] = useState('home');
  const [isLoading, setIsLoading] = useState(false);
  const [loadingLabel, setLoadingLabel] = useState('Preparing your workspace');
  const [search, setSearch] = useState('');
  const [preferences, setPreferences] = useState(readPreferences);
  const [settingsTab, setSettingsTab] = useState('appearance');
  const [dark, setDark] = useState(() => preferences.theme === 'dark');
  const [fullScreen, setFullScreen] = useState(false);
  const [updateState, setUpdateState] = useState({ status: 'idle', message: 'Automatic updates are enabled.' });
  const [readyUpdate, setReadyUpdate] = useState(null);
  const [applyingUpdate, setApplyingUpdate] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const [toast, setToast] = useState(null);
  const [modal, setModal] = useState(null);
  const [textValue, setTextValue] = useState('Confidential');
  const [textColor, setTextColor] = useState('#6e54ea');
  const [textSize, setTextSize] = useState('18');
  const [coverColor, setCoverColor] = useState('#242638');
  const [exportTitle, setExportTitle] = useState('');
  const [exportAuthor, setExportAuthor] = useState('PDF Studio');
  const [exportPageNumbers, setExportPageNumbers] = useState(false);
  const [exportWatermark, setExportWatermark] = useState('');
  const [splitMode, setSplitMode] = useState('each');
  const [splitEvery, setSplitEvery] = useState('2');
  const [splitRanges, setSplitRanges] = useState('1-3, 4-6');
  const [imageFormat, setImageFormat] = useState(() => preferences.defaultImageFormat);
  const [imageQuality, setImageQuality] = useState(() => String(preferences.defaultImageQuality));
  const [showInspector, setShowInspector] = useState(() => preferences.showInspector);
  const [draggingPageId, setDraggingPageId] = useState(null);
  const [dropCue, setDropCue] = useState(null);
  const [previewZoom, setPreviewZoom] = useState(1);
  const [appVersion, setAppVersion] = useState('3.0.2');
  const [access, setAccess] = useState({ locked: false, status: 'enabled' });
  const [accessChecking, setAccessChecking] = useState(false);
  const [accessNotice, setAccessNotice] = useState('');
  const accessLockedRef = useRef(false);
  const fileInputRef = useRef(null);
  const suppressPageClickUntil = useRef(0);
  const historyRef = useRef([]);
  const redoRef = useRef([]);

  useEffect(() => { pagesRef.current = pages; }, [pages]);
  const setPreference = useCallback((key, value) => {
    setPreferences((current) => ({ ...current, [key]: value }));
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    document.documentElement.classList.toggle('font-scale-large', preferences.fontScale === 'large');
    document.documentElement.classList.toggle('font-scale-xlarge', preferences.fontScale === 'xlarge');
    document.documentElement.classList.toggle('density-compact', preferences.density === 'compact');
    document.documentElement.classList.toggle('high-contrast', Boolean(preferences.highContrast));
    document.documentElement.classList.toggle('reduce-motion', Boolean(preferences.reduceMotion));
    document.documentElement.dataset.accent = preferences.accentTheme || 'violet';
    document.documentElement.dataset.platform = 'win32';
    try {
      const savedPreferences = {
        ...preferences,
        theme: dark ? 'dark' : 'light',
        showInspector,
        defaultImageFormat: imageFormat,
        defaultImageQuality: Number(imageQuality),
      };
      localStorage.setItem('pdfstudio-theme', savedPreferences.theme);
      localStorage.setItem('pdfstudio-settings', JSON.stringify(savedPreferences));
    } catch { /* Preferences remain usable for this session when storage is unavailable. */ }
  }, [dark, preferences, showInspector, imageFormat, imageQuality]);
  useEffect(() => {
    window.pdfStudio?.version?.().then((version) => setAppVersion(version)).catch(() => {});
    window.pdfStudio?.isMaximized?.().then(setMaximized).catch(() => {});
    const unsubscribe = window.pdfStudio?.onMaximizedChanged?.(setMaximized);
    const unsubscribeFullScreen = window.pdfStudio?.onFullScreenChanged?.(setFullScreen);
    const unsubscribeAbout = window.pdfStudio?.onShowAbout?.(() => setModal({ type: 'about' }));
    const unsubscribeUpdater = window.pdfStudio?.onUpdaterState?.((state) => {
      setUpdateState((current) => ({ ...current, ...state }));
    });
    const unsubscribeReady = window.pdfStudio?.onUpdateReady?.((update) => {
      setReadyUpdate(update);
      setUpdateState((current) => ({ ...current, status: 'ready', latestVersion: update.version, message: `Version ${update.version} is downloaded and ready to install.` }));
      void window.pdfStudio?.markUpdatePromptShown?.(update.version);
    });
    const unsubscribeDownload = window.pdfStudio?.onUpdateDownloadProgress?.((progress) => {
      setUpdateState((current) => ({ ...current, status: 'downloading', percent: progress.percent, downloadedBytes: progress.downloadedBytes, totalBytes: progress.totalBytes, message: progress.message || 'Downloading update in the background…' }));
    });
    window.pdfStudio?.getUpdaterState?.().then((snapshot) => {
      if (snapshot?.state) setUpdateState((current) => ({ ...snapshot.state, ...(['downloading', 'ready', 'applying'].includes(current.status) ? current : {}) }));
      if (snapshot?.pendingUpdate && snapshot.shouldPrompt) {
        setReadyUpdate(snapshot.pendingUpdate);
        void window.pdfStudio?.markUpdatePromptShown?.(snapshot.pendingUpdate.version);
      }
    }).catch(() => {});
    return () => { unsubscribe?.(); unsubscribeFullScreen?.(); unsubscribeAbout?.(); unsubscribeUpdater?.(); unsubscribeReady?.(); unsubscribeDownload?.(); };
  }, []);
  // Device access (Monitor enable / disable). The main process owns the decision and enforces it; we only mirror it.
  const applyAccessState = useCallback((state) => {
    if (!state || typeof state !== 'object') return;
    const wasLocked = accessLockedRef.current;
    accessLockedRef.current = Boolean(state.locked);
    setAccess(state);
    if (state.locked) setModal(null);
    if (wasLocked && !state.locked) { setAccessNotice(''); setToast({ message: 'Access restored. PDF Studio is unlocked again.', kind: 'success' }); }
  }, []);
  useEffect(() => {
    let active = true;
    window.pdfStudio?.getAccessState?.().then((state) => { if (active) applyAccessState(state); }).catch(() => {});
    const unsubscribe = window.pdfStudio?.onAccessState?.(applyAccessState);
    return () => { active = false; unsubscribe?.(); };
  }, [applyAccessState]);
  const recheckAccess = useCallback(async () => {
    setAccessChecking(true);
    setAccessNotice('');
    try {
      const state = await window.pdfStudio?.recheckAccess?.();
      if (state) {
        applyAccessState(state);
        if (state.locked && !state.offline) setAccessNotice('This device is still disabled. Ask your administrator to enable it in the monitor.');
      }
    } catch { setAccessNotice('The status could not be checked. Please try again in a moment.'); }
    finally { setAccessChecking(false); }
  }, [applyAccessState]);
  const quitFromLock = useCallback(() => { void window.pdfStudio?.close?.(); }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const id = window.setTimeout(() => setToast(null), 3600);
    return () => window.clearTimeout(id);
  }, [toast]);

  const notify = useCallback((message, kind = 'success') => setToast({ message, kind }), []);
  const commitPages = useCallback((producer) => {
    const current = pagesRef.current;
    const next = typeof producer === 'function' ? producer(current) : producer;
    if (next === current) return;
    historyRef.current.push(current);
    if (historyRef.current.length > 40) historyRef.current.shift();
    redoRef.current = [];
    pagesRef.current = next;
    setPages(next);
    if (next.length === 0) { setActiveId(null); setSelectedIds([]); }
    else {
      const oldActive = activeId;
      const newActive = next.some((page) => page.id === oldActive) ? oldActive : next[0].id;
      setActiveId(newActive);
      setSelectedIds((currentIds) => currentIds.filter((id) => next.some((page) => page.id === id)));
    }
  }, [activeId]);

  const undo = useCallback(() => {
    const previous = historyRef.current.pop();
    if (!previous) return notify('Nothing to undo.', 'info');
    redoRef.current.push(pagesRef.current);
    pagesRef.current = previous;
    setPages(previous);
    const active = previous.find((page) => page.id === activeId) || previous[0];
    setActiveId(active?.id || null);
    setSelectedIds(active ? [active.id] : []);
    notify('Last page change undone.', 'info');
  }, [activeId, notify]);
  const redo = useCallback(() => {
    const next = redoRef.current.pop();
    if (!next) return notify('Nothing to redo.', 'info');
    historyRef.current.push(pagesRef.current);
    pagesRef.current = next;
    setPages(next);
    const active = next.find((page) => page.id === activeId) || next[0];
    setActiveId(active?.id || null);
    setSelectedIds(active ? [active.id] : []);
    notify('Page change restored.', 'info');
  }, [activeId, notify]);

  const activePage = useMemo(() => pages.find((page) => page.id === activeId) || pages[0] || null, [pages, activeId]);
  const selectedPages = useMemo(() => pages.filter((page) => selectedIds.includes(page.id)), [pages, selectedIds]);
  const currentDocument = activePage ? documents.find((document) => document.id === activePage.sourceId) : null;
  const selectedPageNumbers = useMemo(() => selectedPages.map((page) => pages.findIndex((item) => item.id === page.id) + 1), [pages, selectedPages]);
  const filteredPages = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return pages;
    return pages.filter((page, index) => `page ${index + 1} ${page.sourceName || ''} ${page.kind}`.toLowerCase().includes(query));
  }, [pages, search]);

  const addImportedItems = useCallback(async (items) => {
    if (!items?.length) return;
    setIsLoading(true);
    setLoadingLabel('Reading your files');
    const newPages = [];
    const newDocuments = [];
    try {
      for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
        const item = items[itemIndex];
        let bytes = normalizeBytes(item.bytes ?? item.data);
        if (!bytes.length) continue;
        let kind = item.kind || (item.mime === 'application/pdf' || item.name?.toLowerCase().endsWith('.pdf') ? 'pdf' : 'image');
        if (!['pdf', 'image'].includes(kind)) continue;
        const sourceId = uid();
        const source = { id: sourceId, name: item.name || `Document ${itemIndex + 1}`, originName: item.originName, path: item.path || '', mime: item.mime || (kind === 'pdf' ? 'application/pdf' : 'image/png'), kind, bytes, size: bytes.byteLength };
        let pageCount = 1;
        if (kind === 'pdf') {
          setLoadingLabel(`Reading ${source.name}`);
          try {
            source.pdf = await loadPdfSource(bytes);
          } catch (error) {
            const needsPassword = error?.name === 'PasswordException' || /password/i.test(error?.message || '');
            if (!needsPassword) throw error;
            let opened = false;
            for (let attempt = 0; attempt < 3 && !opened; attempt += 1) {
              const password = window.prompt(`This PDF is password-protected. Enter the password for “${source.name}”${attempt ? ` (attempt ${attempt + 1} of 3)` : ''}:`);
              if (password == null) break;
              try { source.pdf = await loadPdfSource(bytes, password); opened = true; }
              catch (passwordError) { if (passwordError?.name !== 'PasswordException' && !/password/i.test(passwordError?.message || '')) throw passwordError; }
            }
            if (!opened) { notify(`Skipped ${source.name}: password was not accepted.`, 'error'); continue; }
          }
          pageCount = source.pdf.numPages;
        } else if (!source.mime.startsWith('image/')) {
          source.mime = 'image/png';
        }
        sourcesRef.current.set(sourceId, source);
        newDocuments.push({ id: sourceId, name: source.name, kind, mime: source.mime, size: source.size, pageCount, path: source.path, originName: source.originName, importedAt: new Date() });
        for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
          newPages.push({ id: uid(), sourceId, sourceName: source.name, sourcePageIndex: kind === 'pdf' ? pageIndex : null, kind, rotation: 0, thumbnail: null, overlays: [], width: 595.28, height: 841.89 });
        }
      }
      if (!newPages.length) return;
      setDocuments((previous) => [...previous, ...newDocuments]);
      const current = pagesRef.current;
      historyRef.current.push(current);
      if (historyRef.current.length > 40) historyRef.current.shift();
      redoRef.current = [];
      const joined = [...current, ...newPages];
      pagesRef.current = joined;
      setPages(joined);
      setActiveId(newPages[0].id);
      setSelectedIds([newPages[0].id]);
      setMode('workspace');
      setSourceRevision((n) => n + 1);
      notify(`${newPages.length} page${newPages.length === 1 ? '' : 's'} added to your workspace.`);
      setLoadingLabel('Generating page previews');
      for (const page of newPages) {
        const thumbnail = await createPageThumbnail(page, sourcesRef.current);
        if (thumbnail) setPages((currentPages) => {
          const updated = currentPages.map((item) => item.id === page.id ? { ...item, thumbnail } : item);
          pagesRef.current = updated;
          return updated;
        });
      }
    } catch (error) {
      console.error(error);
      notify(error?.message || 'Could not open one of these files.', 'error');
    } finally {
      setIsLoading(false);
      setLoadingLabel('Preparing your workspace');
    }
  }, [notify]);

  const chooseFiles = useCallback(async () => {
    if (accessLockedRef.current) return;
    try {
      if (window.pdfStudio?.openFiles) {
        const items = await window.pdfStudio.openFiles();
        await addImportedItems(items);
      } else {
        fileInputRef.current?.click();
      }
    } catch (error) { notify(error?.message || 'Unable to open the file picker.', 'error'); }
  }, [addImportedItems, notify]);

  const handleBrowserFiles = useCallback(async (fileList) => {
    if (accessLockedRef.current) return;
    const items = await Promise.all([...fileList].map(async (file) => {
      const ext = file.name.split('.').pop().toLowerCase();
      let kind = ext === 'pdf' ? 'pdf' : 'image';
      let mime = file.type || (kind === 'pdf' ? 'application/pdf' : 'image/png');
      return { name: file.name, mime, kind, bytes: new Uint8Array(await file.arrayBuffer()) };
    }));
    await addImportedItems(items);
  }, [addImportedItems]);

  const selectPage = useCallback((page, event) => {
    setActiveId(page.id);
    if (event?.shiftKey) {
      const anchorIndex = pages.findIndex((item) => item.id === (selectedIds[0] || activeId));
      const targetIndex = pages.findIndex((item) => item.id === page.id);
      const [start, end] = [anchorIndex, targetIndex].sort((a, b) => a - b);
      setSelectedIds(pages.slice(start, end + 1).map((item) => item.id));
    } else if (event?.ctrlKey || event?.metaKey) {
      setSelectedIds((previous) => previous.includes(page.id) ? previous.filter((id) => id !== page.id) : [...previous, page.id]);
    } else {
      setSelectedIds([page.id]);
    }
  }, [activeId, pages, selectedIds]);

  const deleteSelected = useCallback((explicitIds) => {
    const ids = new Set(explicitIds || (selectedIds.length ? selectedIds : activeId ? [activeId] : []));
    if (!ids.size) return;
    const next = pagesRef.current.filter((page) => !ids.has(page.id));
    if (next.length === pagesRef.current.length) return;
    commitPages(next);
    notify(`${ids.size} page${ids.size > 1 ? 's' : ''} removed.`, 'info');
  }, [activeId, commitPages, notify, selectedIds]);

  const requestDeleteSelected = useCallback((explicitIds) => {
    const ids = [...new Set(explicitIds || (selectedIds.length ? selectedIds : activeId ? [activeId] : []))];
    if (!ids.length) return;
    if (preferences.confirmDelete) {
      setModal({ type: 'confirm-delete', ids });
      return;
    }
    setModal(null);
    deleteSelected(ids);
  }, [activeId, deleteSelected, preferences.confirmDelete, selectedIds]);

  const rotateSelected = useCallback((angle, explicitIds) => {
    const ids = new Set(explicitIds || (selectedIds.length ? selectedIds : activeId ? [activeId] : []));
    if (!ids.size) return;
    const next = pagesRef.current.map((page) => ids.has(page.id) ? { ...page, rotation: ((page.rotation + angle) % 360 + 360) % 360, thumbnail: null } : page);
    commitPages(next);
    for (const page of next.filter((item) => ids.has(item.id))) {
      createPageThumbnail(page, sourcesRef.current).then((thumbnail) => {
        if (thumbnail) setPages((current) => { const updated = current.map((item) => item.id === page.id ? { ...item, thumbnail } : item); pagesRef.current = updated; return updated; });
      });
    }
    notify(`Rotated ${ids.size} page${ids.size > 1 ? 's' : ''}.`, 'info');
  }, [activeId, commitPages, notify, selectedIds]);

  const duplicateSelected = useCallback((explicitIds) => {
    const duplicateIds = explicitIds || selectedIds;
    const selected = pagesRef.current.filter((page) => duplicateIds.includes(page.id));
    if (!selected.length && activePage) selected.push(activePage);
    if (!selected.length) return;
    const duplicates = selected.map((page) => ({ ...page, id: uid(), overlays: (page.overlays || []).map((overlay) => ({ ...overlay })) }));
    const lastIndex = Math.max(...selected.map((page) => pagesRef.current.findIndex((item) => item.id === page.id)));
    const next = [...pagesRef.current];
    next.splice(lastIndex + 1, 0, ...duplicates);
    commitPages(next);
    setSelectedIds(duplicates.map((page) => page.id));
    setActiveId(duplicates[0].id);
    notify(`${duplicates.length} page${duplicates.length > 1 ? 's' : ''} duplicated.`);
  }, [activePage, commitPages, notify, selectedIds]);

  const addBlankPage = useCallback(() => {
    const page = { id: uid(), sourceId: null, sourceName: 'Blank page', sourcePageIndex: null, kind: 'blank', rotation: 0, thumbnail: null, overlays: [], width: 595.28, height: 841.89 };
    const index = activeId ? pagesRef.current.findIndex((item) => item.id === activeId) + 1 : pagesRef.current.length;
    const next = [...pagesRef.current];
    next.splice(Math.max(0, index), 0, page);
    commitPages(next);
    setActiveId(page.id);
    setSelectedIds([page.id]);
    createPageThumbnail(page, sourcesRef.current).then((thumbnail) => {
      if (thumbnail) setPages((current) => { const updated = current.map((item) => item.id === page.id ? { ...item, thumbnail } : item); pagesRef.current = updated; return updated; });
    });
    notify('Blank page inserted.');
  }, [activeId, commitPages, notify]);

  const movePage = useCallback((dragId, targetId, position = 'before') => {
    if (!dragId || !targetId || dragId === targetId) return;
    const current = pagesRef.current;
    const from = current.findIndex((page) => page.id === dragId);
    if (from < 0) return;
    const next = [...current];
    const [dragged] = next.splice(from, 1);
    const targetIndex = next.findIndex((page) => page.id === targetId);
    if (targetIndex < 0) return;
    const insertAt = targetIndex + (position === 'after' ? 1 : 0);
    next.splice(insertAt, 0, dragged);
    if (next.every((page, index) => page.id === current[index]?.id)) return;
    commitPages(next);
    setActiveId(dragged.id);
    setSelectedIds([dragged.id]);
    setDropCue(null);
    setDraggingPageId(null);
    notify(`Page moved to position ${next.findIndex((page) => page.id === dragged.id) + 1}.`, 'info');
  }, [commitPages, notify]);

  const addTextOverlay = useCallback(() => {
    if (!activePage) return notify('Choose a page before adding text.', 'info');
    commitPages((current) => current.map((page) => selectedIds.includes(page.id) ? { ...page, overlays: [...(page.overlays || []), { type: 'text', text: textValue.trim() || 'Text', x: 9, y: 15, size: Number(textSize) || 18, color: textColor }] } : page));
    setModal(null);
    notify(`Text added to ${selectedIds.length || 1} page${(selectedIds.length || 1) > 1 ? 's' : ''}.`);
  }, [activePage, commitPages, notify, selectedIds, textColor, textSize, textValue]);

  const addCoverOverlay = useCallback(() => {
    if (!activePage) return notify('Choose a page before covering an area.', 'info');
    commitPages((current) => current.map((page) => selectedIds.includes(page.id) ? { ...page, overlays: [...(page.overlays || []), { type: 'rect', x: 9, y: 16, width: 36, height: 7, color: coverColor }] } : page));
    setModal(null);
    notify('Cover block added. Note: a cover overlay is not a certified redaction.');
  }, [activePage, commitPages, coverColor, notify, selectedIds]);

  const doExportPdf = useCallback(async (onlySelected = false) => {
    const exportPages = onlySelected ? selectedPages : pages;
    if (!exportPages.length) return notify('There are no pages to export.', 'error');
    setIsLoading(true); setLoadingLabel('Building your PDF');
    try {
      const bytes = await composePdf(exportPages, sourcesRef.current, { title: exportTitle || 'PDF Studio document', author: exportAuthor || 'PDF Studio', pageNumbers: exportPageNumbers, watermark: exportWatermark });
      const name = `${(exportTitle || (documents.length === 1 ? documents[0].name.replace(/\.[^.]+$/, '') : 'PDF-Studio-document')).replace(/[\\/:*?"<>|]/g, '-').slice(0, 100)}.pdf`;
      let result;
      if (window.pdfStudio?.saveFile) result = await window.pdfStudio.saveFile({ name, data: bytes, filters: [{ name: 'PDF document', extensions: ['pdf'] }] });
      else result = await saveInBrowser(bytes, name, 'application/pdf');
      if (result?.canceled) return;
      setModal(null);
      notify(`PDF exported${result?.filePath ? ` to ${result.filePath}` : ''}.`);
    } catch (error) { console.error(error); notify(error?.message || 'PDF export failed.', 'error'); }
    finally { setIsLoading(false); setLoadingLabel('Preparing your workspace'); }
  }, [documents, exportAuthor, exportPageNumbers, exportTitle, exportWatermark, notify, pages, selectedPages]);

  const saveInBrowser = async (data, name, mime) => {
    const blob = new Blob([data], { type: mime || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = name; link.click();
    URL.revokeObjectURL(url);
    return { canceled: false };
  };

  const convertToWord = useCallback(async () => {
    if (!pages.length) return notify('Open a PDF before converting it to Word.', 'info');
    setIsLoading(true); setLoadingLabel('Extracting text and preparing DOCX');
    try {
      const pdfBytes = await composePdf(pages, sourcesRef.current, { title: 'Converted PDF', author: exportAuthor });
      const docxBytes = await pdfToDocx(pdfBytes);
      const baseName = (exportTitle || 'PDF-Studio-converted').replace(/[\\/:*?"<>|]/g, '-').slice(0, 100);
      const result = window.pdfStudio?.saveFile ? await window.pdfStudio.saveFile({ name: `${baseName}.docx`, data: docxBytes, filters: [{ name: 'Word document', extensions: ['docx'] }] }) : await saveInBrowser(docxBytes, `${baseName}.docx`, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      if (!result?.canceled) { setModal(null); notify('Editable Word document exported. Complex layouts and images may need manual adjustment.'); }
    } catch (error) { console.error(error); notify(error?.message || 'PDF-to-Word conversion failed.', 'error'); }
    finally { setIsLoading(false); setLoadingLabel('Preparing your workspace'); }
  }, [exportAuthor, exportTitle, notify, pages]);

  const convertToImages = useCallback(async () => {
    if (!pages.length) return notify('Open a document before exporting images.', 'info');
    const exportPages = selectedPages.length > 0 ? selectedPages : pages;
    setIsLoading(true); setLoadingLabel('Rendering pages as images');
    try {
      const pdfBytes = await composePdf(exportPages, sourcesRef.current, { title: 'PDF Studio image export', author: exportAuthor });
      const pdf = await loadPdfSource(pdfBytes);
      const sourceId = uid();
      const map = new Map([[sourceId, { id: sourceId, name: 'Export', mime: 'application/pdf', kind: 'pdf', bytes: pdfBytes, pdf }]]);
      const rasterPages = Array.from({ length: pdf.numPages }, (_, index) => ({ id: uid(), sourceId, kind: 'pdf', sourcePageIndex: index, rotation: 0, overlays: [] }));
      const outputs = await renderPdfImages(map, rasterPages, { format: imageFormat, quality: Number(imageQuality) / 100, maxDimension: 1900 });
      if (window.pdfStudio?.saveBatch) {
        const result = await window.pdfStudio.saveBatch(outputs);
        if (result?.canceled) return;
        setModal(null); notify(`${result.count} image${result.count === 1 ? '' : 's'} exported to ${result.folder}.`);
      } else {
        for (const output of outputs) await saveInBrowser(output.data, output.name, imageFormat === 'jpeg' ? 'image/jpeg' : 'image/png');
        setModal(null); notify(`${outputs.length} images exported.`);
      }
    } catch (error) { console.error(error); notify(error?.message || 'Image export failed.', 'error'); }
    finally { setIsLoading(false); setLoadingLabel('Preparing your workspace'); }
  }, [exportAuthor, imageFormat, imageQuality, notify, pages, selectedPages]);

  const splitPdf = useCallback(async () => {
    if (!pages.length) return notify('Open a PDF before splitting.', 'info');
    let groups = [];
    if (splitMode === 'each') groups = pages.map((page) => [page]);
    else if (splitMode === 'every') {
      const size = Math.max(1, Math.min(500, Number(splitEvery) || 2));
      for (let index = 0; index < pages.length; index += size) groups.push(pages.slice(index, index + size));
    } else {
      const ranges = splitRanges.split(',').map((part) => part.trim()).filter(Boolean);
      for (const range of ranges) {
        const match = range.match(/^(\d+)\s*(?:-\s*(\d+))?$/);
        if (!match) return notify(`Invalid page range: “${range}”. Use values such as 1-3, 5, 8-10.`, 'error');
        const start = Number(match[1]); const end = Number(match[2] || match[1]);
        if (start < 1 || end < start || end > pages.length) return notify(`Range “${range}” is outside the current 1–${pages.length} page workspace.`, 'error');
        groups.push(pages.slice(start - 1, end));
      }
    }
    setIsLoading(true); setLoadingLabel('Preparing split files');
    try {
      const outputs = [];
      for (let index = 0; index < groups.length; index += 1) {
        const bytes = await composePdf(groups[index], sourcesRef.current, { title: `PDF Studio split ${index + 1}`, author: exportAuthor });
        outputs.push({ name: `split-${String(index + 1).padStart(2, '0')}.pdf`, data: bytes });
      }
      if (window.pdfStudio?.saveBatch) {
        const result = await window.pdfStudio.saveBatch(outputs);
        if (result?.canceled) return;
        setModal(null); notify(`${result.count} PDF file${result.count === 1 ? '' : 's'} saved to ${result.folder}.`);
      } else {
        for (const output of outputs) await saveInBrowser(output.data, output.name, 'application/pdf');
        setModal(null); notify(`${outputs.length} split files exported.`);
      }
    } catch (error) { console.error(error); notify(error?.message || 'Could not split this workspace.', 'error'); }
    finally { setIsLoading(false); setLoadingLabel('Preparing your workspace'); }
  }, [exportAuthor, notify, pages, splitEvery, splitMode, splitRanges]);

  const removeDocument = useCallback((documentId) => {
    commitPages((current) => current.filter((page) => page.sourceId !== documentId));
    sourcesRef.current.delete(documentId);
    setDocuments((current) => current.filter((document) => document.id !== documentId));
    setSourceRevision((n) => n + 1);
    notify('Source removed from the workspace.', 'info');
  }, [commitPages, notify]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (accessLockedRef.current) return;
      const target = event.target;
      const editing = target && (target.matches('input, textarea, select') || target.isContentEditable);
      if (event.key === 'Escape') { if (modal) setModal(null); return; }
      if (modal) return;
      if (!editing && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'o') { event.preventDefault(); chooseFiles(); return; }
      if (!editing && (event.ctrlKey || event.metaKey) && ['1', '2', '3', '4'].includes(event.key)) {
        event.preventDefault();
        const destination = { '1': 'home', '2': 'workspace', '3': 'convert', '4': 'history' }[event.key];
        setMode(destination);
        return;
      }
      if (!editing && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); if (pagesRef.current.length) setModal({ type: 'export' }); return; }
      if (!editing && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) redo(); else undo(); return; }
      if (!editing && (event.key === 'Delete' || event.key === 'Backspace')) { if (selectedIds.length) { event.preventDefault(); requestDeleteSelected(); } }
      if (!editing && event.key === 'ArrowLeft' && activePage) { const i = pagesRef.current.findIndex((page) => page.id === activePage.id); if (i > 0) { setActiveId(pagesRef.current[i - 1].id); setSelectedIds([pagesRef.current[i - 1].id]); } }
      if (!editing && event.key === 'ArrowRight' && activePage) { const i = pagesRef.current.findIndex((page) => page.id === activePage.id); if (i < pagesRef.current.length - 1) { setActiveId(pagesRef.current[i + 1].id); setSelectedIds([pagesRef.current[i + 1].id]); } }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activePage, chooseFiles, requestDeleteSelected, modal, redo, selectedIds, undo]);

  const handleDropFiles = async (event) => {
    event.preventDefault();
    if (accessLockedRef.current) return;
    const files = [...(event.dataTransfer?.files || [])];
    if (files.length) await handleBrowserFiles(files);
  };

  const resetPreferences = () => {
    setPreferences({ ...DEFAULT_PREFERENCES });
    setDark(false);
    setShowInspector(true);
    setImageFormat('png');
    setImageQuality('92');
    setSettingsTab('appearance');
    notify('Settings restored to their defaults.', 'success');
  };

  const checkForUpdates = useCallback(async () => {
    setUpdateState({ status: 'checking', message: 'Checking for updates…' });
    try {
      const result = await window.pdfStudio?.checkForUpdates?.();
      if (!result) throw new Error('Update checks are available in the desktop application.');
      if (result.status && result.status !== 'checking') setUpdateState((current) => ({ ...current, ...result }));
    } catch {
      setUpdateState({ status: 'error', message: 'We couldn’t check for updates. PDF Studio will try again automatically later.' });
    }
  }, []);

  const deferReadyUpdate = useCallback(async () => {
    const version = readyUpdate?.version;
    if (version) await window.pdfStudio?.deferUpdate?.(version).catch(() => {});
    setReadyUpdate(null);
    setUpdateState((current) => ({ ...current, status: 'ready', latestVersion: version || current.latestVersion, message: 'The update is saved. PDF Studio will offer it again the next time you open the app.' }));
  }, [readyUpdate]);

  const applyReadyUpdate = useCallback(async () => {
    if (!readyUpdate || applyingUpdate) return;
    setApplyingUpdate(true);
    try {
      const result = await window.pdfStudio?.applyUpdateNow?.();
      if (!result?.started) throw new Error('PDF Studio could not start the update.');
      setUpdateState((current) => ({ ...current, status: 'applying', message: 'Applying the update and restarting PDF Studio…' }));
      setReadyUpdate(null);
    } catch (error) {
      setApplyingUpdate(false);
      notify(error?.message || 'The update could not be applied. You can choose Update later and retry.', 'error');
    }
  }, [readyUpdate, applyingUpdate, notify]);

  const startTool = (tool) => {
    if (tool.action === 'word') { if (!pages.length) chooseFiles(); else setModal({ type: 'word' }); }
    else if (tool.action === 'images') { if (!pages.length) chooseFiles(); else setModal({ type: 'images' }); }
    else { setMode(tool.mode || 'workspace'); if (!pages.length) chooseFiles(); }
  };

  return <MotionConfig reducedMotion={preferences.reduceMotion ? 'always' : 'user'} transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}>
  <motion.div data-accent={preferences.accentTheme || 'violet'} className={cx('app-shell', 'platform-win32', fullScreen && 'is-fullscreen', maximized && 'is-maximized', dark && 'theme-dark', preferences.fontScale === 'large' && 'font-scale-large', preferences.fontScale === 'xlarge' && 'font-scale-xlarge', preferences.density === 'compact' && 'density-compact', preferences.highContrast && 'high-contrast', preferences.reduceMotion && 'reduce-motion')} onDragOver={(event) => event.preventDefault()} onDrop={handleDropFiles} inert={access.locked ? true : undefined} aria-hidden={access.locked ? true : undefined} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: preferences.reduceMotion ? 0 : 0.24 }}>
    <input ref={fileInputRef} type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.webp,.bmp,.gif,.tif,.tiff,.docx" className="hidden-input" onChange={(event) => { if (event.target.files?.length) handleBrowserFiles(event.target.files); event.target.value = ''; }} />

    <motion.header className="titlebar" initial={{ opacity: 0, y: -7 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22, delay: 0.035 }}>
      <button type="button" className="titlebar-brand" onClick={() => setMode('home')} aria-label="Go to PDF Studio overview">
        <div className="brand-mark"><img src="./icons/pdf-studio.png" alt="" draggable="false" /></div>
        <div className="brand-wordmark"><strong>PDF<span>Studio</span></strong><small>Document workspace</small></div>
      </button>
      <div className="titlebar-center"><span className="titlebar-dot" /> Local workspace <span className="titlebar-separator">/</span> {mode === 'home' ? 'Overview' : mode === 'workspace' ? 'Page workspace' : mode === 'settings' ? 'Settings' : mode === 'convert' ? 'Conversion studio' : mode === 'history' ? 'Recent sources' : 'Workspace'}</div>
      <WindowControls maximized={maximized} />
    </motion.header>

    <motion.div className="app-body" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.22, delay: 0.07 }}>
      <motion.aside className="sidebar" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.25, delay: 0.06, ease: [0.22, 1, 0.36, 1] }}>
        <div className="sidebar-scroll">
          <SectionLabel>Workspace</SectionLabel>
          <LayoutGroup id="primary-navigation">
          <motion.button whileHover={{ x: 2 }} whileTap={{ scale: 0.995 }} transition={interactiveSpring} title={`Overview (Ctrl+1)`} aria-label="Overview" aria-current={mode === 'home' ? 'page' : undefined} className={cx('nav-item', mode === 'home' && 'nav-active')} onClick={() => setMode('home')}>{mode === 'home' && <motion.span layoutId="primary-nav-active" className="nav-active-indicator" transition={interactiveSpring} />}<LayoutDashboard size={17} /><span>Overview</span><span className="nav-key">Ctrl 1</span></motion.button>
          <motion.button whileHover={{ x: 2 }} whileTap={{ scale: 0.995 }} transition={interactiveSpring} title={`Page workspace (Ctrl+2)`} aria-label="Page workspace" aria-current={mode === 'workspace' ? 'page' : undefined} className={cx('nav-item', mode === 'workspace' && 'nav-active')} onClick={() => setMode('workspace')}>{mode === 'workspace' && <motion.span layoutId="primary-nav-active" className="nav-active-indicator" transition={interactiveSpring} />}<Files size={17} /><span>Page workspace</span>{pages.length > 0 && <span className="nav-count">{pages.length}</span>}</motion.button>
          <motion.button whileHover={{ x: 2 }} whileTap={{ scale: 0.995 }} transition={interactiveSpring} title={`Conversion studio (Ctrl+3)`} aria-label="Conversion studio" aria-current={mode === 'convert' ? 'page' : undefined} className={cx('nav-item', mode === 'convert' && 'nav-active')} onClick={() => setMode('convert')}>{mode === 'convert' && <motion.span layoutId="primary-nav-active" className="nav-active-indicator" transition={interactiveSpring} />}<WandSparkles size={17} /><span>Convert files</span><span className="nav-new">TOOLS</span></motion.button>
          <motion.button whileHover={{ x: 2 }} whileTap={{ scale: 0.995 }} transition={interactiveSpring} title={`Recent sources (Ctrl+4)`} aria-label="Recent sources" aria-current={mode === 'history' ? 'page' : undefined} className={cx('nav-item', mode === 'history' && 'nav-active')} onClick={() => setMode('history')}>{mode === 'history' && <motion.span layoutId="primary-nav-active" className="nav-active-indicator" transition={interactiveSpring} />}<History size={17} /><span>Recent sources</span></motion.button>
          <motion.button whileHover={{ x: 2 }} whileTap={{ scale: 0.995 }} transition={interactiveSpring} title="Application settings" aria-label="Settings" aria-current={mode === 'settings' ? 'page' : undefined} className={cx('nav-item', mode === 'settings' && 'nav-active')} onClick={() => setMode('settings')}>{mode === 'settings' && <motion.span layoutId="primary-nav-active" className="nav-active-indicator" transition={interactiveSpring} />}<Settings2 size={17} /><span>Settings</span></motion.button>
          </LayoutGroup>

          <div className="sidebar-divider" />
          <SectionLabel trailing={<IconButton icon={Plus} label="Add documents" size={15} onClick={chooseFiles} />} >Your documents</SectionLabel>
          {documents.length === 0 ? <button className="empty-docs-link" onClick={chooseFiles}><FolderOpen size={17} /><span>Add your first file</span><ChevronRight size={14} /></button> : <motion.div className="document-list" layout>
            <AnimatePresence initial={false}>{documents.map((document) => <motion.div layout className={cx('document-list-item', currentDocument?.id === document.id && 'document-current')} key={document.id} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -6 }} transition={{ duration: 0.16 }}>
              <div className={cx('file-type-mini', document.kind === 'pdf' ? 'file-pdf' : 'file-image')}>{document.kind === 'pdf' ? <FileText size={14} /> : <FileImage size={14} />}</div>
              <button className="document-label" title={document.name} onClick={() => {
                const page = pages.find((item) => item.sourceId === document.id);
                if (page) { setActiveId(page.id); setSelectedIds([page.id]); setMode('workspace'); }
              }}><span>{document.name}</span><small>{document.pageCount} {document.pageCount === 1 ? 'page' : 'pages'} · {formatBytes(document.size)}</small></button>
              <IconButton icon={X} label={`Remove ${document.name}`} size={13} className="document-remove" onClick={() => removeDocument(document.id)} />
            </motion.div>)}</AnimatePresence>
          </motion.div>}

          <div className="sidebar-divider" />
          <SectionLabel>Quick tools</SectionLabel>
          <button className="quick-nav" onClick={() => setModal({ type: 'split' })} disabled={!pages.length}><span className="quick-icon quick-violet"><Split size={15} /></span><span>Split PDF</span></button>
          <button className="quick-nav" onClick={() => setModal({ type: 'word' })} disabled={!pages.length}><span className="quick-icon quick-blue"><FileText size={15} /></span><span>PDF to Word</span></button>
          <button className="quick-nav" onClick={() => setModal({ type: 'images' })} disabled={!pages.length}><span className="quick-icon quick-orange"><FileImage size={15} /></span><span>Export images</span></button>
        </div>
        <div className="sidebar-footer">
          <div className="privacy-card"><div className="privacy-icon"><ShieldCheck size={17} /></div><div><strong>Your files stay yours</strong><p>Processed on this device. No uploads.</p></div><CheckCircle2 size={15} className="privacy-check" /></div>
          <button className="account-row" onClick={() => setMode('settings')}><div className="account-avatar">JA</div><div className="account-meta"><strong>PDF Studio</strong><small>Personal workspace · v{appVersion}</small></div><Settings2 size={16} className="account-settings" /></button>
        </div>
      </motion.aside>

      <motion.main className="main-panel" initial={{ opacity: 0, x: 5 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.24, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}>
        <div className="topbar">
          <div className="breadcrumbs"><span onClick={() => setMode('home')}>Studio</span><ChevronRight size={14} /><strong>{mode === 'home' ? 'Overview' : mode === 'workspace' ? 'Page workspace' : mode === 'convert' ? 'Conversion studio' : mode === 'history' ? 'Recent sources' : 'Settings'}</strong>{activePage && mode === 'workspace' && <><ChevronRight size={14} /><span className="crumb-muted">{activePage.sourceName}</span></>}</div>
          <div className="topbar-actions"><div className="local-badge" title="Files are processed on this device"><span /> On-device processing</div><IconButton icon={dark ? Sun : Moon} label={dark ? 'Switch to light theme' : 'Switch to dark theme'} onClick={() => setDark((value) => !value)} /><IconButton icon={CircleHelp} label="About PDF Studio" onClick={() => setModal({ type: 'about' })} /></div>
        </div>

        <AnimatePresence mode="wait" initial={false}>
        {mode === 'home' && <motion.section key="home" className="home-view" variants={pageVariants} initial="initial" animate="animate" exit="exit">
          <div className="welcome-row"><div className="welcome-copy"><div className="eyebrow welcome-eyebrow">Workspace overview</div><h1>Manage your PDF documents.</h1><p>Open files to combine, reorder, and convert pages in one workspace. Your documents are processed locally on this device.</p><div className="welcome-actions"><ActionButton icon={Plus} variant="primary" onClick={chooseFiles}>Open documents<kbd className="shortcut-hint">Ctrl+O</kbd></ActionButton><ActionButton icon={FolderOpen} onClick={() => setMode('workspace')}>Go to workspace</ActionButton></div><div className="welcome-details"><span><LockKeyhole size={15} /> Local processing</span><span><FileText size={15} /> PDFs and images</span></div></div></div>

          <motion.div className="home-stats" variants={staggerVariants} initial="hidden" animate="show"><motion.div className="stat-card" variants={staggerItemVariants} whileHover={{ y: -2 }} transition={interactiveSpring}><span className="stat-icon stat-purple"><Files size={17} /></span><div><small>Pages in workspace</small><strong>{pages.length}</strong></div><span className="stat-foot">Current session</span></motion.div><motion.div className="stat-card" variants={staggerItemVariants} whileHover={{ y: -2 }} transition={interactiveSpring}><span className="stat-icon stat-mint"><HardDrive size={17} /></span><div><small>Sources opened</small><strong>{documents.length}</strong></div><span className="stat-foot">Local files</span></motion.div><motion.div className="stat-card" variants={staggerItemVariants} whileHover={{ y: -2 }} transition={interactiveSpring}><span className="stat-icon stat-orange"><ShieldCheck size={17} /></span><div><small>File processing</small><strong className="status-ready">On this device</strong></div><span className="stat-foot"><span className="online-dot" /> No cloud upload</span></motion.div></motion.div>

          <div className="section-heading"><div><h2>Common tasks</h2><p>Choose a tool to get started.</p></div><span className="section-heading-note">{initialTools.length} available tools</span></div>
          <motion.div className="tool-card-grid" variants={staggerVariants} initial="hidden" animate="show">{initialTools.map((tool) => <motion.button key={tool.label} variants={staggerItemVariants} whileHover={{ y: -3, scale: 1.006 }} whileTap={{ scale: 0.99 }} transition={interactiveSpring} className="tool-card" onClick={() => startTool(tool)}><div className={cx('tool-card-icon', `tone-${tool.tone}`)}><tool.icon size={21} strokeWidth={1.8} /></div><div className="tool-card-copy"><strong>{tool.label}</strong><span>{tool.description}</span></div><span className="tool-card-arrow"><ArrowUpRight size={17} /></span></motion.button>)}</motion.div>
          <motion.div className="bottom-callout" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12, duration: 0.22 }}><div className="callout-glyph"><LockKeyhole size={19} /></div><div><strong>Private by design.</strong><span>Your documents are processed locally on your computer. PDF Studio does not upload them to a cloud service.</span></div><ActionButton size="sm" icon={ArrowRight} iconPosition="end" onClick={() => setModal({ type: 'about' })}>Learn more</ActionButton></motion.div>
        </motion.section>}

        {mode === 'workspace' && <motion.section key="workspace" className="workspace-view" variants={pageVariants} initial="initial" animate="animate" exit="exit">
          <div className="workspace-heading"><div><div className="eyebrow"><span className="eyebrow-dot" /> Page management</div><h1>Page workspace</h1><p>Arrange your pages exactly how you want them. Drag to reorder, select multiple pages, then export a clean PDF.</p></div><div className="workspace-heading-actions"><ActionButton icon={FolderOpen} onClick={chooseFiles}>Add files</ActionButton><ActionButton icon={Download} variant="primary" disabled={!pages.length} onClick={() => setModal({ type: 'export' })}>Export PDF</ActionButton></div></div>
          {pages.length === 0 ? <motion.div className="workspace-empty" initial={{ opacity: 0, scale: 0.985 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.22 }}><div className="empty-illustration"><div className="empty-sheet sheet-back"/><div className="empty-sheet sheet-middle"/><div className="empty-sheet sheet-front"><FilePlus2 size={32} /></div><span className="empty-plus"><Plus size={14} /></span></div><h2>Make room for your pages</h2><p>Bring PDFs and images into one workspace, reorder them, then export everything as a single PDF.</p><ActionButton icon={Upload} variant="primary" onClick={chooseFiles}>Choose files</ActionButton><span className="empty-or">or drop files anywhere in this window</span></motion.div> : <>
            <div className="workspace-toolbar"><div className="toolbar-group"><IconButton icon={Undo2} label="Undo (Ctrl+Z)" onClick={undo} disabled={!historyRef.current.length} /><IconButton icon={Redo2} label="Redo (Ctrl+Shift+Z)" onClick={redo} disabled={!redoRef.current.length} /><span className="toolbar-rule"/><IconButton icon={RotateCcw} label="Rotate left" onClick={() => rotateSelected(-90)} disabled={!selectedIds.length && !activePage} /><IconButton icon={RotateCw} label="Rotate right" onClick={() => rotateSelected(90)} disabled={!selectedIds.length && !activePage} /><IconButton icon={Copy} label="Duplicate selected pages" onClick={duplicateSelected} disabled={!pages.length} /><IconButton icon={Trash2} label="Delete selected pages" onClick={requestDeleteSelected} disabled={!selectedIds.length} /></div><div className="toolbar-group"><span className="selection-indicator">{selectedIds.length || 0} selected</span><span className="toolbar-rule"/><IconButton icon={Type} label="Add text overlay" onClick={() => setModal({ type: 'text' })} disabled={!pages.length} /><IconButton icon={LockKeyhole} label="Add cover block" onClick={() => setModal({ type: 'cover' })} disabled={!pages.length} /><IconButton icon={Plus} label="Insert blank page" onClick={addBlankPage} /><span className="toolbar-rule"/><IconButton icon={PanelRightClose} label="Hide preview panel" active={showInspector} onClick={() => setShowInspector((value) => !value)} /></div></div>
            <div className={cx('workspace-content', !showInspector && 'inspector-hidden')}>
              <div className="page-grid-panel"><div className="page-grid-toolbar"><div className="page-grid-title"><strong>Pages <span>{pages.length}</span></strong><small>{search.trim() ? 'Clear search to reorder pages' : 'Drag tiles to reorder · use arrows for precise moves'}</small></div><div className="page-grid-options"><div className="search-field"><Search size={14} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a page..." aria-label="Find a page" />{search && <button onClick={() => setSearch('')}><X size={12}/></button>}</div><IconButton icon={ListFilter} label="Reverse page order" onClick={() => commitPages([...pagesRef.current].reverse())} /></div></div>
                <div className="page-grid-scroll"><div className="page-grid"><AnimatePresence initial={false}>{filteredPages.map((page) => {
                  const pageIndex = pages.findIndex((item) => item.id === page.id);
                  const selected = selectedIds.includes(page.id);
                  const cuePosition = dropCue?.id === page.id ? dropCue.position : null;
                  const pageNumber = String(pageIndex + 1).padStart(2, '0');
                  return <motion.div key={page.id} layout="position" initial={{ opacity: 0, y: 8, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }} whileHover={{ y: -2 }} transition={interactiveSpring}
                    className={cx('page-card', selected && 'page-selected', activeId === page.id && 'page-active', draggingPageId === page.id && 'page-dragging', cuePosition === 'before' && 'drop-before', cuePosition === 'after' && 'drop-after')}
                    draggable={!search.trim()}
                    aria-label={`Page ${pageIndex + 1}. Drag to reorder. Click to select.`}
                    title={search.trim() ? 'Clear the page search to reorder pages' : 'Drag this page to reorder it'}
                    onDragStart={(event) => {
                      if (search.trim()) { event.preventDefault(); return; }
                      setDraggingPageId(page.id);
                      suppressPageClickUntil.current = Date.now() + 350;
                      setDropCue(null);
                      event.dataTransfer.effectAllowed = 'move';
                      event.dataTransfer.setData('application/x-pdfstudio-page', page.id);
                      event.dataTransfer.setData('text/plain', page.id);
                      try { event.dataTransfer.setDragImage(event.currentTarget, 32, 28); } catch { /* Drag-image support varies by platform. */ }
                    }}
                    onDragOver={(event) => {
                      const draggedId = event.dataTransfer?.getData('application/x-pdfstudio-page') || draggingPageId;
                      if (!draggedId || draggedId === page.id || search.trim()) return;
                      event.preventDefault();
                      event.dataTransfer.dropEffect = 'move';
                      const rect = event.currentTarget.getBoundingClientRect();
                      const position = event.clientX < rect.left + rect.width / 2 ? 'before' : 'after';
                      setDropCue((currentCue) => currentCue?.id === page.id && currentCue?.position === position ? currentCue : { id: page.id, position });
                    }}
                    onDrop={(event) => {
                      const draggedId = event.dataTransfer?.getData('application/x-pdfstudio-page') || draggingPageId;
                      if (!draggedId || draggedId === page.id) return;
                      event.preventDefault();
                      event.stopPropagation();
                      const rect = event.currentTarget.getBoundingClientRect();
                      const position = dropCue?.id === page.id ? dropCue.position : (event.clientX < rect.left + rect.width / 2 ? 'before' : 'after');
                      movePage(draggedId, page.id, position);
                    }}
                    onDragEnd={() => { suppressPageClickUntil.current = Date.now() + 350; setDraggingPageId(null); setDropCue(null); }}
                    onClick={(event) => { if (Date.now() < suppressPageClickUntil.current) { event.preventDefault(); return; } selectPage(page, event); }}>
                    <div className="page-card-top"><span className={cx('page-number-badge', selected && 'badge-selected')}>{pageNumber}</span><span className="page-drag-grip" aria-hidden="true"><GripVertical size={14} /></span><div className="page-card-hover-actions"><IconButton icon={ArrowLeft} label={`Move page ${pageIndex + 1} earlier`} size={12} disabled={pageIndex === 0 || !!search.trim()} onClick={(event) => { event.stopPropagation(); movePage(page.id, pages[pageIndex - 1]?.id, 'before'); }} /><IconButton icon={ArrowRight} label={`Move page ${pageIndex + 1} later`} size={12} disabled={pageIndex === pages.length - 1 || !!search.trim()} onClick={(event) => { event.stopPropagation(); movePage(page.id, pages[pageIndex + 1]?.id, 'after'); }} /><IconButton icon={RotateCw} label={`Rotate page ${pageIndex + 1}`} size={12} onClick={(event) => { event.stopPropagation(); rotateSelected(90, [page.id]); }} /><IconButton icon={MoreHorizontal} label={`More actions for page ${pageIndex + 1}`} size={12} onClick={(event) => { event.stopPropagation(); setActiveId(page.id); setSelectedIds([page.id]); setModal({ type: 'page-menu', pageId: page.id }); }} /></div></div>
                    <div className="page-thumb-zone">{page.thumbnail ? <img src={page.thumbnail} alt={`Page ${pageIndex + 1}`} draggable="false" /> : <div className="page-thumb-placeholder"><FileText size={27} /><span>Rendering…</span></div>}{!!page.overlays?.length && <span className="page-overlay-badge"><Type size={11} /> {page.overlays.length}</span>}</div>
                    <div className="page-card-footer"><div><strong>Page {pageNumber}</strong><small>{page.kind === 'image' ? extName(page.sourceName) + ' image' : page.kind === 'blank' ? 'Blank page' : `PDF page ${page.sourcePageIndex + 1}`}</small></div><span className={cx('page-check', selected && 'page-check-on')}>{selected && <Check size={12} />}</span></div>
                  </motion.div>;
                })}</AnimatePresence>
                <button type="button" className={cx('page-add-card', dropCue?.id === '__end__' && 'page-add-hover')} onClick={chooseFiles} onDragOver={(event) => {
                  const draggedId = event.dataTransfer?.getData('application/x-pdfstudio-page') || draggingPageId;
                  if (draggedId) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDropCue((cue) => cue?.id === '__end__' ? cue : { id: '__end__', position: 'after' }); }
                  else if (Array.from(event.dataTransfer?.types || []).includes('Files')) { event.preventDefault(); event.currentTarget.classList.add('page-add-hover'); }
                }} onDragLeave={(event) => { event.currentTarget.classList.remove('page-add-hover'); setDropCue((cue) => cue?.id === '__end__' ? null : cue); }} onDrop={(event) => {
                  const draggedId = event.dataTransfer?.getData('application/x-pdfstudio-page') || draggingPageId;
                  event.currentTarget.classList.remove('page-add-hover');
                  if (draggedId && pagesRef.current.length) { event.preventDefault(); event.stopPropagation(); const lastPage = pagesRef.current[pagesRef.current.length - 1]; movePage(draggedId, lastPage.id, 'after'); }
                  else if (event.dataTransfer?.files?.length) { event.preventDefault(); event.stopPropagation(); handleBrowserFiles([...event.dataTransfer.files]); }
                  setDropCue(null);
                }} aria-label="Add PDF or image pages">
                  <span className="page-add-icon"><Plus size={24} strokeWidth={1.8} /></span><strong>Add pages</strong><span>PDF or image</span><kbd>Browse files</kbd>
                </button>
                </div>{filteredPages.length === 0 && <div className="no-search-results"><Search size={22}/><strong>No pages match “{search}”</strong><ActionButton size="sm" onClick={() => setSearch('')}>Clear search</ActionButton></div>}</div>
                <div className="page-grid-bottom"><span><GripVertical size={13} /> {pages.length} pages total</span><span>Shift-click range <b>·</b> Ctrl-click multiple <b>·</b> Drop at + to move to end</span></div>
              </div>
              {showInspector && <motion.aside className="inspector-panel" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 12 }} transition={{ duration: 0.2 }}><div className="inspector-head"><div><div className="eyebrow">Live preview</div><h3>Page details</h3></div><IconButton icon={PanelRightOpen} label="Hide preview" onClick={() => setShowInspector(false)} /></div>
                {activePage ? <><div className="inspector-page-meta"><div className="inspector-doc-icon"><FileText size={17} /></div><div className="inspector-doc-copy"><strong>Page {pages.findIndex((page) => page.id === activePage.id) + 1}</strong><span title={activePage.sourceName}>{activePage.sourceName}</span></div><span className="inspector-page-count">{pages.findIndex((page) => page.id === activePage.id) + 1} / {pages.length}</span></div>
                <div className="inspector-preview-wrap"><PagePreview page={activePage} sources={sourcesRef.current} zoom={previewZoom} onAddText={() => setModal({ type: 'text' })} onAddBlock={() => setModal({ type: 'cover' })} /></div>
                <div className="preview-zoom-row"><span><ZoomIn size={14} /> Preview scale</span><div><button onClick={() => setPreviewZoom((value) => Math.max(0.6, +(value - 0.1).toFixed(1)))} disabled={previewZoom <= 0.6}><ZoomOut size={13}/></button><span>{Math.round(previewZoom * 100)}%</span><button onClick={() => setPreviewZoom((value) => Math.min(1.4, +(value + 0.1).toFixed(1)))} disabled={previewZoom >= 1.4}><ZoomIn size={13}/></button></div></div>
                <div className="inspector-properties"><SectionLabel>Page properties</SectionLabel><div className="property-row"><span>Position in document</span><strong>{String(pages.findIndex((page) => page.id === activePage.id) + 1).padStart(2, '0')} <span className="property-total">/ {pages.length}</span></strong></div><div className="property-row"><span>Source type</span><strong>{activePage.kind === 'pdf' ? 'PDF document' : activePage.kind === 'image' ? 'Image file' : 'Blank page'}</strong></div><div className="property-row"><span>Orientation</span><strong>{activePage.rotation % 180 === 0 ? 'Portrait' : 'Landscape'}</strong></div><div className="property-row"><span>Overlay objects</span><strong>{activePage.overlays?.length || 0}</strong></div></div>
                <div className="inspector-actions"><ActionButton icon={RotateCcw} onClick={() => { setSelectedIds([activePage.id]); rotateSelected(-90); }}>Rotate left</ActionButton><ActionButton icon={Scissors} onClick={() => { setSelectedIds([activePage.id]); setModal({ type: 'export-selected' }); }}>Export page</ActionButton></div></> : <div className="inspector-empty"><FileText size={30}/><p>Select a page to preview it here.</p></div>}
              </motion.aside>}
            </div>
          </>}
        </motion.section>}

        {mode === 'convert' && <motion.section key="convert" className="conversion-view" variants={pageVariants} initial="initial" animate="animate" exit="exit"><div className="workspace-heading"><div><div className="eyebrow"><Sparkles size={13} /> Conversion studio</div><h1>Make your files work harder.</h1><p>Convert your current workspace or open a file to get started. Conversion runs locally on your device.</p></div><ActionButton icon={FolderOpen} onClick={chooseFiles}>Add files</ActionButton></div><motion.div className="conversion-grid" variants={staggerVariants} initial="hidden" animate="show">
          <motion.button variants={staggerItemVariants} whileHover={{ y: -3 }} whileTap={{ scale: 0.99 }} transition={interactiveSpring} className="conversion-card" onClick={() => pages.length ? setModal({ type: 'word' }) : chooseFiles()}><div className="conversion-card-art art-word"><FileText size={38}/><span>W</span></div><div className="conversion-card-body"><span className="conversion-tag">Editable text</span><h3>PDF to Word</h3><p>Extract selectable text into a DOCX document with page breaks. Complex layouts may need a little cleanup.</p><div className="conversion-card-action">Convert to .docx <ArrowRight size={15}/></div></div></motion.button>
          <motion.button variants={staggerItemVariants} whileHover={{ y: -3 }} whileTap={{ scale: 0.99 }} transition={interactiveSpring} className="conversion-card" onClick={() => pages.length ? setModal({ type: 'images' }) : chooseFiles()}><div className="conversion-card-art art-image"><FileImage size={38}/><span>PNG</span></div><div className="conversion-card-body"><span className="conversion-tag">High-quality output</span><h3>PDF to images</h3><p>Render each current page to PNG or JPG. Great for sharing a page or preparing a visual preview.</p><div className="conversion-card-action">Export images <ArrowRight size={15}/></div></div></motion.button>
          <motion.button variants={staggerItemVariants} whileHover={{ y: -3 }} whileTap={{ scale: 0.99 }} transition={interactiveSpring} className="conversion-card" onClick={chooseFiles}><div className="conversion-card-art art-doc"><ImagePlus size={38}/><span>JPG</span></div><div className="conversion-card-body"><span className="conversion-tag">Image workflow</span><h3>Images to PDF</h3><p>Open PNG, JPG, WEBP, BMP or GIF files. Image pages join the same sortable workspace.</p><div className="conversion-card-action">Choose images <ArrowRight size={15}/></div></div></motion.button>
          <motion.button variants={staggerItemVariants} whileHover={{ y: -3 }} whileTap={{ scale: 0.99 }} transition={interactiveSpring} className="conversion-card" onClick={() => pages.length ? setModal({ type: 'split' }) : chooseFiles()}><div className="conversion-card-art art-split"><Split size={38}/><span>01 / 02</span></div><div className="conversion-card-body"><span className="conversion-tag">Page control</span><h3>Split PDF</h3><p>Split the current workspace into individual pages, fixed page groups, or custom page ranges.</p><div className="conversion-card-action">Configure split <ArrowRight size={15}/></div></div></motion.button>
        </motion.div><div className="conversion-footnote"><ShieldCheck size={17}/><span><strong>Local-first processing.</strong> Files are opened and transformed on this computer. No cloud upload or account is required.</span></div></motion.section>}

        {mode === 'history' && <motion.section key="history" className="history-view" variants={pageVariants} initial="initial" animate="animate" exit="exit"><div className="workspace-heading"><div><div className="eyebrow">Your local session</div><h1>Recent sources</h1><p>Files currently loaded into this workspace.</p></div><ActionButton icon={FolderOpen} onClick={chooseFiles}>Add files</ActionButton></div>{documents.length ? <div className="history-table"><div className="history-table-head"><span>DOCUMENT</span><span>TYPE</span><span>SIZE</span><span>PAGES</span><span /></div>{documents.map((document, index) => <motion.div className="history-table-row" key={document.id} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18, delay: Math.min(index * 0.035, 0.2) }}><div className="history-file"><div className={cx('file-type-mini', document.kind === 'pdf' ? 'file-pdf' : 'file-image')}>{document.kind === 'pdf' ? <FileText size={15}/> : <FileImage size={15}/>}</div><div><strong>{document.name}</strong><small>{document.path || 'Added to current session'}</small></div></div><span>{extName(document.name)}</span><span>{formatBytes(document.size)}</span><span>{document.pageCount}</span><ActionButton icon={ArrowRight} onClick={() => { const p = pages.find((page) => page.sourceId === document.id); if (p) { setActiveId(p.id); setSelectedIds([p.id]); setMode('workspace'); } }}>Open</ActionButton></motion.div>)}</div> : <motion.div className="history-empty" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}><Clock3 size={30}/><h3>No sources yet</h3><p>Files that you open in PDF Studio will appear here for this session.</p><ActionButton icon={FolderOpen} variant="primary" onClick={chooseFiles}>Open files</ActionButton></motion.div>}</motion.section>}

        {mode === 'settings' && <motion.section key="settings" className="settings-view" variants={pageVariants} initial="initial" animate="animate" exit="exit">
          <div className="settings-page-heading">
            <div><div className="eyebrow"><Settings2 size={14} /> Application preferences</div><h1>Settings</h1><p>Configure the way PDF Studio looks and behaves. Your preferences are saved on this computer.</p></div>
            <ActionButton icon={RotateCcw} onClick={resetPreferences}>Reset to defaults</ActionButton>
          </div>
          <div className="settings-layout">
            <nav className="settings-nav" aria-label="Settings categories">
              <motion.button whileHover={{ x: 2 }} whileTap={{ scale: 0.99 }} transition={interactiveSpring} className={cx('settings-nav-item', settingsTab === 'appearance' && 'settings-nav-active')} onClick={() => setSettingsTab('appearance')}><Sun size={18}/><span><strong>Appearance</strong><small>Theme and readability</small></span>{settingsTab === 'appearance' && <ChevronRight size={16}/>}</motion.button>
              <motion.button whileHover={{ x: 2 }} whileTap={{ scale: 0.99 }} transition={interactiveSpring} className={cx('settings-nav-item', settingsTab === 'workspace' && 'settings-nav-active')} onClick={() => setSettingsTab('workspace')}><SlidersHorizontal size={18}/><span><strong>Workspace</strong><small>Page tools and safeguards</small></span>{settingsTab === 'workspace' && <ChevronRight size={16}/>}</motion.button>
              <motion.button whileHover={{ x: 2 }} whileTap={{ scale: 0.99 }} transition={interactiveSpring} className={cx('settings-nav-item', settingsTab === 'export' && 'settings-nav-active')} onClick={() => setSettingsTab('export')}><FileOutput size={18}/><span><strong>Files & export</strong><small>Default image output</small></span>{settingsTab === 'export' && <ChevronRight size={16}/>}</motion.button>
              <motion.button whileHover={{ x: 2 }} whileTap={{ scale: 0.99 }} transition={interactiveSpring} className={cx('settings-nav-item', settingsTab === 'privacy' && 'settings-nav-active')} onClick={() => setSettingsTab('privacy')}><ShieldCheck size={18}/><span><strong>Privacy & about</strong><small>Local processing and shortcuts</small></span>{settingsTab === 'privacy' && <ChevronRight size={16}/>}</motion.button>
              <motion.button whileHover={{ x: 2 }} whileTap={{ scale: 0.99 }} transition={interactiveSpring} className={cx('settings-nav-item', settingsTab === 'updates' && 'settings-nav-active')} onClick={() => setSettingsTab('updates')}><MonitorDown size={18}/><span><strong>Updates & downloads</strong><small>Automatic checks and verified updates</small></span>{settingsTab === 'updates' && <ChevronRight size={16}/>}</motion.button>
            </nav>

            <div className="settings-content">
              <AnimatePresence mode="wait" initial={false}>
              <motion.div key={settingsTab} className="settings-content-motion" variants={pageVariants} initial="initial" animate="animate" exit="exit">
              {settingsTab === 'appearance' && <>
                <div className="settings-panel">
                  <div className="settings-panel-title"><span className="settings-symbol"><Sun size={18}/></span><div><h2>Appearance</h2><p>Use a theme and interface scale that are comfortable to read.</p></div></div>
                  <div className="settings-field"><div className="settings-field-heading"><strong>Color mode</strong><small>Choose the surface style for your workspace.</small></div><div className="theme-choice-row settings-theme-options"><button className={cx('theme-choice', !dark && 'theme-choice-active')} onClick={() => setDark(false)}><span className="theme-preview theme-preview-light"><i/><i/><i/></span><span><strong>Light</strong><small>Bright, high-clarity surfaces</small></span>{!dark && <CheckCircle2 size={18}/>}</button><button className={cx('theme-choice', dark && 'theme-choice-active')} onClick={() => setDark(true)}><span className="theme-preview theme-preview-dark"><i/><i/><i/></span><span><strong>Dark</strong><small>Comfortable in low light</small></span>{dark && <CheckCircle2 size={18}/>}</button></div></div>
                  <div className="settings-divider"/>
                  <div className="settings-field"><div className="settings-field-heading"><strong>Accent color</strong><small>Personalize selected navigation, primary buttons, focus rings, and active controls.</small></div><div className="accent-preset-grid" role="group" aria-label="Accent color presets">{ACCENT_PRESETS.map((preset) => <button type="button" key={preset.id} className={cx('accent-preset', preferences.accentTheme === preset.id && 'accent-preset-active')} onClick={() => setPreference('accentTheme', preset.id)} aria-pressed={preferences.accentTheme === preset.id}><span className="accent-preset-swatch" style={{ '--swatch-color': preset.color, '--swatch-soft': preset.soft }}><span>{preferences.accentTheme === preset.id ? <Check size={15}/> : null}</span></span><strong>{preset.label}</strong>{preferences.accentTheme === preset.id && <CheckCircle2 size={15} className="accent-preset-check"/>}</button>)}</div></div>
                  <div className="settings-divider"/>
                  <div className="settings-field"><div className="settings-field-heading"><strong>Interface text size</strong><small>Scale menus, settings, labels, and controls across the app.</small></div><div className="settings-segment text-scale-options"><button className={cx(preferences.fontScale === 'standard' && 'segment-selected')} onClick={() => setPreference('fontScale', 'standard')}><span className="segment-demo-small">Aa</span><span>Standard</span><small>100%</small></button><button className={cx(preferences.fontScale === 'large' && 'segment-selected')} onClick={() => setPreference('fontScale', 'large')}><span className="segment-demo-large">Aa</span><span>Large</span><small>115%</small></button><button className={cx(preferences.fontScale === 'xlarge' && 'segment-selected')} onClick={() => setPreference('fontScale', 'xlarge')}><span className="segment-demo-xlarge">Aa</span><span>Extra large</span><small>130%</small></button></div></div>
                  <div className="settings-divider"/>
                  <div className="settings-field"><div className="settings-field-heading"><strong>Workspace density</strong><small>Choose more breathing room or fit more page cards on screen.</small></div><div className="settings-segment"><button className={cx(preferences.density === 'comfortable' && 'segment-selected')} onClick={() => setPreference('density', 'comfortable')}><span>Comfortable</span><small>More spacing</small></button><button className={cx(preferences.density === 'compact' && 'segment-selected')} onClick={() => setPreference('density', 'compact')}><span>Compact</span><small>More content</small></button></div></div>
                  <div className="settings-divider"/>
                  <SettingToggle title="Increase contrast" description="Strengthen boundaries, text contrast, and focus indicators for easier scanning." checked={preferences.highContrast} onChange={(value) => setPreference('highContrast', value)}/>
                  <div className="settings-divider"/>
                  <SettingToggle title="Reduce motion" description="Reduce transitions and movement effects for a calmer interface." checked={preferences.reduceMotion} onChange={(value) => setPreference('reduceMotion', value)}/>
                </div>
              </>}

              {settingsTab === 'workspace' && <div className="settings-panel">
                <div className="settings-panel-title"><span className="settings-symbol settings-symbol-blue"><SlidersHorizontal size={18}/></span><div><h2>Workspace behavior</h2><p>Control page tools and protect against accidental changes.</p></div></div>
                <SettingToggle title="Show page preview panel" description="Keep the selected-page preview and page properties visible on the right side of the workspace." checked={showInspector} onChange={setShowInspector}/>
                <div className="settings-divider"/>
                <SettingToggle title="Confirm before deleting pages" description="Ask you to review the number of pages before removing them. Recommended for most users." checked={preferences.confirmDelete} onChange={(value) => setPreference('confirmDelete', value)}/>
                <div className="settings-divider"/>
                <div className="settings-shortcut-list"><div className="settings-field-heading"><strong>Keyboard shortcuts</strong><small>Shortcuts use Control (Ctrl) on this computer and work when focus is not in a text field.</small></div><div className="shortcut-row"><span>Open documents</span><ShortcutKeys keys={['O']}/></div><div className="shortcut-row"><span>Export current workspace</span><ShortcutKeys keys={['S']}/></div><div className="shortcut-row"><span>Undo</span><ShortcutKeys keys={['Z']}/></div><div className="shortcut-row"><span>Redo</span><ShortcutKeys keys={['Shift', 'Z']}/></div><div className="shortcut-row"><span>Delete selected pages</span><span className="shortcut-keys"><kbd>Delete</kbd><span className="shortcut-or">or</span><kbd>Backspace</kbd></span></div><div className="shortcut-row"><span>Navigate sections</span><ShortcutKeys keys={['1–4']}/></div></div>
              </div>}

              {settingsTab === 'export' && <div className="settings-panel">
                <div className="settings-panel-title"><span className="settings-symbol settings-symbol-blue"><FileOutput size={18}/></span><div><h2>Files & export</h2><p>Set defaults for page-image exports. PDF export continues to ask where to save each file.</p></div></div>
                <div className="settings-field"><div className="settings-field-heading"><strong>Default image format</strong><small>Used whenever you open the “Export pages as images” tool.</small></div><div className="settings-segment"><button className={cx(imageFormat === 'png' && 'segment-selected')} onClick={() => setImageFormat('png')}><span>PNG</span><small>Lossless · ideal for text</small></button><button className={cx(imageFormat === 'jpeg' && 'segment-selected')} onClick={() => setImageFormat('jpeg')}><span>JPEG</span><small>Smaller · ideal for photos</small></button></div></div>
                {imageFormat === 'jpeg' && <><div className="settings-divider"/><div className="settings-field"><div className="settings-field-heading"><strong>JPEG image quality</strong><small>Higher quality preserves detail but creates larger files.</small></div><div className="settings-range"><input aria-label="Default JPEG quality" type="range" min="40" max="100" value={imageQuality} onChange={(event) => setImageQuality(event.target.value)}/><strong>{imageQuality}%</strong></div><div className="range-ends"><span>Smaller files</span><span>Better quality</span></div></div></>}
                <div className="settings-note"><HardDrive size={18}/><div><strong>Save location</strong><p>PDF Studio opens a save dialog or folder chooser for exports. It does not silently overwrite your files.</p></div></div>
              </div>}

              {settingsTab === 'privacy' && <>
                <div className="settings-panel">
                  <div className="settings-panel-title"><span className="settings-symbol settings-symbol-green"><ShieldCheck size={18}/></span><div><h2>Privacy & file handling</h2><p>Your documents are processed locally by this desktop build.</p></div></div>
                  <div className="privacy-detail-row"><span className="privacy-detail-icon"><CheckCircle2 size={18}/></span><div><strong>Local-first processing</strong><p>Imported document bytes stay in the current application session; this build has no document upload or account sign-in workflow.</p></div></div>
                  <div className="privacy-detail-row"><span className="privacy-detail-icon"><HardDrive size={18}/></span><div><strong>Preferences stored on this computer</strong><p>Theme, readability, workspace behavior and export defaults are saved in the app's local settings storage.</p></div></div>
                  <div className="privacy-detail-row"><span className="privacy-detail-icon"><Activity size={18}/></span><div><strong>App session reporting</strong><p>For usage and update management, PDF Studio sends its version, a random installation and session ID, operating system, computer hostname, local network IP address, session start time and elapsed time. Document contents, file names and PDF data are not sent.</p></div></div>
                  <div className="settings-note"><CircleHelp size={18}/><div><strong>About PDF Studio</strong><p>Version {appVersion} · Electron, React and Tailwind CSS. PDF-to-Word extracts selectable text; scanned pages may require OCR, which is not included in this build.</p><button className="inline-link-button" onClick={() => setModal({ type: 'about' })}>View application details <ArrowUpRight size={14}/></button></div></div>
                </div>
              </>}

              {settingsTab === 'updates' && <div className="settings-panel updater-panel">
                <div className="settings-panel-title"><span className="settings-symbol settings-symbol-blue"><MonitorDown size={18}/></span><div><h2>Updates & downloads</h2><p>PDF Studio checks when it opens and quietly prepares verified updates while you keep working.</p></div></div>
                <div className="update-current-version"><div className="update-version-icon"><PackageCheck size={20}/></div><div><span>Installed version</span><strong>PDF Studio {appVersion}</strong><small>Windows · portable EXE</small></div><span className="update-local-label"><span/> Local app</span></div>
                <div className="settings-divider"/>
                <div className="update-actions"><ActionButton icon={updateState.status === 'checking' ? LoaderCircle : Search} variant="primary" disabled={updateState.status === 'checking' || updateState.status === 'downloading' || updateState.status === 'applying'} onClick={checkForUpdates}>{updateState.status === 'checking' ? 'Checking for updates…' : 'Check for updates'}</ActionButton>{updateState.status === 'downloading' && <span className="update-background-note"><LoaderCircle size={14}/> Downloading securely in the background. You can keep working.</span>}</div>
                <motion.div layout className={cx('update-status-card', `update-status-${updateState.status}`)} role="status" aria-live="polite" initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }}><span className="update-status-icon">{updateState.status === 'checking' || updateState.status === 'downloading' || updateState.status === 'applying' ? <LoaderCircle className="update-status-spinner" size={18}/> : updateState.status === 'error' ? <CircleAlert size={18}/> : updateState.status === 'ready' || updateState.status === 'up-to-date' ? <CheckCircle size={18}/> : <MonitorDown size={18}/>}</span><div className="update-status-copy"><strong>{updateState.status === 'checking' ? 'Checking for updates' : updateState.status === 'downloading' ? `Downloading version ${updateState.latestVersion || ''}`.trim() : updateState.status === 'ready' ? `Version ${updateState.latestVersion || readyUpdate?.version || ''} is ready` : updateState.status === 'applying' ? 'Applying update' : updateState.status === 'up-to-date' ? 'You’re up to date' : updateState.status === 'error' ? 'Could not check for updates' : 'Automatic updates enabled'}</strong><p>{updateState.message || 'PDF Studio checks for verified updates when the application opens.'}</p></div></motion.div>
                <AnimatePresence initial={false}>{updateState.status === 'downloading' && <motion.div className="update-progress-wrap" key="update-progress" initial={{ opacity: 0, height: 0, y: -4 }} animate={{ opacity: 1, height: 'auto', y: 0 }} exit={{ opacity: 0, height: 0, y: -4 }} transition={{ duration: 0.2 }}><div className="update-progress-meta"><span>{updateState.percent == null ? 'Downloading…' : `${Math.round(updateState.percent)}%`}</span><span>{updateState.downloadedBytes != null ? `${formatBytes(updateState.downloadedBytes)}${updateState.totalBytes ? ` of ${formatBytes(updateState.totalBytes)}` : ''}` : 'Preparing update package'}</span></div><div className="update-progress-track"><motion.div className={cx('update-progress-value', updateState.percent == null && 'update-progress-indeterminate')} animate={{ width: updateState.percent == null ? '34%' : `${Math.min(100, Math.max(0, updateState.percent))}%` }} transition={{ duration: 0.18, ease: 'easeOut' }}/></div></motion.div>}</AnimatePresence>
                <div className="settings-note update-safety-note"><ShieldCheck size={18}/><div><strong>Verified before installing</strong><p>Update files are checked for integrity before they are staged. When an update is ready, PDF Studio asks whether to restart and apply it now or wait until later.</p></div></div>
              </div>}
              </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </motion.section>}
        </AnimatePresence>
      </motion.main>
    </motion.div>

    <AnimatePresence>{isLoading && <motion.div className="loading-overlay" key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><motion.div className="loading-card" initial={{ opacity: 0, y: 8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 4, scale: 0.99 }} transition={{ type: 'spring', stiffness: 420, damping: 32 }}><div className="loading-spinner"><span/><span/><span/></div><strong>{loadingLabel}</strong><span>Keeping everything on this device</span></motion.div></motion.div>}
    {toast && <motion.div key={`${toast.kind}:${toast.message}`} className={cx('toast-message', `toast-${toast.kind}`)} initial={{ opacity: 0, y: 14, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.985 }} transition={{ type: 'spring', stiffness: 440, damping: 30 }}><span className="toast-icon">{toast.kind === 'error' ? <X size={15}/> : toast.kind === 'info' ? <Activity size={15}/> : <Check size={15}/>}</span><span>{toast.message}</span><button onClick={() => setToast(null)}><X size={13}/></button></motion.div>}</AnimatePresence>

    <AnimatePresence mode="sync" initial={false}>
    {modal?.type === 'confirm-delete' && <Modal key={modal.type} title={`Delete ${modal.ids.length} page${modal.ids.length === 1 ? '' : 's'}?`} eyebrow="CONFIRM PAGE REMOVAL" onClose={() => setModal(null)} footer={<><ActionButton onClick={() => setModal(null)}>Keep pages</ActionButton><ActionButton variant="danger" icon={Trash2} onClick={() => { deleteSelected(modal.ids); setModal(null); }}>Delete {modal.ids.length} page{modal.ids.length === 1 ? '' : 's'}</ActionButton></>}><div className="delete-confirm-content"><span className="delete-confirm-icon"><Trash2 size={22}/></span><div><strong>This removes the selected pages from the current workspace.</strong><p>Your original source files on disk are not deleted. This change can be undone with Undo.</p></div></div></Modal>}

    {modal?.type === 'export' && <Modal key={modal.type} title="Export PDF" eyebrow="FINALIZE YOUR DOCUMENT" onClose={() => setModal(null)} footer={<><ActionButton onClick={() => setModal(null)}>Cancel</ActionButton><ActionButton variant="primary" icon={Download} onClick={() => doExportPdf(false)}>Export {pages.length} pages</ActionButton></>}>
      <div className="modal-intro"><div className="modal-hero-icon modal-hero-purple"><FileCheck2 size={22}/></div><div><strong>Ready for its next destination.</strong><p>Your page order, rotations and current overlays will be included in the exported PDF.</p></div></div>
      <label className="form-label">Document title<input className="form-input" value={exportTitle} onChange={(event) => setExportTitle(event.target.value)} placeholder="My final document" /></label>
      <label className="form-label">Author<input className="form-input" value={exportAuthor} onChange={(event) => setExportAuthor(event.target.value)} placeholder="PDF Studio" /></label>
      <div className="form-options"><label className="check-option"><input type="checkbox" checked={exportPageNumbers} onChange={(event) => setExportPageNumbers(event.target.checked)}/><span><strong>Add page numbers</strong><small>Place a small number at the bottom of each page.</small></span></label><label className="form-label">Text watermark <input className="form-input" value={exportWatermark} onChange={(event) => setExportWatermark(event.target.value)} placeholder="Optional · e.g. DRAFT" /></label></div>
      <div className="modal-note"><ShieldCheck size={15}/><span>PDF export runs locally. Password encryption and guaranteed file-size reduction are not included in this rebuild yet.</span></div>
    </Modal>}

    {modal?.type === 'export-selected' && <Modal key={modal.type} title="Export selected page" eyebrow="QUICK EXPORT" onClose={() => setModal(null)} footer={<><ActionButton onClick={() => setModal(null)}>Cancel</ActionButton><ActionButton variant="primary" icon={Download} onClick={() => doExportPdf(true)}>Save selected PDF</ActionButton></>}><div className="modal-intro"><div className="modal-hero-icon modal-hero-blue"><FileText size={22}/></div><div><strong>{selectedPages.length || 1} page{(selectedPages.length || 1) === 1 ? '' : 's'} selected</strong><p>Export the selected page(s) as a separate PDF, retaining their current order.</p></div></div></Modal>}

    {modal?.type === 'word' && <Modal key={modal.type} title="Convert PDF to Word" eyebrow="EDITABLE DOCUMENT" onClose={() => setModal(null)} footer={<><ActionButton onClick={() => setModal(null)}>Cancel</ActionButton><ActionButton variant="primary" icon={FileText} onClick={convertToWord}>Create DOCX</ActionButton></>}><div className="modal-intro"><div className="modal-hero-icon modal-hero-blue"><FileText size={22}/></div><div><strong>Create an editable Word document</strong><p>PDF Studio extracts selectable text and arranges it into editable paragraphs with page breaks.</p></div></div><div className="conversion-summary"><div><span>Pages to convert</span><strong>{pages.length}</strong></div><div><span>Output format</span><strong>.DOCX</strong></div><div><span>Processing</span><strong>On this device</strong></div></div><div className="modal-note"><Activity size={15}/><span>Text extraction is best for digital PDFs. Scanned pages without an OCR text layer and complex tables/images may not convert accurately.</span></div></Modal>}

    {modal?.type === 'images' && <Modal key={modal.type} title="Export pages as images" eyebrow="IMAGE EXPORT" onClose={() => setModal(null)} footer={<><ActionButton onClick={() => setModal(null)}>Cancel</ActionButton><ActionButton variant="primary" icon={Download} onClick={convertToImages}>Export {selectedPages.length ? selectedPages.length : pages.length} pages</ActionButton></>}><div className="modal-intro"><div className="modal-hero-icon modal-hero-orange"><FileImage size={22}/></div><div><strong>Make each page a shareable image</strong><p>{selectedPages.length ? 'Only your selected pages will be exported.' : 'No page selection found, so all pages in the workspace will be exported.'}</p></div></div><label className="form-label">Image format<div className="segmented-choice"><button className={cx(imageFormat === 'png' && 'segment-active')} onClick={() => setImageFormat('png')}><span>PNG</span><small>Sharper text</small></button><button className={cx(imageFormat === 'jpeg' && 'segment-active')} onClick={() => setImageFormat('jpeg')}><span>JPEG</span><small>Smaller photos</small></button></div></label>{imageFormat === 'jpeg' && <label className="form-label">JPEG quality <div className="range-row"><input type="range" min="40" max="100" value={imageQuality} onChange={(event) => setImageQuality(event.target.value)}/><strong>{imageQuality}%</strong></div></label>}<div className="modal-note"><HardDrive size={15}/><span>Choose an output folder in the next step. Each page will be rendered at high resolution.</span></div></Modal>}

    {modal?.type === 'split' && <Modal key={modal.type} title="Split workspace" eyebrow="CREATE SEPARATE PDFS" onClose={() => setModal(null)} footer={<><ActionButton onClick={() => setModal(null)}>Cancel</ActionButton><ActionButton variant="primary" icon={Split} onClick={splitPdf}>Split into files</ActionButton></>}><div className="modal-intro"><div className="modal-hero-icon modal-hero-purple"><Split size={22}/></div><div><strong>Choose how to split your {pages.length}-page workspace</strong><p>Each output will be saved as a separate PDF in the folder you choose.</p></div></div><div className="split-options"><label className={cx('split-option', splitMode === 'each' && 'split-option-active')}><input type="radio" checked={splitMode === 'each'} onChange={() => setSplitMode('each')}/><span><strong>Every page</strong><small>{pages.length} separate PDF files</small></span><Files size={17}/></label><label className={cx('split-option', splitMode === 'every' && 'split-option-active')}><input type="radio" checked={splitMode === 'every'} onChange={() => setSplitMode('every')}/><span><strong>Group pages</strong><small>Create a new PDF after every N pages</small></span><input className="compact-number" type="number" min="1" max="500" value={splitEvery} onChange={(event) => { setSplitEvery(event.target.value); setSplitMode('every'); }}/></label><label className={cx('split-option', splitMode === 'ranges' && 'split-option-active')}><input type="radio" checked={splitMode === 'ranges'} onChange={() => setSplitMode('ranges')}/><span><strong>Custom ranges</strong><small>For example: 1-3, 4, 6-8</small></span><ChevronRight size={16}/></label>{splitMode === 'ranges' && <label className="form-label range-input-label">Page ranges<input className="form-input" value={splitRanges} onChange={(event) => setSplitRanges(event.target.value)} placeholder="1-3, 4, 6-8" /></label>}</div></Modal>}

    {modal?.type === 'text' && <Modal key={modal.type} title="Add text overlay" eyebrow="ANNOTATE PAGE" onClose={() => setModal(null)} footer={<><ActionButton onClick={() => setModal(null)}>Cancel</ActionButton><ActionButton variant="primary" icon={Type} onClick={addTextOverlay}>Apply text</ActionButton></>}><div className="modal-intro"><div className="modal-hero-icon modal-hero-purple"><Type size={22}/></div><div><strong>Add a text overlay to the selected page</strong><p>Text is embedded in the PDF when exported. It is an overlay and does not modify existing PDF text objects.</p></div></div><label className="form-label">Text to add<input className="form-input" value={textValue} onChange={(event) => setTextValue(event.target.value)} placeholder="Type something..." autoFocus /></label><div className="form-two-col"><label className="form-label">Text size<select className="form-input" value={textSize} onChange={(event) => setTextSize(event.target.value)}><option value="12">12 pt — small</option><option value="18">18 pt — medium</option><option value="24">24 pt — large</option><option value="36">36 pt — heading</option></select></label><label className="form-label">Text color<div className="color-picker-row"><input type="color" value={textColor} onChange={(event) => setTextColor(event.target.value)}/><span>{textColor.toUpperCase()}</span></div></label></div><div className="modal-note"><AlignLeft size={15}/><span>New text appears near the upper-left area of the page. Select multiple pages to apply it to all of them.</span></div></Modal>}

    {modal?.type === 'cover' && <Modal key={modal.type} title="Add a cover block" eyebrow="ANNOTATE PAGE" onClose={() => setModal(null)} footer={<><ActionButton onClick={() => setModal(null)}>Cancel</ActionButton><ActionButton variant="primary" icon={LockKeyhole} onClick={addCoverOverlay}>Add cover block</ActionButton></>}><div className="modal-intro"><div className="modal-hero-icon modal-hero-dark"><LockKeyhole size={22}/></div><div><strong>Cover a visible area</strong><p>This places a solid shape over part of the page. It is not a certified redaction and may not remove underlying text from the PDF structure.</p></div></div><label className="form-label">Cover color<div className="color-picker-row"><input type="color" value={coverColor} onChange={(event) => setCoverColor(event.target.value)}/><span>{coverColor.toUpperCase()}</span></div></label><div className="modal-note modal-note-warning"><ShieldCheck size={15}/><span>For sensitive information, use a dedicated redaction workflow that permanently removes content and verify the exported file before sharing.</span></div></Modal>}

    {modal?.type === 'page-menu' && <Modal key={modal.type} title="Page actions" eyebrow="PAGE OPTIONS" onClose={() => setModal(null)} footer={<ActionButton onClick={() => setModal(null)}>Done</ActionButton>}><div className="page-menu-list"><button onClick={() => { rotateSelected(-90, [modal.pageId]); setActiveId(modal.pageId); setSelectedIds([modal.pageId]); setModal(null); }}><RotateCcw size={17}/><span><strong>Rotate left</strong><small>Turn the page 90° counter-clockwise.</small></span></button><button onClick={() => { rotateSelected(90, [modal.pageId]); setActiveId(modal.pageId); setSelectedIds([modal.pageId]); setModal(null); }}><RotateCw size={17}/><span><strong>Rotate right</strong><small>Turn the page 90° clockwise.</small></span></button><button onClick={() => { duplicateSelected([modal.pageId]); setModal(null); }}><Copy size={17}/><span><strong>Duplicate page</strong><small>Insert a copy after this page.</small></span></button><button className="page-menu-danger" onClick={() => requestDeleteSelected([modal.pageId])}><Trash2 size={17}/><span><strong>Delete page</strong><small>Remove this page from the workspace.</small></span></button></div></Modal>}

    {modal?.type === 'about' && <Modal key={modal.type} title="About PDF Studio" wide onClose={() => setModal(null)} footer={<><ActionButton icon={MonitorDown} className="footer-lead" onClick={() => { setModal(null); setMode('settings'); setSettingsTab('updates'); }}>Updates &amp; downloads</ActionButton><ActionButton variant="primary" onClick={() => setModal(null)}>Done</ActionButton></>}>
      <div className="about-hero"><div className="about-brand-icon"><img src="./icons/pdf-studio.png" alt="" draggable="false" /></div><div className="about-hero-copy"><div className="about-product-line"><h3>PDF Studio</h3><span className="about-version-pill">Version {appVersion}</span></div><p>Everyday PDF tools, in one desktop workspace.</p><div className="about-platform-line"><Laptop size={14} aria-hidden="true"/><span>Windows desktop</span><span className="about-meta-dot" aria-hidden="true"/><span>Local-first processing</span></div></div></div>
      <p className="about-copy">Open, combine, reorder, rotate, and export PDF pages alongside common image formats. PDF Studio keeps your document work on your computer, with simple tools and clear controls instead of a cloud-based workflow.</p>
      <div className="about-feature-grid"><div className="about-feature"><span className="about-feature-icon about-feature-purple"><Layers3 size={18}/></span><div><strong>Organize pages</strong><p>Combine files, reorder pages, rotate, duplicate, and export selections.</p></div></div><div className="about-feature"><span className="about-feature-icon about-feature-blue"><FileOutput size={18}/></span><div><strong>Convert &amp; export</strong><p>Export PDF pages as images or create an editable DOCX from selectable text.</p></div></div><div className="about-feature"><span className="about-feature-icon about-feature-green"><ShieldCheck size={18}/></span><div><strong>Work locally</strong><p>Your opened documents stay in the current local session; nothing is uploaded.</p></div></div></div>
      <div className="developer-signature-card"><div className="developer-monogram" aria-hidden="true">JAR</div><div className="developer-copy"><span className="developer-eyebrow">Created by</span><strong className="developer-name"><span>Jessie</span> Albert <em>Regualos</em></strong><p>Developer · PDF Studio</p></div><div className="developer-signature-mark" aria-hidden="true">JAR<span> / </span>PDF STUDIO</div></div>
      <div className="about-footnote"><BookOpen size={15} aria-hidden="true"/><span>PDF Studio {appVersion} · Electron desktop app · Preferences are saved on this computer.</span></div>
    </Modal>}
    </AnimatePresence>

    <AnimatePresence>
      {readyUpdate && <Modal key={`update-ready-${readyUpdate.version}`} title={`PDF Studio ${readyUpdate.version} is ready`} eyebrow="UPDATE READY TO INSTALL" onClose={deferReadyUpdate} footer={<><ActionButton onClick={deferReadyUpdate} disabled={applyingUpdate}>Update later</ActionButton><ActionButton variant="primary" icon={applyingUpdate ? LoaderCircle : Download} onClick={applyReadyUpdate} disabled={applyingUpdate}>{applyingUpdate ? 'Preparing restart…' : 'Update now'}</ActionButton></>}>
        <div className="update-ready-content"><div className="update-ready-icon"><PackageCheck size={25}/></div><div className="update-ready-copy"><strong>A verified update has been downloaded.</strong><p>PDF Studio {readyUpdate.version} is ready. Choose Update now to apply it and restart the application, or Update later to keep working. PDF Studio will offer this update again the next time you open the app.</p></div></div>
        {readyUpdate.notes && <div className="update-ready-notes"><strong>What’s new</strong><p>{readyUpdate.notes}</p></div>}
        <div className="modal-note"><ShieldCheck size={16}/><span>Save any open work before updating. Your local documents and workspace files are not sent with the update.</span></div>
      </Modal>}
    </AnimatePresence>
  </motion.div>
  <AnimatePresence>{access.locked && <AccessLockScreen key="access-lock" access={access} checking={accessChecking} notice={accessNotice} dark={dark} onRecheck={recheckAccess} onQuit={quitFromLock} />}</AnimatePresence>
  </MotionConfig>;
}

export default App;
