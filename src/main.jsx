import React, { Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/fonts.css';
import './styles/index.css';
import './styles/ui-refresh.css';
import './styles/edit-pdf.css';
import './styles/tour.css';
import './styles/sidebar-collapse.css';

// The Edit PDF window and the main window share one HTML entry; each loads only its own code.
const App = lazy(() => import('./App.jsx'));
const EditorWindow = lazy(() => import('./EditorWindow.jsx'));

const rootElement = document.getElementById('root');
createRoot(rootElement).render(
  <React.StrictMode>
    <Suspense fallback={null}>
      {new URLSearchParams(window.location.search).get('window') === 'edit' ? <EditorWindow /> : <App />}
    </Suspense>
  </React.StrictMode>,
);

// The HTML startup watchdog can now stop checking for an empty renderer.
new MutationObserver((_records, observer) => {
  if (!rootElement?.childElementCount) return;
  observer.disconnect();
  window.__PDF_STUDIO_BOOT_SUCCESS?.();
  // Tell the desktop shell the UI is mounted so it can swap the startup splash for the main window.
  window.pdfStudio?.notifyReady?.()?.catch?.(() => {});
}).observe(rootElement, { childList: true });
