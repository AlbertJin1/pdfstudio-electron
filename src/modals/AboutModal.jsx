import { BookOpen, Layers3, ShieldCheck, FileOutput, MonitorDown, Star, Code2, Sparkles } from 'lucide-react';
import ActionButton from '../components/common/ActionButton.jsx';
import Modal from '../components/common/Modal.jsx';

export default function AboutModal({ appVersion, setMode, setSettingsTab, setModal }) {
  return (
    <Modal title="About PDF Studio" wide onClose={() => setModal(null)} footer={<><ActionButton icon={Star} onClick={() => setModal({ type: 'review' })}>Review PDF Studio</ActionButton><ActionButton icon={MonitorDown} className="footer-lead" onClick={() => { setModal(null); setMode('settings'); setSettingsTab('updates'); }}>Updates &amp; downloads</ActionButton><ActionButton variant="primary" onClick={() => setModal(null)}>Done</ActionButton></>}>
      <div className="about-hero">
        <div className="about-brand-icon"><img src="./icons/pdf-studio.png" alt="PDF Studio app icon" draggable="false" /></div>
        <div className="about-hero-copy">
          <div className="about-product-line"><h3>PDF Studio</h3><span className="about-version-pill">Version {appVersion}</span></div>
          <p>Everyday PDF tools, in one straightforward workspace.</p>
          <div className="about-platform-line"><BookOpen size={14} aria-hidden="true"/><span>Document workspace</span><span className="about-meta-dot" aria-hidden="true"/><span>On-device processing</span></div>
        </div>
      </div>
      <p className="about-copy">PDF Studio helps you bring documents and images together, organize pages, and create the files you need. Open your files, arrange or adjust pages, then export a finished PDF or convert pages into other useful formats. Your working documents are processed on this computer instead of being uploaded to a cloud service.</p>
      <div className="about-feature-grid">
        <div className="about-feature"><span className="about-feature-icon about-feature-purple"><Layers3 size={18} aria-hidden="true"/></span><div><strong>Organize pages</strong><p>Combine sources, reorder pages, rotate or duplicate pages, and export the selection you need.</p></div></div>
        <div className="about-feature"><span className="about-feature-icon about-feature-blue"><FileOutput size={18} aria-hidden="true"/></span><div><strong>Convert &amp; export</strong><p>Split documents, export pages as images, or create an editable Word document from selectable text.</p></div></div>
        <div className="about-feature"><span className="about-feature-icon about-feature-green"><ShieldCheck size={18} aria-hidden="true"/></span><div><strong>Work privately</strong><p>Your opened files are handled locally during the current workspace session. Nothing is uploaded for processing.</p></div></div>
      </div>
      <div className="developer-signature-card" role="group" aria-label="Developer: Jessie Albert Regualos, IT Specialist - WVM">
        <div className="developer-monogram" aria-hidden="true"><span>JAR</span><i>✦</i></div>
        <div className="developer-copy">
          <span className="developer-eyebrow">Created by</span>
          <strong className="developer-name"><span>Jessie</span> Albert <em>Regualos</em></strong>
          <p className="developer-role"><Code2 size={13} strokeWidth={2.1} aria-hidden="true"/><span>IT Specialist - WVM</span><Sparkles className="developer-role-spark" size={12} aria-hidden="true"/></p>
        </div>
        <div className="developer-signature-mark" aria-hidden="true">JAR<span> / </span>PDF STUDIO</div>
      </div>
      <div className="about-branding-strip" role="group" aria-label="ITRS and RSC logos">
        <div className="about-branding-logo about-itrs-logo" role="img" aria-label="ITRS">
          <img className="itrs-logo-light" src="./branding/itrs-dark.png" alt="ITRS" draggable="false" />
          <img className="itrs-logo-dark" src="./branding/itrs-white.png" alt="ITRS" draggable="false" />
        </div>
        <div className="about-branding-divider" aria-hidden="true" />
        <div className="about-branding-logo about-rsc-logo" role="img" aria-label="Robinsons Supermarket, Robinsons Easymart, and Shopwise">
          <img className="rsc-logo-light" src="./branding/rsc-logo.png" alt="Robinsons Supermarket, Robinsons Easymart, and Shopwise" draggable="false" />
          <img className="rsc-logo-dark" src="./branding/rsc-logo-dark.png" alt="Robinsons Supermarket, Robinsons Easymart, and Shopwise" draggable="false" />
        </div>
      </div>
      <div className="about-footnote"><BookOpen size={15} aria-hidden="true"/><span>PDF Studio {appVersion} · Your preferences are saved on this computer.</span></div>
    </Modal>
  );
}
