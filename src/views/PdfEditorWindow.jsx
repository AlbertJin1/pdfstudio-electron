import { useCallback, useEffect, useRef, useState } from 'react';
import EditPdfView from './EditPdfView.jsx';
import { cx } from '../utils/cx.js';

export default function PdfEditorWindow() {
  const [initialDocument, setInitialDocument] = useState(null);
  const [notice, setNotice] = useState('');
  const [dark, setDark] = useState(() => { try { return localStorage.getItem('pdfstudio-theme') === 'dark'; } catch { return false; } });
  const sourcesRef = useRef(new Map());
  const notify = useCallback((message, type = 'info') => {
    setNotice({ message: String(message || ''), type });
  }, []);

  useEffect(() => {
    document.title = 'PDF Studio - Edit PDF';
    const updateTheme = () => { try { setDark(localStorage.getItem('pdfstudio-theme') === 'dark'); } catch { setDark(false); } };
    window.addEventListener('storage', updateTheme);
    let cancelled = false;
    window.pdfStudio?.getEditorDocument?.().then((payload) => {
      if (cancelled || !payload?.bytes) return;
      const id = 'standalone-editor-document';
      sourcesRef.current.set(id, { id, name: payload.name || 'document.pdf', kind: 'pdf', bytes: payload.bytes });
      setInitialDocument({ id, name: payload.name || 'document.pdf', kind: 'pdf' });
    }).catch((error) => {
      if (!cancelled) setNotice({ message: error?.message || 'The PDF could not be transferred to the editor window.', type: 'error' });
    });
    return () => { cancelled = true; window.removeEventListener('storage', updateTheme); };
  }, []);

  return (
    <main className={cx('pdf-editor-window-root', dark && 'theme-dark', notice?.type === 'error' && 'has-editor-window-error')}>
      {notice?.message && <div className={`ed-window-toast ed-window-toast-${notice.type}`} role="status"><span>{notice.message}</span><button type="button" onClick={() => setNotice('')} aria-label="Dismiss message">×</button></div>}
      <EditPdfView active documents={initialDocument ? [initialDocument] : []} sourcesRef={sourcesRef} initialDocument={initialDocument} notify={notify} />
    </main>
  );
}
