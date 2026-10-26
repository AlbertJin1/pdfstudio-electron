import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import EditorWindow from './EditorWindow.jsx';
import '@fontsource-variable/inter/wght.css';
import './styles/index.css';
import './styles/ui-refresh.css';
import './styles/edit-pdf.css';
import './styles/tour.css';

const rootElement = document.getElementById('root');
createRoot(rootElement).render(
  <React.StrictMode>
    {new URLSearchParams(window.location.search).get('window') === 'edit' ? <EditorWindow /> : <App />}
  </React.StrictMode>,
);

// The HTML startup watchdog can now stop checking for an empty renderer.
requestAnimationFrame(() => requestAnimationFrame(() => {
  if (rootElement?.childElementCount) window.__PDF_STUDIO_BOOT_SUCCESS?.();
}));
