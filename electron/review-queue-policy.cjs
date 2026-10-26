'use strict';

const MAX_PENDING_REVIEWS = 5;
const MAX_RETRY_DELAY_MS = 24 * 60 * 60 * 1000;

function shouldSuppressReviewPrompt(state, queueReadBlocked = false) {
  if (queueReadBlocked) return true;
  if (!state || typeof state !== 'object') return false;
  return Number(state.submittedAt) > 0
    || Boolean(state.neverAskAgain)
    || Boolean(state.pendingReviewId)
    || state.reviewStatus === 'pending'
    || state.reviewStatus === 'submitted';
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

module.exports = { MAX_PENDING_REVIEWS, shouldSuppressReviewPrompt, retryDelayMs, normalizeOutbox, createOutboxItem };
