'use strict';

/**
 * Device access policy for PDF Studio (client side of pdfstudio-monitor /api/client-gateway.php).
 *
 * Contract (see pdfstudio-monitor/ACCESS_CONTROL.md):
 *   - unknown / new devices are ENABLED by default and the app never waits for the server to start;
 *   - the client polls the monitor gateway (about every 30 seconds); the shared API key remains server-side;
 *   - a "disabled" answer locks the app immediately, and that denied state is cached on disk so the
 *     device stays locked when the monitor is unreachable or the app is restarted offline;
 *   - an "enabled" answer from the monitor unlocks a running copy on the next successful poll;
 *   - errors (network, 401/404/5xx, non-JSON tunnel pages) never change the current state.
 *
 * This file has no Electron dependency so it can be unit tested with plain Node.
 */

const MIN_POLL_SECONDS = 15;
const MAX_POLL_SECONDS = 300;
const DEFAULT_POLL_SECONDS = 30;
const MAX_FAILURE_BACKOFF_SECONDS = 60;

function cleanText(value, max) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max);
}

/**
 * Validates a gateway access-policy GET answer. Returns null for anything that is not a well-formed policy,
 * so an HTML tunnel page, an error body or a half-written response can never lock or unlock the app.
 */
function parsePolicyResponse(result) {
  if (!result || typeof result !== 'object' || result.ok !== true) return null;
  let enabled;
  if (typeof result.enabled === 'boolean') enabled = result.enabled;
  else if (result.access_state === 'disabled') enabled = false;
  else if (result.access_state === 'enabled') enabled = true;
  else return null;
  // If the two fields disagree, fail safe towards the explicit "disabled" signal.
  if (result.access_state === 'disabled') enabled = false;

  const installId = String(result.install_id || '').trim().toLowerCase();
  const pollAfter = Number(result.poll_after);
  return {
    enabled,
    reason: cleanText(result.reason, 500),
    updatedAt: Number.isFinite(Number(result.updated_at)) ? Math.max(0, Math.floor(Number(result.updated_at))) : 0,
    updatedBy: cleanText(result.updated_by, 120),
    installId: /^[a-f0-9]{16,128}$/.test(installId) ? installId : '',
    pollAfterSeconds: Number.isFinite(pollAfter) ? Math.min(MAX_POLL_SECONDS, Math.max(MIN_POLL_SECONDS, Math.floor(pollAfter))) : DEFAULT_POLL_SECONDS,
  };
}

/** Delay before the next poll: the server's poll_after after a success, a short capped back-off after failures. */
function nextPollDelayMs(pollAfterSeconds, consecutiveFailures = 0) {
  if (consecutiveFailures > 0) {
    const seconds = Math.min(MAX_FAILURE_BACKOFF_SECONDS, DEFAULT_POLL_SECONDS * (2 ** Math.min(consecutiveFailures - 1, 3)));
    return Math.round(seconds * 1000);
  }
  const base = Number.isFinite(Number(pollAfterSeconds)) ? Number(pollAfterSeconds) : DEFAULT_POLL_SECONDS;
  return Math.round(Math.min(MAX_POLL_SECONDS, Math.max(MIN_POLL_SECONDS, base)) * 1000);
}

/** What is stored on disk. Only the last known policy is kept, never any document information. */
function serializeCache(policy, { installId = '', hostname = '', checkedAt = Date.now() } = {}) {
  return JSON.stringify({
    enabled: policy.enabled === true,
    reason: cleanText(policy.reason, 500),
    updatedAt: Number(policy.updatedAt) || 0,
    updatedBy: cleanText(policy.updatedBy, 120),
    installId: String(installId || policy.installId || ''),
    hostname: cleanText(hostname, 64),
    checkedAt: Number(checkedAt) || Date.now(),
  });
}

