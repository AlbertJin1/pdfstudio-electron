// Remembers the last export folder and resolution between sessions (best effort; storage may be unavailable).
const FOLDER_KEY = 'pdfstudio.imageExport.folder';
const DPI_KEY = 'pdfstudio.imageExport.dpi';

export const IMAGE_DPI_OPTIONS = [
  { value: 96, label: 'Web · 96 DPI', hint: 'Smallest files' },
  { value: 150, label: 'Standard · 150 DPI', hint: 'Sharp on screen' },
  { value: 200, label: 'High · 200 DPI', hint: 'Crisp detail' },
  { value: 300, label: 'Print · 300 DPI', hint: 'Largest files' },
];

export function loadImageExportPrefs() {
  try {
    const dpi = Number(localStorage.getItem(DPI_KEY));
    return { folder: localStorage.getItem(FOLDER_KEY) || '', dpi: IMAGE_DPI_OPTIONS.some((option) => option.value === dpi) ? dpi : 150 };
  } catch { return { folder: '', dpi: 150 }; }
}

export function saveImageExportPrefs({ folder, dpi }) {
  try {
    if (folder) localStorage.setItem(FOLDER_KEY, folder);
    if (dpi) localStorage.setItem(DPI_KEY, String(dpi));
  } catch { /* ignore */ }
}

/** Same rules as the desktop main process, so the path preview matches what is created. */
export function cleanFileStem(value, fallback = 'document') {
  const stem = String(value || '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '').slice(0, 100);
  return stem || fallback;
}

export const dirnameOf = (filePath) => {
  const text = String(filePath || '');
  const index = Math.max(text.lastIndexOf('\\'), text.lastIndexOf('/'));
  return index > 0 ? text.slice(0, index) : '';
};

export const joinPath = (parent, child) => {
  if (!parent) return child;
  const separator = parent.includes('\\') && !parent.includes('/') ? '\\' : '/';
  return `${parent.replace(/[\\/]+$/, '')}${separator}${child}`;
};
