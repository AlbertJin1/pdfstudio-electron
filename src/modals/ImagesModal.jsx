import { Download, FileImage, HardDrive } from 'lucide-react';
import ActionButton from '../components/common/ActionButton.jsx';
import Modal from '../components/common/Modal.jsx';
import { cx } from '../utils/cx.js';

export default function ImagesModal({ pages, imageFormat, imageQuality, selectedPages, setModal, setImageFormat, setImageQuality, convertToImages }) {
  return (
    <Modal title="Export pages as images" eyebrow="IMAGE EXPORT" onClose={() => setModal(null)} footer={<><ActionButton onClick={() => setModal(null)}>Cancel</ActionButton><ActionButton variant="primary" icon={Download} onClick={convertToImages}>Export {selectedPages.length ? selectedPages.length : pages.length} pages</ActionButton></>}><div className="modal-intro"><div className="modal-hero-icon modal-hero-orange"><FileImage size={22}/></div><div><strong>Make each page a shareable image</strong><p>{selectedPages.length ? 'Only your selected pages will be exported.' : 'No page selection found, so all pages in the workspace will be exported.'}</p></div></div><label className="form-label">Image format<div className="segmented-choice"><button className={cx(imageFormat === 'png' && 'segment-active')} onClick={() => setImageFormat('png')}><span>PNG</span><small>Sharper text</small></button><button className={cx(imageFormat === 'jpeg' && 'segment-active')} onClick={() => setImageFormat('jpeg')}><span>JPEG</span><small>Smaller photos</small></button></div></label>{imageFormat === 'jpeg' && <label className="form-label">JPEG quality <div className="range-row"><input type="range" min="40" max="100" value={imageQuality} onChange={(event) => setImageQuality(event.target.value)}/><strong>{imageQuality}%</strong></div></label>}<div className="modal-note"><HardDrive size={15}/><span>Choose an output folder in the next step. Each page will be rendered at high resolution.</span></div></Modal>
  );
}
