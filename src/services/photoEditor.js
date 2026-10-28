const IMAGE_MIME_BY_EXT = Object.freeze({
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
});

export const PHOTO_INPUT_EXTENSIONS = /\.(?:png|jpe?g|webp|bmp)$/i;
export const PHOTO_MAX_BYTES = 80 * 1024 * 1024;
export const PHOTO_MAX_PIXELS = 80_000_000;
export const PHOTO_MAX_OUTPUT_SIDE = 16_384;

export function extensionOf(name = '') {
  return String(name).split('.').pop()?.toLowerCase() || '';
}

export function sourceMime(file) {
  const mime = String(file?.type || '').toLowerCase();
  if (['image/png', 'image/jpeg', 'image/webp'].includes(mime)) return mime;
  const extension = extensionOf(file?.name);
  return IMAGE_MIME_BY_EXT[extension] || 'image/png';
}

export function photoOutputSpec(file, format = 'source') {
  const source = sourceMime(file);
  const mime = format === 'source' ? source : ({ png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' }[format] || 'image/png');
  const ext = mime === 'image/jpeg' ? 'jpg' : mime === 'image/webp' ? 'webp' : 'png';
  return { mime, ext, label: ext.toUpperCase() };
}

export function cleanPhotoStem(name = 'photo') {
  const stem = String(name).replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/[. ]+$/g, '').trim();
  return (stem || 'photo').slice(0, 120);
}

function finitePositive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function canvasToBlob(canvas, mime, quality) {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('The image could not be encoded. Try a different output format.')), mime, quality);
    } catch (error) { reject(error); }
  });
}

