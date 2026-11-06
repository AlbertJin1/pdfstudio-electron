import { useCallback, useState } from 'react';
import { composePdf, loadPdfSource, pdfToDocx, renderPdfImages } from '../services/pdf/index.js';
import { rasterizePdfForCompression } from '../services/pdf/rasterize.js';
import { compressPdf as compressStandalonePdf, validateCompressionIntegrity } from '../services/pdf/compress.js';
import { saveInBrowser } from '../utils/download.js';
import { cleanFileStem, saveImageExportPrefs } from '../utils/imageExportPrefs.js';
import { parsePageRange } from '../utils/pageRange.js';
import { buildSplitPlan, splitFileName } from '../utils/splitPlan.js';
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


  const convertToWord = useCallback(async (request = 'flow') => {
    const conversionOptions = typeof request === 'string' ? { mode: request } : (request && typeof request === 'object' ? request : {});
    const conversionMode = ['flow', 'auto', 'editable', 'layout', 'visual'].includes(conversionOptions.mode) ? conversionOptions.mode : 'flow';
    const standalone = conversionOptions.file?.bytes ? conversionOptions.file : null; // PDF picked directly for Word: never enters the workspace
    if (!standalone && !pages.length) return notify('Open a PDF before converting it to Word.', 'info');
    setIsLoading(true); setLoadingLabel('Reading PDF layout and text');
    try {
      const pdfBytes = standalone ? standalone.bytes.slice() : await composePdf(pages, sourcesRef.current, { title: 'Converted PDF', author: exportAuthor });
      const conversion = await pdfToDocx(pdfBytes, undefined, {
        mode: conversionMode,
        ocrEnabled: conversionOptions.ocrEnabled !== false,
        ocrLanguage: conversionOptions.ocrLanguage || 'eng',
        title: standalone ? standalone.name.replace(/\.[^.]+$/, '') : (exportTitle || ''),
        onProgress: ({ page, pages: total, phase, profile }) => setLoadingLabel(phase === 'building' ? (profile || 'Building Word document') : phase === 'ocr' ? `OCR · page ${page} of ${total}` : phase === 'validation' ? 'Verifying Word package and text' : (profile || `Reconstructing page ${page} of ${total}`)),
      });
      const baseName = (standalone ? standalone.name.replace(/\.[^.]+$/, '') : exportTitle || (documents.length === 1 ? documents[0].name.replace(/\.[^.]+$/, '') : 'PDF-Studio-converted')).replace(/[\\/:*?"<>|]/g, '-').slice(0, 100);
      const result = window.pdfStudio?.saveFile ? await window.pdfStudio.saveFile({ name: `${baseName}.docx`, data: conversion.bytes, filters: [{ name: 'Word document', extensions: ['docx'] }] }) : await saveInBrowser(conversion.bytes, `${baseName}.docx`, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      if (!result?.canceled) {
        setModal(null);
        const quality = conversion.quality || {};
        const needsReview = conversion.mode !== 'visual'
          && (conversion.pagesWithPartialText || quality.warnings?.length);
        if (conversion.mode !== 'visual') console.info('PDF to Word quality report', quality);
        notify(
          needsReview
            ? (conversion.mode === 'layout' ? 'Saved as layout-preserving Word. Review the result in Word.' : `Saved as Word. ${quality.warnings?.[0] || 'Some content may need review in Word.'}`)
            : `Saved as Word document (${conversion.pages} page${conversion.pages === 1 ? '' : 's'}${quality.tablesReconstructed ? `, ${quality.tablesReconstructed} table${quality.tablesReconstructed === 1 ? '' : 's'}` : ''}${quality.separateWordImageAssets ? `, ${quality.separateWordImageAssets} picture${quality.separateWordImageAssets === 1 ? '' : 's'}` : ''}).`,
          needsReview ? 'info' : 'success',
        );
      }
    } catch (error) { console.error(error); notify(error?.message || 'PDF-to-Word conversion failed.', 'error'); }
    finally { setIsLoading(false); setLoadingLabel('Preparing your workspace'); }
  }, [documents, exportAuthor, exportTitle, notify, pages, setIsLoading, setLoadingLabel, setModal, sourcesRef]);

  const compressPdfFile = useCallback(async ({ file, preset = 'balanced', targetBytes = null, password = '', resolutionDpi, quality, colorMode, preserveMetadata, includeAnnotations, allowRasterFallback = false, scanLike = false, imageObjectCount, duplicateImageEstimate, detectDuplicateImages, outputPassword = '', previewOnly = false, preparedResult = null } = {}) => {
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
          scanLike,
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

  const convertToImages = useCallback(async (request = {}) => {
    const standalone = request.file?.bytes ? request.file : null; // PDF picked or dropped in the dialog: never enters the workspace
    if (!standalone && !pages.length) return notify('Open a PDF before exporting images.', 'info');
    const format = request.format === 'jpeg' ? 'jpeg' : 'png';
    const ext = format === 'jpeg' ? 'jpg' : 'png';
    const quality = Math.min(1, Math.max(0.4, Number(request.quality ?? imageQuality) / 100 || 0.92));
    const dpi = Math.min(600, Math.max(48, Number(request.dpi) || 150));
    const baseName = cleanFileStem(request.baseName || (standalone ? standalone.name.replace(/\.[^.]+$/, '') : (documents.length === 1 ? documents[0].name.replace(/\.[^.]+$/, '') : exportTitle || 'PDF-Studio-document')));
    const folderName = `${baseName}-images`;
    const bridge = window.pdfStudio;
    const desktop = Boolean(bridge?.beginFolderExport);
    if (desktop && !request.parentFolder) return notify('Choose a folder to save the images in.', 'info');

    setIsLoading(true); setLoadingLabel('Preparing pages');
    let pdf = null; let session = null; let written = 0;
    try {
      // 1. Decide which pages of which PDF are rendered, and the number each file is named after.
      let pageNumbers; let labels; let totalForPadding;
      if (standalone) {
        pdf = await loadPdfSource(standalone.bytes.slice());
        totalForPadding = pdf.numPages;
        if (request.scope === 'range') {
          const parsed = parsePageRange(request.rangeText, pdf.numPages);
          if (parsed.error) throw new Error(parsed.error);
          pageNumbers = parsed.pages;
        } else pageNumbers = Array.from({ length: pdf.numPages }, (_, index) => index + 1);
        labels = pageNumbers;
      } else {
        let chosen;
        if (request.scope === 'selected' && selectedPages.length) {
          const ids = new Set(selectedPages.map((page) => page.id));
          chosen = pages.map((page, index) => ({ page, label: index + 1 })).filter((entry) => ids.has(entry.page.id));
        } else if (request.scope === 'range') {
          const parsed = parsePageRange(request.rangeText, pages.length);
          if (parsed.error) throw new Error(parsed.error);
          chosen = parsed.pages.map((number) => ({ page: pages[number - 1], label: number }));
        } else chosen = pages.map((page, index) => ({ page, label: index + 1 }));
        if (!chosen.length) throw new Error('There are no pages to export.');
        totalForPadding = pages.length;
        const pdfBytes = await composePdf(chosen.map((entry) => entry.page), sourcesRef.current, { title: 'PDF Studio image export', author: exportAuthor });
        pdf = await loadPdfSource(pdfBytes);
        pageNumbers = chosen.map((_, index) => index + 1);
        labels = chosen.map((entry) => entry.label);
      }
      const pad = Math.max(3, String(totalForPadding).length);
      const fileName = (index) => `${baseName}-page-${String(labels[index]).padStart(pad, '0')}.${ext}`;

      // 2. Open the destination before the slow work so a bad folder fails fast.
      let writeImage; let destination = '';
      if (desktop) {
        session = await bridge.beginFolderExport({ parent: request.parentFolder, folderName });
        destination = session.folder;
        writeImage = (name, data) => bridge.writeFolderExport({ token: session.token, name, data });
      } else if (request.directoryHandle) {
        let target = null;
        for (let attempt = 1; attempt <= 500 && !target; attempt += 1) {
          const candidate = attempt === 1 ? folderName : `${folderName} (${attempt})`;
          try { await request.directoryHandle.getDirectoryHandle(candidate); } catch { target = candidate; }
        }
        const dir = await request.directoryHandle.getDirectoryHandle(target, { create: true });
        destination = `${request.directoryHandle.name}/${target}`;
        writeImage = async (name, data) => { const handle = await dir.getFileHandle(name, { create: true }); const writable = await handle.createWritable(); await writable.write(data); await writable.close(); };
      } else {
        writeImage = (name, data) => saveInBrowser(data, name, format === 'jpeg' ? 'image/jpeg' : 'image/png');
        destination = 'your Downloads folder';
      }

      // 3. Render and write one page at a time.
      await renderPdfImages(pdf, pageNumbers, {
        format, quality, dpi,
        onProgress: ({ index, total }) => setLoadingLabel(`Exporting page ${index + 1} of ${total}`),
        onImage: async ({ data, index }) => { await writeImage(fileName(index), data); written += 1; },
      });

      saveImageExportPrefs({ folder: desktop ? request.parentFolder : '', dpi });
      if (session) { await bridge.finishFolderExport({ token: session.token, open: request.openWhenDone !== false }); session = null; }
      setModal(null);
      notify(`${written} image${written === 1 ? '' : 's'} exported to ${destination}.`);
    } catch (error) {
      console.error(error);
      notify(error?.message || 'Image export failed.', 'error');
    } finally {
      if (session) { try { await bridge.finishFolderExport({ token: session.token, open: false }); } catch { /* ignore */ } }
      try { await pdf?.destroy?.(); } catch { /* ignore */ }
      setIsLoading(false); setLoadingLabel('Preparing your workspace');
    }
  }, [documents, exportAuthor, exportTitle, imageQuality, notify, pages, selectedPages, setIsLoading, setLoadingLabel, setModal, sourcesRef]);

  const splitPdf = useCallback(async (request = {}) => {
    const standalone = request.file?.bytes ? request.file : null; // PDF picked or dropped in the dialog: never enters the workspace
    if (!standalone && !pages.length) return notify('Open a PDF before splitting.', 'info');
    const baseName = cleanFileStem(request.baseName || (standalone ? standalone.name.replace(/\.[^.]+$/, '') : (documents.length === 1 ? documents[0].name.replace(/\.[^.]+$/, '') : exportTitle || 'PDF-Studio-document')));
    const folderName = `${baseName}-split`;
    const bridge = window.pdfStudio;
    const desktop = Boolean(bridge?.beginFolderExport);
    if (desktop && !request.parentFolder) return notify('Choose a folder to save the files in.', 'info');

    setIsLoading(true); setLoadingLabel('Reading PDF');
    let session = null; let written = 0;
    try {
      // 1. One source PDF: the picked file as-is, or the whole workspace (edits, rotation and order baked in) composed once.
      const sourceBytes = standalone ? standalone.bytes.slice() : await composePdf(pages, sourcesRef.current, { title: baseName, author: exportAuthor });
      const { PDFDocument } = await import('pdf-lib');
      let source;
      try { source = await PDFDocument.load(sourceBytes, { ignoreEncryption: false }); }
      catch (error) { throw new Error(/encrypt|password/i.test(error?.message || '') ? 'This PDF is password-protected. Remove the password first, then split it.' : 'This PDF could not be read for splitting. It may be damaged.'); }
      const total = source.getPageCount();
      const plan = buildSplitPlan({ mode: request.mode, every: request.every, rangeText: request.rangeText, total });
      if (plan.error) throw new Error(plan.error);
      if (!plan.groups.length) throw new Error('There are no pages to split.');

      // 2. Open the destination before the slow work so a bad folder fails fast.
      let writeFile; let destination = '';
      if (desktop) {
        session = await bridge.beginFolderExport({ parent: request.parentFolder, folderName });
        destination = session.folder;
        writeFile = (name, data) => bridge.writeFolderExport({ token: session.token, name, data });
      } else if (request.directoryHandle) {
        let target = null;
        for (let attempt = 1; attempt <= 500 && !target; attempt += 1) {
          const candidate = attempt === 1 ? folderName : `${folderName} (${attempt})`;
          try { await request.directoryHandle.getDirectoryHandle(candidate); } catch { target = candidate; }
        }
        const dir = await request.directoryHandle.getDirectoryHandle(target, { create: true });
        destination = `${request.directoryHandle.name}/${target}`;
        writeFile = async (name, data) => { const handle = await dir.getFileHandle(name, { create: true }); const writable = await handle.createWritable(); await writable.write(data); await writable.close(); };
      } else {
        writeFile = (name, data) => saveInBrowser(data, name, 'application/pdf');
        destination = 'your Downloads folder';
      }

      // 3. Build and write one part at a time so memory stays flat for large documents.
      const author = source.getAuthor() || exportAuthor || 'PDF Studio';
      for (let index = 0; index < plan.groups.length; index += 1) {
        const group = plan.groups[index];
        setLoadingLabel(`Creating file ${index + 1} of ${plan.groups.length}`);
        const part = await PDFDocument.create();
        const indices = Array.from({ length: group.end - group.start + 1 }, (_, offset) => group.start - 1 + offset);
        for (const copied of await part.copyPages(source, indices)) part.addPage(copied);
        part.setTitle(`${baseName} (${group.start === group.end ? `page ${group.start}` : `pages ${group.start}–${group.end}`})`);
        part.setAuthor(author); part.setCreator('PDF Studio for Desktop'); part.setProducer('PDF Studio'); part.setCreationDate(new Date());
        await writeFile(splitFileName(baseName, group, total), await part.save());
        written += 1;
      }

      saveImageExportPrefs({ folder: desktop ? request.parentFolder : '' });
      if (session) { await bridge.finishFolderExport({ token: session.token, open: request.openWhenDone !== false }); session = null; }
      setModal(null);
      notify(`${written} PDF file${written === 1 ? '' : 's'} saved to ${destination}.`);
    } catch (error) {
      console.error(error);
      notify(error?.message || 'Could not split this PDF.', 'error');
    } finally {
      if (session) { try { await bridge.finishFolderExport({ token: session.token, open: false }); } catch { /* ignore */ } }
      setIsLoading(false); setLoadingLabel('Preparing your workspace');
    }
  }, [documents, exportAuthor, exportTitle, notify, pages, setIsLoading, setLoadingLabel, setModal, sourcesRef]);

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
    doExportPdf,
    convertToWord,
    compressPdfFile,
    convertToImages,
    splitPdf,
  };
}
