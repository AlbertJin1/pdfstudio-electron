import { useEffect, useState } from 'react';
import { Download, FileCheck2, LockKeyhole, ShieldCheck, Stamp } from 'lucide-react';
import ActionButton from '../components/common/ActionButton.jsx';
import Modal from '../components/common/Modal.jsx';
import Select from '../components/common/Select.jsx';

const WATERMARK_PRESETS = [
  { value: 'none', label: 'No watermark' },
  { value: 'draft', label: 'DRAFT' },
  { value: 'confidential', label: 'CONFIDENTIAL' },
  { value: 'internal', label: 'INTERNAL USE ONLY' },
  { value: 'custom', label: 'Custom label…' },
];

const PAPER_OPTIONS = [
  { value: 'original', label: 'Keep each page\'s current size' },
  { value: 'a4', label: 'Fit all pages to A4' },
  { value: 'letter', label: 'Fit all pages to US Letter' },
  { value: 'legal', label: 'Fit all pages to US Legal' },
  { value: 'folio', label: 'Fit all pages to Folio (8.5 × 13 in)' },
  { value: 'a3', label: 'Fit all pages to A3' },
  { value: 'a5', label: 'Fit all pages to A5' },
];
const OPACITY_OPTIONS = [
  { value: '20', label: '20% — subtle' }, { value: '32', label: '32% — professional' },
  { value: '45', label: '45% — strong' }, { value: '60', label: '60% — prominent' },
];
const ANGLE_OPTIONS = [{ value: '35', label: '35° rising' }, { value: '45', label: '45° rising' }, { value: '-35', label: '35° falling' }];
const COMPRESSION_OPTIONS = [
  { value: 'none', label: 'No extra compression' },
  { value: 'lossless', label: 'Lossless optimize', hint: 'Preserves text and vectors' },
  { value: 'compact', label: 'Compact', hint: 'Smaller JPEG page images' },
  { value: 'smallest', label: 'Smallest file', hint: 'Stronger image compression' },
];

