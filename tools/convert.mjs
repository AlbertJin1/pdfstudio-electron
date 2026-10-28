import fs from 'node:fs';
import { docxModule } from './shim.mjs';
const [,, input, output, mode = 'auto'] = process.argv;
const { pdfToDocx } = await docxModule();
const t = Date.now();
const r = await pdfToDocx(new Uint8Array(fs.readFileSync(input)), null, { mode, ocrEnabled: false });
fs.writeFileSync(output, r.bytes);
console.log(JSON.stringify({ pages: r.pages, ms: Date.now() - t, strategies: r.quality.pageStrategies, warnings: r.quality.warnings, cov: r.quality.editableTextCoveragePercent }, null, 1));
