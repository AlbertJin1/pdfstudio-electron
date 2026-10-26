import { useCallback, useState } from 'react';
import { composePdf, loadPdfSource, pdfToDocx, renderPdfImages } from '../services/pdf/index.js';
import { saveInBrowser } from '../utils/download.js';
import { uid } from '../utils/id.js';

export function useExporters({ pages, selectedPages, documents, sourcesRef, notify, setModal, setIsLoading, setLoadingLabel, imageFormat, imageQuality }) {
  const [exportTitle, setExportTitle] = useState('');
  const [exportAuthor, setExportAuthor] = useState('PDF Studio');
  const [exportPageNumbers, setExportPageNumbers] = useState(false);
  const [exportWatermark, setExportWatermark] = useState('');
  const [splitMode, setSplitMode] = useState('each');
  const [splitEvery, setSplitEvery] = useState('2');
  const [splitRanges, setSplitRanges] = useState('1-3, 4-6');

  const doExportPdf = useCallback(async (onlySelected = false) => {
    const exportPages = onlySelected ? selectedPages : pages;
    if (!exportPages.length) return notify('There are no pages to export.', 'error');
    setIsLoading(true); setLoadingLabel('Building your PDF');
    try {
      const bytes = await composePdf(exportPages, sourcesRef.current, { title: exportTitle || 'PDF Studio document', author: exportAuthor || 'PDF Studio', pageNumbers: exportPageNumbers, watermark: exportWatermark });
      const name = `${(exportTitle || (documents.length === 1 ? documents[0].name.replace(/\.[^.]+$/, '') : 'PDF-Studio-document')).replace(/[\\/:*?"<>|]/g, '-').slice(0, 100)}.pdf`;
      let result;
      if (window.pdfStudio?.saveFile) result = await window.pdfStudio.saveFile({ name, data: bytes, filters: [{ name: 'PDF document', extensions: ['pdf'] }] });
      else result = await saveInBrowser(bytes, name, 'application/pdf');
      if (result?.canceled) return;
      setModal(null);
      notify(`PDF exported${result?.filePath ? ` to ${result.filePath}` : ''}.`);
    } catch (error) { console.error(error); notify(error?.message || 'PDF export failed.', 'error'); }
    finally { setIsLoading(false); setLoadingLabel('Preparing your workspace'); }
  }, [documents, exportAuthor, exportPageNumbers, exportTitle, exportWatermark, notify, pages, selectedPages]);


  const convertToWord = useCallback(async () => {
    if (!pages.length) return notify('Open a PDF before converting it to Word.', 'info');
    setIsLoading(true); setLoadingLabel('Extracting text and preparing DOCX');
    try {
      const pdfBytes = await composePdf(pages, sourcesRef.current, { title: 'Converted PDF', author: exportAuthor });
      const docxBytes = await pdfToDocx(pdfBytes);
      const baseName = (exportTitle || 'PDF-Studio-converted').replace(/[\\/:*?"<>|]/g, '-').slice(0, 100);
      const result = window.pdfStudio?.saveFile ? await window.pdfStudio.saveFile({ name: `${baseName}.docx`, data: docxBytes, filters: [{ name: 'Word document', extensions: ['docx'] }] }) : await saveInBrowser(docxBytes, `${baseName}.docx`, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      if (!result?.canceled) { setModal(null); notify('Editable Word document exported. Complex layouts and images may need manual adjustment.'); }
    } catch (error) { console.error(error); notify(error?.message || 'PDF-to-Word conversion failed.', 'error'); }
    finally { setIsLoading(false); setLoadingLabel('Preparing your workspace'); }
  }, [exportAuthor, exportTitle, notify, pages]);

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
    exportWatermark,
    setExportWatermark,
    splitMode,
    setSplitMode,
    splitEvery,
    setSplitEvery,
    splitRanges,
    setSplitRanges,
    doExportPdf,
    convertToWord,
    convertToImages,
    splitPdf,
  };
}
