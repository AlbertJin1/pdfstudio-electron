export function formatBytes(size = 0) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
export function extName(name = '') { return name.split('.').pop()?.toUpperCase() || 'FILE'; }
export function sentenceCase(text = '') { const lower = String(text).toLowerCase(); return lower.charAt(0).toUpperCase() + lower.slice(1); }
