import { useEffect, useState } from 'react';
import EditPdfView from './views/EditPdfView.jsx';
import Toast from './components/layout/Toast.jsx';
import { useToast } from './hooks/useToast.js';
import { readPreferences } from './constants/preferences.js';
import { cx } from './utils/cx.js';

/** Root of the stand-alone Edit PDF window (opened by the main window with ?window=edit). */
export default function EditorWindow() {
  const [preferences, setPreferences] = useState(readPreferences);
  const [initial, setInitial] = useState(null);
  const { toast, setToast, notify } = useToast();
  const dark = preferences.theme === 'dark';

  // Follow theme/accent changes made in the main window; this window never writes preferences.
  useEffect(() => {
    const onStorage = (event) => { if (!event.key || event.key.startsWith('pdfstudio-')) setPreferences(readPreferences()); };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', dark);
    root.dataset.accent = preferences.accentTheme || 'violet';
    root.dataset.platform = 'win32';
    root.classList.toggle('reduce-motion', Boolean(preferences.reduceMotion));
    root.classList.toggle('high-contrast', Boolean(preferences.highContrast));
  }, [dark, preferences]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try { const payload = await window.pdfStudio?.getEditorInit?.(); if (alive && payload?.bytes) setInitial(payload); } catch { /* start empty */ }
    })();
    return () => { alive = false; };
  }, []);

  return (
    <div data-accent={preferences.accentTheme || 'violet'} className={cx('app-shell', 'ep-window', 'platform-win32', dark && 'theme-dark', preferences.highContrast && 'high-contrast', preferences.reduceMotion && 'reduce-motion')}>
      <EditPdfView standalone active initialFile={initial || undefined} notify={notify} />
      <Toast toast={toast} setToast={setToast} />
    </div>
  );
}
