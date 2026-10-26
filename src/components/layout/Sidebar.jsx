import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
import {
  CheckCircle2,
  ChevronRight,
  FileImage,
  FilePenLine,
  FileText,
  Files,
  FolderOpen,
  History,
  LayoutDashboard,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Settings2,
  ShieldCheck,
  Split,
  WandSparkles,
  X,
} from 'lucide-react';
import IconButton from '../common/IconButton.jsx';
import SectionLabel from '../common/SectionLabel.jsx';
import { interactiveSpring } from '../../constants/motion.js';
import { cx } from '../../utils/cx.js';
import { formatBytes } from '../../utils/format.js';

// Route ids match the app's `mode` values. `label` is what the collapsed-rail tooltip shows.
const NAV = [
  { id: 'home', label: 'Overview', aria: 'Overview', title: 'Overview (Ctrl+1)', shortcut: 'Ctrl+1', keyHint: 'Ctrl 1', icon: LayoutDashboard },
  { id: 'workspace', label: 'Page workspace', aria: 'Page workspace', title: 'Page workspace (Ctrl+2)', shortcut: 'Ctrl+2', icon: Files },
  { id: 'edit', label: 'Edit PDF', aria: 'Edit PDF', title: 'Edit PDF content', icon: FilePenLine, badge: 'NEW' },
  { id: 'convert', label: 'Convert files', aria: 'Conversion studio', title: 'Conversion studio (Ctrl+3)', shortcut: 'Ctrl+3', icon: WandSparkles, badge: 'TOOLS' },
  { id: 'history', label: 'Recent sources', aria: 'Recent sources', title: 'Recent sources (Ctrl+4)', shortcut: 'Ctrl+4', icon: History },
  { id: 'settings', label: 'Settings', aria: 'Settings', title: 'Application settings', icon: Settings2 },
];

const COLLAPSE_KEY = 'pdfstudio-sidebar-collapsed';
const readCollapsed = () => { try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { return false; } };

/** Tooltip anchored to the hovered rail item. Rendered in a portal so the sidebar's overflow never clips it. */
function RailTooltip({ tip }) {
  if (!tip) return null;
  return createPortal(
    <div className="rail-tooltip" role="tooltip" style={{ left: tip.x, top: tip.y }}>
      <span>{tip.text}</span>{tip.keys && <kbd>{tip.keys}</kbd>}
    </div>,
    document.body,
  );
}

