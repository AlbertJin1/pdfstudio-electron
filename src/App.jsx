import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import AccessLockScreen from './components/access/AccessLockScreen.jsx';
import LoadingOverlay from './components/layout/LoadingOverlay.jsx';
import Sidebar from './components/layout/Sidebar.jsx';
import TitleBar from './components/layout/TitleBar.jsx';
import Toast from './components/layout/Toast.jsx';
import Topbar from './components/layout/Topbar.jsx';
import { useAccessControl } from './hooks/useAccessControl.js';
import { useDesktopShell } from './hooks/useDesktopShell.js';
import { useExporters } from './hooks/useExporters.js';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts.js';
import { useLoadingState } from './hooks/useLoadingState.js';
import { useOverlays } from './hooks/useOverlays.js';
import { usePreferences } from './hooks/usePreferences.js';
import { useToast } from './hooks/useToast.js';
import { useWorkspace } from './hooks/useWorkspace.js';
import ModalHost from './modals/ModalHost.jsx';
import { cx } from './utils/cx.js';
import ConvertView from './views/ConvertView.jsx';
import EditPdfView from './views/EditPdfView.jsx';
import HistoryView from './views/HistoryView.jsx';
import HomeView from './views/HomeView.jsx';
import WorkspaceView from './views/WorkspaceView.jsx';
import SettingsView from './views/settings/SettingsView.jsx';

