import { useCallback, useEffect, useRef, useState } from 'react';

export function useAccessControl({ setModal, setToast }) {
  const [access, setAccess] = useState({ locked: false, status: 'enabled' });
  const [accessChecking, setAccessChecking] = useState(false);
  const [accessNotice, setAccessNotice] = useState('');
  const accessLockedRef = useRef(false);

  // Device access (Monitor enable / disable). The main process owns the decision and enforces it; we only mirror it.
  const applyAccessState = useCallback((state) => {
    if (!state || typeof state !== 'object') return;
    const wasLocked = accessLockedRef.current;
    accessLockedRef.current = Boolean(state.locked);
    setAccess(state);
    if (state.locked) setModal(null);
    if (wasLocked && !state.locked) { setAccessNotice(''); setToast({ message: 'Access restored. PDF Studio is unlocked again.', kind: 'success' }); }
  }, []);
  useEffect(() => {
    let active = true;
    window.pdfStudio?.getAccessState?.().then((state) => { if (active) applyAccessState(state); }).catch(() => {});
    const unsubscribe = window.pdfStudio?.onAccessState?.(applyAccessState);
    return () => { active = false; unsubscribe?.(); };
  }, [applyAccessState]);
  const recheckAccess = useCallback(async () => {
    setAccessChecking(true);
    setAccessNotice('');
    try {
      const state = await window.pdfStudio?.recheckAccess?.();
      if (state) {
        applyAccessState(state);
        if (state.locked && !state.offline) setAccessNotice('This device is still disabled. Ask your administrator to enable it in the monitor.');
      }
    } catch { setAccessNotice('The status could not be checked. Please try again in a moment.'); }
    finally { setAccessChecking(false); }
  }, [applyAccessState]);
  const quitFromLock = useCallback(() => { void window.pdfStudio?.close?.(); }, []);

  return {
    access,
    accessChecking,
    accessNotice,
    accessLockedRef,
    recheckAccess,
    quitFromLock,
  };
}
