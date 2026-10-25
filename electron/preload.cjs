const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pdfStudio', Object.freeze({
  openFiles: () => ipcRenderer.invoke('files:open'),
  saveFile: (payload) => ipcRenderer.invoke('files:save', payload),
  saveBatch: (files) => ipcRenderer.invoke('files:save-batch', files),
  minimize: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximize: () => ipcRenderer.invoke('window:maximize-toggle'),
  close: () => ipcRenderer.invoke('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  version: () => ipcRenderer.invoke('app:version'),
  openExternal: (url) => ipcRenderer.invoke('app:open-external', url),
  onMaximizedChanged: (callback) => {
    const listener = (_event, maximized) => callback(Boolean(maximized));
    ipcRenderer.on('window:maximized', listener);
    return () => ipcRenderer.removeListener('window:maximized', listener);
  },
}));
