import { useMemo, useState } from 'react';
import { AlertTriangle, Download, FileImage } from 'lucide-react';
import ActionButton from '../components/common/ActionButton.jsx';
import Modal from '../components/common/Modal.jsx';
import Select from '../components/common/Select.jsx';
import FolderDestination from '../components/common/FolderDestination.jsx';
import PdfSourcePicker from '../components/common/PdfSourcePicker.jsx';
import { useExportFolder } from '../hooks/useExportFolder.js';
import { usePdfPageCount } from '../hooks/usePdfPageCount.js';
import { usePdfPicker } from '../hooks/usePdfPicker.js';
import { IMAGE_DPI_OPTIONS, cleanFileStem } from '../utils/imageExportPrefs.js';
import { parsePageRange } from '../utils/pageRange.js';
import { cx } from '../utils/cx.js';

const DPI_SELECT_OPTIONS = IMAGE_DPI_OPTIONS.map((option) => ({ value: option.value, label: option.label.split(' · ')[0] + ' · ' + option.value + ' DPI', hint: option.hint }));
const A4_INCHES = [8.27, 11.69];

export default function ImagesModal({ pages, selectedPages, file: initialFile = null, workspaceName = '', workspacePath = '', imageFormat, imageQuality, setModal, setImageFormat, setImageQuality, convertToImages }) {
  // The PDF to export. null = the pages currently in the workspace (when there are any).
  const [file, setFile] = useState(initialFile);
  const filePages = usePdfPageCount(file);
  const picker = usePdfPicker({ onFile: (item) => { setFile(item); setScope((current) => (current === 'selected' ? 'all' : current)); folder.reset(); } });
  const [scope, setScope] = useState(() => (!initialFile && selectedPages.length ? 'selected' : 'all'));
  const [rangeText, setRangeText] = useState('');
  const folder = useExportFolder({ sourcePath: file ? file.path : workspacePath });
  const [dpi, setDpi] = useState(folder.prefs.dpi);
  const [openWhenDone, setOpenWhenDone] = useState(true);
  const hasWorkspace = pages.length > 0;
  const unreadable = Boolean(file) && filePages === 0;
  const hasSource = (Boolean(file) || hasWorkspace) && !unreadable;
  const totalPages = file ? filePages : pages.length;
  const selectionCount = !file ? selectedPages.length : 0;

  const rangeResult = useMemo(() => (scope === 'range' && totalPages ? parsePageRange(rangeText, totalPages) : null), [scope, rangeText, totalPages]);
  const exportCount = scope === 'selected' ? selectionCount : scope === 'range' ? (rangeResult?.pages?.length || 0) : (totalPages || 0);

  const baseName = cleanFileStem(file ? file.name.replace(/\.[^.]+$/, '') : workspaceName, 'PDF-Studio-document');
  const folderName = `${baseName}-images`;
  const ready = hasSource && exportCount > 0 && !(rangeResult?.error) && !folder.needsFolder && (!file || filePages !== null);

  const clearFile = () => { setFile(null); setScope((current) => (current === 'range' ? 'range' : selectionCount ? 'selected' : 'all')); picker.clearMessages(); };
  const pxFor = (value) => `${Math.round(A4_INCHES[0] * value)} × ${Math.round(A4_INCHES[1] * value)} px`;
  const run = () => convertToImages({
    file, scope, rangeText, format: imageFormat, quality: Number(imageQuality), dpi, baseName,
    parentFolder: folder.parentPath || '', directoryHandle: folder.directoryHandle, openWhenDone,
  });

  const scopeOptions = [
    { id: 'all', label: 'All pages', hint: totalPages ? `${totalPages} page${totalPages === 1 ? '' : 's'}` : 'Every page' },
    ...(selectionCount ? [{ id: 'selected', label: 'Selected', hint: `${selectionCount} page${selectionCount === 1 ? '' : 's'}` }] : []),
    { id: 'range', label: 'Page range', hint: 'e.g. 1-3, 5' },
  ];

  return (
    <Modal title="Export pages as images" eyebrow="PDF → IMAGES" wide onClose={() => setModal(null)}
      onDropFiles={picker.handleFiles} dropHint={{ title: 'Drop your PDF to export it as images', subtitle: 'Release to use this file for the image export.' }}
      footer={<><ActionButton onClick={() => setModal(null)}>Cancel</ActionButton><ActionButton variant="primary" icon={Download} disabled={!ready} onClick={run}>{exportCount > 0 ? `Export ${exportCount} image${exportCount === 1 ? '' : 's'}` : 'Export images'}</ActionButton></>}>
      <input {...picker.inputProps} />
      <div className="modal-intro">
        <div className="modal-hero-icon modal-hero-orange"><FileImage size={22} /></div>
        <div><strong>Turn each PDF page into an image</strong><p>Pick or drop a PDF, choose the pages and quality, and PDF Studio saves them into a new folder named after the document.</p></div>
      </div>
      <PdfSourcePicker file={file} pageCount={file ? filePages : null} onBrowse={picker.browse} onClear={file ? clearFile : null} picking={picker.picking}
        emptyTitle="Drop a PDF here to export it as images"
        error={unreadable ? 'This PDF couldn’t be read. It may be damaged or password-protected — choose a different file.' : picker.error} notice={picker.notice}
        fallbackTitle={hasWorkspace ? (workspaceName || 'Current workspace') : ''} fallbackDetail={`${pages.length} page${pages.length === 1 ? '' : 's'} in the workspace${selectionCount ? ` · ${selectionCount} selected` : ''}`} />

      {hasSource && <>
        <div className="img-export-section">
          <span className="img-export-label">Pages</span>
          <div className={cx('segmented-choice', scopeOptions.length === 3 && 'is-three')} role="radiogroup" aria-label="Pages to export">
            {scopeOptions.map((option) => <button key={option.id} type="button" role="radio" aria-checked={scope === option.id} className={cx(scope === option.id && 'segment-active')} onClick={() => setScope(option.id)}><span>{option.label}</span><small>{option.hint}</small></button>)}
          </div>
          {scope === 'range' && <>
            <input className="form-input img-export-range" data-autofocus value={rangeText} onChange={(event) => setRangeText(event.target.value)} placeholder={`1-3, 5, 8-${Math.max(totalPages || 10, 8)}`} spellCheck={false} aria-label="Page range" aria-invalid={Boolean(rangeText && rangeResult?.error)} />
            {rangeText && rangeResult?.error && <div className="pdf-source-message is-error" role="alert"><AlertTriangle size={15} /><span>{rangeResult.error}</span></div>}
          </>}
        </div>

        <div className="img-export-grid">
          <div className="img-export-section">
            <span className="img-export-label">Image format</span>
            <div className="segmented-choice" role="radiogroup" aria-label="Image format">
              <button type="button" role="radio" aria-checked={imageFormat === 'png'} className={cx(imageFormat === 'png' && 'segment-active')} onClick={() => setImageFormat('png')}><span>PNG</span><small>Sharper text, lossless</small></button>
              <button type="button" role="radio" aria-checked={imageFormat === 'jpeg'} className={cx(imageFormat === 'jpeg' && 'segment-active')} onClick={() => setImageFormat('jpeg')}><span>JPG</span><small>Smaller files</small></button>
            </div>
            {imageFormat === 'jpeg' && <div className="range-row"><input type="range" min="40" max="100" value={imageQuality} onChange={(event) => setImageQuality(event.target.value)} aria-label="JPG quality" /><strong>{imageQuality}%</strong></div>}
          </div>
          <div className="img-export-section">
            <label className="img-export-label" htmlFor="img-export-dpi">Resolution</label>
            <Select id="img-export-dpi" className="form-input" value={dpi} onChange={setDpi} options={DPI_SELECT_OPTIONS} ariaLabel="Resolution" />
            <small className="img-export-help">An A4 page is about {pxFor(dpi / 1)} at this setting.</small>
          </div>
        </div>

        <FolderDestination folder={folder} folderName={folderName} openWhenDone={openWhenDone} onOpenWhenDoneChange={setOpenWhenDone} />
      </>}
    </Modal>
  );
}
