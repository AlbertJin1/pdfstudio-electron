import { useMemo, useState } from 'react';
import { AlertTriangle, Files, Layers, ListOrdered, Split } from 'lucide-react';
import ActionButton from '../components/common/ActionButton.jsx';
import FolderDestination from '../components/common/FolderDestination.jsx';
import Modal from '../components/common/Modal.jsx';
import PdfSourcePicker from '../components/common/PdfSourcePicker.jsx';
import { useExportFolder } from '../hooks/useExportFolder.js';
import { usePdfPageCount } from '../hooks/usePdfPageCount.js';
import { usePdfPicker } from '../hooks/usePdfPicker.js';
import { cleanFileStem } from '../utils/imageExportPrefs.js';
import { buildSplitPlan, splitFileName } from '../utils/splitPlan.js';
import { cx } from '../utils/cx.js';

const MODES = [
  { id: 'each', icon: Files, title: 'Every page', hint: 'One PDF per page' },
  { id: 'every', icon: Layers, title: 'Group pages', hint: 'A new PDF after every N pages' },
  { id: 'ranges', icon: ListOrdered, title: 'Custom ranges', hint: 'One PDF per range, e.g. 1-3, 4, 6-8' },
];

export default function SplitModal({ pages, file: initialFile = null, workspaceName = '', workspacePath = '', setModal, splitPdf }) {
  // The PDF to split. null = the pages currently in the workspace (when there are any).
  const [file, setFile] = useState(initialFile);
  const filePages = usePdfPageCount(file);
  const folder = useExportFolder({ sourcePath: file ? file.path : workspacePath });
  const picker = usePdfPicker({ onFile: (item) => { setFile(item); folder.reset(); } });
  const [mode, setMode] = useState('each');
  const [every, setEvery] = useState('2');
  const [rangeText, setRangeText] = useState('');
  const [openWhenDone, setOpenWhenDone] = useState(true);

  const hasWorkspace = pages.length > 0;
  const unreadable = Boolean(file) && filePages === 0;
  const hasSource = (Boolean(file) || hasWorkspace) && !unreadable;
  const total = file ? filePages : pages.length;
  const baseName = cleanFileStem(file ? file.name.replace(/\.[^.]+$/, '') : workspaceName, 'PDF-Studio-document');
  const folderName = `${baseName}-split`;

  const plan = useMemo(() => (total ? buildSplitPlan({ mode, every, rangeText, total }) : { groups: [] }), [mode, every, rangeText, total]);
  const fileCount = plan.groups?.length || 0;
  const showError = plan.error && (mode !== 'ranges' || rangeText.trim());
  const ready = hasSource && !plan.error && fileCount > 0 && !folder.needsFolder && (!file || filePages !== null);
  const preview = (plan.groups || []).slice(0, 4).map((group) => splitFileName(baseName, group, total));

  const clearFile = () => { setFile(null); picker.clearMessages(); };
  const run = () => splitPdf({ file, mode, every: Number(every), rangeText, baseName, parentFolder: folder.parentPath || '', directoryHandle: folder.directoryHandle, openWhenDone });

  return (
    <Modal title="Split PDF" eyebrow="CREATE SEPARATE PDFS" wide onClose={() => setModal(null)}
      onDropFiles={picker.handleFiles} dropHint={{ title: 'Drop your PDF to split it', subtitle: 'Release to use this file for splitting.' }}
      footer={<><ActionButton onClick={() => setModal(null)}>Cancel</ActionButton><ActionButton variant="primary" icon={Split} disabled={!ready} onClick={run}>{fileCount > 0 && !plan.error ? `Split into ${fileCount} file${fileCount === 1 ? '' : 's'}` : 'Split PDF'}</ActionButton></>}>
      <input {...picker.inputProps} />
      <div className="modal-intro">
        <div className="modal-hero-icon modal-hero-purple"><Split size={22} /></div>
        <div><strong>Break a PDF into separate files</strong><p>Pick or drop a PDF, choose how to divide it, and PDF Studio saves every part into a new folder named after the document.</p></div>
      </div>
      <PdfSourcePicker file={file} pageCount={file ? filePages : null} onBrowse={picker.browse} onClear={file ? clearFile : null} picking={picker.picking}
        emptyTitle="Drop a PDF here to split it"
        error={unreadable ? 'This PDF couldn’t be read. It may be damaged or password-protected — choose a different file.' : picker.error} notice={picker.notice}
        fallbackTitle={hasWorkspace ? (workspaceName || 'Current workspace') : ''} fallbackDetail={`${pages.length} page${pages.length === 1 ? '' : 's'} in the workspace will be split`} />

      {hasSource && <>
        <div className="img-export-section">
          <span className="img-export-label">How to split</span>
          <div className="split-options" role="radiogroup" aria-label="Split method">
            {MODES.map(({ id, icon: Icon, title, hint }) => (
              <label key={id} className={cx('split-option', mode === id && 'split-option-active')}>
                <input type="radio" name="split-mode" checked={mode === id} onChange={() => setMode(id)} />
                <span><strong>{title}</strong><small>{hint}</small></span>
                {id === 'every'
                  ? <input className="compact-number" type="number" min="1" max={Math.max(1, total || 500)} value={every} aria-label="Pages per file" onChange={(event) => { setEvery(event.target.value); setMode('every'); }} onFocus={() => setMode('every')} />
                  : <Icon size={17} />}
              </label>
            ))}
          </div>
          {mode === 'ranges' && <input className="form-input img-export-range" data-autofocus value={rangeText} onChange={(event) => setRangeText(event.target.value)} placeholder={`1-3, 4, 6-${Math.max(total || 8, 6)}`} spellCheck={false} aria-label="Page ranges" aria-invalid={Boolean(showError)} />}
          {showError && <div className="pdf-source-message is-error" role="alert"><AlertTriangle size={15} /><span>{plan.error}</span></div>}
        </div>

        {fileCount > 0 && !plan.error && <div className="split-preview" aria-live="polite">
          <strong>{fileCount} PDF file{fileCount === 1 ? '' : 's'} will be created</strong>
          <ul>{preview.map((name) => <li key={name}>{name}</li>)}{fileCount > preview.length && <li className="split-preview-more">+ {fileCount - preview.length} more</li>}</ul>
        </div>}

        <FolderDestination folder={folder} folderName={folderName} openWhenDone={openWhenDone} onOpenWhenDoneChange={setOpenWhenDone} />
      </>}
    </Modal>
  );
}
