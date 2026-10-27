import { useCallback, useMemo, useRef, useState } from 'react';
import { pickPdfFromFiles } from '../utils/pdfFiles.js';

/**
 * One selection flow for "choose a PDF" dialogs: Browse button, native dialog (desktop app) or hidden
 * <input> (browser), and files dropped onto the dialog all end up in onFile(item).
 *
 *   const picker = usePdfPicker({ onFile: (item) => setFile(item) });
 *   <input {...picker.inputProps} />
 *   <Modal onDropFiles={picker.handleFiles} … />
 *   <PdfSourcePicker onBrowse={picker.browse} error={picker.error} notice={picker.notice} … />
 */
export function usePdfPicker({ onFile }) {
  const inputRef = useRef(null);
  const onFileRef = useRef(onFile);
  onFileRef.current = onFile;
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const clearMessages = useCallback(() => { setError(''); setNotice(''); }, []);

  const accept = useCallback((item, ignored = 0) => {
    setError('');
    setNotice(ignored > 0 ? `Only one PDF can be used at a time, so “${item.name}” was selected and ${ignored === 1 ? 'the other file was' : `${ignored} other files were`} ignored.` : '');
    onFileRef.current?.(item);
  }, []);

  // Drop target and <input> both arrive here with real browser File objects.
  const handleFiles = useCallback(async (files) => {
    const result = await pickPdfFromFiles(files);
    if (result.error) { setNotice(''); setError(result.error); return; }
    accept(result.item, result.ignored);
  }, [accept]);

  const browse = useCallback(async () => {
    setError('');
    if (window.pdfStudio?.openFiles) {
      setPicking(true);
      try {
        const items = await window.pdfStudio.openFiles({ pdfOnly: true });
        const item = items?.[0];
        if (item) {
          if (!item.bytes?.length) setError(`“${item.name || 'That file'}” is empty.`);
          else accept({ ...item, mime: 'application/pdf', kind: 'pdf' });
        }
      } catch (caught) {
        setError(caught?.message || 'Could not open the file picker.');
      } finally { setPicking(false); }
    } else inputRef.current?.click();
  }, [accept]);

  const inputProps = useMemo(() => ({
    ref: inputRef,
    type: 'file',
    accept: '.pdf,application/pdf',
    className: 'hidden-input',
    tabIndex: -1,
    'aria-hidden': true,
    onChange: (event) => {
      const files = Array.from(event.target.files || []);
      event.target.value = ''; // lets the same file be picked again after Remove
      if (files.length) void handleFiles(files);
    },
  }), [handleFiles]);

  return { browse, handleFiles, picking, error, notice, setError, clearMessages, inputProps };
}
