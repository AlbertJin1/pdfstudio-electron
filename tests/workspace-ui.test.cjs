'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const workspace = read('src/hooks/useWorkspace.js');
const electronMain = read('electron/main.cjs');
const preview = read('src/components/workspace/PagePreview.jsx');
const previewModal = read('src/modals/PagePreviewModal.jsx');
const modalHost = read('src/modals/ModalHost.jsx');
const dragGrid = read('src/components/workspace/PageGridPanel.jsx');
const styles = read('src/styles/workspace-polish.css');
const baseStyles = read('src/styles/index.css');
const about = read('src/modals/AboutModal.jsx');

assert.match(workspace, /all:\s*'\.pdf,\.png,\.jpg,\.jpeg,\.webp,\.bmp,\.gif,\.tif,\.tiff'/,
  'Page workspace picker must allow PDF and supported images only');
assert.ok(workspace.includes('if (!isPageFileExtension(ext)) { unsupportedCount += 1; continue; }'),
  'Workspace import processing must reject Word and unknown extensions before interpreting file bytes');
assert.match(workspace, /if\s*\(!extAllowed\s*\|\|\s*!mimeAllowed\)/,
  'Browser imports and drag/drop must validate extension and MIME before reading file content');
assert.doesNotMatch(electronMain.slice(electronMain.indexOf("handle('files:open'"), electronMain.indexOf('async function openExportFolder')), /docx/i,
  'Native page picker and IPC handler must not expose Word documents as page imports');
assert.match(preview, /fitToStage\s*=\s*false/);
assert.match(preview, /new ResizeObserver/);
assert.match(preview, /paperWrap\.style\.width\s*=\s*`\$\{displayWidth\}px`/,
  'Expanded preview wrapper must match the rendered page canvas to anchor overlays correctly');
assert.match(previewModal, /fitToStage/);
assert.match(modalHost, /modal\?\.type === 'page-preview'/, 'Expanded page preview must be connected to the modal host');
assert.match(dragGrid, /normalizedX[\s\S]*normalizedY[\s\S]*const horizontal/,
  'Drop position must normalize target coordinates to avoid tall cards biasing the drop edge');
assert.match(dragGrid, /requestAnimationFrame\(renderFrame\)/,
  'Drag ghost movement must be batched to animation frames');
assert.match(styles, /\.setting-switch::after\s*\{\s*top:\s*50%;/);
assert.match(styles, /translate\(18px,\s*-50%\)/,
  'Switch knobs must stay vertically centered in both unchecked and checked states');
assert.match(styles, /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+1px\s+minmax\(0,\s*1fr\)/,
  'ITRS and RSC branding must receive equal-width columns');
assert.doesNotMatch(about, /Brand identity/i, 'Redundant Brand identity label must be removed');
assert.match(about, /<em>Regualos<\/em>/, 'Developer surname must have its own styling hook');
assert.doesNotMatch(baseStyles, /\.preview-rendered-canvas\s*\{[^}]*height:\s*auto\s*!important/,
  'Base preview styles must not override the expanded page canvas height');


const pageCard = read('src/components/workspace/PageCard.jsx');
const workspaceView = read('src/views/WorkspaceView.jsx');
assert.match(pageCard, /page-thumb-fullscreen[\s\S]*setModal\(\{ type: 'page-preview', pageId: page.id \}\)/,
  'Each page thumbnail must open the full-page viewer from its fullscreen control');
assert.doesNotMatch(workspaceView, /InspectorPanel|Live preview|Page details/,
  'The live preview sidebar must be removed from the workspace');
assert.match(previewModal, /Zoom in[\s\S]*Zoom out|Zoom out[\s\S]*Zoom in/,
  'The full-page viewer must provide zoom controls');
assert.match(previewModal, /ArrowLeft[\s\S]*ArrowRight[\s\S]*Home[\s\S]*End/,
  'The full-page viewer must support page navigation shortcuts');
assert.match(styles, /page-thumb-fullscreen/);
assert.match(styles, /height:\s*calc\(100dvh - 24px\)/,
  'The page viewer should use the available viewport instead of a small dialog');

console.log('Workspace file policy, drag positioning, thumbnail fullscreen viewer, zoom shortcuts, toggle alignment, and About branding checks passed.');
