import { useCallback, useEffect, useState } from 'react';

export function useDesktopShell({ setModal, notify }) {
  const [fullScreen, setFullScreen] = useState(false);
  const [updateState, setUpdateState] = useState({ status: 'idle', message: 'Automatic updates are enabled.' });
  const [readyUpdate, setReadyUpdate] = useState(null);
  const [applyingUpdate, setApplyingUpdate] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const [appVersion, setAppVersion] = useState('3.0.6');

  useEffect(() => {
    window.pdfStudio?.version?.().then((version) => setAppVersion(version)).catch(() => {});
    window.pdfStudio?.isMaximized?.().then(setMaximized).catch(() => {});
    const unsubscribe = window.pdfStudio?.onMaximizedChanged?.(setMaximized);
    const unsubscribeFullScreen = window.pdfStudio?.onFullScreenChanged?.(setFullScreen);
    const unsubscribeAbout = window.pdfStudio?.onShowAbout?.(() => setModal({ type: 'about' }));
    const unsubscribeUpdater = window.pdfStudio?.onUpdaterState?.((state) => {
      setUpdateState((current) => ({ ...current, ...state }));
    });
    const unsubscribeReady = window.pdfStudio?.onUpdateReady?.((update) => {
      setReadyUpdate(update);
      setUpdateState((current) => ({ ...current, status: 'ready', latestVersion: update.version, message: `Version ${update.version} is downloaded and ready to install.` }));
      void window.pdfStudio?.markUpdatePromptShown?.(update.version);
    });
    const unsubscribeDownload = window.pdfStudio?.onUpdateDownloadProgress?.((progress) => {
      setUpdateState((current) => ({ ...current, status: 'downloading', percent: progress.percent, downloadedBytes: progress.downloadedBytes, totalBytes: progress.totalBytes, message: progress.message || 'Downloading update in the background…' }));
    });
    window.pdfStudio?.getUpdaterState?.().then((snapshot) => {
      if (snapshot?.state) setUpdateState((current) => ({ ...snapshot.state, ...(['downloading', 'ready', 'applying'].includes(current.status) ? current : {}) }));
      if (snapshot?.pendingUpdate && snapshot.shouldPrompt) {
        setReadyUpdate(snapshot.pendingUpdate);
        void window.pdfStudio?.markUpdatePromptShown?.(snapshot.pendingUpdate.version);
      }
    }).catch(() => {});
    return () => { unsubscribe?.(); unsubscribeFullScreen?.(); unsubscribeAbout?.(); unsubscribeUpdater?.(); unsubscribeReady?.(); unsubscribeDownload?.(); };
  }, []);

  const checkForUpdates = useCallback(async () => {
    setUpdateState({ status: 'checking', message: 'Checking for updates…' });
    try {
      const result = await window.pdfStudio?.checkForUpdates?.();
      if (!result) throw new Error('Update checks are available in the desktop application.');
      if (result.status && result.status !== 'checking') setUpdateState((current) => ({ ...current, ...result }));
    } catch {
      setUpdateState({ status: 'error', message: 'We couldn’t check for updates. PDF Studio will try again automatically later.' });
    }
  }, []);

  const deferReadyUpdate = useCallback(async () => {
    const version = readyUpdate?.version;
    if (version) await window.pdfStudio?.deferUpdate?.(version).catch(() => {});
    setReadyUpdate(null);
    setUpdateState((current) => ({ ...current, status: 'ready', latestVersion: version || current.latestVersion, message: 'The update is saved. PDF Studio will offer it again the next time you open the app.' }));
  }, [readyUpdate]);

  const applyReadyUpdate = useCallback(async () => {
    if (!readyUpdate || applyingUpdate) return;
    setApplyingUpdate(true);
    try {
      const result = await window.pdfStudio?.applyUpdateNow?.();
      if (!result?.started) throw new Error('PDF Studio could not start the update.');
      setUpdateState((current) => ({ ...current, status: 'applying', message: 'Applying the update and restarting PDF Studio…' }));
      setReadyUpdate(null);
    } catch (error) {
      setApplyingUpdate(false);
      notify(error?.message || 'The update could not be applied. You can choose Update later and retry.', 'error');
    }
  }, [readyUpdate, applyingUpdate, notify]);

  return {
    fullScreen,
    maximized,
    appVersion,
    updateState,
    readyUpdate,
    applyingUpdate,
    checkForUpdates,
    deferReadyUpdate,
    applyReadyUpdate,
  };
}
