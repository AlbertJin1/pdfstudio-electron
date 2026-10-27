/*
 * Keeps the publish/ folder to exactly ONE deliverable: the portable EXE.
 *
 *   node scripts/release-tool.cjs clean     (runs automatically before build:win)
 *   node scripts/release-tool.cjs finalize  (runs automatically after build:win)
 *
 * electron-builder leaves intermediate files next to the EXE (win-unpacked/, builder-debug.yml,
 * builder-effective-config.yaml). They are not needed to run the app, so `finalize` removes them and
 * then verifies that the portable EXE is the only file left.
 */
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const releaseDir = path.join(root, 'publish');
const exeName = 'PdfStudio.exe';

function remove(target) {
  fs.rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
}

const mode = process.argv[2];

if (mode === 'clean') {
  remove(releaseDir);
  remove(path.join(root, 'build-resources'));
  process.exit(0);
}

if (mode === 'finalize') {
  if (!fs.existsSync(releaseDir)) {
    console.error('\nERROR: publish/ was not created. The build did not finish.');
    process.exit(1);
  }
  for (const entry of fs.readdirSync(releaseDir)) {
    if (entry !== exeName) remove(path.join(releaseDir, entry));
  }
  const left = fs.readdirSync(releaseDir);
  if (left.length !== 1 || left[0] !== exeName) {
    console.error(`\nERROR: expected publish/ to contain only ${exeName}, found: ${left.join(', ') || '(nothing)'}`);
    process.exit(1);
  }
  const bytes = fs.statSync(path.join(releaseDir, exeName)).size;
  const mb = (bytes / 1024 / 1024).toFixed(1);
  console.log(`\nSingle portable executable ready: publish\\${exeName} (${mb} MiB)`);
  if (bytes > 250 * 1024 * 1024) {
    console.warn('SIZE WARNING: the EXE is still above 250 MiB. Review the [size] staging report above and confirm PDFSTUDIO_OCR_LANGS is not set to all and PDFSTUDIO_BUNDLE_NATIVE_GHOSTSCRIPT is not enabled.');
  } else {
    console.log('Size check: within the optimized portable-build target (250 MiB or less).');
  }
  console.log('No installer. No installation or administrator permission needed. Copy it anywhere and run it.');
  remove(path.join(root, 'build-resources'));
  process.exit(0);
}

console.error('Usage: node scripts/release-tool.cjs <clean|finalize>');
process.exit(2);
