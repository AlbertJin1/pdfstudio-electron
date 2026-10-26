import { LockKeyhole, ShieldCheck } from 'lucide-react';
import ActionButton from '../components/common/ActionButton.jsx';
import Modal from '../components/common/Modal.jsx';

export default function CoverModal({ coverColor, setModal, setCoverColor, addCoverOverlay }) {
  return (
    <Modal title="Add a cover block" eyebrow="ANNOTATE PAGE" onClose={() => setModal(null)} footer={<><ActionButton onClick={() => setModal(null)}>Cancel</ActionButton><ActionButton variant="primary" icon={LockKeyhole} onClick={addCoverOverlay}>Add cover block</ActionButton></>}><div className="modal-intro"><div className="modal-hero-icon modal-hero-dark"><LockKeyhole size={22}/></div><div><strong>Cover a visible area</strong><p>This places a solid shape over part of the page. It is not a certified redaction and may not remove underlying text from the PDF structure.</p></div></div><label className="form-label">Cover color<div className="color-picker-row"><input type="color" value={coverColor} onChange={(event) => setCoverColor(event.target.value)}/><span>{coverColor.toUpperCase()}</span></div></label><div className="modal-note modal-note-warning"><ShieldCheck size={15}/><span>For sensitive information, use a dedicated redaction workflow that permanently removes content and verify the exported file before sharing.</span></div></Modal>
  );
}
