import { motion } from 'motion/react';
import {
  ArrowRight,
  FileImage,
  FileText,
  FolderOpen,
  ImageDown,
  ImagePlus,
  ScanSearch,
  FileArchive,
  ShieldCheck,
  Sparkles,
  Target,
  Split,
} from 'lucide-react';
import ActionButton from '../components/common/ActionButton.jsx';
import { interactiveSpring, pageVariants, staggerItemVariants, staggerVariants } from '../constants/motion.js';

export default function ConvertView({ pages, setModal, chooseFiles, startWord }) {
  return (
    <motion.section key="convert" className="conversion-view" variants={pageVariants} initial="initial" animate="animate" exit="exit"><div className="workspace-heading"><div><div className="eyebrow"><Sparkles size={13} /> Conversion studio</div><h1>Make your files work harder.</h1><p>Convert your current workspace or open a file to get started. Conversion runs locally on your device.</p></div><ActionButton icon={FolderOpen} onClick={chooseFiles}>Add files</ActionButton></div><motion.div className="conversion-grid" variants={staggerVariants} initial="hidden" animate="show">
              <motion.button variants={staggerItemVariants} whileHover={{ y: -3 }} whileTap={{ scale: 0.99 }} transition={interactiveSpring} className="conversion-card" onClick={() => startWord()}><div className="conversion-card-art art-word"><FileText size={38}/><span>W</span></div><div className="conversion-card-body"><span className="conversion-tag">Adaptive Word conversion</span><h3>PDF to Word</h3><p>Analyze every page first, preserve complex layouts, and keep recognized text editable. Choose reflowable editing or visual replica when appropriate.</p><div className="conversion-card-action">Convert to .docx <ArrowRight size={15}/></div></div></motion.button>
              <motion.button variants={staggerItemVariants} whileHover={{ y: -3 }} whileTap={{ scale: 0.99 }} transition={interactiveSpring} className="conversion-card" onClick={() => setModal({ type: 'compress' })}><div className="conversion-card-art art-compress"><FileArchive size={38}/><span>PDF</span></div><div className="conversion-card-body"><span className="conversion-tag">Size optimizer</span><h3>Compress PDF</h3><p>Analyze image and stream resources, optimize images and duplicate resources, preserve vector text, preview quality, validate structure, and target a size in MB or %.</p><div className="conversion-card-action">Set compression <Target size={15}/><ArrowRight size={15}/></div></div></motion.button>
              <motion.button variants={staggerItemVariants} whileHover={{ y: -3 }} whileTap={{ scale: 0.99 }} transition={interactiveSpring} className="conversion-card" onClick={() => setModal({ type: 'images' })}><div className="conversion-card-art art-image"><FileImage size={38}/><span>PNG</span></div><div className="conversion-card-body"><span className="conversion-tag">High-quality output</span><h3>PDF to images</h3><p>Render each current page to PNG or JPG. Great for sharing a page or preparing a visual preview.</p><div className="conversion-card-action">Export images <ArrowRight size={15}/></div></div></motion.button>
              <motion.button variants={staggerItemVariants} whileHover={{ y: -3 }} whileTap={{ scale: 0.99 }} transition={interactiveSpring} className="conversion-card" onClick={() => chooseFiles('images')}><div className="conversion-card-art art-doc"><ImagePlus size={38}/><span>JPG</span></div><div className="conversion-card-body"><span className="conversion-tag">Image workflow</span><h3>Images to PDF</h3><p>Open PNG, JPG, WEBP, BMP or GIF files. Image pages join the same sortable workspace.</p><div className="conversion-card-action">Choose images <ArrowRight size={15}/></div></div></motion.button>
              <motion.button variants={staggerItemVariants} whileHover={{ y: -3 }} whileTap={{ scale: 0.99 }} transition={interactiveSpring} className="conversion-card" onClick={() => setModal({ type: 'split' })}><div className="conversion-card-art art-split"><Split size={38}/><span>01 / 02</span></div><div className="conversion-card-body"><span className="conversion-tag">Page control</span><h3>Split PDF</h3><p>Split a PDF into individual pages, fixed page groups, or custom page ranges. Pick or drop any PDF, or use your workspace.</p><div className="conversion-card-action">Configure split <ArrowRight size={15}/></div></div></motion.button>
              <motion.button variants={staggerItemVariants} whileHover={{ y: -3 }} whileTap={{ scale: 0.99 }} transition={interactiveSpring} className="conversion-card" onClick={() => setModal({ type: 'imageConvert' })}><div className="conversion-card-art art-doc"><ImageDown size={38}/><span>HEIC · WebP</span></div><div className="conversion-card-body"><span className="conversion-tag">Image converter</span><h3>Format converter</h3><p>Convert HEIC, WebP, PNG, JPG, AVIF, TIFF and more in batches. Squeeze files under a size limit, and see and remove hidden GPS location and camera data.</p><div className="conversion-card-action">Convert images <ArrowRight size={15}/></div></div></motion.button>
              <motion.button variants={staggerItemVariants} whileHover={{ y: -3 }} whileTap={{ scale: 0.99 }} transition={interactiveSpring} className="conversion-card" onClick={() => setModal({ type: 'imageText' })}><div className="conversion-card-art art-word"><ScanSearch size={38}/><span>OCR</span></div><div className="conversion-card-body"><span className="conversion-tag">Offline text recognition</span><h3>Image to text</h3><p>Extract text from photos, screenshots and scans, including emoji, then copy it or save it as a .txt file.</p><div className="conversion-card-action">Extract text <ArrowRight size={15}/></div></div></motion.button>
            </motion.div><div className="conversion-footnote"><ShieldCheck size={17}/><span><strong>Local-first processing.</strong> Files are opened and transformed on this computer. No cloud upload or account is required.</span></div></motion.section>
  );
}
