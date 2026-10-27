const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pdfStudio', Object.freeze({
  notifyReady: () => ipcRenderer.invoke('app:renderer-ready'),
  reportStartupError: (report) => ipcRenderer.invoke('app:renderer-startup-error', report),
  openFiles: (options) => ipcRenderer.invoke('files:open', options),
  getEditorInit: () => ipcRenderer.invoke('editor:init'),
  closeEditor: () => ipcRenderer.invoke('editor:close'),
  setEditorTitle: (title) => ipcRenderer.invoke('editor:set-title', title),
  findFont: (query) => ipcRenderer.invoke('fonts:find', query),
  saveFile: (payload) => ipcRenderer.invoke('files:save', payload),
  saveFinalizedPdf: (payload) => ipcRenderer.invoke('files:save-finalized-pdf', payload),
  optimizePdf: (payload) => ipcRenderer.invoke('pdf:optimize', payload),
  getPdfCompressionEngineInfo: () => ipcRenderer.invoke('pdf:compression-engine-info'),
  smartCompressPdf: (payload) => ipcRenderer.invoke('pdf:smart-compress', payload),
  lockPdf: (payload) => ipcRenderer.invoke('pdf:lock', payload),
  ocrImage: (payload) => ipcRenderer.invoke('pdf:ocr-image', payload),
  saveBatch: (files) => ipcRenderer.invoke('files:save-batch', files),
  maybePromptReview: () => ipcRenderer.invoke('review:maybe-prompt'),
  markReviewPromptShown: () => ipcRenderer.invoke('review:prompt-shown'),
  deferReview: (choice) => ipcRenderer.invoke('review:defer', choice),
  submitReview: (payload) => ipcRenderer.invoke('review:submit', payload),
  getReviewIdentity: () => ipcRenderer.invoke('review:identity'),
  getAccessState: () => ipcRenderer.invoke('access:get-state'),
  recheckAccess: () => ipcRenderer.invoke('access:recheck'),
  onAccessState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('access:state', listener);
    return () => ipcRenderer.removeListener('access:state', listener);
  },
  minimize: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximize: () => ipcRenderer.invoke('window:maximize-toggle'),
  close: () => ipcRenderer.invoke('window:close'),
  setUnsavedChanges: (hasUnsaved) => ipcRenderer.invoke('app:set-unsaved', Boolean(hasUnsaved)),
  isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  version: () => ipcRenderer.invoke('app:version'),
  platform: () => ipcRenderer.invoke('app:platform'),
  getSystemTheme: () => ipcRenderer.invoke('theme:get-system'),
  onSystemThemeChanged: (callback) => {
    const listener = (_event, theme) => callback(theme);
    ipcRenderer.on('theme:system-changed', listener);
    return () => ipcRenderer.removeListener('theme:system-changed', listener);
  },
  openExternal: (url) => ipcRenderer.invoke('app:open-external', url),
  checkForUpdates: () => ipcRenderer.invoke('updater:check'),
  getUpdaterState: () => ipcRenderer.invoke('updater:get-state'),
  markUpdatePromptShown: (version) => ipcRenderer.invoke('updater:prompt-shown', version),
  deferUpdate: (version) => ipcRenderer.invoke('updater:update-later', version),
  applyUpdateNow: () => ipcRenderer.invoke('updater:apply-now'),
  cancelUpdateDownload: () => ipcRenderer.invoke('updater:cancel'),
  openDownloadsFolder: () => ipcRenderer.invoke('updater:open-downloads'),
  onUpdaterState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('updater:state', listener);
    return () => ipcRenderer.removeListener('updater:state', listener);
  },
  onUpdateReady: (callback) => {
    const listener = (_event, update) => callback(update);
    ipcRenderer.on('updater:update-ready', listener);
    return () => ipcRenderer.removeListener('updater:update-ready', listener);
  },
  onUpdateDownloadProgress: (callback) => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on('updater:download-progress', listener);
    return () => ipcRenderer.removeListener('updater:download-progress', listener);
  },
  onFullScreenChanged: (callback) => {
    const listener = (_event, fullScreen) => callback(Boolean(fullScreen));
    ipcRenderer.on('window:fullscreen', listener);
    return () => ipcRenderer.removeListener('window:fullscreen', listener);
  },
  onShowAbout: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('app:show-about', listener);
    return () => ipcRenderer.removeListener('app:show-about', listener);
  },
  onMaximizedChanged: (callback) => {
    const listener = (_event, maximized) => callback(Boolean(maximized));
    ipcRenderer.on('window:maximized', listener);
    return () => ipcRenderer.removeListener('window:maximized', listener);
  },
}));
