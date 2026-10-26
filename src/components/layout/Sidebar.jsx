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

export default function Sidebar({ pages, documents, mode, appVersion, currentDocument, setSelectedIds, setActiveId, setMode, setModal, chooseFiles, removeDocument }) {
  return (
    <motion.aside className="sidebar" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.25, delay: 0.06, ease: [0.22, 1, 0.36, 1] }}>
      <div className="sidebar-scroll">
        <SectionLabel>Workspace</SectionLabel>
        <LayoutGroup id="primary-navigation">
        <motion.button whileHover={{ x: 2 }} whileTap={{ scale: 0.995 }} transition={interactiveSpring} title={`Overview (Ctrl+1)`} aria-label="Overview" aria-current={mode === 'home' ? 'page' : undefined} className={cx('nav-item', mode === 'home' && 'nav-active')} onClick={() => setMode('home')}>{mode === 'home' && <motion.span layoutId="primary-nav-active" className="nav-active-indicator" transition={interactiveSpring} />}<LayoutDashboard size={17} /><span>Overview</span><span className="nav-key">Ctrl 1</span></motion.button>
        <motion.button whileHover={{ x: 2 }} whileTap={{ scale: 0.995 }} transition={interactiveSpring} title={`Page workspace (Ctrl+2)`} aria-label="Page workspace" aria-current={mode === 'workspace' ? 'page' : undefined} className={cx('nav-item', mode === 'workspace' && 'nav-active')} onClick={() => setMode('workspace')}>{mode === 'workspace' && <motion.span layoutId="primary-nav-active" className="nav-active-indicator" transition={interactiveSpring} />}<Files size={17} /><span>Page workspace</span>{pages.length > 0 && <span className="nav-count">{pages.length}</span>}</motion.button>
        <motion.button whileHover={{ x: 2 }} whileTap={{ scale: 0.995 }} transition={interactiveSpring} title="Edit PDF content" aria-label="Edit PDF" aria-current={mode === 'edit' ? 'page' : undefined} className={cx('nav-item', mode === 'edit' && 'nav-active')} onClick={() => setMode('edit')}>{mode === 'edit' && <motion.span layoutId="primary-nav-active" className="nav-active-indicator" transition={interactiveSpring} />}<FilePenLine size={17} /><span>Edit PDF</span><span className="nav-new">NEW</span></motion.button>
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
        <button type="button" className="account-row" onClick={() => setMode('settings')} aria-label="Open PDF Studio settings" title="Open settings"><span className="account-avatar" aria-hidden="true">JA</span><span className="account-meta"><strong>PDF Studio</strong><small>Personal workspace · v{appVersion}</small></span><Settings2 size={16} className="account-settings" aria-hidden="true" /></button>
      </div>
    </motion.aside>
  );
}
