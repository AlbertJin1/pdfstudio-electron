import { useCallback, useState } from 'react';
import { composePdf, loadPdfSource, pdfToDocx, renderPdfImages } from '../services/pdf/index.js';
import { rasterizePdfForCompression } from '../services/pdf/rasterize.js';
import { compressPdf as compressStandalonePdf, validateCompressionIntegrity } from '../services/pdf/compress.js';
import { saveInBrowser } from '../utils/download.js';
import { uid } from '../utils/id.js';
import { formatBytes } from '../utils/format.js';

export function useExporters({ pages, selectedPages, documents, sourcesRef, notify, setModal, setIsLoading, setLoadingLabel, imageFormat, imageQuality }) {
  const [exportTitle, setExportTitle] = useState('');
  const [exportAuthor, setExportAuthor] = useState('PDF Studio');
  const [exportPageNumbers, setExportPageNumbers] = useState(false);
  const [exportWatermarkMode, setExportWatermarkMode] = useState('none');
  const [exportWatermark, setExportWatermark] = useState('');
  const [exportWatermarkOpacity, setExportWatermarkOpacity] = useState('32');
  const [exportWatermarkAngle, setExportWatermarkAngle] = useState('35');
  const [exportWatermarkColor, setExportWatermarkColor] = useState('#626b7c');
  const [exportPaperSize, setExportPaperSize] = useState('original');
  const [exportCompression, setExportCompression] = useState('lossless');
  const [exportPassword, setExportPassword] = useState('');
  const [splitMode, setSplitMode] = useState('each');
  const [splitEvery, setSplitEvery] = useState('2');
  const [splitRanges, setSplitRanges] = useState('1-3, 4-6');

  const doExportPdf = useCallback(async (onlySelected = false) => {
    const exportPages = onlySelected ? selectedPages : pages;
    if (!exportPages.length) return notify('There are no pages to export.', 'error');
    if (exportPassword && exportPassword.length < 8) return notify('Use at least 8 characters for the PDF password.', 'error');
    setIsLoading(true); setLoadingLabel('Building your PDF');
    try {
      const watermarkPresets = { draft: 'DRAFT', confidential: 'CONFIDENTIAL', internal: 'INTERNAL USE ONLY' };
      const watermarkText = exportWatermarkMode === 'custom'
        ? exportWatermark.trim()
        : (watermarkPresets[exportWatermarkMode] || '');
      let bytes = await composePdf(exportPages, sourcesRef.current, {
        title: exportTitle || 'PDF Studio document',
        author: exportAuthor || 'PDF Studio',
        pageNumbers: exportPageNumbers,
        watermark: watermarkText,
        watermarkOpacity: Number(exportWatermarkOpacity) / 100,
        watermarkAngle: Number(exportWatermarkAngle),
        watermarkColor: exportWatermarkColor,
        paperSize: exportPaperSize,
      });

      if (exportCompression === 'compact' || exportCompression === 'smallest') {
        setLoadingLabel(exportCompression === 'compact' ? 'Creating compact page images' : 'Creating smallest-size page images');
        bytes = await rasterizePdfForCompression(bytes, {
          maxDimension: exportCompression === 'compact' ? 1800 : 1200,
          quality: exportCompression === 'compact' ? 0.78 : 0.64,
          title: exportTitle || 'PDF Studio document',
          author: exportAuthor || 'PDF Studio',
        });
      }

      const name = `${(exportTitle || (documents.length === 1 ? documents[0].name.replace(/\.[^.]+$/, '') : 'PDF-Studio-document')).replace(/[\\/:*?"<>|]/g, '-').slice(0, 100)}.pdf`;
      let result;
      if (window.pdfStudio?.saveFinalizedPdf) {
        setLoadingLabel(exportPassword
          ? 'Encrypting PDF with AES-256 in a background worker'
          : exportCompression !== 'none'
            ? 'Optimizing PDF in a background worker'
            : 'Saving PDF');
        result = await window.pdfStudio.saveFinalizedPdf({
          name,
          data: bytes,
          filters: [{ name: 'PDF document', extensions: ['pdf'] }],
          options: { compress: exportCompression !== 'none', password: exportPassword || '' },
        });
      } else {
        if (exportPassword || exportCompression !== 'none') {
          throw new Error('Password protection and QPDF optimization are available in the PDF Studio desktop app. Open the desktop app and export again.');
        }
        result = await saveInBrowser(bytes, name, 'application/pdf');
      }
      if (result?.canceled) return;
      setModal(null);
      setExportPassword('');
      notify(`PDF exported${result?.filePath ? ` to ${result.filePath}` : ''}.`);
    } catch (error) { console.error(error); notify(error?.message || 'PDF export failed.', 'error'); }
    finally { setIsLoading(false); setLoadingLabel('Preparing your workspace'); }
  }, [documents, exportAuthor, exportCompression, exportPageNumbers, exportPaperSize, exportPassword, exportTitle, exportWatermark, exportWatermarkAngle, exportWatermarkColor, exportWatermarkMode, exportWatermarkOpacity, notify, pages, selectedPages, setIsLoading, setLoadingLabel, setModal, sourcesRef]);


  const convertToWord = useCallback(async (request = 'editable') => {
    const conversionOptions = typeof request === 'string' ? { mode: request } : (request && typeof request === 'object' ? request : {});
    const conversionMode = ['auto', 'editable', 'layout', 'visual'].includes(conversionOptions.mode) ? conversionOptions.mode : 'auto';
    const standalone = conversionOptions.file?.bytes ? conversionOptions.file : null; // PDF picked directly for Word: never enters the workspace
    if (!standalone && !pages.length) return notify('Open a PDF before converting it to Word.', 'info');
    setIsLoading(true); setLoadingLabel('Reading PDF layout and text');
    try {
      const pdfBytes = standalone ? standalone.bytes.slice() : await composePdf(pages, sourcesRef.current, { title: 'Converted PDF', author: exportAuthor });
      const conversion = await pdfToDocx(pdfBytes, undefined, {
        mode: conversionMode,
        ocrEnabled: conversionOptions.ocrEnabled !== false,
        ocrLanguage: conversionOptions.ocrLanguage || 'eng',
        onProgress: ({ page, pages: total, phase, profile }) => setLoadingLabel(phase === 'building' ? (profile || 'Building Word document') : phase === 'ocr' ? `OCR · page ${page} of ${total}` : phase === 'validation' ? 'Verifying Word package and text' : (profile || `Reconstructing page ${page} of ${total}`)),
      });
      const baseName = (standalone ? standalone.name.replace(/\.[^.]+$/, '') : exportTitle || (documents.length === 1 ? documents[0].name.replace(/\.[^.]+$/, '') : 'PDF-Studio-converted')).replace(/[\\/:*?"<>|]/g, '-').slice(0, 100);
      const result = window.pdfStudio?.saveFile ? await window.pdfStudio.saveFile({ name: `${baseName}.docx`, data: conversion.bytes, filters: [{ name: 'Word document', extensions: ['docx'] }] }) : await saveInBrowser(conversion.bytes, `${baseName}.docx`, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      if (!result?.canceled) {
        setModal(null);
        const quality = conversion.quality || {};
        const needsReview = conversion.mode !== 'visual'
          && (conversion.pagesWithoutText || conversion.pagesWithPartialText || quality.warnings?.length);
        if (conversion.mode !== 'visual') console.info('PDF to Word quality report', quality);
        notify(
          needsReview ? (conversion.mode === 'layout' ? 'Saved as layout-preserving Word. Review the result in Word.' : 'Saved as Word. Some content may need review in Word.') : 'Saved as Word document.',
          needsReview ? 'info' : 'success',
        );
      }
    } catch (error) { console.error(error); notify(error?.message || 'PDF-to-Word conversion failed.', 'error'); }
    finally { setIsLoading(false); setLoadingLabel('Preparing your workspace'); }
  }, [documents, exportAuthor, exportTitle, notify, pages, setIsLoading, setLoadingLabel, setModal, sourcesRef]);

  const compressPdfFile = useCallback(async ({ file, preset = 'balanced', targetBytes = null, password = '', resolutionDpi, quality, colorMode, preserveMetadata, includeAnnotations, allowRasterFallback = false, imageObjectCount, duplicateImageEstimate, detectDuplicateImages, outputPassword = '', previewOnly = false, preparedResult = null } = {}) => {
    if (!file?.bytes?.length) return notify('Choose a PDF file before starting compression.', 'info');
    const originalName = String(file.name || 'document.pdf').replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]/g, '-').slice(0, 100) || 'document';
    setIsLoading(true);
    setLoadingLabel(previewOnly ? 'Analyzing and preparing compression preview' : 'Analyzing PDF size and compression options');
    try {
      let compressed;
      // Probe once; with no Ghostscript the smart path is skipped entirely (no failed IPC calls, no noisy logs).
      let smartAvailable = Boolean(window.pdfStudio?.smartCompressPdf);
      if (smartAvailable && window.pdfStudio?.getPdfCompressionEngineInfo) {
        try { smartAvailable = Boolean((await window.pdfStudio.getPdfCompressionEngineInfo())?.available); } catch { smartAvailable = false; }
      }
      if (preparedResult?.bytes?.byteLength) {
        compressed = { ...preparedResult, bytes: preparedResult.bytes instanceof Uint8Array ? preparedResult.bytes.slice() : new Uint8Array(preparedResult.bytes) };
      } else {
        compressed = await compressStandalonePdf(file.bytes, {
          preset,
          targetBytes,
          password,
          resolutionDpi,
          quality,
          colorMode,
          preserveMetadata,
          includeAnnotations,
          allowRasterFallback,
          imageObjectCount,
          duplicateImageEstimate,
          detectDuplicateImages,
          losslessOptimize: window.pdfStudio?.optimizePdf ? async (bytes) => window.pdfStudio.optimizePdf({ data: bytes }) : undefined,
          smartOptimize: smartAvailable ? async (bytes, profile) => {
            const result = await window.pdfStudio.smartCompressPdf({ data: bytes, options: profile });
            if (result?.unavailable) throw new Error(result.reason || 'Ghostscript is unavailable.');
            return result;
          } : undefined,
          onProgress: (progress) => {
            if (progress.phase === 'smart' || progress.phase === 'attempt' || progress.phase === 'refine' || progress.phase === 'raster') {
              setLoadingLabel(`${progress.phase === 'raster' ? 'Raster fallback' : progress.phase === 'smart' ? 'Smart optimization' : 'Trying'}: ${progress.profile || 'compression'} (${progress.attempt || 1}/${progress.attempts || 1})`);
            } else if (progress.phase === 'images') {
              const item = progress.imageIndex && progress.totalImages ? ` · image ${progress.imageIndex}/${progress.totalImages}` : '';
              setLoadingLabel(`Recompressing embedded images: ${progress.profile || 'image optimization'}${item}`);
            } else if (progress.phase === 'rendering') {
              setLoadingLabel(`Compressing page ${progress.page || 1} of ${progress.pages || '?'} · ${progress.profile || 'optimizing'}`);
            } else if (progress.phase === 'analysis') {
              setLoadingLabel(`Analyzing page ${progress.page || 1} of ${progress.pages || '?'}`);
            } else {
              setLoadingLabel(`Preparing ${progress.profile || 'PDF compression'}`);
            }
          },
        });
      }

      if (previewOnly) return { canceled: false, ...compressed, previewOnly: true, name: `${originalName}-compressed.pdf` };

      if (outputPassword) {
        if (!window.pdfStudio?.lockPdf) throw new Error('Password protection requires the PDF Studio desktop app.');
        setLoadingLabel('Applying AES-256 password protection');
        const protectedBytes = await window.pdfStudio.lockPdf({ data: compressed.bytes, password: outputPassword });
        compressed.bytes = protectedBytes instanceof Uint8Array ? protectedBytes : new Uint8Array(protectedBytes);
        compressed.outputSize = compressed.bytes.byteLength;
        compressed.reachedTarget = targetBytes ? compressed.outputSize <= targetBytes : true;
        compressed.unchanged = compressed.outputSize >= compressed.originalSize;
        compressed.reductionPercent = Math.max(0, (1 - compressed.outputSize / compressed.originalSize) * 100);
        if (targetBytes) compressed.targetDifferenceBytes = compressed.outputSize - targetBytes;
        compressed.profile = `${compressed.profile} + AES-256 protection`;
        if (['Ghostscript pdfwrite', 'Built-in PDF image-object optimizer'].includes(compressed.engine)) {
          setLoadingLabel('Validating protected PDF structure');
          const finalIntegrity = await validateCompressionIntegrity(file.bytes, compressed.bytes, { password, outputPassword });
          compressed.integrity = finalIntegrity;
          if (!finalIntegrity.valid) throw new Error(`The compressed output did not pass integrity validation: ${finalIntegrity.errors.join(' ')}`);
        }
      }
      const outputName = `${originalName}-compressed.pdf`;
      const result = window.pdfStudio?.saveFile
        ? await window.pdfStudio.saveFile({ name: outputName, data: compressed.bytes, filters: [{ name: 'PDF document', extensions: ['pdf'] }] })
        : await saveInBrowser(compressed.bytes, outputName, 'application/pdf');
      if (result?.canceled) return { canceled: true };
      setModal(null);
      const reduction = Math.max(0, (1 - compressed.outputSize / compressed.originalSize) * 100);
      const savedBytes = Math.max(0, compressed.originalSize - compressed.outputSize);
      const sizeMessage = `${formatBytes(compressed.originalSize)} → ${formatBytes(compressed.outputSize)}${reduction > 0 ? ` (${reduction.toFixed(1)}% smaller; saved ${formatBytes(savedBytes)})` : ' (no size reduction was possible without changing the encoding)'}`;
      const warning = (compressed.warnings || []).filter(Boolean).join(' ');
      if (targetBytes && !compressed.reachedTarget) {
        notify(`Compressed PDF saved${result?.filePath ? ` to ${result.filePath}` : ''}: ${sizeMessage}, but the requested ${formatBytes(targetBytes)} target could not be reached. ${warning}`, 'info');
      } else if (compressed.unchanged) {
        const note = compressed.warning ? ` ${compressed.warning}` : ' No size reduction was possible with this profile, so the original encoding was kept.';
        notify(`PDF copy saved. ${sizeMessage}.${note}`, 'info');
      } else {
        notify(`Compressed PDF saved${result?.filePath ? ` to ${result.filePath}` : ''}. ${sizeMessage}. ${compressed.engine ? `Engine: ${compressed.engine}. ` : ''}${warning}`, 'success');
      }
      return { canceled: false, ...compressed, filePath: result?.filePath };
    } catch (error) {
      console.error(error);
      const message = /password/i.test(error?.message || '') ? 'This PDF is password-protected. Check the password and try again.' : (error?.message || 'PDF compression failed.');
      notify(message, 'error');
      return { error };
    } finally {
      setIsLoading(false);
      setLoadingLabel('Preparing your workspace');
    }
  }, [notify, setIsLoading, setLoadingLabel, setModal]);

  const convertToImages = useCallback(async () => {
    if (!pages.length) return notify('Open a document before exporting images.', 'info');
    const exportPages = selectedPages.length > 0 ? selectedPages : pages;
    setIsLoading(true); setLoadingLabel('Rendering pages as images');
    try {
      const pdfBytes = await composePdf(exportPages, sourcesRef.current, { title: 'PDF Studio image export', author: exportAuthor });
      const pdf = await loadPdfSource(pdfBytes);
      const sourceId = uid();
      const map = new Map([[sourceId, { id: sourceId, name: 'Export', mime: 'application/pdf', kind: 'pdf', bytes: pdfBytes, pdf }]]);
      const rasterPages = Array.from({ length: pdf.numPages }, (_, index) => ({ id: uid(), sourceId, kind: 'pdf', sourcePageIndex: index, rotation: 0, overlays: [] }));
      const outputs = await renderPdfImages(map, rasterPages, { format: imageFormat, quality: Number(imageQuality) / 100, maxDimension: 1900 });
      if (window.pdfStudio?.saveBatch) {
        const result = await window.pdfStudio.saveBatch(outputs);
        if (result?.canceled) return;
        setModal(null); notify(`${result.count} image${result.count === 1 ? '' : 's'} exported to ${result.folder}.`);
      } else {
        for (const output of outputs) await saveInBrowser(output.data, output.name, imageFormat === 'jpeg' ? 'image/jpeg' : 'image/png');
        setModal(null); notify(`${outputs.length} images exported.`);
      }
    } catch (error) { console.error(error); notify(error?.message || 'Image export failed.', 'error'); }
    finally { setIsLoading(false); setLoadingLabel('Preparing your workspace'); }
  }, [exportAuthor, imageFormat, imageQuality, notify, pages, selectedPages]);

  const splitPdf = useCallback(async () => {
    if (!pages.length) return notify('Open a PDF before splitting.', 'info');
    let groups = [];
    if (splitMode === 'each') groups = pages.map((page) => [page]);
    else if (splitMode === 'every') {
      const size = Math.max(1, Math.min(500, Number(splitEvery) || 2));
      for (let index = 0; index < pages.length; index += size) groups.push(pages.slice(index, index + size));
    } else {
      const ranges = splitRanges.split(',').map((part) => part.trim()).filter(Boolean);
      for (const range of ranges) {
        const match = range.match(/^(\d+)\s*(?:-\s*(\d+))?$/);
        if (!match) return notify(`Invalid page range: “${range}”. Use values such as 1-3, 5, 8-10.`, 'error');
        const start = Number(match[1]); const end = Number(match[2] || match[1]);
        if (start < 1 || end < start || end > pages.length) return notify(`Range “${range}” is outside the current 1–${pages.length} page workspace.`, 'error');
        groups.push(pages.slice(start - 1, end));
      }
    }
    setIsLoading(true); setLoadingLabel('Preparing split files');
    try {
      const outputs = [];
      for (let index = 0; index < groups.length; index += 1) {
        const bytes = await composePdf(groups[index], sourcesRef.current, { title: `PDF Studio split ${index + 1}`, author: exportAuthor });
        outputs.push({ name: `split-${String(index + 1).padStart(2, '0')}.pdf`, data: bytes });
      }
      if (window.pdfStudio?.saveBatch) {
        const result = await window.pdfStudio.saveBatch(outputs);
        if (result?.canceled) return;
        setModal(null); notify(`${result.count} PDF file${result.count === 1 ? '' : 's'} saved to ${result.folder}.`);
      } else {
        for (const output of outputs) await saveInBrowser(output.data, output.name, 'application/pdf');
        setModal(null); notify(`${outputs.length} split files exported.`);
      }
    } catch (error) { console.error(error); notify(error?.message || 'Could not split this workspace.', 'error'); }
    finally { setIsLoading(false); setLoadingLabel('Preparing your workspace'); }
  }, [exportAuthor, notify, pages, splitEvery, splitMode, splitRanges]);

  return {
    exportTitle,
    setExportTitle,
    exportAuthor,
    setExportAuthor,
    exportPageNumbers,
    setExportPageNumbers,
    exportWatermarkMode,
    setExportWatermarkMode,
    exportWatermark,
    setExportWatermark,
    exportWatermarkOpacity,
    setExportWatermarkOpacity,
    exportWatermarkAngle,
    setExportWatermarkAngle,
    exportWatermarkColor,
    setExportWatermarkColor,
    exportPaperSize,
    setExportPaperSize,
    exportCompression,
    setExportCompression,
    exportPassword,
    setExportPassword,
    splitMode,
    setSplitMode,
    splitEvery,
    setSplitEvery,
    splitRanges,
    setSplitRanges,
    doExportPdf,
    convertToWord,
    compressPdfFile,
    convertToImages,
    splitPdf,
  };
}