export async function renderPhotoToCanvas(file, settings = {}, targetCanvas = null, isCurrent = () => true) {
  if (typeof createImageBitmap !== 'function') throw new Error('This environment cannot decode images for editing.');
  const source = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    if (!isCurrent()) return null;
    if (!source.width || !source.height) throw new Error('The image has no readable dimensions.');
    if (source.width * source.height > PHOTO_MAX_PIXELS) throw new Error('This image is too large to edit safely (over 80 megapixels).');

    const crop = settings.cropEnabled && settings.crop ? settings.crop : { x: 0, y: 0, w: 1, h: 1 };
    const sx = Math.max(0, Math.min(source.width - 1, Math.floor(crop.x * source.width)));
    const sy = Math.max(0, Math.min(source.height - 1, Math.floor(crop.y * source.height)));
    const sw = Math.max(1, Math.min(source.width - sx, Math.round(crop.w * source.width)));
    const sh = Math.max(1, Math.min(source.height - sy, Math.round(crop.h * source.height)));

    const rotation = ((Number(settings.rotation) || 0) % 360 + 360) % 360;
    const swap = rotation === 90 || rotation === 270;
    const rotatedWidth = swap ? sh : sw;
    const rotatedHeight = swap ? sw : sh;
    const maxWidth = finitePositive(settings.maxWidth);
    const maxHeight = finitePositive(settings.maxHeight);
    let scale = Math.min(maxWidth ? maxWidth / rotatedWidth : Infinity, maxHeight ? maxHeight / rotatedHeight : Infinity);
    if (!Number.isFinite(scale)) scale = 1;
    if (scale <= 0) scale = 1;
    const outputWidth = Math.max(1, Math.round(rotatedWidth * scale));
    const outputHeight = Math.max(1, Math.round(rotatedHeight * scale));
    if (outputWidth > PHOTO_MAX_OUTPUT_SIDE || outputHeight > PHOTO_MAX_OUTPUT_SIDE || outputWidth * outputHeight > PHOTO_MAX_PIXELS) {
      throw new Error('The requested output dimensions are too large. Reduce the resize dimensions and try again.');
    }

    const outputSpec = photoOutputSpec(file, settings.format || 'source');
    const output = targetCanvas || document.createElement('canvas');
    output.width = outputWidth; output.height = outputHeight;
    const outputContext = output.getContext('2d', { alpha: outputSpec.mime !== 'image/jpeg' });
    if (!outputContext) throw new Error('Could not create the final image.');
    outputContext.imageSmoothingEnabled = true;
    outputContext.imageSmoothingQuality = 'high';
    if (outputSpec.mime === 'image/jpeg') {
      outputContext.fillStyle = settings.jpegBackground || '#ffffff';
      outputContext.fillRect(0, 0, outputWidth, outputHeight);
    }

    // Draw directly from the decoded source into the final output canvas. Keeping a single render
    // canvas avoids multiple full-resolution intermediate buffers for large camera photos.
    const brightness = Number.isFinite(Number(settings.brightness)) ? Number(settings.brightness) : 100;
    const contrast = Number.isFinite(Number(settings.contrast)) ? Number(settings.contrast) : 100;
    const saturation = Number.isFinite(Number(settings.saturation)) ? Number(settings.saturation) : 100;
    const filters = [
      `brightness(${Math.max(10, Math.min(250, brightness))}%)`,
      `contrast(${Math.max(10, Math.min(250, contrast))}%)`,
      `saturate(${Math.max(0, Math.min(250, saturation))}%)`,
      settings.grayscale ? 'grayscale(1)' : '',
      settings.sepia ? 'sepia(1)' : '',
      Number(settings.blur) > 0 ? `blur(${Math.max(0, Math.min(8, Number(settings.blur)))}px)` : '',
    ].filter(Boolean);
    outputContext.save();
    outputContext.translate(outputWidth / 2, outputHeight / 2);
    outputContext.rotate(rotation * Math.PI / 180);
    outputContext.scale(settings.flipHorizontal ? -1 : 1, settings.flipVertical ? -1 : 1);
    outputContext.filter = filters.join(' ') || 'none';
    outputContext.drawImage(source, sx, sy, sw, sh, -sw * scale / 2, -sh * scale / 2, sw * scale, sh * scale);
    outputContext.restore();

    const watermark = String(settings.watermark || '').trim().slice(0, 300);
    if (watermark) {
      const minSide = Math.min(outputWidth, outputHeight);
      const fontSize = Math.max(10, Math.round(minSide * Math.max(1, Math.min(15, Number(settings.watermarkSize) || 4)) / 100));
      const margin = Math.max(10, Math.round(fontSize * 0.7));
      const position = settings.watermarkPosition || 'bottom-right';
      outputContext.save();
      outputContext.globalAlpha = Math.max(5, Math.min(100, Number(settings.watermarkOpacity) || 70)) / 100;
      outputContext.fillStyle = settings.watermarkColor || '#ffffff';
      outputContext.font = `600 ${fontSize}px "Segoe UI", Arial, sans-serif`;
      outputContext.textBaseline = 'middle';
      if (position.endsWith('left')) outputContext.textAlign = 'left';
      else if (position === 'center') outputContext.textAlign = 'center';
      else outputContext.textAlign = 'right';
      let x = position.endsWith('left') ? margin : position === 'center' ? outputWidth / 2 : outputWidth - margin;
      let y = position.startsWith('top') ? margin + fontSize / 2 : position === 'center' ? outputHeight / 2 : outputHeight - margin - fontSize / 2;
      if (position === 'center') { x = outputWidth / 2; y = outputHeight / 2; }
      // Outline/shadow keeps the watermark legible over both dark and light photo areas.
      outputContext.shadowColor = 'rgba(0,0,0,.7)';
      outputContext.shadowBlur = Math.max(1, Math.round(fontSize * 0.12));
      outputContext.shadowOffsetX = 1; outputContext.shadowOffsetY = 1;
      outputContext.fillText(watermark, x, y, Math.max(1, outputWidth - margin * 2));
      outputContext.restore();
    }
    return { canvas: output, ...outputSpec, width: outputWidth, height: outputHeight };
  } finally {
    source.close?.();
  }
}

export async function renderPhotoBlob(file, settings = {}) {
  const rendered = await renderPhotoToCanvas(file, settings);
  const quality = Math.max(40, Math.min(100, Number(settings.quality) || 92)) / 100;
  const blob = await canvasToBlob(rendered.canvas, rendered.mime, rendered.mime === 'image/png' ? undefined : quality);
  return { blob, mime: rendered.mime, ext: rendered.ext, width: rendered.width, height: rendered.height };
}
