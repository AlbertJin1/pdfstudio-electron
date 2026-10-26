import { motion } from 'motion/react';
import { ArrowRight, Clock3, FileImage, FileText, FolderOpen } from 'lucide-react';
import ActionButton from '../components/common/ActionButton.jsx';
import { pageVariants } from '../constants/motion.js';
import { cx } from '../utils/cx.js';
import { extName, formatBytes } from '../utils/format.js';

export default function HistoryView({ pages, documents, setSelectedIds, setActiveId, setMode, chooseFiles }) {
  return (
    <motion.section key="history" className="history-view" variants={pageVariants} initial="initial" animate="animate" exit="exit"><div className="workspace-heading"><div><div className="eyebrow">Your local session</div><h1>Recent sources</h1><p>Files currently loaded into this workspace.</p></div><ActionButton icon={FolderOpen} onClick={chooseFiles}>Add files</ActionButton></div>{documents.length ? <div className="history-table"><div className="history-table-head"><span>DOCUMENT</span><span>TYPE</span><span>SIZE</span><span>PAGES</span><span /></div>{documents.map((document, index) => <motion.div className="history-table-row" key={document.id} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18, delay: Math.min(index * 0.035, 0.2) }}><div className="history-file"><div className={cx('file-type-mini', document.kind === 'pdf' ? 'file-pdf' : 'file-image')}>{document.kind === 'pdf' ? <FileText size={15}/> : <FileImage size={15}/>}</div><div><strong>{document.name}</strong><small>{document.path || 'Added to current session'}</small></div></div><span>{extName(document.name)}</span><span>{formatBytes(document.size)}</span><span>{document.pageCount}</span><ActionButton icon={ArrowRight} onClick={() => { const p = pages.find((page) => page.sourceId === document.id); if (p) { setActiveId(p.id); setSelectedIds([p.id]); setMode('workspace'); } }}>Open</ActionButton></motion.div>)}</div> : <motion.div className="history-empty" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}><Clock3 size={30}/><h3>No sources yet</h3><p>Files that you open in PDF Studio will appear here for this session.</p><ActionButton icon={FolderOpen} variant="primary" onClick={chooseFiles}>Open files</ActionButton></motion.div>}</motion.section>
  );
}
