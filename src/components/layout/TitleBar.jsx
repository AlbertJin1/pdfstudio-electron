import { FilePenLine, LayoutDashboard, Plus, X } from 'lucide-react';
import { motion } from 'motion/react';
import WindowControls from './WindowControls.jsx';

const modeLabel = (mode) => mode === 'home' ? 'Overview' : mode === 'workspace' ? 'Page workspace' : mode === 'settings' ? 'Settings' : mode === 'convert' ? 'Conversion studio' : mode === 'history' ? 'Recent sources' : 'Workspace';

export default function TitleBar({ mode, maximized, setMode, editorTabOpen = false, editorTabTitle = 'Edit PDF', onActivateMainTab, onCloseEditorTab }) {
  const editorActive = mode === 'edit';
  return (
    <motion.header className="titlebar" initial={{ opacity: 0, y: -7 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22, delay: 0.035 }}>
      <button type="button" className="titlebar-brand" onClick={() => setMode('home')} aria-label="Go to PDF Studio overview">
        <div className="brand-mark"><img src="./icons/pdf-studio.png" alt="" draggable="false" /></div>
        <div className="brand-wordmark"><strong>PDF<span>Studio</span></strong><small>Document workspace</small></div>
      </button>
      <div className="titlebar-tabs" role="tablist" aria-label="PDF Studio tabs">
        <button type="button" role="tab" aria-selected={!editorActive} className={`titlebar-tab titlebar-tab-main${!editorActive ? ' is-active' : ''}`} onClick={onActivateMainTab} title={`PDF Studio · ${modeLabel(mode)}`}>
          <LayoutDashboard size={15} aria-hidden="true" />
          <span className="titlebar-tab-label">PDF Studio</span>
        </button>
        {editorTabOpen ? (
          <div className={`titlebar-tab-wrap${editorActive ? ' is-active' : ''}`}>
            <button type="button" role="tab" aria-selected={editorActive} className="titlebar-tab titlebar-tab-editor" onClick={() => setMode('edit')} title={editorTabTitle || 'Edit PDF'}>
              <FilePenLine size={15} aria-hidden="true" />
              <span className="titlebar-tab-label">{editorTabTitle || 'Edit PDF'}</span>
            </button>
            <button type="button" className="titlebar-tab-close" onClick={(event) => { event.stopPropagation(); onCloseEditorTab?.(); }} aria-label="Close Edit PDF tab" title="Close tab"><X size={13} aria-hidden="true" /></button>
          </div>
        ) : (
          <button type="button" className="titlebar-tab-add" onClick={() => setMode('edit')} aria-label="Open Edit PDF tab" title="Open Edit PDF tab"><Plus size={16} aria-hidden="true" /></button>
        )}
      </div>
      <div className="titlebar-center" title="Files are processed on this device"><span className="titlebar-status" role="status"><span className="titlebar-dot" aria-hidden="true"/><span>Local workspace</span></span></div>
      <WindowControls maximized={maximized} />
    </motion.header>
  );
}
