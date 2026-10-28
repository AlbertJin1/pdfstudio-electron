'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const policy = require('../electron/access-policy.cjs');
const { monitorApiUrlCandidates } = require('../electron/monitor-api.cjs');

const ID = 'a'.repeat(32);
const enabledBody = { ok: true, enabled: true, access_state: 'enabled', install_id: ID, reason: '', updated_at: 0, updated_by: '', poll_after: 30 };
const disabledBody = { ok: true, enabled: false, access_state: 'disabled', install_id: ID, reason: 'Laptop returned to IT', updated_at: 1790000000, updated_by: 'admin', poll_after: 30 };

// ── parsePolicyResponse: only a well-formed answer may lock or unlock ──
assert.equal(policy.parsePolicyResponse(enabledBody).enabled, true);
const d = policy.parsePolicyResponse(disabledBody);
assert.equal(d.enabled, false);
assert.equal(d.reason, 'Laptop returned to IT');
assert.equal(d.updatedBy, 'admin');
assert.equal(d.installId, ID);
assert.equal(policy.parsePolicyResponse(null), null);
assert.equal(policy.parsePolicyResponse({ ok: false, enabled: false }), null, 'error bodies never lock');
assert.equal(policy.parsePolicyResponse({ ok: true }), null, 'a body without a decision is ignored');
assert.equal(policy.parsePolicyResponse({ ok: true, enabled: 'no' }), null, 'a non-boolean decision is ignored');
assert.equal(policy.parsePolicyResponse({ ...enabledBody, access_state: 'disabled' }).enabled, false, 'conflicting fields fail towards disabled');
assert.equal(policy.parsePolicyResponse({ ...enabledBody, install_id: 'not-hex' }).installId, '', 'invalid install ids are not adopted');
assert.equal(policy.parsePolicyResponse({ ...enabledBody, poll_after: 1 }).pollAfterSeconds, policy.MIN_POLL_SECONDS);
assert.equal(policy.parsePolicyResponse({ ...enabledBody, poll_after: 99999 }).pollAfterSeconds, policy.MAX_POLL_SECONDS);
assert.equal(policy.parsePolicyResponse({ ...disabledBody, reason: 'a\u0000b\nc' }).reason, 'a b c', 'control characters are stripped from the reason');

// ── cache: disabled survives a restart, corrupt/tampered files never lock ──
const cached = policy.parseCache(policy.serializeCache(d, { installId: ID, hostname: 'PC-1' }));
assert.equal(cached.enabled, false);
assert.equal(cached.reason, 'Laptop returned to IT');
assert.equal(cached.hostname, 'PC-1');
assert.equal(policy.parseCache('{not json'), null);
assert.equal(policy.parseCache(''), null);
assert.equal(policy.parseCache(JSON.stringify({ enabled: 'false' })), null);
assert.equal(policy.parseCache(JSON.stringify({ enabled: true })).enabled, true);

// ── polling cadence ──
assert.equal(policy.nextPollDelayMs(30, 0), 30000);
assert.equal(policy.nextPollDelayMs(1, 0), policy.MIN_POLL_SECONDS * 1000);
assert.equal(policy.nextPollDelayMs(30, 1), 30000);
assert.equal(policy.nextPollDelayMs(30, 2), 60000);
assert.equal(policy.nextPollDelayMs(30, 9), 60000, 'back-off is capped so an unlock is never delayed long');

// ── applyOutcome: success decides, failure never changes the decision ──
const base = { status: 'enabled', reason: '', updatedAt: 0, updatedBy: '', checkedAt: 0, offline: false, source: 'default', message: '' };
const locked = policy.applyOutcome(base, { ok: true, policy: d }, 111);
assert.equal(locked.status, 'disabled');
assert.equal(locked.offline, false);
assert.equal(locked.checkedAt, 111);
const stillLocked = policy.applyOutcome(locked, { ok: false, message: 'timeout', status: 0 }, 222);
assert.equal(stillLocked.status, 'disabled', 'monitor unreachable keeps a disabled device locked');
assert.equal(stillLocked.offline, true);
assert.equal(stillLocked.reason, locked.reason);
const unlocked = policy.applyOutcome(stillLocked, { ok: true, policy: policy.parsePolicyResponse(enabledBody) }, 333);
assert.equal(unlocked.status, 'enabled');
assert.equal(unlocked.offline, false);
assert.equal(unlocked.reason, '');
const stillOpen = policy.applyOutcome(base, { ok: false, message: 'HTTP 404', status: 404 }, 444);
assert.equal(stillOpen.status, 'enabled', 'monitor unreachable never locks a device that was not disabled');
const blankReason = policy.applyOutcome(base, { ok: true, policy: policy.parsePolicyResponse({ ...disabledBody, reason: '' }) });
assert.ok(blankReason.reason.length > 0, 'a lock always has an explanation');

