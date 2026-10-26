import { motion } from 'motion/react';
import { FileText, PanelRightOpen, RotateCcw, ZoomIn, ZoomOut, Scissors } from 'lucide-react';
import ActionButton from '../common/ActionButton.jsx';
import IconButton from '../common/IconButton.jsx';
import SectionLabel from '../common/SectionLabel.jsx';
import PagePreview from './PagePreview.jsx';

export default function InspectorPanel({ pages, sourcesRef, previewZoom, activePage, setSelectedIds, setModal, setShowInspector, setPreviewZoom, rotateSelected }) {
  return (
    <motion.aside className="inspector-panel" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 12 }} transition={{ duration: 0.2 }}><div className="inspector-head"><div><div className="eyebrow">Live preview</div><h3>Page details</h3></div><IconButton icon={PanelRightOpen} label="Hide preview" onClick={() => setShowInspector(false)} /></div>
                    {activePage ? <><div className="inspector-page-meta"><div className="inspector-doc-icon"><FileText size={17} /></div><div className="inspector-doc-copy"><strong>Page {pages.findIndex((page) => page.id === activePage.id) + 1}</strong><span title={activePage.sourceName}>{activePage.sourceName}</span></div><span className="inspector-page-count">{pages.findIndex((page) => page.id === activePage.id) + 1} / {pages.length}</span></div>
                    <div className="inspector-preview-wrap"><PagePreview page={activePage} sources={sourcesRef.current} zoom={previewZoom} onAddText={() => setModal({ type: 'text' })} onAddBlock={() => setModal({ type: 'cover' })} /></div>
                    <div className="preview-zoom-row"><span><ZoomIn size={14} /> Preview scale</span><div><button onClick={() => setPreviewZoom((value) => Math.max(0.6, +(value - 0.1).toFixed(1)))} disabled={previewZoom <= 0.6}><ZoomOut size={13}/></button><span>{Math.round(previewZoom * 100)}%</span><button onClick={() => setPreviewZoom((value) => Math.min(1.4, +(value + 0.1).toFixed(1)))} disabled={previewZoom >= 1.4}><ZoomIn size={13}/></button></div></div>
                    <div className="inspector-properties"><SectionLabel>Page properties</SectionLabel><div className="property-row"><span>Position in document</span><strong>{String(pages.findIndex((page) => page.id === activePage.id) + 1).padStart(2, '0')} <span className="property-total">/ {pages.length}</span></strong></div><div className="property-row"><span>Source type</span><strong>{activePage.kind === 'pdf' ? 'PDF document' : activePage.kind === 'image' ? 'Image file' : 'Blank page'}</strong></div><div className="property-row"><span>Orientation</span><strong>{activePage.rotation % 180 === 0 ? 'Portrait' : 'Landscape'}</strong></div><div className="property-row"><span>Overlay objects</span><strong>{activePage.overlays?.length || 0}</strong></div></div>
                    <div className="inspector-actions"><ActionButton icon={RotateCcw} onClick={() => { setSelectedIds([activePage.id]); rotateSelected(-90); }}>Rotate left</ActionButton><ActionButton icon={Scissors} onClick={() => { setSelectedIds([activePage.id]); setModal({ type: 'export-selected' }); }}>Export page</ActionButton></div></> : <div className="inspector-empty"><FileText size={30}/><p>Select a page to preview it here.</p></div>}
                  </motion.aside>
  );
}
