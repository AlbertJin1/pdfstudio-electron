import { motion } from 'motion/react';
import {
  ArrowRight,
  FileImage,
  FileText,
  FolderOpen,
  ImagePlus,
  ShieldCheck,
  Sparkles,
  Split,
} from 'lucide-react';
import ActionButton from '../components/common/ActionButton.jsx';
import { interactiveSpring, pageVariants, staggerItemVariants, staggerVariants } from '../constants/motion.js';

export default function ConvertView({ pages, setModal, chooseFiles }) {
  return (
    <motion.section key="convert" className="conversion-view" variants={pageVariants} initial="initial" animate="animate" exit="exit"><div className="workspace-heading"><div><div className="eyebrow"><Sparkles size={13} /> Conversion studio</div><h1>Make your files work harder.</h1><p>Convert your current workspace or open a file to get started. Conversion runs locally on your device.</p></div><ActionButton icon={FolderOpen} onClick={chooseFiles}>Add files</ActionButton></div><motion.div className="conversion-grid" variants={staggerVariants} initial="hidden" animate="show">
              <motion.button variants={staggerItemVariants} whileHover={{ y: -3 }} whileTap={{ scale: 0.99 }} transition={interactiveSpring} className="conversion-card" onClick={() => pages.length ? setModal({ type: 'word' }) : chooseFiles()}><div className="conversion-card-art art-word"><FileText size={38}/><span>W</span></div><div className="conversion-card-body"><span className="conversion-tag">Editable text</span><h3>PDF to Word</h3><p>Extract selectable text into a DOCX document with page breaks. Complex layouts may need a little cleanup.</p><div className="conversion-card-action">Convert to .docx <ArrowRight size={15}/></div></div></motion.button>
              <motion.button variants={staggerItemVariants} whileHover={{ y: -3 }} whileTap={{ scale: 0.99 }} transition={interactiveSpring} className="conversion-card" onClick={() => pages.length ? setModal({ type: 'images' }) : chooseFiles()}><div className="conversion-card-art art-image"><FileImage size={38}/><span>PNG</span></div><div className="conversion-card-body"><span className="conversion-tag">High-quality output</span><h3>PDF to images</h3><p>Render each current page to PNG or JPG. Great for sharing a page or preparing a visual preview.</p><div className="conversion-card-action">Export images <ArrowRight size={15}/></div></div></motion.button>
              <motion.button variants={staggerItemVariants} whileHover={{ y: -3 }} whileTap={{ scale: 0.99 }} transition={interactiveSpring} className="conversion-card" onClick={chooseFiles}><div className="conversion-card-art art-doc"><ImagePlus size={38}/><span>JPG</span></div><div className="conversion-card-body"><span className="conversion-tag">Image workflow</span><h3>Images to PDF</h3><p>Open PNG, JPG, WEBP, BMP or GIF files. Image pages join the same sortable workspace.</p><div className="conversion-card-action">Choose images <ArrowRight size={15}/></div></div></motion.button>
              <motion.button variants={staggerItemVariants} whileHover={{ y: -3 }} whileTap={{ scale: 0.99 }} transition={interactiveSpring} className="conversion-card" onClick={() => pages.length ? setModal({ type: 'split' }) : chooseFiles()}><div className="conversion-card-art art-split"><Split size={38}/><span>01 / 02</span></div><div className="conversion-card-body"><span className="conversion-tag">Page control</span><h3>Split PDF</h3><p>Split the current workspace into individual pages, fixed page groups, or custom page ranges.</p><div className="conversion-card-action">Configure split <ArrowRight size={15}/></div></div></motion.button>
            </motion.div><div className="conversion-footnote"><ShieldCheck size={17}/><span><strong>Local-first processing.</strong> Files are opened and transformed on this computer. No cloud upload or account is required.</span></div></motion.section>
  );
}
