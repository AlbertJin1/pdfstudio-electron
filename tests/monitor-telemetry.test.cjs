'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { isPdfStudioMonitorApiUrl, monitorApiUrlCandidates } = require('../electron/services/monitor-api.cjs');

const canonical = new URL('https://pdfstudio.shares.zrok.io/pdfstudio-monitor/api/');
const direct = new URL('https://pdfstudio.shares.zrok.io/pdfstudio-monitor/public/api/');

assert.equal(isPdfStudioMonitorApiUrl(canonical), true, 'canonical API path is trusted');
assert.equal(isPdfStudioMonitorApiUrl(direct), true, 'direct-public API path is trusted');
assert.equal(isPdfStudioMonitorApiUrl('http://pdfstudio.shares.zrok.io/pdfstudio-monitor/api/'), false, 'HTTP is rejected');
assert.equal(isPdfStudioMonitorApiUrl('https://example.com/pdfstudio-monitor/api/'), false, 'foreign host is rejected');
assert.deepEqual(monitorApiUrlCandidates(canonical).map((url) => url.pathname), [
  '/pdfstudio-monitor/api/',
  '/pdfstudio-monitor/public/api/',
]);
assert.deepEqual(monitorApiUrlCandidates(direct).map((url) => url.pathname), [
  '/pdfstudio-monitor/public/api/',
  '/pdfstudio-monitor/api/',
]);

const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
assert.match(main, /result\.ok === true/, 'a successful HTTP status alone must not count as delivered telemetry');
assert.match(main, /: 'permanent'/, 'permanent API rejections are identified');
assert.match(main, /monitor-usage\.log/, 'client-side telemetry errors are logged locally');
assert.match(main, /void startUsageMonitoring\(\);/, 'telemetry starts during app readiness');
assert.doesNotMatch(main, /if \(response\.status >= 400 && response\.status < 500\) return true;/, '4xx must not be silently treated as delivery');

console.log('Monitor telemetry route and client reporting regression checks passed.');
