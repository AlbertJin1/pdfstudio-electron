import { normalizeBytes } from '../../utils/files.js';

export async function getImageBitmap(source) {
  const blob = new Blob([normalizeBytes(source.bytes)], { type: source.mime || 'image/png' });
  if ('createImageBitmap' in window) return createImageBitmap(blob);
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  } finally {
    // ImageBitmap does not need an object URL after it is decoded.
    URL.revokeObjectURL(url);
  }
}


export async function renderPageCanvas(page, sources, maxDimension = 720, highQuality = false) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('Canvas rendering is not available.');

  if (page.kind === 'blank') {
    const ratio = page.rotation % 180 === 90 ? page.height / page.width : page.width / page.height;
    let width = maxDimension;
    let height = Math.max(1, Math.round(maxDimension / ratio));
    if (ratio > 1) { height = maxDimension; width = Math.max(1, Math.round(maxDimension * ratio)); }
    canvas.width = width;
    canvas.height = height;
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    return canvas;
  }

  const source = sources.get(page.sourceId);
  if (!source) throw new Error('The source file for this page is no longer available.');

  if (page.kind === 'pdf') {
    const pdfPage = await source.pdf.getPage(page.sourcePageIndex + 1);
    const totalRotation = ((pdfPage.rotate || 0) + (page.rotation || 0) + 360) % 360;
    const initial = pdfPage.getViewport({ scale: 1, rotation: totalRotation });
    const target = highQuality ? Math.min(maxDimension * 1.25, 1400) : maxDimension;
    const scale = target / Math.max(initial.width, initial.height);
    const viewport = pdfPage.getViewport({ scale, rotation: totalRotation });
    const outputScale = highQuality ? Math.min(window.devicePixelRatio || 1, 2) : 1;
    canvas.width = Math.max(1, Math.floor(viewport.width * outputScale));
    canvas.height = Math.max(1, Math.floor(viewport.height * outputScale));
    canvas.style.width = `${Math.floor(viewport.width)}px`;
    canvas.style.height = `${Math.floor(viewport.height)}px`;
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    await pdfPage.render({ canvasContext: context, viewport, transform: outputScale === 1 ? null : [outputScale, 0, 0, outputScale, 0, 0], background: '#ffffff' }).promise;
    return canvas;
  }

  const image = await getImageBitmap(source);
  const angle = ((page.rotation || 0) % 360 + 360) % 360;
  const sideways = angle === 90 || angle === 270;
  const rotatedWidth = sideways ? image.height : image.width;
  const rotatedHeight = sideways ? image.width : image.height;
  const scale = maxDimension / Math.max(rotatedWidth, rotatedHeight);
  canvas.width = Math.max(1, Math.round(rotatedWidth * scale));
  canvas.height = Math.max(1, Math.round(rotatedHeight * scale));
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.save();
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate(angle * Math.PI / 180);
  context.drawImage(image, -image.width * scale / 2, -image.height * scale / 2, image.width * scale, image.height * scale);
  context.restore();
  image.close?.();
  return canvas;
}

export async function createPageThumbnail(page, sources) {
  try {
    const canvas = await renderPageCanvas(page, sources, 230, false);
    return canvas.toDataURL('image/jpeg', 0.78);
  } catch (error) {
    console.error('Could not render page thumbnail', error);
    return null;
  }
}

export function getPageSize(page, sources) {
  if (page.kind === 'blank') return { width: page.width || 595.28, height: page.height || 841.89 };
  if (page.kind === 'pdf') {
    const source = sources.get(page.sourceId);
    const ref = source?.pdf?.getPage(page.sourcePageIndex + 1);
    if (!ref) return { width: 595.28, height: 841.89 };
    return ref.then((pdfPage) => {
      const viewport = pdfPage.getViewport({ scale: 1, rotation: (pdfPage.rotate + (page.rotation || 0)) % 360 });
      return { width: viewport.width, height: viewport.height };
    });
  }
  return { width: 595.28, height: 841.89 };
}
