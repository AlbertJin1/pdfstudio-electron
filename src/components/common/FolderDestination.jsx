import { AlertTriangle, FolderOpen } from 'lucide-react';
import ActionButton from './ActionButton.jsx';
import { joinPath } from '../../utils/imageExportPrefs.js';

/** "Save location" block: current parent folder, the sub-folder that will be created, and a Change/Choose button. */
export default function FolderDestination({ folder, folderName, openWhenDone, onOpenWhenDoneChange }) {
  const { desktop, canChoose, parentLabel, needsFolder, error, choose } = folder;
  return <div className="img-export-section">
    <span className="img-export-label">Save location</span>
    <div className="img-export-folder">
      <div className="img-export-folder-icon"><FolderOpen size={18} /></div>
      <div className="img-export-folder-copy">
        {canChoose ? <>
          <strong title={parentLabel || undefined}>{parentLabel || 'No folder selected'}</strong>
          <span>{needsFolder ? 'Choose where the new folder should be created.' : <>Files go into a new folder: <b>{folderName}</b></>}</span>
        </> : <>
          <strong>Your browser’s Downloads folder</strong>
          <span>Folder selection needs the PDF Studio desktop app; files will download one by one.</span>
        </>}
      </div>
      {canChoose && <ActionButton icon={FolderOpen} onClick={choose}>{parentLabel ? 'Change folder' : 'Choose folder'}</ActionButton>}
    </div>
    {error && <div className="pdf-source-message is-error" role="alert"><AlertTriangle size={15} /><span>{error}</span></div>}
    {canChoose && !needsFolder && <small className="img-export-help" title={joinPath(parentLabel, folderName)}>Result: {joinPath(parentLabel || '…', folderName)} — an existing folder is never overwritten; a number is added instead.</small>}
    {desktop && <label className="compress-check-row img-export-check"><input type="checkbox" checked={openWhenDone} onChange={(event) => onOpenWhenDoneChange(event.target.checked)} /><span><strong>Open the folder when finished</strong></span></label>}
  </div>;
}
