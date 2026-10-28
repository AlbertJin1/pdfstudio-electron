import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanPhotoStem, extensionOf, photoOutputSpec, PHOTO_INPUT_EXTENSIONS, PHOTO_MAX_BYTES, PHOTO_MAX_PIXELS } from '../src/services/photoEditor.js';
import { cropFromDrag, fitCropRectToAspect, moveCropRect, normalizedCropAspect, resizeCropDimension, resizeCropRect } from '../src/services/photoCrop.js';

test('photo editor output formats have matching MIME and safe extensions', () => {
  assert.deepEqual(photoOutputSpec({ name: 'portrait.jpg', type: 'image/jpeg' }, 'source'), { mime: 'image/jpeg', ext: 'jpg', label: 'JPG' });
  assert.deepEqual(photoOutputSpec({ name: 'portrait.bmp', type: 'image/bmp' }, 'source'), { mime: 'image/png', ext: 'png', label: 'PNG' });
  assert.deepEqual(photoOutputSpec({ name: 'portrait.png', type: 'image/png' }, 'webp'), { mime: 'image/webp', ext: 'webp', label: 'WEBP' });
  assert.deepEqual(photoOutputSpec({ name: 'portrait.jpg', type: 'image/jpeg' }, 'png'), { mime: 'image/png', ext: 'png', label: 'PNG' });
});

test('photo editor file-name helpers produce safe cross-platform stems', () => {
  assert.equal(extensionOf('holiday.photo.JPEG'), 'jpeg');
  assert.equal(cleanPhotoStem('my:holiday/photo?.jpg'), 'my_holiday_photo_');
  assert.equal(cleanPhotoStem('...jpg'), 'photo');
  assert.equal(cleanPhotoStem(' '), 'photo');
});

test('photo editor accepts only supported browser-decodable raster extensions and applies safety bounds', () => {
  assert.equal(PHOTO_INPUT_EXTENSIONS.test('photo.png'), true);
  assert.equal(PHOTO_INPUT_EXTENSIONS.test('photo.JPEG'), true);
  assert.equal(PHOTO_INPUT_EXTENSIONS.test('photo.webp'), true);
  assert.equal(PHOTO_INPUT_EXTENSIONS.test('photo.bmp'), true);
  assert.equal(PHOTO_INPUT_EXTENSIONS.test('photo.heic'), false);
  assert.equal(PHOTO_INPUT_EXTENSIONS.test('document.pdf'), false);
  assert.equal(PHOTO_MAX_BYTES, 80 * 1024 * 1024);
  assert.equal(PHOTO_MAX_PIXELS, 80_000_000);
});

test('photo editing has a dedicated persistent tab and still reuses the photo editor pipeline', () => {
  const read = (file) => readFileSync(resolve(process.cwd(), file), 'utf8');
  assert.match(read('src/constants/tools.js'), /label: 'Photo Editing'.*action: 'photoEditor'/);
  assert.match(read('src/App.jsx'), /next === 'photo'/);
  assert.match(read('src/App.jsx'), /<PhotoEditorView notify={notify} onSessionChange={setPhotoSession} \/>/);
  assert.match(read('src/App.jsx'), /photoTabOpen && <div className=\{cx\('persistent-photo-editing'/);
  assert.match(read('src/components/layout/TitleBar.jsx'), /role=\"tab\" aria-selected={photoActive} className=\"titlebar-tab titlebar-tab-photo\"/);
  assert.match(read('src/components/layout/Sidebar.jsx'), /id: 'photo', label: 'Photo Editing'/);
  assert.match(read('src/components/layout/Sidebar.jsx'), /aria-label=\"Photo Editing\".*setMode\('photo'\)/);
  assert.match(read('src/modals/ModalHost.jsx'), /modal\?\.type === 'photoEditor'.*PhotoEditorModal/);
  assert.match(read('src/modals/PhotoEditorModal.jsx'), /<Modal embedded={embedded}/);
  assert.match(read('src/components/common/Modal.jsx'), /if \(embedded\) return <div className=\"embedded-modal-page\"/);
  assert.match(read('src/main.jsx'), /styles\/photo-editor\.css/);
});


test('crop ratio presets produce correct normalized crop geometry', () => {
  assert.equal(normalizedCropAspect('free', 1.5), null);
  assert.equal(normalizedCropAspect('original', 1.5), 1);
  assert.ok(Math.abs(normalizedCropAspect('16:9', 16 / 9) - 1) < 1e-9);
  const fitted = fitCropRectToAspect({ x: 0, y: 0, w: 1, h: 1 }, '16:9', 4 / 3);
  assert.ok(Math.abs((fitted.w / fitted.h) * (4 / 3) - 16 / 9) < 1e-6);
  assert.ok(fitted.x >= 0 && fitted.y >= 0 && fitted.x + fitted.w <= 1.000001 && fitted.y + fitted.h <= 1.000001);
});

test('crop selection can be drawn in any direction and stays inside image bounds', () => {
  const rect = cropFromDrag({ x: 0.8, y: 0.8 }, { x: 0.2, y: 0.25 }, 'free', 1.4);
  assert.ok(rect.x >= 0 && rect.y >= 0 && rect.w > 0 && rect.h > 0);
  assert.ok(rect.x + rect.w <= 1 && rect.y + rect.h <= 1);
});

test('crop boxes move and resize from handles without leaving the image', () => {
  const base = { x: 0.2, y: 0.2, w: 0.5, h: 0.5 };
  const moved = moveCropRect(base, 0.8, -0.5);
  assert.deepEqual(moved, { x: 0.5, y: 0, w: 0.5, h: 0.5 });
  const resized = resizeCropRect(base, 'se', { x: 0.95, y: 0.8 }, '1:1', 1);
  assert.ok(Math.abs(resized.w - resized.h) < 1e-6);
  assert.ok(resized.x >= 0 && resized.y >= 0 && resized.x + resized.w <= 1.000001 && resized.y + resized.h <= 1.000001);
});

test('manual crop width and height inputs update dimensions in source-pixel coordinates', () => {
  const wider = resizeCropDimension({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 }, 'w', 300, 600, 400, 'free', 1.5);
  assert.equal(Math.round(wider.w * 600), 300);
  assert.ok(Math.abs(wider.x + wider.w / 2 - 0.5) < 1e-6);
  const locked = resizeCropDimension({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 }, 'w', 300, 600, 400, '4:3', 1.5);
  assert.ok(Math.abs((locked.w / locked.h) * 1.5 - 4 / 3) < 1e-6);
});

test('photo editor exposes draggable crop handles, precise crop dimensions, and isolated range events', () => {
  const view = readFileSync(resolve(process.cwd(), 'src/modals/PhotoEditorModal.jsx'), 'utf8');
  const css = readFileSync(resolve(process.cwd(), 'src/styles/photo-editor.css'), 'utf8');
  assert.match(view, /data-crop-handle=\{handle\}/);
  assert.match(view, /Crop width in pixels/);
  assert.match(view, /Crop height in pixels/);
  assert.match(view, /onPointerDown=\{stopRangePropagation\}/);
  assert.match(css, /\.pe-crop-handle-se/);
  assert.match(css, /touch-action: none; user-select: none;/);
});
