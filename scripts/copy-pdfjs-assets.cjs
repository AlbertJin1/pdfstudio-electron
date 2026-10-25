const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const packageRoot = path.join(root, 'node_modules', 'pdfjs-dist');
const destinationRoot = path.join(root, 'public', 'pdfjs');
const folders = ['wasm', 'cmaps', 'standard_fonts', 'iccs', 'image_decoders'];
const workerFile = 'pdf.worker.min.mjs';

if (!fs.existsSync(packageRoot)) {
  console.warn('[pdf-studio] pdfjs-dist is not installed yet; skipping its static assets.');
  process.exit(0);
}

fs.mkdirSync(destinationRoot, { recursive: true });
let copied = 0;
for (const folder of folders) {
  const source = path.join(packageRoot, folder);
  if (!fs.existsSync(source)) continue;
  fs.cpSync(source, path.join(destinationRoot, folder), { recursive: true, force: true });
  copied += 1;
}

// Serve the worker as a local public asset. Importing it with ?url makes Rolldown treat
// the worker as a generated JavaScript chunk, which produces a misleading >500 kB warning
// and can inflate the frontend chunk graph.
const workerSource = path.join(packageRoot, 'build', workerFile);
if (!fs.existsSync(workerSource)) {
  console.warn(`[pdf-studio] PDF.js worker not found at ${workerSource}`);
  process.exitCode = 1;
} else {
  fs.copyFileSync(workerSource, path.join(destinationRoot, workerFile));
  console.log(`[pdf-studio] Copied PDF.js worker to public/pdfjs/${workerFile}.`);
}
console.log(`[pdf-studio] Prepared ${copied} PDF.js runtime asset folders in public/pdfjs.`);
