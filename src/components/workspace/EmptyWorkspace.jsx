import { motion } from 'motion/react';
import { FilePlus2, Plus, Upload } from 'lucide-react';
import ActionButton from '../common/ActionButton.jsx';

export default function EmptyWorkspace({ chooseFiles }) {
  return (
    <motion.div className="workspace-empty" initial={{ opacity: 0, scale: 0.985 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.22 }}><div className="empty-illustration"><div className="empty-sheet sheet-back"/><div className="empty-sheet sheet-middle"/><div className="empty-sheet sheet-front"><FilePlus2 size={32} /></div><span className="empty-plus"><Plus size={14} /></span></div><h2>Make room for your pages</h2><p>Bring PDFs and images into one workspace, reorder them, then export everything as a single PDF.</p><ActionButton icon={Upload} variant="primary" onClick={chooseFiles}>Choose files</ActionButton><span className="empty-or">or drop files anywhere in this window</span></motion.div>
  );
}
