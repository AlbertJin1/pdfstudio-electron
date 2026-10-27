import { useEffect, useState } from 'react';
import { Activity, AlignLeft, FileText, Image } from 'lucide-react';
import ActionButton from '../components/common/ActionButton.jsx';
import Modal from '../components/common/Modal.jsx';
import PdfSourcePicker from '../components/common/PdfSourcePicker.jsx';
import { usePdfPicker } from '../hooks/usePdfPicker.js';
import { loadPdfSource } from '../services/pdf/index.js';

export default function WordModal({ pages, file: initialFile = null, setModal, convertToWord }) {
  const [mode, setMode] = useState('editable');
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
        <div><strong>Convert to a real, editable Word document</strong><p>Editable mode rebuilds normal Word paragraphs and tables, inserts photos and logos as separate images, and uses the PDF page size. Choose layout-preserving mode only when fixed positioning matters more than natural Word editing.</p></div>
      </div>
      <PdfSourcePicker file={file} pageCount={file ? filePages : null} onBrowse={picker.browse} onClear={file ? clearFile : null} picking={picker.picking}
        error={unreadable ? 'This PDF couldn’t be read. It may be damaged or password-protected — choose a different file.' : picker.error} notice={picker.notice}
        fallbackTitle={hasWorkspace ? 'Current workspace' : ''} fallbackDetail={`${pages.length} page${pages.length === 1 ? '' : 's'} will be converted`} />
      {ready && <>
      <div className="conversion-summary"><div><span>Pages to convert</span><strong>{file ? (filePages ?? '…') : pages.length}</strong></div><div><span>Output format</span><strong>.DOCX</strong></div><div><span>Processing</span><strong>On this device</strong></div></div>
      <div className="word-conversion-modes" role="radiogroup" aria-label="Word conversion layout">
        <button type="button" role="radio" aria-checked={mode === 'editable'} className={`word-conversion-mode ${mode === 'editable' ? 'is-selected' : ''}`} onClick={() => setMode('editable')}>
          <span className="word-conversion-mode-icon"><FileText size={20}/></span>
          <span className="word-conversion-mode-copy"><strong>Editable Word document</strong><span>Recommended · normal Word typing flow with editable paragraphs, native tables for detected grids, and separate photo/logo images. Content can reflow when you edit it.</span></span>
          <span className="word-conversion-radio" aria-hidden="true"/>
        </button>
        <button type="button" role="radio" aria-checked={mode === 'layout'} className={`word-conversion-mode ${mode === 'layout' ? 'is-selected' : ''}`} onClick={() => setMode('layout')}>
          <span className="word-conversion-mode-icon"><AlignLeft size={20}/></span>
          <span className="word-conversion-mode-copy"><strong>Layout-preserving</strong><span>Keeps the original page artwork and positions editable text on top. Useful when appearance matters most, but it is less convenient to edit as a normal Word document.</span></span>
          <span className="word-conversion-radio" aria-hidden="true"/>
        </button>
        <button type="button" role="radio" aria-checked={mode === 'visual'} className={`word-conversion-mode ${mode === 'visual' ? 'is-selected' : ''}`} onClick={() => setMode('visual')}>
          <span className="word-conversion-mode-icon"><Image size={20}/></span>
          <span className="word-conversion-mode-copy"><strong>Visual replica</strong><span>Highest visual fidelity · each page remains a high-resolution image, not individually editable Word content.</span></span>
          <span className="word-conversion-radio" aria-hidden="true"/>
        </button>
      </div>
      {mode !== 'visual' && <div className="word-ocr-options">
        <label className="compress-check-row"><input type="checkbox" checked={ocrEnabled} onChange={(event) => setOcrEnabled(event.target.checked)}/><span><strong>Hybrid OCR for scanned and mixed pages</strong><small>Recognize image-only text and keep OCR words editable where they can be safely separated from the page artwork. Runs locally through Tesseract.</small></span></label>
        {ocrEnabled && <label className="form-label word-ocr-language">OCR language
          <select className="form-select" value={ocrLanguage} onChange={(event) => setOcrLanguage(event.target.value)}>
            <option value="eng">English</option>
            <option value="eng+chi_tra">English + Traditional Chinese</option>
            <option value="chi_tra">Traditional Chinese</option>
            <option value="eng+chi_sim">English + Simplified Chinese</option>
            <option value="jpn">Japanese</option>
            <option value="kor">Korean</option>
            <option value="fra">French</option>
            <option value="deu">German</option>
            <option value="spa">Spanish</option>
          </select>
        </label>}
      </div>}
      <div className="modal-note"><Activity size={15}/><span>Editable mode uses regular Word paragraphs and reconstructs clearly ruled tables as Word tables; image assets are separated from the page artwork where possible. Page dimensions are retained, but text wrapping, fonts, and complex layouts may differ slightly. Scan-only pages, rotated/vertical text, borderless tables, and complex graphics may need review. OCR requires Tesseract and its selected language data. For fixed-position text over original artwork, choose Layout-preserving; Visual replica exports page images only.</span></div>
      </>}
    </Modal>
  );
}
