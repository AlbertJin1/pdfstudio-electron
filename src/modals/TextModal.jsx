import { AlignLeft, Type } from 'lucide-react';
import ActionButton from '../components/common/ActionButton.jsx';
import Modal from '../components/common/Modal.jsx';
import Select from '../components/common/Select.jsx';

const SIZE_OPTIONS = [{ value: '12', label: '12 pt — small' }, { value: '18', label: '18 pt — medium' }, { value: '24', label: '24 pt — large' }, { value: '36', label: '36 pt — heading' }];

export default function TextModal({ textValue, textColor, textSize, setModal, setTextValue, setTextColor, setTextSize, addTextOverlay }) {
  return (
    <Modal title="Add text overlay" eyebrow="ANNOTATE PAGE" onClose={() => setModal(null)} footer={<><ActionButton onClick={() => setModal(null)}>Cancel</ActionButton><ActionButton variant="primary" icon={Type} onClick={addTextOverlay}>Apply text</ActionButton></>}><div className="modal-intro"><div className="modal-hero-icon modal-hero-purple"><Type size={22}/></div><div><strong>Add a text overlay to the selected page</strong><p>Text is embedded in the PDF when exported. It is an overlay and does not modify existing PDF text objects.</p></div></div><label className="form-label">Text to add<input className="form-input" value={textValue} onChange={(event) => setTextValue(event.target.value)} placeholder="Type something..." autoFocus /></label><div className="form-two-col"><label className="form-label">Text size<Select className="form-input" value={textSize} onChange={setTextSize} options={SIZE_OPTIONS} ariaLabel="Text size" /></label><label className="form-label">Text color<div className="color-picker-row"><input type="color" value={textColor} onChange={(event) => setTextColor(event.target.value)}/><span>{textColor.toUpperCase()}</span></div></label></div><div className="modal-note"><AlignLeft size={15}/><span>New text appears near the upper-left area of the page. Select multiple pages to apply it to all of them.</span></div></Modal>
  );
}
