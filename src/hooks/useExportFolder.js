import { useCallback, useMemo, useState } from 'react';
import { dirnameOf, loadImageExportPrefs } from '../utils/imageExportPrefs.js';

/**
 * Destination-folder state shared by the dialogs that write several files (PDF → images, Split PDF).
 * Desktop: native folder dialog; the default is the folder of the source PDF when known, else the last folder used.
 * Chromium browsers: showDirectoryPicker. Anything else: browser downloads (no folder choice).
 */
export function useExportFolder({ sourcePath = '' } = {}) {
  const prefs = useMemo(loadImageExportPrefs, []);
  const [custom, setCustom] = useState(null); // { path } | { handle, name }
  const [error, setError] = useState('');
  const desktop = Boolean(window.pdfStudio?.chooseFolder);
  const browserPicker = !desktop && typeof window.showDirectoryPicker === 'function';
  const suggested = desktop ? (dirnameOf(sourcePath) || prefs.folder) : '';
  const parentPath = custom?.path || (custom ? '' : suggested);
  const parentLabel = custom?.path || custom?.name || suggested;

  const choose = useCallback(async () => {
    setError('');
    try {
      if (desktop) {
        const result = await window.pdfStudio.chooseFolder({ defaultPath: parentPath || undefined });
        if (result?.folder) setCustom({ path: result.folder });
      } else if (browserPicker) {
        const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
        setCustom({ handle, name: handle.name });
      }
    } catch (caught) { if (caught?.name !== 'AbortError') setError(caught?.message || 'Could not open the folder picker.'); }
  }, [browserPicker, desktop, parentPath]);

  const reset = useCallback(() => { setCustom(null); setError(''); }, []);

  return { prefs, desktop, browserPicker, canChoose: desktop || browserPicker, parentPath, parentLabel, directoryHandle: custom?.handle || null, needsFolder: desktop && !parentPath, error, choose, reset };
}
