'use strict';

const MONITOR_HOST = 'pdfstudio.shares.zrok.io';
const CANONICAL_PREFIX = '/pdfstudio-monitor/api';
const DIRECT_PUBLIC_PREFIX = '/pdfstudio-monitor/public/api';

/** Only HTTPS URLs on the configured Monitor host and its API path are trusted. */
function isPdfStudioMonitorApiUrl(value) {
  try {
    const url = value instanceof URL ? value : new URL(String(value));
    return url.protocol === 'https:'
      && url.hostname.toLowerCase() === MONITOR_HOST
      && (url.pathname === CANONICAL_PREFIX
        || url.pathname.startsWith(`${CANONICAL_PREFIX}/`)
        || url.pathname === DIRECT_PUBLIC_PREFIX
        || url.pathname.startsWith(`${DIRECT_PUBLIC_PREFIX}/`));
  } catch {
    return false;
  }
}

/**
 * The gateway normally uses the /api rewrite. Some hosts expose public/ directly and do not
 * apply the root rewrite. Try the equivalent /public/api gateway path as a fallback; never
 * change the host or protocol.
 */
function monitorApiUrlCandidates(value) {
  let url;
  try { url = value instanceof URL ? new URL(value.toString()) : new URL(String(value)); }
  catch { return []; }
  if (!isPdfStudioMonitorApiUrl(url)) return [url];

  const isDirectPublic = url.pathname === DIRECT_PUBLIC_PREFIX || url.pathname.startsWith(`${DIRECT_PUBLIC_PREFIX}/`);
  if (isDirectPublic) {
    const canonical = new URL(url.toString());
    canonical.pathname = url.pathname.replace(/^\/pdfstudio-monitor\/public\/api(?=\/|$)/i, CANONICAL_PREFIX);
    return [url, canonical];
  }

  const direct = new URL(url.toString());
  direct.pathname = url.pathname.replace(/^\/pdfstudio-monitor\/api(?=\/|$)/i, DIRECT_PUBLIC_PREFIX);
  return [url, direct];
}

module.exports = { isPdfStudioMonitorApiUrl, monitorApiUrlCandidates };
