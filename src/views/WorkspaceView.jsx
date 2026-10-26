import { motion } from 'motion/react';
import { Download, FolderOpen } from 'lucide-react';
import ActionButton from '../components/common/ActionButton.jsx';
import EmptyWorkspace from '../components/workspace/EmptyWorkspace.jsx';
import InspectorPanel from '../components/workspace/InspectorPanel.jsx';
import PageGridPanel from '../components/workspace/PageGridPanel.jsx';
import WorkspaceToolbar from '../components/workspace/WorkspaceToolbar.jsx';
import { pageVariants } from '../constants/motion.js';
import { cx } from '../utils/cx.js';

export default function WorkspaceView({ pages, pagesRef, sourcesRef, selectedIds, activeId, search, showInspector, draggingPageId, dropCue, landedId, previewZoom, suppressPageClickUntil, historyRef, redoRef, activePage, filteredPages, setSelectedIds, setActiveId, setSearch, setModal, setShowInspector, setDraggingPageId, setDropCue, setPreviewZoom, commitPages, undo, redo, chooseFiles, handleBrowserFiles, selectPage, requestDeleteSelected, rotateSelected, duplicateSelected, addBlankPage, movePage }) {
  return (
    <motion.section key="workspace" className="workspace-view" variants={pageVariants} initial="initial" animate="animate" exit="exit">
              <div className="workspace-heading"><div><div className="eyebrow"><span className="eyebrow-dot" /> Page management</div><h1>Page workspace</h1><p>Arrange your pages exactly how you want them. Drag to reorder, select multiple pages, then export a clean PDF.</p></div><div className="workspace-heading-actions"><ActionButton icon={FolderOpen} onClick={chooseFiles}>Add files</ActionButton><ActionButton icon={Download} variant="primary" disabled={!pages.length} onClick={() => setModal({ type: 'export' })}>Export PDF</ActionButton></div></div>
    {pages.length === 0 ? <EmptyWorkspace chooseFiles={chooseFiles} /> : <>
    <WorkspaceToolbar pages={pages} selectedIds={selectedIds} showInspector={showInspector} historyRef={historyRef} redoRef={redoRef} activePage={activePage} setModal={setModal} setShowInspector={setShowInspector} undo={undo} redo={redo} requestDeleteSelected={requestDeleteSelected} rotateSelected={rotateSelected} duplicateSelected={duplicateSelected} addBlankPage={addBlankPage} />
                <div className={cx('workspace-content', !showInspector && 'inspector-hidden')}>
    <PageGridPanel pages={pages} pagesRef={pagesRef} selectedIds={selectedIds} activeId={activeId} search={search} draggingPageId={draggingPageId} dropCue={dropCue} landedId={landedId} suppressPageClickUntil={suppressPageClickUntil} filteredPages={filteredPages} setSelectedIds={setSelectedIds} setActiveId={setActiveId} setSearch={setSearch} setModal={setModal} setDraggingPageId={setDraggingPageId} setDropCue={setDropCue} commitPages={commitPages} chooseFiles={chooseFiles} handleBrowserFiles={handleBrowserFiles} selectPage={selectPage} rotateSelected={rotateSelected} duplicateSelected={duplicateSelected} requestDeleteSelected={requestDeleteSelected} movePage={movePage} />
    {showInspector && <InspectorPanel pages={pages} sourcesRef={sourcesRef} previewZoom={previewZoom} activePage={activePage} setSelectedIds={setSelectedIds} setModal={setModal} setShowInspector={setShowInspector} setPreviewZoom={setPreviewZoom} rotateSelected={rotateSelected} />}
    </div>
    </>}
    </motion.section>
  );
}