/** Parses the cache file. A missing, corrupt or tampered file yields null, which means "no restriction known". */
function parseCache(raw) {
  try {
    const data = JSON.parse(String(raw || ''));
    if (!data || typeof data !== 'object' || typeof data.enabled !== 'boolean') return null;
    return {
      enabled: data.enabled,
      reason: cleanText(data.reason, 500),
      updatedAt: Number(data.updatedAt) || 0,
      updatedBy: cleanText(data.updatedBy, 120),
      installId: String(data.installId || ''),
      hostname: cleanText(data.hostname, 64),
      checkedAt: Number(data.checkedAt) || 0,
    };
  } catch {
    return null;
  }
}

/** Builds the query string the monitor expects. */
function buildPolicyQuery({ installId, version, hostname, localIp }) {
  const params = new URLSearchParams();
  params.set('app', 'pdfstudio');
  params.set('install_id', String(installId || ''));
  params.set('version', String(version || ''));
  if (hostname) params.set('hostname', String(hostname));
  if (localIp) params.set('local_ip', String(localIp));
  return params;
}

/**
 * One policy lookup. Tries each candidate API path (the canonical /api and the direct /public/api alias) the way the
 * telemetry client does. Returns { ok: true, policy } or { ok: false, message, status } and never throws.
 */
async function fetchAccessPolicy({
  fetchImpl = fetch,
  baseUrl,
  candidatesFor,
  userAgent,
  identity,
  timeoutMs = 8000,
}) {
  const url = new URL(`${String(baseUrl).replace(/\/+$/, '')}/client-gateway.php`);
  url.searchParams.set('resource', 'access');
  for (const [key, value] of buildPolicyQuery(identity).entries()) url.searchParams.set(key, value);
  const candidates = typeof candidatesFor === 'function' ? candidatesFor(url) : [url];
  let lastMessage = 'The monitor could not be reached.';
  let lastStatus = 0;

  for (let index = 0; index < candidates.length; index += 1) {
    const endpoint = candidates[index];
    try {
      const response = await fetchImpl(endpoint.toString(), {
        method: 'GET',
        redirect: 'manual',
        headers: {
          'User-Agent': userAgent,
          'ngrok-skip-browser-warning': '1',
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
      lastStatus = response.status;
      const text = await response.text().catch(() => '');
      let body = null;
      try { body = JSON.parse(text); } catch { /* not JSON */ }
      const policy = response.ok ? parsePolicyResponse(body) : null;
      if (policy) return { ok: true, policy };
      lastMessage = `${endpoint.pathname} returned HTTP ${response.status}${body?.error ? `: ${cleanText(body.error, 160)}` : response.ok ? ' without a valid access policy' : ''}`;
      // Wrong route, auth layer, tunnel page: try the alternate deployment path before giving up.
      continue;
    } catch (error) {
      // A network failure is host-wide; a second path on the same host will not help.
      lastStatus = 0;
      lastMessage = `${endpoint.host} could not be reached: ${cleanText(error?.message || error, 160)}`;
      break;
    }
  }
  return { ok: false, message: lastMessage, status: lastStatus };
}

/**
 * Pure state transition. `state` is what the app currently enforces, `outcome` the result of a lookup.
 * Success always wins (it is the only thing that can lock or unlock); failure keeps the current decision and
 * only records that the monitor is currently unreachable.
 */
function applyOutcome(state, outcome, now = Date.now()) {
  if (outcome.ok) {
    const p = outcome.policy;
    return {
      status: p.enabled ? 'enabled' : 'disabled',
      reason: p.enabled ? '' : (p.reason || 'Access to PDF Studio was disabled on this device by an administrator.'),
      updatedAt: p.updatedAt,
      updatedBy: p.updatedBy,
      checkedAt: now,
      offline: false,
      source: 'monitor',
      message: '',
    };
  }
  return { ...state, offline: true, message: outcome.message || state.message || '' };
}

module.exports = {
  MIN_POLL_SECONDS,
  MAX_POLL_SECONDS,
  DEFAULT_POLL_SECONDS,
  parsePolicyResponse,
  nextPollDelayMs,
  serializeCache,
  parseCache,
  buildPolicyQuery,
  fetchAccessPolicy,
  applyOutcome,
};
