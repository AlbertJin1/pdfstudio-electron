import { Trash2 } from 'lucide-react';
import ActionButton from '../components/common/ActionButton.jsx';
import Modal from '../components/common/Modal.jsx';

export default function ConfirmDeleteModal({ modal, setModal, deleteSelected }) {
  return (
    <Modal title={`Delete ${modal.ids.length} page${modal.ids.length === 1 ? '' : 's'}?`} eyebrow="CONFIRM PAGE REMOVAL" onClose={() => setModal(null)} footer={<><ActionButton onClick={() => setModal(null)}>Keep pages</ActionButton><ActionButton variant="danger" icon={Trash2} onClick={() => { deleteSelected(modal.ids); setModal(null); }}>Delete {modal.ids.length} page{modal.ids.length === 1 ? '' : 's'}</ActionButton></>}><div className="delete-confirm-content"><span className="delete-confirm-icon"><Trash2 size={22}/></span><div><strong>This removes the selected pages from the current workspace.</strong><p>Your original source files on disk are not deleted. This change can be undone with Undo.</p></div></div></Modal>
  );
}
