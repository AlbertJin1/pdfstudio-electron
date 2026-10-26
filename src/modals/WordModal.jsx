import { Activity, FileText } from 'lucide-react';
import ActionButton from '../components/common/ActionButton.jsx';
import Modal from '../components/common/Modal.jsx';

export default function WordModal({ pages, setModal, convertToWord }) {
  return (
    <Modal title="Convert PDF to Word" eyebrow="EDITABLE DOCUMENT" onClose={() => setModal(null)} footer={<><ActionButton onClick={() => setModal(null)}>Cancel</ActionButton><ActionButton variant="primary" icon={FileText} onClick={convertToWord}>Create DOCX</ActionButton></>}><div className="modal-intro"><div className="modal-hero-icon modal-hero-blue"><FileText size={22}/></div><div><strong>Create an editable Word document</strong><p>PDF Studio extracts selectable text and arranges it into editable paragraphs with page breaks.</p></div></div><div className="conversion-summary"><div><span>Pages to convert</span><strong>{pages.length}</strong></div><div><span>Output format</span><strong>.DOCX</strong></div><div><span>Processing</span><strong>On this device</strong></div></div><div className="modal-note"><Activity size={15}/><span>Text extraction is best for digital PDFs. Scanned pages without an OCR text layer and complex tables/images may not convert accurately.</span></div></Modal>
  );
}
