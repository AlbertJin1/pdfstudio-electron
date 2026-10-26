#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const forbidden = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name === '.env' || (/^\.env\.(?!example$|sample$|dist$|template$)[^/]+$/i.test(entry.name))) forbidden.push(path.relative(root, full));
  }
}
walk(root);
if (forbidden.length) {
  console.error('Refusing release: real/local environment files were found: ' + forbidden.join(', '));
  process.exit(1);
}
console.log('PASS: no real/local .env files found in the Electron source tree.');
