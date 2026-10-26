import {
  Copy,
  Plus,
  Redo2,
  RotateCcw,
  RotateCw,
  Trash2,
  Undo2,
} from 'lucide-react';
import IconButton from '../common/IconButton.jsx';

export default function WorkspaceToolbar({ pages, selectedIds, historyRef, redoRef, activePage, undo, redo, requestDeleteSelected, rotateSelected, duplicateSelected, addBlankPage }) {
  return (
    <div className="workspace-toolbar"><div className="toolbar-group"><IconButton icon={Undo2} label="Undo (Ctrl+Z)" onClick={undo} disabled={!historyRef.current.length} /><IconButton icon={Redo2} label="Redo (Ctrl+Shift+Z)" onClick={redo} disabled={!redoRef.current.length} /><span className="toolbar-rule"/><IconButton icon={RotateCcw} label="Rotate left" onClick={() => rotateSelected(-90)} disabled={!selectedIds.length && !activePage} /><IconButton icon={RotateCw} label="Rotate right" onClick={() => rotateSelected(90)} disabled={!selectedIds.length && !activePage} /><IconButton icon={Copy} label="Duplicate selected pages" onClick={() => duplicateSelected()} disabled={!pages.length} /><IconButton icon={Trash2} label="Delete selected pages" onClick={() => requestDeleteSelected()} disabled={!selectedIds.length} /></div><div className="toolbar-group"><span className="selection-indicator">{selectedIds.length || 0} selected</span><span className="toolbar-rule"/><IconButton icon={Plus} label="Insert blank page" onClick={addBlankPage} /></div></div>
  );
}
