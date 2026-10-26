import { Download, FileText } from 'lucide-react';
import ActionButton from '../components/common/ActionButton.jsx';
import Modal from '../components/common/Modal.jsx';

export default function ExportSelectedModal({ selectedPages, setModal, doExportPdf }) {
  return (
    <Modal title="Export selected page" eyebrow="QUICK EXPORT" onClose={() => setModal(null)} footer={<><ActionButton onClick={() => setModal(null)}>Cancel</ActionButton><ActionButton variant="primary" icon={Download} onClick={() => doExportPdf(true)}>Save selected PDF</ActionButton></>}><div className="modal-intro"><div className="modal-hero-icon modal-hero-blue"><FileText size={22}/></div><div><strong>{selectedPages.length || 1} page{(selectedPages.length || 1) === 1 ? '' : 's'} selected</strong><p>Export the selected page(s) as a separate PDF, retaining their current order.</p></div></div></Modal>
  );
}
