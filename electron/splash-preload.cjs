'use strict';
// Splash-only preload: receives status text from the main process and updates the DOM.
// It exposes nothing to the page and accepts only whitelisted, validated values.
const { ipcRenderer } = require('electron');
const LABELS = ['Securing workspace', 'Starting PDF engine', 'Building interface', 'Ready'];
let last = null;
function apply(msg) {
  const root = document.documentElement;
  const step = Number.isInteger(msg?.step) && msg.step >= 1 && msg.step <= 4 ? msg.step : 1;
  root.setAttribute('data-step', String(step));
  const status = document.getElementById('status');
  if (status) status.textContent = LABELS[step - 1];
  const ver = document.getElementById('ver');
  if (ver && typeof msg?.version === 'string' && /^[0-9A-Za-z.+-]{1,24}$/.test(msg.version)) ver.textContent = `v${msg.version}`;
  if (msg?.leaving === true) root.classList.add('leaving');
}
ipcRenderer.on('splash:update', (_event, msg) => {
  last = msg;
  if (document.readyState === 'loading') return; // applied on DOMContentLoaded
  apply(msg);
});
window.addEventListener('DOMContentLoaded', () => { if (last) apply(last); });
