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

const accessPolicy = fs.readFileSync(path.join(__dirname, '..', 'electron', 'services', 'access-policy.cjs'), 'utf8');
assert.doesNotMatch(accessPolicy, /apiKey|X-Api-Key/, 'access policy polling does not carry a shared key');
assert.match(main, /monitorGatewayEndpoint\(\{ resource: 'telemetry' \}\)/, 'telemetry flows through the server-side gateway');
assert.match(main, /app_id: 'pdfstudio'/, 'PDF Studio telemetry includes an explicit canonical app_id');
assert.match(main, /searchParams\.set\('app_id', 'pdfstudio'\)/, 'PDF Studio updater URLs always include the PDF Studio app_id');
assert.doesNotMatch(main, /monitorApiKey|loadMonitorApiKey|X-Api-Key|PDF_STUDIO_MONITOR_API_KEY/, 'Electron never loads or sends the shared Monitor API key');
const gateway = fs.readFileSync(path.join(__dirname, '..', 'server-bridge', 'public', 'api', 'client-gateway.php'), 'utf8');
assert.match(gateway, /X-Api-Key: /, 'only the server-side gateway attaches the shared key upstream');
assert.match(gateway, /CURLOPT_FOLLOWLOCATION => false/, 'gateway does not forward the server key across redirects');
assert.match(gateway, /Unknown Monitor gateway resource/, 'gateway is not an unrestricted proxy');
assert.match(gateway, /update-download/);
assert.match(gateway, /\['latest', 'download', 'manifest', 'delta'\]/, 'server bridge allowlists delta manifest and chunk operations');
assert.match(gateway, /\$upstreamQuery\['format'\] = 'zip'/, 'server bridge passes only the explicitly supported ZIP format');
assert.match(gateway, /Invalid differential chunk identifier/, 'server bridge validates every differential chunk hash');

// Reviews must be accepted by the gateway (it previously only allowed open/heartbeat/close and answered
// "Unsupported telemetry event" to every review).
{
  const gateway = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'server-bridge', 'public', 'api', 'client-gateway.php'), 'utf8');
  assert.match(gateway, /\['open', 'heartbeat', 'close', 'review'\]/, 'gateway accepts the review event');
  assert.match(gateway, /gateway_request_app_id\(\$body, false\)/, 'telemetry requires an explicit application ID');
  assert.match(gateway, /app_uses_client_gateway\(\$appId\)/, 'gateway uses the monitor application registry rather than a static app list');
  assert.match(gateway, /min_range' => 1, 'max_range' => 5/, 'gateway validates the 1-5 rating');
}
console.log('Monitor telemetry route and client reporting regression checks passed.');
