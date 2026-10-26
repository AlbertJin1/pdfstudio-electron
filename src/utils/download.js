/** Browser fallback used when the Electron bridge (window.pdfStudio) is not available. */
export async function saveInBrowser(data, name, mime) {
  const blob = new Blob([data], { type: mime || 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
  return { canceled: false };
}
