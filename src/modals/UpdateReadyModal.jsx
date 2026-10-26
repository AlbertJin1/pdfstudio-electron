import { Download, PackageCheck, ShieldCheck, LoaderCircle } from 'lucide-react';
import ActionButton from '../components/common/ActionButton.jsx';
import Modal from '../components/common/Modal.jsx';

export default function UpdateReadyModal({ readyUpdate, applyingUpdate, deferReadyUpdate, applyReadyUpdate }) {
  return (
    <Modal title={`PDF Studio ${readyUpdate.version} is ready`} eyebrow="UPDATE READY TO INSTALL" onClose={deferReadyUpdate} footer={<><ActionButton onClick={deferReadyUpdate} disabled={applyingUpdate}>Update later</ActionButton><ActionButton variant="primary" icon={applyingUpdate ? LoaderCircle : Download} onClick={applyReadyUpdate} disabled={applyingUpdate}>{applyingUpdate ? 'Preparing restart…' : 'Update now'}</ActionButton></>}>
            <div className="update-ready-content"><div className="update-ready-icon"><PackageCheck size={25}/></div><div className="update-ready-copy"><strong>A verified update has been downloaded.</strong><p>PDF Studio {readyUpdate.version} is ready. Choose Update now to apply it and restart the application, or Update later to keep working. PDF Studio will offer this update again the next time you open the app.</p></div></div>
            {readyUpdate.notes && <div className="update-ready-notes"><strong>What’s new</strong><p>{readyUpdate.notes}</p></div>}
            <div className="modal-note"><ShieldCheck size={16}/><span>Save any open work before updating. Your local documents and workspace files are not sent with the update.</span></div>
          </Modal>
  );
}