export default function Sidebar({ pages, documents, mode, appVersion, currentDocument, setSelectedIds, setActiveId, setMode, setModal, chooseFiles, removeDocument }) {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [railTip, setRailTip] = useState(null);

  const toggle = useCallback(() => {
    setRailTip(null);
    setCollapsed((value) => {
      const next = !value;
      try { localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0'); } catch { /* preference just will not persist */ }
      return next;
    });
  }, []);

  // Ctrl/Cmd+B toggles the rail, except while typing in a field.
  useEffect(() => {
    const onKey = (event) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== 'b') return;
      const el = event.target;
      if (el?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el?.tagName || '')) return;
      event.preventDefault();
      toggle();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle]);

  // Tooltip data lives on the elements (data-tip), so one set of delegated handlers serves the whole rail.
  const tip = (text, keys) => (collapsed && text ? { 'data-tip': text, ...(keys ? { 'data-tip-keys': keys } : {}) } : {});
  const showTip = (event) => {
    if (!collapsed) return;
    const target = event.target.closest?.('[data-tip]');
    if (!target) { setRailTip(null); return; }
    const rect = target.getBoundingClientRect();
    setRailTip({ text: target.dataset.tip, keys: target.dataset.tipKeys, x: rect.right + 10, y: rect.top + rect.height / 2 });
  };
  const hideTip = () => setRailTip(null);
  const openDocument = (document) => {
    const page = pages.find((item) => item.sourceId === document.id);
    if (page) { setActiveId(page.id); setSelectedIds([page.id]); setMode('workspace'); }
  };

  return (
    <>
    <motion.aside className={cx('sidebar', collapsed && 'is-collapsed')} onMouseOver={showTip} onMouseLeave={hideTip} onFocus={showTip} onBlur={hideTip} onScroll={hideTip} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.25, delay: 0.06, ease: [0.22, 1, 0.36, 1] }}>
      <div className="sidebar-scroll">
        <SectionLabel className="sidebar-toggle-row" trailing={<button type="button" className="icon-button sidebar-toggle" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!collapsed} title={collapsed ? undefined : 'Collapse sidebar (Ctrl+B)'} {...tip(collapsed ? 'Expand sidebar' : '', 'Ctrl+B')} onClick={toggle}>{collapsed ? <PanelLeftOpen size={17} strokeWidth={1.85} aria-hidden="true" /> : <PanelLeftClose size={17} strokeWidth={1.85} aria-hidden="true" />}</button>}>Workspace</SectionLabel>
        <LayoutGroup id="primary-navigation">
        {NAV.map(({ id, label, aria, title, shortcut, icon: Icon, badge, keyHint }) => (
          <motion.button key={id} whileHover={collapsed ? undefined : { x: 2 }} whileTap={{ scale: 0.995 }} transition={interactiveSpring} title={collapsed ? undefined : title} {...tip(label, shortcut)} aria-label={aria} aria-current={mode === id ? 'page' : undefined} className={cx('nav-item', mode === id && 'nav-active')} onClick={() => setMode(id)}>
            {mode === id && <motion.span layoutId="primary-nav-active" className="nav-active-indicator" transition={interactiveSpring} />}
            <Icon size={17} /><span>{label}</span>
            {keyHint && <span className="nav-key">{keyHint}</span>}
            {id === 'workspace' && pages.length > 0 && <span className="nav-count">{pages.length}</span>}
            {badge && <span className="nav-new">{badge}</span>}
          </motion.button>
        ))}
        </LayoutGroup>

        <div className="sidebar-divider" />
        <SectionLabel trailing={<IconButton icon={Plus} label="Add documents" size={15} onClick={chooseFiles} />} >Your documents</SectionLabel>
        {documents.length === 0 ? <button className="empty-docs-link" onClick={chooseFiles} aria-label="Add your first file" {...tip('Add your first file', 'Ctrl+O')}><FolderOpen size={17} /><span>Add your first file</span><ChevronRight size={14} /></button> : <motion.div className="document-list" layout>
          <AnimatePresence initial={false}>{documents.map((document) => <motion.div layout {...tip(document.name)} onClick={collapsed ? () => openDocument(document) : undefined} className={cx('document-list-item', currentDocument?.id === document.id && 'document-current')} key={document.id} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -6 }} transition={{ duration: 0.16 }}>
            <div className={cx('file-type-mini', document.kind === 'pdf' ? 'file-pdf' : 'file-image')}>{document.kind === 'pdf' ? <FileText size={14} /> : <FileImage size={14} />}</div>
            <button className="document-label" title={document.name} onClick={() => openDocument(document)}><span>{document.name}</span><small>{document.pageCount} {document.pageCount === 1 ? 'page' : 'pages'} · {formatBytes(document.size)}</small></button>
            <IconButton icon={X} label={`Remove ${document.name}`} size={13} className="document-remove" onClick={() => removeDocument(document.id)} />
          </motion.div>)}</AnimatePresence>
        </motion.div>}

        <div className="sidebar-divider" />
        <SectionLabel>Quick tools</SectionLabel>
        <button className="quick-nav" aria-label="Split PDF" {...tip('Split PDF')} onClick={() => setModal({ type: 'split' })} disabled={!pages.length}><span className="quick-icon quick-violet"><Split size={15} /></span><span>Split PDF</span></button>
        <button className="quick-nav" aria-label="PDF to Word" {...tip('PDF to Word')} onClick={() => setModal({ type: 'word' })} disabled={!pages.length}><span className="quick-icon quick-blue"><FileText size={15} /></span><span>PDF to Word</span></button>
        <button className="quick-nav" aria-label="Export images" {...tip('Export images')} onClick={() => setModal({ type: 'images' })} disabled={!pages.length}><span className="quick-icon quick-orange"><FileImage size={15} /></span><span>Export images</span></button>
      </div>
      <div className="sidebar-footer">
        <div className="privacy-card" {...tip('Your files stay yours: processed on this device')}><div className="privacy-icon"><ShieldCheck size={17} /></div><div><strong>Your files stay yours</strong><p>Processed on this device. No uploads.</p></div><CheckCircle2 size={15} className="privacy-check" /></div>
        <button type="button" className="account-row" onClick={() => setMode('settings')} aria-label="Open PDF Studio settings" title={collapsed ? undefined : 'Open settings'} {...tip('PDF Studio settings')}><span className="account-avatar" aria-hidden="true">JA</span><span className="account-meta"><strong>PDF Studio</strong><small>Personal workspace · v{appVersion}</small></span><Settings2 size={16} className="account-settings" aria-hidden="true" /></button>
      </div>
    </motion.aside>
    <RailTooltip tip={railTip} />
    </>
  );
}
