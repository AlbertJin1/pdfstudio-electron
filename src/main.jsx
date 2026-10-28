import React, { Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/fonts.css';
import './styles/index.css';
import './styles/ui-refresh.css';
import './styles/edit-pdf.css';
import './styles/tour.css';
import './styles/sidebar-collapse.css';
import './styles/loader.css';
import './styles/dropzone.css';
import './styles/workspace-polish.css';

// The Edit PDF window and the main window share one HTML entry; each loads only its own code.
const isEditWindow = new URLSearchParams(window.location.search).get('window') === 'edit';
const appImport = isEditWindow ? import('./EditorWindow.jsx') : import('./App.jsx');
const App = lazy(() => import('./App.jsx'));
const EditorWindow = lazy(() => import('./EditorWindow.jsx'));

const rootElement = document.getElementById('root');
createRoot(rootElement).render(
  <React.StrictMode>
    <Suspense fallback={null}>
      {isEditWindow ? <EditorWindow /> : <App />}
    </Suspense>
  </React.StrictMode>,
);

// ───────────── Startup loader ─────────────
// The native splash is the loader. The shell is told "ready" only after the UI has mounted AND its
// assets (fonts, lazy screens, access state) have loaded and one frame has painted, so the main window
// never appears half-built.
const withTimeout = (promise, ms) => Promise.race([Promise.resolve(promise).catch(() => {}), new Promise((resolve) => setTimeout(resolve, ms))]);
const nextPaint = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

function waitForMount() {
  if (rootElement?.childElementCount) return Promise.resolve();
  return new Promise((resolve) => {
    new MutationObserver((_records, observer) => {
      if (!rootElement?.childElementCount) return;
      observer.disconnect();
      resolve();
    }).observe(rootElement, { childList: true });
  });
}

async function loadStartupAssets() {
  const fonts = document.fonts;
  const tasks = [
    appImport,
    withTimeout(window.pdfStudio?.getAccessState?.(), 3000),
  ];
  if (fonts?.load) {
    for (const weight of [400, 500, 600, 700, 800]) tasks.push(fonts.load(`${weight} 14px "Inter Variable"`).catch(() => {}));
  }
  if (!isEditWindow) {
    // Warm the screens the user is most likely to open so they never flash a blank fallback.
    tasks.push(
      import('./views/ConvertView.jsx'),
      import('./views/EditPdfView.jsx'),
      import('./views/HistoryView.jsx'),
      import('./views/settings/SettingsView.jsx'),
    );
  }
  await Promise.allSettled(tasks.map((task) => withTimeout(task, 10000)));
  if (fonts?.ready) await withTimeout(fonts.ready, 3000);
}

(async () => {
  await waitForMount();
  await loadStartupAssets();
  await nextPaint(); // the fully loaded UI has been painted behind the splash
  window.__PDF_STUDIO_BOOT_SUCCESS?.();
  window.pdfStudio?.notifyReady?.()?.catch?.(() => {});
})();
