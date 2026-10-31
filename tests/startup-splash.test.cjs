'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'electron/main.cjs'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'electron/preload.cjs'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const splash = fs.readFileSync(path.join(root, 'electron/splash.html'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));

assert.match(main, /const SPLASH_MIN_MS\s*=\s*2850/,
  'the branded splash must remain visible long enough for its opening animation to finish');
assert.match(main, /const SPLASH_READY_HOLD_MS\s*=\s*620/,
  'the final progress segment needs time to complete before fading');
assert.match(main, /const STARTUP_WATCHDOG_MS\s*=\s*22000/,
  'a native watchdog must eventually resolve a failed startup');
assert.match(main, /const SPLASH_VISIBILITY_WATCHDOG_MS\s*=\s*6500/,
  'a splash that never becomes visible must not hold up the application forever');
assert.match(main, /startupSplashGateTimer/,
  'the splash visibility gate must be cancellable when the window becomes ready or fails');
assert.match(main, /handle\('app:renderer-startup-error'/,
  'the renderer must be able to tell Electron that boot failed');
assert.match(main, /handle\('app:renderer-ready'/,
  'the main application must wait for an explicit renderer-ready handshake');
assert.match(main, /render-process-gone/,
  'a renderer crash during startup must not leave the splash stuck');
assert.match(main, /showStartupFailure\(mainWindow,\s*\{\s*heading: 'PDF Studio took too long to start'/,
  'the native timeout must show a useful diagnostic instead of opening a blank app');
assert.doesNotMatch(main, /setTimeout\(revealMainWindow,\s*15000\)/,
  'the old blind timer must not reveal a blank window');
assert.doesNotMatch(main, /setTimeout\(runBackgroundStartup,\s*6000\)/,
  'background network and file work must not begin while the splash may still be showing');

const failureStart = main.indexOf('async function showStartupFailure');
const failureEnd = main.indexOf('\nasync function loadRenderer', failureStart);
const failureBody = main.slice(failureStart, failureEnd);
assert(failureBody.indexOf('await window.loadURL') < failureBody.indexOf("revealMainWindow('failure')"),
  'diagnostic content must load before the startup splash is removed');
assert.match(preload, /reportStartupError:\s*\(report\)\s*=>\s*ipcRenderer\.invoke\('app:renderer-startup-error', report\)/,
  'startup diagnostics must use a narrow IPC bridge');
assert.match(index, /bridge\.reportStartupError\(/,
  'the HTML watchdog must notify Electron when React fails to mount');
assert.match(index, /within 18 seconds/,
  'the inline watchdog must report a frontend mount timeout');
assert.match(splash, /html\.leaving #card\{animation:out/,
  'the branded splash must retain its deliberate exit animation');
assert.equal(pkg.version, '3.0.7');
assert.equal(lock.version, pkg.version);
assert.equal(lock.packages[''].version, pkg.version);
console.log('Startup splash handshake, timeout, failure recovery, and release version tests passed.');
