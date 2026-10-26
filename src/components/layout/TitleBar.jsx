import { motion } from 'motion/react';
import WindowControls from './WindowControls.jsx';

export default function TitleBar({ mode, maximized, setMode }) {
  return (
    <motion.header className="titlebar" initial={{ opacity: 0, y: -7 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22, delay: 0.035 }}>
      <button type="button" className="titlebar-brand" onClick={() => setMode('home')} aria-label="Go to PDF Studio overview">
        <div className="brand-mark"><img src="./icons/pdf-studio.png" alt="" draggable="false" /></div>
        <div className="brand-wordmark"><strong>PDF<span>Studio</span></strong><small>Document workspace</small></div>
      </button>
      <div className="titlebar-center"><span className="titlebar-dot" /> Local workspace <span className="titlebar-separator">/</span> {mode === 'home' ? 'Overview' : mode === 'workspace' ? 'Page workspace' : mode === 'settings' ? 'Settings' : mode === 'convert' ? 'Conversion studio' : mode === 'history' ? 'Recent sources' : mode === 'edit' ? 'Edit PDF' : 'Workspace'}</div>
      <WindowControls maximized={maximized} />
    </motion.header>
  );
}
