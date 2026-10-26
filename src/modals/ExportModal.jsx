import { Download, FileCheck2, ShieldCheck } from 'lucide-react';
import ActionButton from '../components/common/ActionButton.jsx';
import Modal from '../components/common/Modal.jsx';

export default function ExportModal({ pages, exportTitle, exportAuthor, exportPageNumbers, exportWatermark, setModal, setExportTitle, setExportAuthor, setExportPageNumbers, setExportWatermark, doExportPdf }) {
  return (
    <Modal title="Export PDF" eyebrow="FINALIZE YOUR DOCUMENT" onClose={() => setModal(null)} footer={<><ActionButton onClick={() => setModal(null)}>Cancel</ActionButton><ActionButton variant="primary" icon={Download} onClick={() => doExportPdf(false)}>Export {pages.length} pages</ActionButton></>}>
          <div className="modal-intro"><div className="modal-hero-icon modal-hero-purple"><FileCheck2 size={22}/></div><div><strong>Ready for its next destination.</strong><p>Your page order, rotations and current overlays will be included in the exported PDF.</p></div></div>
          <label className="form-label">Document title<input className="form-input" value={exportTitle} onChange={(event) => setExportTitle(event.target.value)} placeholder="My final document" /></label>
          <label className="form-label">Author<input className="form-input" value={exportAuthor} onChange={(event) => setExportAuthor(event.target.value)} placeholder="PDF Studio" /></label>
          <div className="form-options"><label className="check-option"><input type="checkbox" checked={exportPageNumbers} onChange={(event) => setExportPageNumbers(event.target.checked)}/><span><strong>Add page numbers</strong><small>Place a small number at the bottom of each page.</small></span></label><label className="form-label">Text watermark <input className="form-input" value={exportWatermark} onChange={(event) => setExportWatermark(event.target.value)} placeholder="Optional · e.g. DRAFT" /></label></div>
          <div className="modal-note"><ShieldCheck size={15}/><span>PDF export runs locally. Password encryption and guaranteed file-size reduction are not included in this rebuild yet.</span></div>
        </Modal>
  );
}
