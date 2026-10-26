import { motion } from 'motion/react';
import {
  ArrowRight,
  ArrowUpRight,
  FileText,
  Files,
  FolderOpen,
  HardDrive,
  LockKeyhole,
  Plus,
  ShieldCheck,
} from 'lucide-react';
import ActionButton from '../components/common/ActionButton.jsx';
import { interactiveSpring, pageVariants, staggerItemVariants, staggerVariants } from '../constants/motion.js';
import { initialTools } from '../constants/tools.js';
import { cx } from '../utils/cx.js';

export default function HomeView({ pages, documents, setMode, setModal, chooseFiles, startTool }) {
  return (
    <motion.section key="home" className="home-view" variants={pageVariants} initial="initial" animate="animate" exit="exit">
              <div className="welcome-row"><div className="welcome-copy"><div className="eyebrow welcome-eyebrow">Workspace overview</div><h1>Manage your PDF documents.</h1><p>Open files to combine, reorder, and convert pages in one workspace. Your documents are processed locally on this device.</p><div className="welcome-actions"><ActionButton icon={Plus} variant="primary" onClick={chooseFiles} hint={<span className="shortcut-hint" aria-hidden="true"><kbd>Ctrl</kbd><kbd>O</kbd></span>}>Open documents</ActionButton><ActionButton icon={FolderOpen} onClick={() => setMode('workspace')}>Go to workspace</ActionButton></div><div className="welcome-details"><span><LockKeyhole size={15} /> Local processing</span><span><FileText size={15} /> PDFs and images</span></div></div></div>

              <motion.div className="home-stats" variants={staggerVariants} initial="hidden" animate="show"><motion.div className="stat-card" variants={staggerItemVariants} whileHover={{ y: -2 }} transition={interactiveSpring}><span className="stat-icon stat-purple"><Files size={17} /></span><div><small>Pages in workspace</small><strong>{pages.length}</strong></div><span className="stat-foot">Current session</span></motion.div><motion.div className="stat-card" variants={staggerItemVariants} whileHover={{ y: -2 }} transition={interactiveSpring}><span className="stat-icon stat-mint"><HardDrive size={17} /></span><div><small>Sources opened</small><strong>{documents.length}</strong></div><span className="stat-foot">Local files</span></motion.div><motion.div className="stat-card" variants={staggerItemVariants} whileHover={{ y: -2 }} transition={interactiveSpring}><span className="stat-icon stat-orange"><ShieldCheck size={17} /></span><div><small>File processing</small><strong className="status-ready">On this device</strong></div><span className="stat-foot"><span className="online-dot" /> No cloud upload</span></motion.div></motion.div>

              <div className="section-heading"><div><h2>Common tasks</h2><p>Choose a tool to get started.</p></div><span className="section-heading-note">{initialTools.length} available tools</span></div>
              <motion.div className="tool-card-grid" variants={staggerVariants} initial="hidden" animate="show">{initialTools.map((tool) => <motion.button key={tool.label} variants={staggerItemVariants} whileHover={{ y: -3, scale: 1.006 }} whileTap={{ scale: 0.99 }} transition={interactiveSpring} className="tool-card" onClick={() => startTool(tool)}><div className={cx('tool-card-icon', `tone-${tool.tone}`)}><tool.icon size={21} strokeWidth={1.8} /></div><div className="tool-card-copy"><strong>{tool.label}</strong><span>{tool.description}</span></div><span className="tool-card-arrow"><ArrowUpRight size={17} /></span></motion.button>)}</motion.div>
              <motion.div className="bottom-callout" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12, duration: 0.22 }}><div className="callout-glyph"><LockKeyhole size={19} /></div><div><strong>Private by design.</strong><span>Your documents are processed locally on your computer. PDF Studio does not upload them to a cloud service.</span></div><ActionButton size="sm" icon={ArrowRight} iconPosition="end" onClick={() => setModal({ type: 'about' })}>Learn more</ActionButton></motion.div>
            </motion.section>
  );
}
