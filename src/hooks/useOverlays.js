import { useCallback, useState } from 'react';

export function useOverlays({ activePage, selectedIds, commitPages, setModal, notify }) {
  const [textValue, setTextValue] = useState('Confidential');
  const [textColor, setTextColor] = useState('#6e54ea');
  const [textSize, setTextSize] = useState('18');
  const [coverColor, setCoverColor] = useState('#242638');

  const addTextOverlay = useCallback(() => {
    if (!activePage) return notify('Choose a page before adding text.', 'info');
    commitPages((current) => current.map((page) => selectedIds.includes(page.id) ? { ...page, overlays: [...(page.overlays || []), { type: 'text', text: textValue.trim() || 'Text', x: 9, y: 15, size: Number(textSize) || 18, color: textColor }] } : page));
    setModal(null);
    notify(`Text added to ${selectedIds.length || 1} page${(selectedIds.length || 1) > 1 ? 's' : ''}.`);
  }, [activePage, commitPages, notify, selectedIds, textColor, textSize, textValue]);

  const addCoverOverlay = useCallback(() => {
    if (!activePage) return notify('Choose a page before covering an area.', 'info');
    commitPages((current) => current.map((page) => selectedIds.includes(page.id) ? { ...page, overlays: [...(page.overlays || []), { type: 'rect', x: 9, y: 16, width: 36, height: 7, color: coverColor }] } : page));
    setModal(null);
    notify('Cover block added. Note: a cover overlay is not a certified redaction.');
  }, [activePage, commitPages, coverColor, notify, selectedIds]);

  return {
    textValue,
    setTextValue,
    textColor,
    setTextColor,
    textSize,
    setTextSize,
    coverColor,
    setCoverColor,
    addTextOverlay,
    addCoverOverlay,
  };
}
