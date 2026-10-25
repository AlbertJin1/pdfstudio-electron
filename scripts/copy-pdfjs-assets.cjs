const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const packageRoot = path.join(root, 'node_modules', 'pdfjs-dist');
const destinationRoot = path.join(root, 'public', 'pdfjs');
const folders = ['wasm', 'cmaps', 'standard_fonts', 'iccs', 'image_decoders'];

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
console.log(`[pdf-studio] Prepared ${copied} PDF.js runtime asset folders in public/pdfjs.`);
