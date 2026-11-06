import { useEffect, useState } from 'react';
import { Activity, AlignLeft, FileText, Image, Sparkles } from 'lucide-react';
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
  const [mode, setMode] = useState('flow');
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
        <div><strong>Convert to a fully editable Word document</strong><p>PDF Studio reads the PDF’s real text, fonts, colours, lines and images and rebuilds them as normal Word content — flowing paragraphs, real tables, columns and pictures — page for page.</p></div>
      </div>
      <PdfSourcePicker file={file} pageCount={file ? filePages : null} onBrowse={picker.browse} onClear={file ? clearFile : null} picking={picker.picking}
        error={unreadable ? 'This PDF couldn’t be read. It may be damaged or password-protected — choose a different file.' : picker.error} notice={picker.notice}
        fallbackTitle={hasWorkspace ? 'Current workspace' : ''} fallbackDetail={`${pages.length} page${pages.length === 1 ? '' : 's'} will be converted`} />
      {ready && <>
      <div className="conversion-summary"><div><span>Pages to convert</span><strong>{file ? (filePages ?? '…') : pages.length}</strong></div><div><span>Output format</span><strong>.DOCX</strong></div><div><span>Processing</span><strong>On this device</strong></div></div>
      <div className="word-conversion-modes" role="radiogroup" aria-label="Word conversion layout">
        {[
          { id: 'flow', icon: Sparkles, title: 'Editable Word document (recommended)', text: 'Like Acrobat’s Word export: paragraphs reflow with the original fonts, sizes, colours, alignment, indents and spacing; ruled grids and shaded boxes become real Word tables with merged cells; columns, lists, links, logos, photos and signatures are kept. Each PDF page becomes a Word page.' },
          { id: 'layout', icon: AlignLeft, title: 'Exact page layout', text: 'Pins every line of text to its original coordinates over the page artwork. Closest to the PDF on very complex forms, but text does not reflow as normal paragraphs.' },
          { id: 'visual', icon: Image, title: 'Visual replica', text: 'Places each page as a high-resolution picture. Looks identical but the content cannot be edited.' },
        ].map(({ id, icon: Icon, title, text }) => (
          <button key={id} type="button" role="radio" aria-checked={mode === id} className={`word-conversion-mode ${mode === id ? 'is-selected' : ''}`} onClick={() => setMode(id)}>
            <span className="word-conversion-mode-icon"><Icon size={20}/></span>
            <span className="word-conversion-mode-copy"><strong>{title}</strong><span>{text}</span></span>
            <span className="word-conversion-radio" aria-hidden="true"/>
          </button>
        ))}
      </div>
      {mode !== 'visual' && <div className="word-ocr-options">
        <label className="compress-check-row"><input type="checkbox" checked={ocrEnabled} onChange={(event) => setOcrEnabled(event.target.checked)}/><span><strong>OCR for scan-only or nearly textless pages</strong><small>Uses local Tesseract OCR when the PDF has no usable text layer. Pages that already have text and screenshots are not OCRed indiscriminately, preventing screenshot content from being erased or duplicated.</small></span></label>
        {ocrEnabled && <label className="form-label word-ocr-language">OCR language
          <Select className="form-input" value={ocrLanguage} onChange={setOcrLanguage} options={OCR_LANGUAGES} ariaLabel="OCR language" />
        </label>}
      </div>}
      <div className="modal-note"><Activity size={15}/><span>Everything runs on this computer. Fonts are matched to their Word equivalents (Helvetica → Arial, Times → Times New Roman, Carlito → Calibri…). Scanned pages need OCR to become editable; without it they are kept as pictures. Very unusual PDFs (text drawn as outlines, heavy transparency) can still need a quick review in Word.</span></div>
      </>}
    </Modal>
  );
}
