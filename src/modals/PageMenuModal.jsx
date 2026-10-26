import { Copy, RotateCcw, RotateCw, Trash2 } from 'lucide-react';
import ActionButton from '../components/common/ActionButton.jsx';
import Modal from '../components/common/Modal.jsx';

export default function PageMenuModal({ modal, setSelectedIds, setActiveId, setModal, requestDeleteSelected, rotateSelected, duplicateSelected }) {
  return (
    <Modal title="Page actions" eyebrow="PAGE OPTIONS" onClose={() => setModal(null)} footer={<ActionButton onClick={() => setModal(null)}>Done</ActionButton>}><div className="page-menu-list"><button onClick={() => { rotateSelected(-90, [modal.pageId]); setActiveId(modal.pageId); setSelectedIds([modal.pageId]); setModal(null); }}><RotateCcw size={17}/><span><strong>Rotate left</strong><small>Turn the page 90° counter-clockwise.</small></span></button><button onClick={() => { rotateSelected(90, [modal.pageId]); setActiveId(modal.pageId); setSelectedIds([modal.pageId]); setModal(null); }}><RotateCw size={17}/><span><strong>Rotate right</strong><small>Turn the page 90° clockwise.</small></span></button><button onClick={() => { duplicateSelected([modal.pageId]); setModal(null); }}><Copy size={17}/><span><strong>Duplicate page</strong><small>Insert a copy after this page.</small></span></button><button className="page-menu-danger" onClick={() => requestDeleteSelected([modal.pageId])}><Trash2 size={17}/><span><strong>Delete page</strong><small>Remove this page from the workspace.</small></span></button></div></Modal>
  );
}
