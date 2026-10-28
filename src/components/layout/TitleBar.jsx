import { Crop, FilePenLine, LayoutDashboard, Plus, X } from 'lucide-react';
import { motion } from 'motion/react';
import WindowControls from './WindowControls.jsx';

const modeLabel = (mode) => mode === 'home' ? 'Overview' : mode === 'workspace' ? 'Page workspace' : mode === 'settings' ? 'Settings' : mode === 'convert' ? 'Conversion studio' : mode === 'history' ? 'Recent sources' : mode === 'photo' ? 'Photo Editing' : 'Workspace';

export default function TitleBar({ mode, maximized, setMode, editorTabOpen = false, editorTabTitle = 'Edit PDF', photoTabOpen = false, onActivateMainTab, onCloseEditorTab, onClosePhotoTab }) {
  const editorActive = mode === 'edit';
  const photoActive = mode === 'photo';
  const mainActive = !editorActive && !photoActive;
  return (
    <motion.header className="titlebar" initial={{ opacity: 0, y: -7 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22, delay: 0.035 }}>
      <button type="button" className="titlebar-brand" onClick={() => setMode('home')} aria-label="Go to PDF Studio overview">
        <div className="brand-mark"><img src="./icons/pdf-studio.png" alt="" draggable="false" /></div>
        <div className="brand-wordmark"><strong>PDF<span>Studio</span></strong><small>Document workspace</small></div>
      </button>
      <div className="titlebar-tabs" role="tablist" aria-label="PDF Studio tabs">
        <button type="button" role="tab" aria-selected={mainActive} className={`titlebar-tab titlebar-tab-main${mainActive ? ' is-active' : ''}`} onClick={onActivateMainTab} title={`PDF Studio · ${modeLabel(mode)}`}>
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
        {photoTabOpen ? (
          <div className={`titlebar-tab-wrap titlebar-tab-wrap-photo${photoActive ? ' is-active' : ''}`}>
            <button type="button" role="tab" aria-selected={photoActive} className="titlebar-tab titlebar-tab-photo" onClick={() => setMode('photo')} title="Photo Editing">
              <Crop size={15} aria-hidden="true" />
              <span className="titlebar-tab-label">Photo Editing</span>
            </button>
            <button type="button" className="titlebar-tab-close" onClick={(event) => { event.stopPropagation(); onClosePhotoTab?.(); }} aria-label="Close Photo Editing tab" title="Close tab"><X size={13} aria-hidden="true" /></button>
          </div>
        ) : (
          <button type="button" className="titlebar-tab-add titlebar-tab-add-photo" onClick={() => setMode('photo')} aria-label="Open Photo Editing tab" title="Open Photo Editing tab"><Plus size={16} aria-hidden="true" /></button>
        )}
      </div>
      <div className="titlebar-center" title="Files are processed on this device"><span className="titlebar-status" role="status"><span className="titlebar-dot" aria-hidden="true"/><span>Local workspace</span></span></div>
      <WindowControls maximized={maximized} />
    </motion.header>
  );
}
