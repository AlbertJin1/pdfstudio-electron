import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, Eye, FileArchive, HardDrive,
  RefreshCw, Settings2, ShieldCheck, SlidersHorizontal, Target, ScanSearch, Save,
} from 'lucide-react';
import ActionButton from '../components/common/ActionButton.jsx';
import Modal from '../components/common/Modal.jsx';
import Select from '../components/common/Select.jsx';
import PdfSourcePicker from '../components/common/PdfSourcePicker.jsx';
import { usePdfPicker } from '../hooks/usePdfPicker.js';
import { COMPRESSION_PRESETS, analyzePdf, renderPdfPreview } from '../services/pdf/compress.js';
import { formatBytes } from '../utils/format.js';

const PRESET_OPTIONS = Object.entries(COMPRESSION_PRESETS).map(([key, option]) => ({ value: key, label: option.label }));
const TARGET_UNIT_OPTIONS = [{ value: 'percent', label: '% of original' }, { value: 'mb', label: 'MB' }];
const DPI_OPTIONS = [50, 66, 72, 96, 110, 150, 200, 240, 300, 400].map((dpi) => ({ value: dpi, label: `${dpi} DPI`, hint: dpi === 300 ? 'Print quality' : dpi === 150 ? 'Email / sharing' : undefined }));
const COLOR_MODE_OPTIONS = [
  { value: 'color', label: 'Keep color' }, { value: 'grayscale', label: 'Convert to grayscale' },
  { value: 'monochrome', label: 'Black & white', hint: 'Requires raster fallback' },
];

const emptyPreview = { original: null, compressed: null };

