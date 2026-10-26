export const isPdf = (item) => item?.kind === 'pdf' || item?.mime === 'application/pdf';
export const isImage = (item) => item?.kind === 'image' || String(item?.mime || '').startsWith('image/');
export const uid = () => globalThis.crypto?.randomUUID?.() || `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
export const normalizeBytes = (value) => value instanceof Uint8Array ? value : new Uint8Array(value || []);