export default function ExportModal({
  pages, exportTitle, exportAuthor, exportPageNumbers,
  exportWatermarkMode, exportWatermark, exportWatermarkOpacity, exportWatermarkAngle, exportWatermarkColor,
  exportPaperSize, exportCompression, exportPassword,
  setModal, setExportTitle, setExportAuthor, setExportPageNumbers,
  setExportWatermarkMode, setExportWatermark, setExportWatermarkOpacity, setExportWatermarkAngle, setExportWatermarkColor,
  setExportPaperSize, setExportCompression, setExportPassword, doExportPdf,
}) {
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const close = () => { setExportPassword(''); setPasswordConfirm(''); setPasswordError(''); setModal(null); };
  useEffect(() => () => setExportPassword(''), [setExportPassword]);

  const handleExport = () => {
    setPasswordError('');
    if (exportPassword && exportPassword.length < 8) {
      setPasswordError('Use at least 8 characters for a stronger open password.');
      return;
    }
    if (exportPassword !== passwordConfirm) {
      setPasswordError(exportPassword || passwordConfirm ? 'The passwords do not match.' : '');
      if (exportPassword || passwordConfirm) return;
    }
    doExportPdf(false);
  };

  return (
    <Modal title="Merge & export PDF" eyebrow="FINALIZE YOUR DOCUMENT" wide onClose={close} footer={<><ActionButton onClick={close}>Cancel</ActionButton><ActionButton variant="primary" icon={Download} onClick={handleExport}>Export {pages.length} pages</ActionButton></>}>
      <div className="modal-intro"><div className="modal-hero-icon modal-hero-purple"><FileCheck2 size={22}/></div><div><strong>Build a single PDF from your page workspace.</strong><p>Export pages in their current order, with paper sizing, a diagonal label, file optimization, and optional AES-256 password protection.</p></div></div>

      <div className="export-options-grid">
        <section className="export-section">
          <div className="export-section-title"><FileCheck2 size={16}/><strong>Document & page size</strong></div>
          <label className="form-label">Document title<input className="form-input" value={exportTitle} onChange={(event) => setExportTitle(event.target.value)} placeholder="My final document" /></label>
          <label className="form-label">Author<input className="form-input" value={exportAuthor} onChange={(event) => setExportAuthor(event.target.value)} placeholder="PDF Studio" /></label>
          <label className="form-label">Page size<Select className="form-input" value={exportPaperSize} onChange={setExportPaperSize} options={PAPER_OPTIONS} ariaLabel="Page size" /></label>
          <label className="check-option"><input type="checkbox" checked={exportPageNumbers} onChange={(event) => setExportPageNumbers(event.target.checked)}/><span><strong>Add page numbers</strong><small>Place a small number at the bottom of every page.</small></span></label>
        </section>

        <section className="export-section">
          <div className="export-section-title"><Stamp size={16}/><strong>Diagonal watermark</strong></div>
          <label className="form-label">Label preset<Select className="form-input" value={exportWatermarkMode} onChange={setExportWatermarkMode} options={WATERMARK_PRESETS} ariaLabel="Watermark label preset" /></label>
          {exportWatermarkMode === 'custom' && <label className="form-label">Custom label<input className="form-input" maxLength={100} value={exportWatermark} onChange={(event) => setExportWatermark(event.target.value)} placeholder="e.g. FOR REVIEW ONLY" /></label>}
          {exportWatermarkMode !== 'none' && <>
            <div className="form-two-col">
              <label className="form-label">Text color<div className="color-picker-row"><input type="color" value={exportWatermarkColor} onChange={(event) => setExportWatermarkColor(event.target.value)}/><span>{exportWatermarkColor.toUpperCase()}</span></div></label>
              <label className="form-label">Opacity<Select className="form-input" value={exportWatermarkOpacity} onChange={setExportWatermarkOpacity} options={OPACITY_OPTIONS} ariaLabel="Watermark opacity" /></label>
            </div>
            <label className="form-label">Diagonal angle<Select className="form-input" value={exportWatermarkAngle} onChange={setExportWatermarkAngle} options={ANGLE_OPTIONS} ariaLabel="Watermark angle" /></label>
            <div className="watermark-preview" aria-label="Watermark preview"><div className="watermark-preview-paper"><span style={{ color: exportWatermarkColor, opacity: Number(exportWatermarkOpacity) / 100, transform: `translate(-50%, -50%) rotate(${Number(exportWatermarkAngle)}deg)` }}>{((exportWatermarkMode === 'custom' ? exportWatermark.trim() : ({ draft: 'DRAFT', confidential: 'CONFIDENTIAL', internal: 'INTERNAL USE ONLY' }[exportWatermarkMode] || 'WATERMARK')) || (exportWatermarkMode === 'custom' ? 'ENTER LABEL' : 'WATERMARK')).toUpperCase()}</span><i /><i /><i /><i /></div><small>Preview · bold diagonal label on every page</small></div>
          </>}
        </section>

        <section className="export-section">
          <div className="export-section-title"><ShieldCheck size={16}/><strong>File size optimization</strong></div>
          <label className="form-label">Compression mode<Select className="form-input" value={exportCompression} onChange={setExportCompression} options={COMPRESSION_OPTIONS} ariaLabel="Compression mode" /></label>
          {exportCompression === 'compact' || exportCompression === 'smallest' ? <div className="modal-note export-warning"><ShieldCheck size={15}/><span>Compact modes rasterize every page. They can reduce scanned-document file sizes, but text, links, vector artwork, and form fields become non-editable pixels. Review the output before sharing.</span></div> : <div className="modal-note"><ShieldCheck size={15}/><span>Lossless optimization attempts to reduce PDF stream overhead without intentionally reducing image quality. Size savings depend on the source file.</span></div>}
        </section>

        <section className="export-section">
          <div className="export-section-title"><LockKeyhole size={16}/><strong>Password protection</strong><span className="export-optional">Optional</span></div>
          <label className="form-label">Open password<input className="form-input" type="password" autoComplete="new-password" value={exportPassword} onChange={(event) => { setExportPassword(event.target.value); setPasswordError(''); }} placeholder="Leave blank for no password" /></label>
          <label className="form-label">Confirm password<input className="form-input" type="password" autoComplete="new-password" value={passwordConfirm} onChange={(event) => { setPasswordConfirm(event.target.value); setPasswordError(''); }} placeholder="Re-enter the password" /></label>
          {passwordError && <p className="export-validation-error" role="alert">{passwordError}</p>}
          <div className="modal-note"><LockKeyhole size={15}/><span>Uses AES-256 encryption. PDF Studio does not store the password; keep it safe because the encrypted file requires it to open.</span></div>
        </section>
      </div>
    </Modal>
  );
}
