'use strict';
const assert = require('node:assert/strict');
const { shouldSuppressReviewPrompt, reviewCooldownRemainingMs, REVIEW_REPROMPT_MS, retryDelayMs, normalizeOutbox, createOutboxItem } = require('../electron/review-queue-policy.cjs');

assert.equal(shouldSuppressReviewPrompt({ submittedAt: Date.now() }), true, 'already-submitted reviews suppress prompts');
assert.equal(shouldSuppressReviewPrompt({ submittedAt: 0, reviewStatus: 'pending', pendingReviewId: 'abc' }), true, 'offline-pending reviews suppress prompts');
assert.equal(shouldSuppressReviewPrompt({ neverAskAgain: true }), true, 'do-not-ask choice suppresses prompts');
assert.equal(shouldSuppressReviewPrompt({}), false, 'new users can still qualify for a prompt');
assert.equal(shouldSuppressReviewPrompt({}, true), true, 'unreadable secure outbox suppresses prompts rather than risking duplicate feedback');
assert.equal(retryDelayMs(1, 'retry'), 60_000, 'first transient retry is one minute');
assert.equal(retryDelayMs(2, 'retry'), 120_000, 'transient retry delay backs off exponentially');
assert.equal(retryDelayMs(1, 'permanent'), 60 * 60 * 1000, 'server rejections use a slower retry schedule');
assert.equal(retryDelayMs(30, 'retry'), 24 * 60 * 60 * 1000, 'retry delay is capped at one day');
const id = '0123456789abcdef0123456789abcdef';
const item = createOutboxItem(id, { event: 'review', install_id: 'abcdef0123456789' }, 1234);
assert.equal(item.createdAt, 1234);
assert.deepEqual(normalizeOutbox({ version: 1, items: [item] }), [item]);
assert.throws(() => normalizeOutbox({ version: 2, items: [] }), /unsupported format/);
assert.equal(normalizeOutbox({ version: 1, items: [{ id: 'x', payload: {} }] }).length, 0, 'malformed entries are rejected');

// Recent reviews pause the automatic prompt; it returns after 90 days or a new major version.
const day = 24 * 60 * 60 * 1000; const t0 = 1_700_000_000_000;
const reviewed = { submittedAt: t0, lastReviewVersion: '3.0.3', reviewStatus: 'submitted' };
assert.equal(REVIEW_REPROMPT_MS, 90 * day);
assert.equal(shouldSuppressReviewPrompt(reviewed, false, { appVersion: '3.0.3', now: t0 + 10 * day }), true, 'paused right after a review');
assert.equal(shouldSuppressReviewPrompt(reviewed, false, { appVersion: '3.4.0', now: t0 + 89 * day }), true, 'still paused on day 89 (same major)');
assert.equal(shouldSuppressReviewPrompt(reviewed, false, { appVersion: '3.4.0', now: t0 + 91 * day }), false, 'prompt may return after 90 days');
assert.equal(shouldSuppressReviewPrompt(reviewed, false, { appVersion: '4.0.0', now: t0 + 2 * day }), false, 'a new major version may prompt again at once');
assert.equal(reviewCooldownRemainingMs(reviewed, '3.0.3', t0 + 30 * day), 60 * day, 'remaining pause is reported');
assert.equal(reviewCooldownRemainingMs(reviewed, '3.0.3', t0 - 5 * day), 90 * day, 'a clock set back never extends the pause');
assert.equal(shouldSuppressReviewPrompt({ ...reviewed, neverAskAgain: true }, false, { appVersion: '4.0.0', now: t0 + 400 * day }), true, 'an explicit opt-out stays permanent');
assert.equal(shouldSuppressReviewPrompt({ submittedAt: t0, reviewStatus: 'pending', pendingReviewId: 'x' }, false, { now: t0 + 400 * day }), true, 'a review awaiting delivery pauses the prompt');
console.log('Review queue policy tests passed.');