export default function CompressionModal({ setModal, compressPdfFile }) {
  const [file, setFile] = useState(null);
  const [mode, setMode] = useState('preset');
  const [preset, setPreset] = useState('balanced');
  const [targetUnit, setTargetUnit] = useState('percent');
  const [targetValue, setTargetValue] = useState('50');
  const [password, setPassword] = useState('');
  const [quality, setQuality] = useState(Math.round(COMPRESSION_PRESETS.balanced.quality * 100));
  const [resolutionDpi, setResolutionDpi] = useState(COMPRESSION_PRESETS.balanced.dpi);
  // In target-size mode the quality/DPI fields are limits only once the user changes them; untouched, the
  // compressor is free to pick the mildest setting that fits the requested size.
  const [capsTouched, setCapsTouched] = useState(false);
  const [colorMode, setColorMode] = useState('color');
  const [preserveMetadata, setPreserveMetadata] = useState(true);
  const [includeAnnotations, setIncludeAnnotations] = useState(true);
  const [allowRasterFallback, setAllowRasterFallback] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [protectOutput, setProtectOutput] = useState(false);
  const [outputPassword, setOutputPassword] = useState('');
  const [confirmOutputPassword, setConfirmOutputPassword] = useState('');
  const [working, setWorking] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState(null);
  const [engineInfo, setEngineInfo] = useState(null);
  const [previewResult, setPreviewResult] = useState(null);
  const [previewImages, setPreviewImages] = useState(emptyPreview);
  const [previewPageNumber, setPreviewPageNumber] = useState(1);
  const [previewError, setPreviewError] = useState('');
  const [pickError, setPickError] = useState('');
  const analysisRequestRef = useRef(0);

  const targetBytes = useMemo(() => {
    if (!file || mode !== 'target') return null;
    const value = Number(targetValue);
    if (!Number.isFinite(value) || value <= 0) return null;
    if (targetUnit === 'percent') {
      if (value < 1 || value > 100) return null;
      return Math.floor(file.bytes.byteLength * value / 100);
    }
    if (value < 0.1 || value > 2048) return null;
    return Math.floor(value * 1024 * 1024);
  }, [file, mode, targetUnit, targetValue]);

  useEffect(() => {
    let active = true;
    const request = window.pdfStudio?.getPdfCompressionEngineInfo?.();
    if (!request?.then) { setEngineInfo({ available: false, reason: 'The smart PDF compression engine is not available in this runtime.' }); return () => { active = false; }; }
    request.then((info) => { if (active) setEngineInfo(info); })
      .catch(() => { if (active) setEngineInfo({ available: false, reason: 'Could not detect the smart PDF compression engine.' }); });
    return () => { active = false; };
  }, []);

  // A preview is only valid for the exact settings it was created with.
  useEffect(() => {
    setPreviewResult(null);
    setPreviewImages(emptyPreview);
    setPreviewError('');
  }, [file, mode, preset, targetBytes, password, quality, resolutionDpi, colorMode, preserveMetadata, includeAnnotations, allowRasterFallback]);

  const inspectFile = async (selectedFile = file, sourcePassword = password) => {
    if (!selectedFile?.bytes?.length) return;
    const requestId = ++analysisRequestRef.current;
    setAnalyzing(true);
    setPickError('');
    try {
      const result = await analyzePdf(selectedFile.bytes, { password: sourcePassword });
      if (requestId === analysisRequestRef.current) {
        setAnalysis(result);
        setPreviewPageNumber((current) => Math.min(Math.max(1, current), result.pageCount || 1));
      }
    } catch (error) {
      if (requestId === analysisRequestRef.current) {
        setAnalysis(null);
        setPickError(/password|encrypt/i.test(error?.message || '')
          ? 'This PDF is protected. Enter its password below, then select Analyze PDF.'
          : (error?.message || 'Could not analyze this PDF.'));
      }
    } finally {
      if (requestId === analysisRequestRef.current) setAnalyzing(false);
    }
  };

  const acceptFile = (item) => {
    if (!item?.bytes?.length) return;
    const nextFile = { ...item, size: item.bytes.byteLength };
    setPickError('');
    setAnalysis(null);
    setPreviewResult(null);
    setPreviewImages(emptyPreview);
    setFile(nextFile);
    setPreviewPageNumber(1);
    void inspectFile(nextFile, password);
  };

  const picker = usePdfPicker({ onFile: acceptFile });
  const picking = picker.picking;

  const clearFile = () => {
    analysisRequestRef.current += 1; // ignore any analysis still running for the removed file
    setFile(null); setAnalysis(null); setAnalyzing(false); setPickError('');
    setPreviewResult(null); setPreviewImages(emptyPreview); setPreviewPageNumber(1);
    picker.clearMessages();
  };

  const currentOptions = () => ({
    file, preset: mode === 'target' ? 'balanced' : preset, targetBytes: mode === 'target' ? targetBytes : null,
    password,
    resolutionDpi: mode === 'target' && !capsTouched ? undefined : resolutionDpi,
    quality: mode === 'target' && !capsTouched ? undefined : quality,
    colorMode, preserveMetadata, includeAnnotations, allowRasterFallback,
    outputPassword: protectOutput ? outputPassword : '',
    hasDigitalSignatures: Boolean(analysis?.hasDigitalSignatures),
    scanLike: Boolean(analysis && analysis.pageCount && analysis.imagePaintOperations >= analysis.pageCount && analysis.textCharacters < 40 * analysis.pageCount),
    imageObjectCount: analysis?.resources?.available ? analysis.resources.imageObjects : undefined,
    duplicateImageEstimate: analysis?.resources?.available ? analysis.resources.duplicateImageObjects : undefined,
  });

  const previewCompression = async () => {
    if (!file) return setPickError('Choose a PDF document first.');
    if (mode === 'target' && !targetBytes) return setPickError(targetUnit === 'percent' ? 'Enter a target between 1% and 100% of the original size.' : 'Enter a target size greater than 0 MB and no more than 2048 MB.');
    let freshAnalysis = analysis;
    if (!freshAnalysis) {
      setAnalyzing(true);
      try {
        freshAnalysis = await analyzePdf(file.bytes, { password });
        setAnalysis(freshAnalysis);
      } catch (error) {
        setAnalysis(null);
        setPickError(/password|encrypt/i.test(error?.message || '')
          ? 'This PDF is protected. Enter its password below, then select Analyze PDF.'
          : (error?.message || 'Could not analyze this PDF.'));
        return;
      } finally { setAnalyzing(false); }
    }
    setWorking(true);
    setPickError('');
    setPreviewError('');
    try {
      const options = currentOptions();
      options.hasDigitalSignatures = Boolean(freshAnalysis?.hasDigitalSignatures);
      const result = await compressPdfFile({ ...options, previewOnly: true });
      if (!result || result.error || result.canceled) {
        if (result?.error) setPickError(result.error.message || 'Could not prepare a compression preview.');
        return;
      }
      setPreviewResult(result);
      await renderPreviews(result, file, previewPageNumber);
    } finally { setWorking(false); }
  };

  const renderPreviews = async (result = previewResult, source = file, pageNumber = previewPageNumber) => {
    if (!result?.bytes?.length || !source?.bytes?.length) return;
    setWorking(true);
    setPreviewError('');
    try {
      const safePage = Math.min(Math.max(1, Math.round(Number(pageNumber) || 1), 1), analysis?.pageCount || 1);
      const original = await renderPdfPreview(source.bytes, { password, pageNumber: safePage, maxDimension: 560 });
      const compressed = await renderPdfPreview(result.bytes, { password, pageNumber: Math.min(safePage, result.integrity?.output?.pageCount || analysis?.pageCount || 1), maxDimension: 560 });
      setPreviewImages({ original, compressed });
    } catch (error) {
      setPreviewImages(emptyPreview);
      setPreviewError(/password|encrypt/i.test(error?.message || '') ? 'Enter the source PDF password and analyze the file again.' : (error?.message || 'Could not render the preview.'));
    } finally { setWorking(false); }
  };

  const saveCompressedCopy = async () => {
    if (!file || !previewResult?.bytes?.length) return setPickError('Generate a compression preview before saving.');
    if (protectOutput && (outputPassword.length < 8 || outputPassword.length > 1024)) return setPickError('Use an output password between 8 and 1024 characters.');
    if (protectOutput && outputPassword !== confirmOutputPassword) return setPickError('The output password and confirmation do not match.');
    if (protectOutput && !window.pdfStudio?.lockPdf) return setPickError('Output password protection is available in the PDF Studio desktop app.');
    setWorking(true);
    try {
      const result = await compressPdfFile({ ...currentOptions(), preparedResult: previewResult });
      if (result?.error) setPickError(result.error.message || 'Could not save the compressed PDF.');
    } finally { setWorking(false); }
  };

  const resetPreview = () => { setPreviewResult(null); setPreviewImages(emptyPreview); setPreviewError(''); };
  const presetDetails = COMPRESSION_PRESETS[preset] || COMPRESSION_PRESETS.balanced;
  const effectiveOutput = previewResult?.outputSize ?? null;
  const savedBytes = effectiveOutput == null ? 0 : Math.max(0, file.bytes.byteLength - effectiveOutput);
  const savedPercent = file?.bytes?.byteLength && effectiveOutput != null ? savedBytes / file.bytes.byteLength * 100 : 0;
  const structuralReport = previewResult?.integrity;

  return (
    <Modal title="Compress PDF" eyebrow="SMART PDF SIZE OPTIMIZER" wide onClose={() => setModal(null)}
      onDropFiles={working ? undefined : picker.handleFiles}
      dropHint={{ title: file ? 'Drop a PDF to replace this file' : 'Drop your PDF to compress it', subtitle: 'Release to analyze it. It won’t be added to the workspace.' }}
      footer={<>
      <ActionButton onClick={() => setModal(null)}>Cancel</ActionButton>
      {!previewResult ? <ActionButton variant="primary" icon={Eye} loading={working || analyzing || picking} disabled={!file || (mode === 'target' && !targetBytes)} onClick={previewCompression}>Preview compression</ActionButton> : <>
        <ActionButton icon={RefreshCw} loading={working} disabled={!file} onClick={previewCompression}>Rebuild preview</ActionButton>
        <ActionButton variant="primary" icon={Save} loading={working} disabled={!previewResult?.bytes?.length} onClick={saveCompressedCopy}>Save compressed copy</ActionButton>
      </>}
    </>}>
      <input {...picker.inputProps} />
      <div className="modal-intro">
        <div className="modal-hero-icon modal-hero-blue"><FileArchive size={22}/></div>
        <div><strong>Analyze first, optimize intelligently, then verify the result</strong><p>Smart compression prioritizes image optimization and duplicate removal while preserving selectable text and vector artwork. Whole-page rasterization is off by default.</p></div>
      </div>

      <PdfSourcePicker file={file} pageCount={analysis?.pageCount || null} onBrowse={picker.browse} onClear={file ? clearFile : null}
        picking={picking} disabled={working} error={picker.error} notice={picker.notice}
        emptyTitle="Drop a PDF here to compress it" />

      <div className={`compress-engine-status ${engineInfo === null ? '' : 'is-available'}`} role="status">
        {engineInfo?.available ? <CheckCircle2 size={16}/> : engineInfo === null ? <RefreshCw size={16}/> : <CheckCircle2 size={16}/>}
        <span>{engineInfo === null
          ? 'Checking compression engines…'
          : engineInfo.available
            ? `Smart object optimizer available${engineInfo.version ? ` · Ghostscript ${engineInfo.version}` : ''}. Text/vector content is rewritten as PDF objects, not flattened page images.`
            : 'Built-in image-object optimizer available. Ghostscript is an optional accelerator; compatible embedded images can be recompressed without flattening text or vector content. Some image codecs and encrypted PDFs may need Ghostscript or the explicitly enabled raster fallback.'}</span>
      </div>

      <div className="compress-analysis-head">
        <div><strong>PDF analysis</strong><span>{analysis ? `${analysis.pageCount} pages · ${formatBytes(file?.bytes?.byteLength || 0)}` : 'Inspect page content, resource sizes, and interactive objects before compression.'}</span></div>
        <ActionButton icon={ScanSearch} loading={analyzing} disabled={!file} onClick={() => inspectFile(file, password)}>Analyze PDF</ActionButton>
      </div>
      {analysis && <div className="compress-analysis-grid">
        <div><small>Pages</small><strong>{analysis.pageCount}</strong></div>
        <div><small>Text characters</small><strong>{analysis.textCharacters.toLocaleString()}</strong></div>
        <div><small>Image placements</small><strong>{analysis.imagePaintOperations.toLocaleString()}</strong></div>
        <div><small>Links / fields</small><strong>{analysis.linkCount} / {analysis.widgetCount}</strong></div>
        <div><small>Image object data</small><strong>{analysis.resources?.available ? formatBytes(analysis.resources.imageBytes) : 'N/A'}</strong></div>
        <div><small>Largest image</small><strong>{analysis.resources?.available && analysis.resources.largestImageBytes ? formatBytes(analysis.resources.largestImageBytes) : 'N/A'}</strong></div>
        <div><small>Embedded font streams</small><strong>{analysis.resources?.available ? analysis.resources.embeddedFontStreams : 'N/A'}</strong></div>
        <div><small>Stream payload</small><strong>{analysis.resources?.available ? formatBytes(analysis.resources.streamBytes) : 'N/A'}</strong></div>
        <div><small>Duplicate image estimate</small><strong>{analysis.resources?.available ? analysis.resources.duplicateImageObjects : 'N/A'}</strong></div>
        <div><small>Attachments / bookmarks</small><strong>{analysis.attachmentCount} / {analysis.outlineEntries}</strong></div>
      </div>}
      {analysis?.resources?.warning && <p className="compress-help">{analysis.resources.warning}</p>}
      {analysis?.hasDigitalSignatures && <div className="compress-inline-error" role="alert"><AlertTriangle size={15}/><span>This PDF appears to be digitally signed. Any rewrite can invalidate its signature, so PDF Studio will preserve the original bytes and skip compression.</span></div>}

      <div className="compress-mode-tabs" role="group" aria-label="Compression mode">
        <button type="button" className={mode === 'preset' ? 'is-active' : ''} onClick={() => { setMode('preset'); setPickError(''); }}><SlidersHorizontal size={15}/><span>Preset</span></button>
        <button type="button" className={mode === 'target' ? 'is-active' : ''} onClick={() => { setMode('target'); setPickError(''); }}><Target size={15}/><span>Target size</span></button>
      </div>

      {mode === 'preset' ? <div className="compress-controls">
        <label className="form-label" htmlFor="compress-preset">Compression preset
          <Select id="compress-preset" className="form-input" value={preset} options={PRESET_OPTIONS} ariaLabel="Compression preset" onChange={(next) => { setPreset(next); setQuality(Math.round(COMPRESSION_PRESETS[next].quality * 100)); setResolutionDpi(COMPRESSION_PRESETS[next].dpi); }} />
        </label>
        <div className="compress-preset-description"><CheckCircle2 size={16}/><span>{presetDetails.description}</span></div>
      </div> : <div className="compress-controls compress-target-controls">
        <label className="form-label" htmlFor="compress-target">Target output size
          <div className="compress-target-row">
            <input id="compress-target" className="form-input" type="number" min={targetUnit === 'percent' ? '1' : '0.1'} max={targetUnit === 'percent' ? '100' : '2048'} step={targetUnit === 'percent' ? '1' : '0.1'} value={targetValue} onChange={(event) => { setTargetValue(event.target.value); setPickError(''); }} />
            <Select className="form-input" value={targetUnit} options={TARGET_UNIT_OPTIONS} ariaLabel="Target size unit" onChange={(next) => { setTargetUnit(next); setTargetValue(next === 'percent' ? '50' : '5'); setPickError(''); }} />
          </div>
        </label>
        {file && targetBytes && <div className="compress-target-estimate"><Target size={16}/><span>Requested maximum: <strong>{formatBytes(targetBytes)}</strong> from {formatBytes(file.bytes.byteLength)}</span></div>}
        <p className="compress-help">The compressor measures each result. It reports when the target is unreachable without sacrificing excessive quality or document structure.</p>
      </div>}

      <button type="button" className="compress-advanced-toggle" aria-expanded={showAdvanced} onClick={() => setShowAdvanced((value) => !value)}><Settings2 size={15}/><span>{showAdvanced ? 'Hide' : 'Show'} advanced settings</span><span className="compress-advanced-current">{colorMode === 'color' ? 'Color' : colorMode === 'grayscale' ? 'Grayscale' : 'Black & white'} · {mode === 'target' && !capsTouched ? 'Auto quality' : `${resolutionDpi} DPI`}</span></button>
      {showAdvanced && <div className="compress-advanced-panel">
        <label className="form-label" htmlFor="compress-dpi">Maximum output resolution <strong>{resolutionDpi} DPI</strong>
          <Select id="compress-dpi" className="form-input" value={resolutionDpi} onChange={(next) => { setResolutionDpi(next); setCapsTouched(true); }} options={DPI_OPTIONS} ariaLabel="Image resolution" disabled={mode === 'preset' && preset === 'lossless'} />
        </label>
        <label className="form-label" htmlFor="compress-quality">Image quality <strong>{quality}%</strong>
          <input id="compress-quality" className="compress-quality-range" type="range" min="15" max="95" step="5" value={quality} onChange={(event) => { setQuality(Number(event.target.value)); setCapsTouched(true); }} disabled={mode === 'preset' && preset === 'lossless'} />
          <span className="compress-field-help">Applies to compressed image streams. Vector text and shapes remain resolution independent when smart optimization is used.</span>
        </label>
        <label className="form-label" htmlFor="compress-colormode">Color handling
          <Select id="compress-colormode" className="form-input" value={colorMode} onChange={setColorMode} options={COLOR_MODE_OPTIONS} ariaLabel="Color mode" disabled={mode === 'preset' && preset === 'lossless'} />
        </label>
        <label className="compress-check-row"><input type="checkbox" checked={preserveMetadata} onChange={(event) => setPreserveMetadata(event.target.checked)} disabled={mode === 'preset' && preset === 'lossless'}/><span><strong>Try to preserve document metadata</strong><small>Keep title, author, subject, keywords, and dates where supported by the selected engine.</small></span></label>
        <label className="compress-check-row"><input type="checkbox" checked={includeAnnotations} onChange={(event) => setIncludeAnnotations(event.target.checked)} disabled={mode === 'preset' && preset === 'lossless'}/><span><strong>Include annotations and form appearances in raster fallback</strong><small>The smart object optimizer tries to preserve annotation objects. This setting controls drawing them into the page if you explicitly choose raster fallback.</small></span></label>
        <label className="compress-check-row compress-raster-fallback"><input type="checkbox" checked={allowRasterFallback} onChange={(event) => setAllowRasterFallback(event.target.checked)} disabled={mode === 'preset' && preset === 'lossless'}/><span><strong>Allow whole-page raster fallback (lossy)</strong><small>Only use when smart optimization cannot reach the goal. It flattens page text, vectors, links, and forms into page images.</small></span></label>
        {mode === 'preset' && preset === 'lossless' && <p className="compress-help">Lossless only does not rasterize pages or re-encode images. It preserves the original when no smaller lossless result is available.</p>}
      </div>}

      <label className="compress-check-row compress-protect-toggle"><input type="checkbox" checked={protectOutput} onChange={(event) => { setProtectOutput(event.target.checked); setPickError(''); }} /><span><strong><ShieldCheck size={14}/> Protect compressed output with a password</strong><small>AES-256 protection is applied after preview; the final size may increase slightly and the target is recalculated.</small></span></label>
      {protectOutput && <div className="compress-output-passwords">
        <label className="form-label" htmlFor="compress-output-password">Output password <span>(at least 8 characters)</span><input id="compress-output-password" className="form-input" type="password" autoComplete="new-password" value={outputPassword} onChange={(event) => { setOutputPassword(event.target.value); setPickError(''); }} placeholder="Password for the saved PDF" /></label>
        <label className="form-label" htmlFor="compress-output-password-confirm">Confirm output password<input id="compress-output-password-confirm" className="form-input" type="password" autoComplete="new-password" value={confirmOutputPassword} onChange={(event) => { setConfirmOutputPassword(event.target.value); setPickError(''); }} placeholder="Type it again" /></label>
      </div>}

      <label className="form-label compress-password-label" htmlFor="compress-password">Source PDF password <span>(only if the original is protected)</span>
        <input id="compress-password" className="form-input" type="password" autoComplete="off" value={password} onChange={(event) => { setPassword(event.target.value); setAnalysis(null); setPickError(''); }} placeholder="Leave blank if not protected" />
      </label>

      {previewResult && <section className="compress-result-panel" aria-label="Compression report">
        <div className="compress-result-title"><div><strong>Compression report</strong><span>{previewResult.profile || 'Compression preview'} · {previewResult.engine || 'PDF optimizer'}</span></div><span className={previewResult.unchanged ? 'compress-result-pill is-neutral' : 'compress-result-pill'}>{previewResult.unchanged ? 'No savings' : `${savedPercent.toFixed(1)}% smaller`}</span></div>
        <div className="compress-result-stats">
          <div><small>Original</small><strong>{formatBytes(previewResult.originalSize)}</strong></div>
          <div><small>Preview output</small><strong>{formatBytes(previewResult.outputSize)}</strong></div>
          <div><small>Space saved</small><strong>{formatBytes(savedBytes)}</strong></div>
          <div><small>Target</small><strong>{previewResult.targetBytes ? (previewResult.reachedTarget ? 'Reached' : 'Not reached') : 'Not set'}</strong></div>
        </div>
        {previewResult.imageObjectStats && <div className="compress-image-stats"><CheckCircle2 size={14}/><span>Embedded images: <strong>{Number(previewResult.imageObjectStats.imagesCompressed || 0).toLocaleString()}</strong> optimized of <strong>{Number(previewResult.imageObjectStats.imagesFound || 0).toLocaleString()}</strong> found · {Number(previewResult.imageObjectStats.imagesSkipped || 0).toLocaleString()} skipped (unsupported, already efficient, or too small).</span></div>}
        {previewResult.warnings?.length > 0 && <div className="compress-report-warning"><AlertTriangle size={15}/><span>{previewResult.warnings.join(' ')}</span></div>}
        {structuralReport && !structuralReport.skipped && <div className={`compress-integrity ${structuralReport.valid ? 'is-valid' : 'is-invalid'}`}><span>{structuralReport.valid ? <CheckCircle2 size={15}/> : <AlertTriangle size={15}/>}</span><div><strong>{structuralReport.valid ? 'Structure checks passed' : 'Structure checks flagged differences'}</strong><small>{structuralReport.original?.pageCount === structuralReport.output?.pageCount ? 'Page count and geometry checked' : 'Page structure needs review'} · {structuralReport.textCoveragePercent ?? 'N/A'}% text token coverage · links/forms/attachments compared</small></div></div>}
        <div className="compress-preview-page-control"><label>Compare page <input type="number" min="1" max={analysis?.pageCount || 1} value={previewPageNumber} onChange={(event) => { setPreviewPageNumber(event.target.value); setPreviewImages(emptyPreview); }} /></label><ActionButton icon={RefreshCw} size="sm" loading={working} onClick={() => renderPreviews(previewResult, file, previewPageNumber)}>Update page preview</ActionButton></div>
        {previewError && <div className="compress-inline-error" role="alert"><AlertTriangle size={15}/><span>{previewError}</span></div>}
        {previewImages.original && previewImages.compressed && <div className="compress-visual-compare">
          <div><div className="compress-preview-caption"><strong>Original PDF</strong><span>{formatBytes(file.bytes.byteLength)}</span></div><img src={previewImages.original.dataUrl} alt={`Original PDF page ${previewImages.original.pageNumber}`} /></div>
          <div><div className="compress-preview-caption"><strong>Compressed preview</strong><span>{formatBytes(previewResult.outputSize)}</span></div><img src={previewImages.compressed.dataUrl} alt={`Compressed PDF page ${previewImages.compressed.pageNumber}`} /></div>
        </div>}
        <p className="compress-help">Visual comparison shows one page at reduced preview resolution. Review the full saved PDF for fine print, transparency, forms, annotations, links, bookmarks, and embedded attachments before distributing it.</p>
      </section>}

      {pickError && <div className="compress-inline-error" role="alert"><AlertTriangle size={15}/><span>{pickError}</span></div>}
      {mode === 'preset' && preset === 'lossless'
        ? <div className="modal-note"><CheckCircle2 size={15}/><span>Lossless optimization never rasterizes pages. If it cannot produce a smaller output, the original is retained.</span></div>
        : <div className="modal-note modal-note-warning"><AlertTriangle size={15}/><span>Smart mode targets image streams and preserves vector text/graphics where possible, but a PDF rewrite can alter unsupported metadata or interactive features. Whole-page rasterization is only attempted when you explicitly enable the fallback.</span></div>}
      <div className="compress-privacy-note"><HardDrive size={14}/><span>Processed locally on this computer. No cloud upload.</span></div>
    </Modal>
  );
}