function App() {
  const [mode, setModeRaw] = useState('home');
  const openEditorRef = useRef(null);
  // Edit PDF opens in its own window when running in the desktop app.
  const setMode = useCallback((next) => {
    if (next === 'edit' && window.pdfStudio?.openEditor) { openEditorRef.current?.(); return; }
    setModeRaw(next);
  }, []);
  const [modal, setModal] = useState(null);
  const [settingsTab, setSettingsTab] = useState('appearance');
  const [guideStep, setGuideStep] = useState(0);
  const [previewZoom, setPreviewZoom] = useState(1);
  const fileInputRef = useRef(null);

  const {
    toast,
    setToast,
    notify,
  } = useToast();

  const {
    isLoading,
    setIsLoading,
    loadingLabel,
    setLoadingLabel,
  } = useLoadingState();

  const {
    preferences,
    setPreference,
    dark,
    setDark,
    imageFormat,
    setImageFormat,
    imageQuality,
    setImageQuality,
    showInspector,
    setShowInspector,
    restoreDefaultPreferences,
  } = usePreferences();

  const {
    access,
    accessChecking,
    accessNotice,
    accessLockedRef,
    recheckAccess,
    quitFromLock,
  } = useAccessControl({ setModal, setToast });

  const {
    fullScreen,
    maximized,
    appVersion,
    updateState,
    readyUpdate,
    applyingUpdate,
    checkForUpdates,
    deferReadyUpdate,
    applyReadyUpdate,
  } = useDesktopShell({ setModal, notify });

  const {
    pages,
    pagesRef,
    sourcesRef,
    documents,
    selectedIds,
    setSelectedIds,
    activeId,
    setActiveId,
    search,
    setSearch,
    draggingPageId,
    setDraggingPageId,
    dropCue,
    setDropCue,
    landedId,
    suppressPageClickUntil,
    historyRef,
    redoRef,
    commitPages,
    undo,
    redo,
    activePage,
    selectedPages,
    currentDocument,
    filteredPages,
    chooseFiles,
    handleBrowserFiles,
    selectPage,
    deleteSelected,
    requestDeleteSelected,
    rotateSelected,
    duplicateSelected,
    addBlankPage,
    movePage,
    removeDocument,
    handleDropFiles,
  } = useWorkspace({ notify, setMode, setIsLoading, setLoadingLabel, setModal, confirmDelete: preferences.confirmDelete, accessLockedRef, fileInputRef });

  const {
    textValue,
    setTextValue,
    textColor,
    setTextColor,
    textSize,
    setTextSize,
    coverColor,
    setCoverColor,
    addTextOverlay,
    addCoverOverlay,
  } = useOverlays({ activePage, selectedIds, commitPages, setModal, notify });

  const {
    exportTitle,
    setExportTitle,
    exportAuthor,
    setExportAuthor,
    exportPageNumbers,
    setExportPageNumbers,
    exportWatermark,
    setExportWatermark,
    splitMode,
    setSplitMode,
    splitEvery,
    setSplitEvery,
    splitRanges,
    setSplitRanges,
    doExportPdf,
    convertToWord,
    convertToImages,
    splitPdf,
  } = useExporters({ pages, selectedPages, documents, sourcesRef, notify, setModal, setIsLoading, setLoadingLabel, imageFormat, imageQuality });

  useKeyboardShortcuts({ accessLockedRef, mode, modal, setModal, chooseFiles, setMode, pagesRef, redo, undo, selectedIds, activeId, search, setSearch, filteredPages, requestDeleteSelected, rotateSelected, duplicateSelected, addBlankPage, commitPages, activePage, setActiveId, setSelectedIds });

  const setHideGuide = useCallback((value) => setPreference('hideGuide', Boolean(value)), [setPreference]);
  const guideAutoShown = useRef(false);
  useEffect(() => {
    if (guideAutoShown.current) return undefined;
    guideAutoShown.current = true;
    if (preferences.hideGuide) return undefined;
    const timer = setTimeout(() => {
      if (accessLockedRef.current) return;
      setModal((current) => current || { type: 'guide' });
    }, 900);
    return () => clearTimeout(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const resetPreferences = useCallback(() => {
    restoreDefaultPreferences();
    setSettingsTab('appearance');
    notify('Settings restored to their defaults.', 'success');
  }, [notify, restoreDefaultPreferences]);

  const startTool = (tool) => {
  if (tool.action === 'word') { if (!pages.length) chooseFiles(); else setModal({ type: 'word' }); }
  else if (tool.action === 'images') { if (!pages.length) chooseFiles(); else setModal({ type: 'images' }); }
  else { setMode(tool.mode || 'workspace'); if (!pages.length && tool.mode !== 'edit') chooseFiles(); }
  };

  openEditorRef.current = async () => {
    const source = currentDocument?.kind === 'pdf' ? sourcesRef.current?.get(currentDocument.id) : null;
    try { await window.pdfStudio.openEditor(source?.bytes ? { name: source.name, bytes: source.bytes } : null); }
    catch (error) { notify(error?.message || 'Could not open the Edit PDF window.', 'error'); }
  };

  return (
    <MotionConfig reducedMotion={preferences.reduceMotion ? 'always' : 'user'} transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}>
    <motion.div data-accent={preferences.accentTheme || 'violet'} className={cx('app-shell', 'platform-win32', fullScreen && 'is-fullscreen', maximized && 'is-maximized', dark && 'theme-dark', preferences.fontScale === 'large' && 'font-scale-large', preferences.fontScale === 'xlarge' && 'font-scale-xlarge', preferences.density === 'compact' && 'density-compact', preferences.highContrast && 'high-contrast', preferences.reduceMotion && 'reduce-motion')} onDragOver={(event) => event.preventDefault()} onDrop={handleDropFiles} inert={access.locked ? true : undefined} aria-hidden={access.locked ? true : undefined} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: preferences.reduceMotion ? 0 : 0.24 }}>
    <input ref={fileInputRef} type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.webp,.bmp,.gif,.tif,.tiff,.docx" className="hidden-input" onChange={(event) => { if (event.target.files?.length) handleBrowserFiles(event.target.files); event.target.value = ''; }} />
    <TitleBar mode={mode} maximized={maximized} setMode={setMode} />
    <motion.div className="app-body" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.22, delay: 0.07 }}>
    <Sidebar pages={pages} documents={documents} mode={mode} appVersion={appVersion} currentDocument={currentDocument} setSelectedIds={setSelectedIds} setActiveId={setActiveId} setMode={setMode} setModal={setModal} chooseFiles={chooseFiles} removeDocument={removeDocument} />
    <motion.main className="main-panel" initial={{ opacity: 0, x: 5 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.24, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}>
    <Topbar mode={mode} dark={dark} activePage={activePage} setMode={setMode} setDark={setDark} setModal={setModal} />
    {!window.pdfStudio?.openEditor && <div className="persistent-edit-pdf" style={{ display: mode === 'edit' ? 'flex' : 'none' }}><EditPdfView active={mode === 'edit'} documents={documents} sourcesRef={sourcesRef} initialDocument={currentDocument} notify={notify} /></div>}
    <AnimatePresence mode="wait" initial={false}>
    {mode === 'home' && <HomeView key="home" pages={pages} documents={documents} setMode={setMode} setModal={setModal} chooseFiles={chooseFiles} startTool={startTool} />}
    {mode === 'workspace' && <WorkspaceView key="workspace" pages={pages} pagesRef={pagesRef} sourcesRef={sourcesRef} selectedIds={selectedIds} activeId={activeId} search={search} showInspector={showInspector} draggingPageId={draggingPageId} landedId={landedId} dropCue={dropCue} previewZoom={previewZoom} suppressPageClickUntil={suppressPageClickUntil} historyRef={historyRef} redoRef={redoRef} activePage={activePage} filteredPages={filteredPages} setSelectedIds={setSelectedIds} setActiveId={setActiveId} setSearch={setSearch} setModal={setModal} setShowInspector={setShowInspector} setDraggingPageId={setDraggingPageId} setDropCue={setDropCue} setPreviewZoom={setPreviewZoom} commitPages={commitPages} undo={undo} redo={redo} chooseFiles={chooseFiles} handleBrowserFiles={handleBrowserFiles} selectPage={selectPage} requestDeleteSelected={requestDeleteSelected} rotateSelected={rotateSelected} duplicateSelected={duplicateSelected} addBlankPage={addBlankPage} movePage={movePage} duplicateSelected={duplicateSelected} requestDeleteSelected={requestDeleteSelected} />}
    {mode === 'convert' && <ConvertView key="convert" pages={pages} setModal={setModal} chooseFiles={chooseFiles} />}
    {mode === 'history' && <HistoryView key="history" pages={pages} documents={documents} setSelectedIds={setSelectedIds} setActiveId={setActiveId} setMode={setMode} chooseFiles={chooseFiles} />}
    {mode === 'settings' && <SettingsView key="settings" mode={mode} preferences={preferences} settingsTab={settingsTab} dark={dark} updateState={updateState} readyUpdate={readyUpdate} imageFormat={imageFormat} imageQuality={imageQuality} showInspector={showInspector} appVersion={appVersion} setSettingsTab={setSettingsTab} setDark={setDark} setModal={setModal} setImageFormat={setImageFormat} setImageQuality={setImageQuality} setShowInspector={setShowInspector} setPreference={setPreference} resetPreferences={resetPreferences} checkForUpdates={checkForUpdates} />}
    </AnimatePresence>
    </motion.main>
    </motion.div>
    <LoadingOverlay isLoading={isLoading} loadingLabel={loadingLabel} />
    <Toast toast={toast} setToast={setToast} />
    <ModalHost hideGuide={preferences.hideGuide} setHideGuide={setHideGuide} pages={pages} mode={mode} guideStep={guideStep} setGuideStep={setGuideStep} chooseFiles={chooseFiles} readyUpdate={readyUpdate} applyingUpdate={applyingUpdate} modal={modal} textValue={textValue} textColor={textColor} textSize={textSize} coverColor={coverColor} exportTitle={exportTitle} exportAuthor={exportAuthor} exportPageNumbers={exportPageNumbers} exportWatermark={exportWatermark} splitMode={splitMode} splitEvery={splitEvery} splitRanges={splitRanges} imageFormat={imageFormat} imageQuality={imageQuality} appVersion={appVersion} selectedPages={selectedPages} setSelectedIds={setSelectedIds} setActiveId={setActiveId} setMode={setMode} setSettingsTab={setSettingsTab} setModal={setModal} setTextValue={setTextValue} setTextColor={setTextColor} setTextSize={setTextSize} setCoverColor={setCoverColor} setExportTitle={setExportTitle} setExportAuthor={setExportAuthor} setExportPageNumbers={setExportPageNumbers} setExportWatermark={setExportWatermark} setSplitMode={setSplitMode} setSplitEvery={setSplitEvery} setSplitRanges={setSplitRanges} setImageFormat={setImageFormat} setImageQuality={setImageQuality} deleteSelected={deleteSelected} requestDeleteSelected={requestDeleteSelected} rotateSelected={rotateSelected} duplicateSelected={duplicateSelected} addTextOverlay={addTextOverlay} addCoverOverlay={addCoverOverlay} doExportPdf={doExportPdf} convertToWord={convertToWord} convertToImages={convertToImages} splitPdf={splitPdf} deferReadyUpdate={deferReadyUpdate} applyReadyUpdate={applyReadyUpdate} />
    </motion.div>
    <AnimatePresence>{access.locked && <AccessLockScreen key="access-lock" access={access} checking={accessChecking} notice={accessNotice} dark={dark} onRecheck={recheckAccess} onQuit={quitFromLock} />}</AnimatePresence>
    </MotionConfig>
  );
}

export default App;