// ── fetchAccessPolicy with a fake fetch ──
(async () => {
  const mk = (status, body, contentType = 'application/json') => async () => ({ ok: status >= 200 && status < 300, status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
  const args = { baseUrl: 'https://pdfstudio.shares.zrok.io/pdfstudio-monitor/api', candidatesFor: monitorApiUrlCandidates, apiKey: 'k', userAgent: 'PdfStudio/test', identity: { installId: ID, version: '3.0.1', hostname: 'PC-1', localIp: '10.0.0.2' } };

  let seen;
  const ok = await policy.fetchAccessPolicy({ ...args, fetchImpl: async (url, init) => { seen = { url, init }; return mk(200, disabledBody)(); } });
  assert.equal(ok.ok, true);
  assert.equal(ok.policy.enabled, false);
  const u = new URL(seen.url);
  assert.equal(u.pathname, '/pdfstudio-monitor/api/access.php');
  assert.equal(u.searchParams.get('app'), 'pdfstudio');
  assert.equal(u.searchParams.get('install_id'), ID);
  assert.equal(u.searchParams.get('hostname'), 'PC-1');
  assert.equal(seen.init.headers['X-Api-Key'], 'k');

  // canonical route 404 -> falls back to the direct /public/api alias
  const urls = [];
  const fallback = await policy.fetchAccessPolicy({ ...args, fetchImpl: async (url) => { urls.push(new URL(url).pathname); return urls.length === 1 ? mk(404, 'Not found')() : mk(200, enabledBody)(); } });
  assert.equal(fallback.ok, true);
  assert.deepEqual(urls, ['/pdfstudio-monitor/api/access.php', '/pdfstudio-monitor/public/api/access.php']);

  // tunnel HTML page with HTTP 200 is not a policy
  const html = await policy.fetchAccessPolicy({ ...args, fetchImpl: mk(200, '<html>warning</html>') });
  assert.equal(html.ok, false);
  // 401 (wrong key) is a failure, not a lock
  const unauthorized = await policy.fetchAccessPolicy({ ...args, fetchImpl: mk(401, { ok: false, error: 'Invalid API key.' }) });
  assert.equal(unauthorized.ok, false);
  assert.match(unauthorized.message, /Invalid API key/);
  // network failure
  const down = await policy.fetchAccessPolicy({ ...args, fetchImpl: async () => { throw new Error('ECONNREFUSED'); } });
  assert.equal(down.ok, false);
  assert.equal(down.status, 0);

  // ── wiring checks against the real sources ──
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  const preload = fs.readFileSync(path.join(__dirname, '..', 'electron', 'preload.cjs'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.jsx'), 'utf8');
  for (const channel of ['files:open', 'files:save', 'files:save-batch', 'files:choose-folder', 'exports:begin', 'exports:write', 'exports:finish']) {
    assert.match(main, new RegExp(`handle\\('${channel}'[^\\n]*\\n\\s*assertAccessAllowed\\(\\);`), `${channel} is refused by the main process while locked`);
  }
  assert.match(main, /loadAccessCacheSync\(\);\s*createWindow\(\);\s*startAccessControl\(\);/, 'cached lock is in force before the first window exists');
  assert.match(main, /handle\('access:get-state'/);
  assert.match(main, /handle\('access:recheck'/);
  assert.match(preload, /getAccessState/);
  assert.match(preload, /onAccessState/);
  assert.match(app, /accessLockedRef\.current\) return;/, 'renderer paths (picker, drop, shortcuts) are guarded');
  assert.match(app, /inert=\{access\.locked/, 'the application shell is inert while locked');

  console.log('Device access policy tests passed.');
})().catch((error) => { console.error(error); process.exit(1); });
