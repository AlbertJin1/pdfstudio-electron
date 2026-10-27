import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
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
import HomeView from './views/HomeView.jsx';
import WorkspaceView from './views/WorkspaceView.jsx';

// Rarely-used screens are split out so the first paint only pays for Home and the page workspace.
const ConvertView = lazy(() => import('./views/ConvertView.jsx'));
const EditPdfView = lazy(() => import('./views/EditPdfView.jsx'));
const HistoryView = lazy(() => import('./views/HistoryView.jsx'));
const SettingsView = lazy(() => import('./views/settings/SettingsView.jsx'));

function App() {
  const [mode, setModeRaw] = useState('home');
  const [editorTabOpen, setEditorTabOpen] = useState(false);
  const [editorDirty, setEditorDirty] = useState(false);
  const [editorTabTitle, setEditorTabTitle] = useState('Edit PDF');
  const previousModeRef = useRef('home');
  // Edit PDF is a first-class in-app tab rather than a detached Electron window.
  const setMode = useCallback((next) => {
    if (next === 'edit') {
      setModeRaw((current) => { if (current !== 'edit') previousModeRef.current = current; return 'edit'; });
      setEditorTabOpen(true);
      return;
    }
    setModeRaw((current) => { if (current !== 'edit') previousModeRef.current = next; return next; });
  }, []);
  const activateMainTab = useCallback(() => {
    setModeRaw((current) => current === 'edit' ? (previousModeRef.current || 'home') : current);
  }, []);
  const closeEditorTab = useCallback(() => {
    if (editorDirty && !window.confirm('You have unsaved PDF edits. Close the Edit PDF tab and discard those changes?')) return;
    setEditorTabOpen(false);
    setEditorDirty(false);
    setEditorTabTitle('Edit PDF');
    setModeRaw((current) => current === 'edit' ? (previousModeRef.current || 'home') : current);
  }, [editorDirty]);
  // If the whole application is closed while an Edit PDF tab has unsaved edits, ask before exit. In the desktop app the
  // main process owns that prompt (it reliably closes the window once the user confirms); the browser build falls back to
  // the standard `beforeunload` guard.
  const hasUnsaved = editorTabOpen && editorDirty;
  useEffect(() => {
    if (window.pdfStudio?.setUnsavedChanges) {
      window.pdfStudio.setUnsavedChanges(hasUnsaved).catch(() => {});
      return () => { window.pdfStudio.setUnsavedChanges(false).catch(() => {}); };
    }
    if (!hasUnsaved) return undefined;
    const guard = (event) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [hasUnsaved]);
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
    exportWatermarkMode,
    setExportWatermarkMode,
    exportWatermark,
    setExportWatermark,
    exportWatermarkOpacity,
    setExportWatermarkOpacity,
    exportWatermarkAngle,
    setExportWatermarkAngle,
    exportWatermarkColor,
    setExportWatermarkColor,
    exportPaperSize,
    setExportPaperSize,
    exportCompression,
    setExportCompression,
    exportPassword,
    setExportPassword,
    splitMode,
    setSplitMode,
    splitEvery,
    setSplitEvery,
    splitRanges,
    setSplitRanges,
    doExportPdf,
    convertToWord,
    compressPdfFile,
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

  // Ask for a product review only after at least 30 minutes of accumulated use. The
  // main process persists submission, snooze, and never-ask preferences per installation.
  // Randomized checks avoid presenting the prompt at the same moment for every user.
  useEffect(() => {
    if (modal || access.locked || !window.pdfStudio?.maybePromptReview) return undefined;
    let timer = null;
    let cancelled = false;
    const check = async () => {
      try {
        const reviewState = await window.pdfStudio.maybePromptReview();
        if (cancelled) return;
        if (reviewState?.stopChecking) return;
        if (reviewState?.shouldPrompt) {
          await window.pdfStudio.markReviewPromptShown?.();
          if (cancelled) return;
          setModal((current) => current || { type: 'review' });
          return;
        }
        const requestedDelay = Number(reviewState?.nextCheckAfterMs);
        const delay = Number.isFinite(requestedDelay) && requestedDelay > 0
          ? Math.max(60_000, Math.min(24 * 60 * 60 * 1000, requestedDelay))
          : Math.round((12 + Math.random() * 18) * 60_000);
        if (!cancelled) timer = setTimeout(check, delay);
      } catch (error) {
        console.warn('[PDF Studio] Review prompt check failed:', error?.message || error);
        if (!cancelled) timer = setTimeout(check, 30 * 60_000);
      }
    };
    timer = setTimeout(check, Math.round((4 + Math.random() * 5) * 60_000));
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [access.locked, modal, setModal]);

  const resetPreferences = useCallback(() => {
    restoreDefaultPreferences();
    setSettingsTab('appearance');
    notify('Settings restored to their defaults.', 'success');
  }, [notify, restoreDefaultPreferences]);

  // PDF to Word always opens its dialog; the dialog itself lets the user convert the open workspace or
  // click/drag-drop a different PDF (which never enters the workspace).
  const startWordConversion = useCallback(() => {
    if (accessLockedRef.current) return;
    setModal({ type: 'word' });
  }, [accessLockedRef, setModal]);

  const startTool = (tool) => {
  if (tool.action === 'word') startWordConversion();
  else if (tool.action === 'images') { if (!pages.length) chooseFiles('pdf'); else setModal({ type: 'images' }); }
  else if (tool.action === 'imagesToPdf') { setMode('workspace'); chooseFiles('images'); }
  else if (tool.action === 'compress') setModal({ type: 'compress' });
  else { setMode(tool.mode || 'workspace'); if (!pages.length && tool.mode !== 'edit') chooseFiles(); }
  };

  return (
    <MotionConfig reducedMotion={preferences.reduceMotion ? 'always' : 'user'} transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}>
    <motion.div data-accent={preferences.accentTheme || 'violet'} className={cx('app-shell', 'platform-win32', fullScreen && 'is-fullscreen', maximized && 'is-maximized', dark && 'theme-dark', preferences.fontScale === 'large' && 'font-scale-large', preferences.fontScale === 'xlarge' && 'font-scale-xlarge', preferences.density === 'compact' && 'density-compact', preferences.highContrast && 'high-contrast', preferences.reduceMotion && 'reduce-motion')} onDragOver={(event) => event.preventDefault()} onDrop={handleDropFiles} inert={access.locked ? true : undefined} aria-hidden={access.locked ? true : undefined} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: preferences.reduceMotion ? 0 : 0.24 }}>
    <input ref={fileInputRef} type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.webp,.bmp,.gif,.tif,.tiff,.docx" className="hidden-input" onChange={(event) => { if (event.target.files?.length) handleBrowserFiles(event.target.files); event.target.value = ''; }} />
    <TitleBar mode={mode} maximized={maximized} setMode={setMode} editorTabOpen={editorTabOpen} editorTabTitle={editorTabTitle} onActivateMainTab={activateMainTab} onCloseEditorTab={closeEditorTab} />
    <motion.div className={cx('app-body', mode === 'edit' && 'app-body-edit')} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.22, delay: 0.07 }}>
    {mode !== 'edit' && <Sidebar pages={pages} documents={documents} mode={mode} appVersion={appVersion} currentDocument={currentDocument} setSelectedIds={setSelectedIds} setActiveId={setActiveId} setMode={setMode} setModal={setModal} chooseFiles={chooseFiles} removeDocument={removeDocument} />}
    <motion.main className={cx('main-panel', mode === 'edit' && 'main-panel-edit')} initial={{ opacity: 0, x: 5 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.24, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}>
    {mode !== 'edit' && <Topbar mode={mode} dark={dark} activePage={activePage} setMode={setMode} setDark={setDark} setModal={setModal} />}
    <Suspense fallback={null}>
    {editorTabOpen && <div className={cx('persistent-edit-pdf', mode === 'edit' && 'is-active')} style={{ display: mode === 'edit' ? 'flex' : 'none' }}><EditPdfView active={mode === 'edit'} documents={documents} sourcesRef={sourcesRef} initialDocument={currentDocument} notify={notify} onDirtyChange={setEditorDirty} onTabTitleChange={setEditorTabTitle} onCloseTab={closeEditorTab} /></div>}
    {mode !== 'edit' && <AnimatePresence mode="wait" initial={false}>
    {mode === 'home' && <HomeView key="home" pages={pages} documents={documents} setMode={setMode} setModal={setModal} chooseFiles={chooseFiles} startTool={startTool} />}
    {mode === 'workspace' && <WorkspaceView key="workspace" pages={pages} pagesRef={pagesRef} sourcesRef={sourcesRef} selectedIds={selectedIds} activeId={activeId} search={search} showInspector={showInspector} draggingPageId={draggingPageId} landedId={landedId} dropCue={dropCue} previewZoom={previewZoom} suppressPageClickUntil={suppressPageClickUntil} historyRef={historyRef} redoRef={redoRef} activePage={activePage} filteredPages={filteredPages} setSelectedIds={setSelectedIds} setActiveId={setActiveId} setSearch={setSearch} setModal={setModal} setShowInspector={setShowInspector} setDraggingPageId={setDraggingPageId} setDropCue={setDropCue} setPreviewZoom={setPreviewZoom} commitPages={commitPages} undo={undo} redo={redo} chooseFiles={chooseFiles} handleBrowserFiles={handleBrowserFiles} selectPage={selectPage} requestDeleteSelected={requestDeleteSelected} rotateSelected={rotateSelected} duplicateSelected={duplicateSelected} addBlankPage={addBlankPage} movePage={movePage} duplicateSelected={duplicateSelected} requestDeleteSelected={requestDeleteSelected} />}
    {mode === 'convert' && <ConvertView key="convert" pages={pages} setModal={setModal} chooseFiles={chooseFiles} startWord={startWordConversion} />}
    {mode === 'history' && <HistoryView key="history" pages={pages} documents={documents} setSelectedIds={setSelectedIds} setActiveId={setActiveId} setMode={setMode} chooseFiles={chooseFiles} />}
    {mode === 'settings' && <SettingsView key="settings" mode={mode} preferences={preferences} settingsTab={settingsTab} dark={dark} updateState={updateState} readyUpdate={readyUpdate} imageFormat={imageFormat} imageQuality={imageQuality} showInspector={showInspector} appVersion={appVersion} setSettingsTab={setSettingsTab} setDark={setDark} setModal={setModal} setImageFormat={setImageFormat} setImageQuality={setImageQuality} setShowInspector={setShowInspector} setPreference={setPreference} resetPreferences={resetPreferences} checkForUpdates={checkForUpdates} />}
    </AnimatePresence>}
    </Suspense>
    </motion.main>
    </motion.div>
    <LoadingOverlay isLoading={isLoading} loadingLabel={loadingLabel} />
    <Toast toast={toast} setToast={setToast} />
    <ModalHost hideGuide={preferences.hideGuide} setHideGuide={setHideGuide} pages={pages} mode={mode} guideStep={guideStep} setGuideStep={setGuideStep} chooseFiles={chooseFiles} readyUpdate={readyUpdate} applyingUpdate={applyingUpdate} modal={modal} textValue={textValue} textColor={textColor} textSize={textSize} coverColor={coverColor} exportTitle={exportTitle} exportAuthor={exportAuthor} exportPageNumbers={exportPageNumbers} exportWatermarkMode={exportWatermarkMode} exportWatermark={exportWatermark} exportWatermarkOpacity={exportWatermarkOpacity} exportWatermarkAngle={exportWatermarkAngle} exportWatermarkColor={exportWatermarkColor} exportPaperSize={exportPaperSize} exportCompression={exportCompression} exportPassword={exportPassword} splitMode={splitMode} splitEvery={splitEvery} splitRanges={splitRanges} imageFormat={imageFormat} imageQuality={imageQuality} appVersion={appVersion} selectedPages={selectedPages} setSelectedIds={setSelectedIds} setActiveId={setActiveId} setMode={setMode} setSettingsTab={setSettingsTab} setModal={setModal} setTextValue={setTextValue} setTextColor={setTextColor} setTextSize={setTextSize} setCoverColor={setCoverColor} setExportTitle={setExportTitle} setExportAuthor={setExportAuthor} setExportPageNumbers={setExportPageNumbers} setExportWatermarkMode={setExportWatermarkMode} setExportWatermark={setExportWatermark} setExportWatermarkOpacity={setExportWatermarkOpacity} setExportWatermarkAngle={setExportWatermarkAngle} setExportWatermarkColor={setExportWatermarkColor} setExportPaperSize={setExportPaperSize} setExportCompression={setExportCompression} setExportPassword={setExportPassword} setSplitMode={setSplitMode} setSplitEvery={setSplitEvery} setSplitRanges={setSplitRanges} setImageFormat={setImageFormat} setImageQuality={setImageQuality} deleteSelected={deleteSelected} requestDeleteSelected={requestDeleteSelected} rotateSelected={rotateSelected} duplicateSelected={duplicateSelected} addTextOverlay={addTextOverlay} addCoverOverlay={addCoverOverlay} doExportPdf={doExportPdf} convertToWord={convertToWord} compressPdfFile={compressPdfFile} convertToImages={convertToImages} splitPdf={splitPdf} deferReadyUpdate={deferReadyUpdate} applyReadyUpdate={applyReadyUpdate} notify={notify} />
    </motion.div>
    <AnimatePresence>{access.locked && <AccessLockScreen key="access-lock" access={access} checking={accessChecking} notice={accessNotice} dark={dark} onRecheck={recheckAccess} onQuit={quitFromLock} />}</AnimatePresence>
    </MotionConfig>
  );
}

export default App;
