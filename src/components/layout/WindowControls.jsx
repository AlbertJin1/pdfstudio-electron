/** Native-feeling window buttons for the frameless Windows window. */
export default function WindowControls({ maximized }) {
  const common = { width: 10, height: 10, viewBox: '0 0 10 10', fill: 'none', stroke: 'currentColor', strokeWidth: 1, 'aria-hidden': true };
  return <div className="window-controls">
    <button type="button" title="Minimize" aria-label="Minimize window" onClick={() => window.pdfStudio?.minimize?.()}><svg {...common}><path d="M0 5.5h10" /></svg></button>
    <button type="button" title={maximized ? 'Restore' : 'Maximize'} aria-label={maximized ? 'Restore window' : 'Maximize window'} onClick={() => window.pdfStudio?.toggleMaximize?.()}>{maximized ? <svg {...common}><path d="M2.5 2.5V.5h7v7h-2" /><rect x=".5" y="2.5" width="7" height="7" /></svg> : <svg {...common}><rect x=".5" y=".5" width="9" height="9" /></svg>}</button>
    <button type="button" title="Close" aria-label="Close window" className="window-close" onClick={() => window.pdfStudio?.close?.()}><svg {...common}><path d="M.5.5l9 9M9.5.5l-9 9" /></svg></button>
  </div>;
}
