export function formatAccessTime(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return '';
  try { return new Date(value * 1000).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }); } catch { return ''; }
}
export function shortDeviceId(id = '') {
  return id.length > 14 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}
