'use strict';

const MAX_PENDING_REVIEWS = 5;
const MAX_RETRY_DELAY_MS = 24 * 60 * 60 * 1000;
// After a review the automatic prompt rests for this long, or until the app reaches a new major version.
const REVIEW_REPROMPT_MS = 90 * 24 * 60 * 60 * 1000;
// New usage required after a review before the automatic prompt may qualify again.
const REVIEW_MIN_NEW_USAGE_SECONDS = 30 * 60;

const majorOf = (version) => { const m = String(version || '').match(/\d+/); return m ? Number(m[0]) : 0; };

/** Milliseconds the automatic prompt must still rest because of a recent review (0 = not resting). */
function reviewCooldownRemainingMs(state, appVersion = '', now = Date.now()) {
  const at = Number(state?.submittedAt) || 0;
  if (at <= 0) return 0;
  // A newer major version (e.g. 3.x -> 4.x) is a new product to review.
  if (appVersion && state.lastReviewVersion && majorOf(appVersion) > majorOf(state.lastReviewVersion)) return 0;
  const elapsed = Math.max(0, now - at); // a clock set back never extends the pause beyond the window
  return Math.max(0, REVIEW_REPROMPT_MS - elapsed);
}

/**
 * True while the automatic prompt must not appear: an unreadable queue/state, an explicit "don't ask again",
 * a review waiting for delivery, or a recent review (paused for 90 days / until the next major version).
 */
function shouldSuppressReviewPrompt(state, queueReadBlocked = false, { appVersion = '', now = Date.now() } = {}) {
  if (queueReadBlocked) return true;
  if (!state || typeof state !== 'object') return false;
  return Boolean(state.neverAskAgain)
    || Boolean(state.pendingReviewId)
    || state.reviewStatus === 'pending'
    || reviewCooldownRemainingMs(state, appVersion, now) > 0;
}

function retryDelayMs(attempts, status) {
  // Transient offline/timeouts retry quickly at first. A server-side 4xx (such as a gateway
  // that has not yet enabled review submissions) backs off more aggressively to avoid spam.
  const base = status === 'permanent' ? 60 * 60 * 1000 : 60 * 1000;
  const exponent = Math.max(0, Math.min(12, Number(attempts) - 1 || 0));
  return Math.min(MAX_RETRY_DELAY_MS, base * (2 ** exponent));
}

function normalizeOutbox(parsed) {
  if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.items)) {
    throw new Error('The encrypted review outbox has an unsupported format.');
  }
  return parsed.items
    .filter((item) => item && typeof item.id === 'string' && /^[a-f0-9]{32}$/i.test(item.id)
      && item.payload && typeof item.payload === 'object' && item.payload.event === 'review'
      && typeof item.payload.install_id === 'string')
    .slice(-MAX_PENDING_REVIEWS);
}

function createOutboxItem(id, payload, now = Date.now()) {
  if (typeof id !== 'string' || !/^[a-f0-9]{32}$/i.test(id)) throw new TypeError('Invalid review queue id.');
  if (!payload || typeof payload !== 'object' || payload.event !== 'review') throw new TypeError('Invalid review queue payload.');
  return { id, payload, createdAt: now, attempts: 0, nextAttemptAt: 0, lastStatus: '', lastError: '' };
}

module.exports = { MAX_PENDING_REVIEWS, REVIEW_REPROMPT_MS, REVIEW_MIN_NEW_USAGE_SECONDS, reviewCooldownRemainingMs, shouldSuppressReviewPrompt, retryDelayMs, normalizeOutbox, createOutboxItem };
