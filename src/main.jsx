import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './index.css';

const rootElement = document.getElementById('root');
createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// The HTML startup watchdog can now stop checking for an empty renderer.
requestAnimationFrame(() => requestAnimationFrame(() => {
  if (rootElement?.childElementCount) window.__PDF_STUDIO_BOOT_SUCCESS?.();
}));
