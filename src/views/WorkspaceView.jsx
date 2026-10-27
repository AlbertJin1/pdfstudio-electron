import { motion } from 'motion/react';
import { Download, FolderOpen } from 'lucide-react';
import ActionButton from '../components/common/ActionButton.jsx';
import EmptyWorkspace from '../components/workspace/EmptyWorkspace.jsx';
import PageGridPanel from '../components/workspace/PageGridPanel.jsx';
import WorkspaceToolbar from '../components/workspace/WorkspaceToolbar.jsx';
import { pageVariants } from '../constants/motion.js';

export default function WorkspaceView({ pages, pagesRef, selectedIds, activeId, search, draggingPageId, dropCue, landedId, suppressPageClickUntil, historyRef, redoRef, activePage, filteredPages, setSelectedIds, setActiveId, setSearch, setModal, setDraggingPageId, setDropCue, commitPages, undo, redo, chooseFiles, handleBrowserFiles, selectPage, requestDeleteSelected, rotateSelected, duplicateSelected, addBlankPage, movePage }) {
  return (
    <motion.section key="workspace" className="workspace-view" variants={pageVariants} initial="initial" animate="animate" exit="exit">
              <div className="workspace-heading"><div><div className="eyebrow"><span className="eyebrow-dot" /> Page management</div><h1>Page workspace</h1><p>Arrange your pages exactly how you want them. Drag to reorder, select multiple pages, then export a clean PDF.</p></div><div className="workspace-heading-actions"><ActionButton icon={FolderOpen} onClick={chooseFiles}>Add files</ActionButton><ActionButton icon={Download} variant="primary" disabled={!pages.length} onClick={() => setModal({ type: 'export' })}>Merge & export PDF</ActionButton></div></div>
    {pages.length === 0 ? <EmptyWorkspace chooseFiles={chooseFiles} /> : <>
    <WorkspaceToolbar pages={pages} selectedIds={selectedIds} historyRef={historyRef} redoRef={redoRef} activePage={activePage} undo={undo} redo={redo} requestDeleteSelected={requestDeleteSelected} rotateSelected={rotateSelected} duplicateSelected={duplicateSelected} addBlankPage={addBlankPage} />
                <div className="workspace-content">
    <PageGridPanel pages={pages} pagesRef={pagesRef} selectedIds={selectedIds} activeId={activeId} search={search} draggingPageId={draggingPageId} dropCue={dropCue} landedId={landedId} suppressPageClickUntil={suppressPageClickUntil} filteredPages={filteredPages} setSelectedIds={setSelectedIds} setActiveId={setActiveId} setSearch={setSearch} setModal={setModal} setDraggingPageId={setDraggingPageId} setDropCue={setDropCue} commitPages={commitPages} chooseFiles={chooseFiles} handleBrowserFiles={handleBrowserFiles} selectPage={selectPage} rotateSelected={rotateSelected} duplicateSelected={duplicateSelected} requestDeleteSelected={requestDeleteSelected} movePage={movePage} />
    </div>
    </>}
    </motion.section>
  );
}
