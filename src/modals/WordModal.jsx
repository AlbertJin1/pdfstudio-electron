import { useEffect, useState } from 'react';
import { Activity, AlignLeft, FileText, Image } from 'lucide-react';
import ActionButton from '../components/common/ActionButton.jsx';
import Modal from '../components/common/Modal.jsx';
import Select from '../components/common/Select.jsx';
import PdfSourcePicker from '../components/common/PdfSourcePicker.jsx';
import { usePdfPicker } from '../hooks/usePdfPicker.js';
import { loadPdfSource } from '../services/pdf/index.js';

const OCR_LANGUAGES = [
  { value: 'eng', label: 'English' }, { value: 'eng+chi_tra', label: 'English + Traditional Chinese' }, { value: 'chi_tra', label: 'Traditional Chinese' },
  { value: 'eng+chi_sim', label: 'English + Simplified Chinese' }, { value: 'jpn', label: 'Japanese' }, { value: 'kor', label: 'Korean' },
  { value: 'fra', label: 'French' }, { value: 'deu', label: 'German' }, { value: 'spa', label: 'Spanish' },
];

export default function WordModal({ pages, file: initialFile = null, setModal, convertToWord }) {
  const [mode, setMode] = useState('auto');
  // The PDF to convert. null = use the pages currently in the workspace (when there are any).
  const [file, setFile] = useState(initialFile);
  const [filePages, setFilePages] = useState(null);
  const picker = usePdfPicker({ onFile: setFile });
  // A PDF picked or dropped here is converted as-is (it never enters the workspace); read its page count for the summary.
  useEffect(() => {
    if (!file) { setFilePages(null); return undefined; }
    let cancelled = false; let doc = null;
    setFilePages(null);
    loadPdfSource(file.bytes).then((pdf) => { doc = pdf; if (!cancelled) setFilePages(pdf.numPages); else pdf.destroy?.(); }).catch(() => { if (!cancelled) setFilePages(0); });
    return () => { cancelled = true; doc?.destroy?.(); };
  }, [file]);
  const [ocrEnabled, setOcrEnabled] = useState(true);
  const [ocrLanguage, setOcrLanguage] = useState('eng');
  const hasWorkspace = pages.length > 0;
  const unreadable = Boolean(file) && filePages === 0;
  const ready = (Boolean(file) || hasWorkspace) && !unreadable;
  const clearFile = () => { setFile(null); picker.clearMessages(); };
  return (
    <Modal title="Convert PDF to Word" eyebrow="PDF → DOCX" wide onClose={() => setModal(null)}
      onDropFiles={picker.handleFiles} dropHint={{ title: 'Drop your PDF to convert it', subtitle: 'Release to use this file for the Word conversion.' }}
      footer={<><ActionButton onClick={() => setModal(null)}>Cancel</ActionButton><ActionButton variant="primary" icon={FileText} disabled={!ready} onClick={() => convertToWord({ mode, ocrEnabled, ocrLanguage, file })}>Create DOCX</ActionButton></>}>
      <input {...picker.inputProps} />
      <div className="modal-intro">
        <div className="modal-hero-icon modal-hero-blue"><FileText size={22}/></div>
        <div><strong>Convert to Word with adaptive layout preservation</strong><p>PDF Studio analyzes each page first. Complex forms keep their page placement, while detected tables are rebuilt as real Word tables and placed photos/signatures become separate image objects. Simpler text-first pages can be rebuilt as normal Word paragraphs.</p></div>
      </div>
      <PdfSourcePicker file={file} pageCount={file ? filePages : null} onBrowse={picker.browse} onClear={file ? clearFile : null} picking={picker.picking}
        error={unreadable ? 'This PDF couldn’t be read. It may be damaged or password-protected — choose a different file.' : picker.error} notice={picker.notice}
        fallbackTitle={hasWorkspace ? 'Current workspace' : ''} fallbackDetail={`${pages.length} page${pages.length === 1 ? '' : 's'} will be converted`} />
      {ready && <>
      <div className="conversion-summary"><div><span>Pages to convert</span><strong>{file ? (filePages ?? '…') : pages.length}</strong></div><div><span>Output format</span><strong>.DOCX</strong></div><div><span>Processing</span><strong>On this device</strong></div></div>
      <div className="word-conversion-modes" role="radiogroup" aria-label="Word conversion layout">
        <button type="button" role="radio" aria-checked={mode === 'auto'} className={`word-conversion-mode ${mode === 'auto' ? 'is-selected' : ''}`} onClick={() => setMode('auto')}>
          <span className="word-conversion-mode-icon"><Activity size={20}/></span>
          <span className="word-conversion-mode-copy"><strong>Automatic hybrid (recommended)</strong><span>Analyzes each page and chooses reflowable content or a fixed-position layout. Recognized tables remain editable Word tables, and detected photos/signatures are individual Word pictures rather than part of a flattened page image.</span></span>
          <span className="word-conversion-radio" aria-hidden="true"/>
        </button>
        <button type="button" role="radio" aria-checked={mode === 'editable'} className={`word-conversion-mode ${mode === 'editable' ? 'is-selected' : ''}`} onClick={() => setMode('editable')}>
          <span className="word-conversion-mode-icon"><FileText size={20}/></span>
          <span className="word-conversion-mode-copy"><strong>Editable / reflowable Word</strong><span>Builds normal Word paragraphs and native tables where the structure can be detected. Better for editing and reformatting text, but page layout can change.</span></span>
          <span className="word-conversion-radio" aria-hidden="true"/>
        </button>
        <button type="button" role="radio" aria-checked={mode === 'layout'} className={`word-conversion-mode ${mode === 'layout' ? 'is-selected' : ''}`} onClick={() => setMode('layout')}>
          <span className="word-conversion-mode-icon"><AlignLeft size={20}/></span>
          <span className="word-conversion-mode-copy"><strong>Layout-preserving</strong><span>Preserves complex page placement while overlaying editable text, native Word tables for recognized table regions, and separate movable pictures for detected photos/signatures.</span></span>
          <span className="word-conversion-radio" aria-hidden="true"/>
        </button>
        <button type="button" role="radio" aria-checked={mode === 'visual'} className={`word-conversion-mode ${mode === 'visual' ? 'is-selected' : ''}`} onClick={() => setMode('visual')}>
          <span className="word-conversion-mode-icon"><Image size={20}/></span>
          <span className="word-conversion-mode-copy"><strong>Visual replica</strong><span>Renders every PDF page as a high-resolution image in Word for the closest appearance match. Page content is not individually editable.</span></span>
          <span className="word-conversion-radio" aria-hidden="true"/>
        </button>
      </div>
      {mode !== 'visual' && <div className="word-ocr-options">
        <label className="compress-check-row"><input type="checkbox" checked={ocrEnabled} onChange={(event) => setOcrEnabled(event.target.checked)}/><span><strong>OCR for scan-only or nearly textless pages</strong><small>Uses local Tesseract OCR when the PDF has no usable text layer. Pages that already have text and screenshots are not OCRed indiscriminately, preventing screenshot content from being erased or duplicated.</small></span></label>
        {ocrEnabled && <label className="form-label word-ocr-language">OCR language
          <Select className="form-input" value={ocrLanguage} onChange={setOcrLanguage} options={OCR_LANGUAGES} ariaLabel="OCR language" />
        </label>}
      </div>}
      <div className="modal-note"><Activity size={15}/><span>Automatic hybrid is the best starting point for mixed real-world PDFs: it keeps complex pages on their original coordinates and uses normal Word structure only where it is safer. Layout-preserving and automatic modes use high-resolution artwork only for complex decoration, mask reconstructed table/photo regions out of that artwork, and place editable text, native tables, and individual pictures separately; OCR is limited to scan-only or nearly textless pages to avoid damaging text inside screenshots. Visual replica is the most reliable for exact appearance but is image-only. PDF Studio does not use Acrobat’s proprietary converter, so embedded fonts, unusual graphics, handwriting and OCR may still require review; a universal 100% editable match cannot be guaranteed for every PDF.</span></div>
      </>}
    </Modal>
  );
}
