import { ChevronRight, CircleHelp, Info, Moon, Sun } from 'lucide-react';
import IconButton from '../common/IconButton.jsx';

export default function Topbar({ mode, dark, activePage, setMode, setDark, setModal }) {
  return (
    <div className="topbar">
      <div className="breadcrumbs"><span onClick={() => setMode('home')}>Studio</span><ChevronRight size={14} /><strong>{mode === 'home' ? 'Overview' : mode === 'workspace' ? 'Page workspace' : mode === 'convert' ? 'Conversion studio' : mode === 'history' ? 'Recent sources' : mode === 'edit' ? 'Edit PDF' : 'Settings'}</strong>{activePage && mode === 'workspace' && <><ChevronRight size={14} /><span className="crumb-muted">{activePage.sourceName}</span></>}</div>
      <div className="topbar-actions"><div className="local-badge" title="Files are processed on this device"><span /> On-device processing</div><IconButton icon={dark ? Sun : Moon} label={dark ? 'Switch to light theme' : 'Switch to dark theme'} onClick={() => setDark((value) => !value)} /><span data-tour="help" className="tour-anchor"><IconButton icon={CircleHelp} label="Open user guide" onClick={() => setModal({ type: 'guide' })} /></span><span data-tour="about" className="tour-anchor"><IconButton icon={Info} label="About PDF Studio" onClick={() => setModal({ type: 'about' })} /></span></div>
    </div>
  );
}
