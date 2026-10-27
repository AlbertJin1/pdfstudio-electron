import { AlertTriangle, FileText, FolderOpen, Info, Layers, UploadCloud, X } from 'lucide-react';
import ActionButton from './ActionButton.jsx';
import IconButton from './IconButton.jsx';
import { formatBytes } from '../../utils/format.js';

/**
 * The "which PDF?" block at the top of a tool dialog.
 *
 *  - no file, no fallback  → a large click-or-drop zone
 *  - fallbackTitle given   → a card for the default source (e.g. the open workspace) plus a "choose another PDF" action
 *  - file selected         → a file card with Change / Remove
 *
 * The actual drop handling lives on <Modal onDropFiles>, so a PDF can be dropped anywhere on the dialog; the
 * zone only provides the click target and the visual affordance.
 */
export default function PdfSourcePicker({
  file = null,
  pageCount = null,
  onBrowse,
  onClear = null,
  picking = false,
  disabled = false,
  error = '',
  notice = '',
  emptyTitle = 'Drop a PDF here',
  fallbackTitle = '',
  fallbackDetail = '',
}) {
  let body;
  if (file) {
    const details = [formatBytes(file.bytes?.byteLength || 0), 'PDF document'];
    if (pageCount) details.push(`${pageCount} page${pageCount === 1 ? '' : 's'}`);
    body = <div className="pdf-source-card" data-selected="true">
      <div className="pdf-source-icon"><FileText size={20} /></div>
      <div className="pdf-source-copy"><strong title={file.name}>{file.name}</strong><span>{details.join(' · ')}</span></div>
      <div className="pdf-source-actions">
        <ActionButton icon={FolderOpen} onClick={onBrowse} loading={picking} disabled={disabled}>Change file</ActionButton>
        {onClear && <IconButton icon={X} label={fallbackTitle ? `Remove file and use ${fallbackTitle.toLowerCase()}` : 'Remove file'} onClick={onClear} disabled={disabled} />}
      </div>
    </div>;
  } else if (fallbackTitle) {
    body = <div className="pdf-source-card">
      <div className="pdf-source-icon"><Layers size={20} /></div>
      <div className="pdf-source-copy"><strong>{fallbackTitle}</strong><span>{fallbackDetail}</span></div>
      <div className="pdf-source-actions"><ActionButton icon={FolderOpen} onClick={onBrowse} loading={picking} disabled={disabled}>Use a different PDF</ActionButton></div>
    </div>;
  } else {
    body = <button type="button" className="pdf-dropzone" data-autofocus onClick={onBrowse} disabled={disabled || picking} aria-busy={picking || undefined}>
      <span className="pdf-dropzone-icon"><UploadCloud size={26} strokeWidth={1.7} /></span>
      <strong>{emptyTitle}</strong>
      <span className="pdf-dropzone-hint">or <span className="pdf-dropzone-link">click to browse</span> your computer</span>
      <span className="pdf-dropzone-chip">PDF · one file at a time</span>
    </button>;
  }
  return <div className="pdf-source">
    {body}
    {fallbackTitle && !file && <p className="pdf-source-tip">You can also drag a PDF anywhere onto this dialog to use that file instead.</p>}
    {error && <div className="pdf-source-message is-error" role="alert"><AlertTriangle size={15} /><span>{error}</span></div>}
    {!error && notice && <div className="pdf-source-message is-notice" role="status"><Info size={15} /><span>{notice}</span></div>}
  </div>;
}
