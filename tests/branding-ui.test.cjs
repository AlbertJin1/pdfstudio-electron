'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const exists = (relative) => assert.ok(fs.statSync(path.join(root, relative)).isFile(), `Missing branding asset: ${relative}`);

const splash = read('electron/splash.html');
const boot = read('index.html');
const about = read('src/modals/AboutModal.jsx');
const sidebar = read('src/components/layout/Sidebar.jsx');
const styles = read('src/styles/ui-refresh.css');

assert.match(splash, /img-src 'self' data:/, 'Electron splash CSP must allow local branding images');
assert.match(splash, /\.\/branding\/itrs-white\.png/, 'Electron splash must use the readable white ITRS mark');
assert.match(splash, /@keyframes itrs-arrive/, 'ITRS splash mark needs its entrance animation');
assert.match(splash, /@keyframes itrs-bloom/, 'ITRS splash mark needs its ambient animation');
assert.match(boot, /\.\/branding\/itrs-dark\.png/, 'HTML boot splash needs the dark logo for light surfaces');
assert.match(boot, /\.\/branding\/itrs-white\.png/, 'HTML boot splash needs the white logo for dark surfaces');
assert.match(about, /IT Specialist - WVM/, 'About developer identity must show the requested role');
assert.match(about, /rsc-logo\.png/, 'About dialog must include the light RSC logo');
assert.match(about, /rsc-logo-dark\.png/, 'About dialog must include the dark RSC logo');
assert.match(about, /itrs-white\.png/, 'About dialog must switch to a white ITRS mark in dark mode');
assert.match(sidebar, /rsc-logo\.png/, 'Application sidebar must include the light RSC logo');
assert.match(sidebar, /rsc-logo-dark\.png/, 'Application sidebar must include the dark RSC logo');
assert.match(styles, /developer-sheen/, 'Developer hover must include the signature-sheen animation');
assert.match(styles, /developer-spark-pop/, 'Developer hover must include the monogram accent animation');
assert.match(styles, /&\.theme-dark \.sidebar-rsc-brand \.rsc-logo-dark/, 'Dark theme must switch the sidebar to the dark RSC logo');
assert.match(styles, /&\.theme-dark \.about-branding-logo \.rsc-logo-dark/, 'Dark theme must switch About to the dark RSC logo');

for (const asset of [
  'public/branding/itrs-dark.png', 'public/branding/itrs-white.png',
  'public/branding/rsc-logo.png', 'public/branding/rsc-logo-dark.png',
  'electron/branding/itrs-white.png',
]) exists(asset);

// PNG signature and dimensions are checked without requiring a graphics dependency.
function pngDimensions(relative) {
  const bytes = fs.readFileSync(path.join(root, relative));
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${relative} must be a valid PNG`);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}
assert.deepEqual(pngDimensions('public/branding/itrs-white.png'), { width: 1533, height: 825 });
assert.deepEqual(pngDimensions('public/branding/rsc-logo.png'), { width: 1200, height: 400 });
assert.deepEqual(pngDimensions('public/branding/rsc-logo-dark.png'), { width: 1200, height: 400 });
console.log('Splash, About, sidebar branding, theme switching, animation, and asset checks passed.');
