# PDF Studio review persistence and offline delivery

## Local behavior

- A review is written to an encrypted outbox before the renderer is told it was saved.
- The outbox is stored as `%APPDATA%/PDF Studio/review-outbox.enc` and encrypted with Electron `safeStorage` (Windows user-bound encryption). The app has no plaintext fallback.
- The review contains only the rating, optional name/message, installation id, app version, OS, hostname, local IP, and a stable client review id. PDF files, file names, and document contents are not included.
- A locally queued review sets persistent `reviewStatus=pending`; a server-acknowledged review sets `reviewStatus=submitted`. Either state prevents future automatic review prompts. A prior `submittedAt` from older versions also continues to suppress prompts.
- The outbox retries at startup, every 60 seconds, when the main window regains focus, and after submission. Retries use exponential backoff (1 minute for transient errors, 1 hour for HTTP rejections, capped at 24 hours).
- A recoverable `.tmp`/`.bak` file is used to restore a completed queue/state write after interrupted replacement. If a queue cannot be decrypted or validated, the app preserves it and suppresses prompts instead of overwriting it or creating another review.

## Server compatibility requirement

The uploaded PDF Studio Monitor 2.4.18 gateway only permits `open`, `heartbeat`, and `close` events at `resource=telemetry`, and rejects `review` as an unsupported telemetry event. The protected Monitor API itself accepts review events, but requires the server-only API key. PDF Studio therefore must not bypass the gateway or embed that secret in the desktop client.

This app-side implementation safely keeps the review pending and retries it, but successful remote delivery requires the deployed Monitor gateway to allowlist and validate review submissions. The Monitor project is intentionally not modified in this patch. Once the gateway accepts the event, the queued review is delivered on a subsequent retry. Do not treat a locally queued review as already received by the Monitor.

## Gateway requirement (important)

The Monitor's `public/api/client-gateway.php` must be the version that accepts the `review` telemetry event
(Monitor 2.4.19+ / `server-bridge/public/api/client-gateway.php`). An older gateway answers
`HTTP 400: Unsupported telemetry event.` — the review is then kept in the encrypted queue and re-sent automatically:
at every app start, and otherwise on the slower "permanent failure" schedule (hourly, backing off). No review is lost.

Reviewer name: when the name field is left empty the PC's hostname is used (placeholder and stored name).

## Review prompt schedule

- People can review whenever they like via **About → Review PDF Studio**; nothing blocks a manual review (the Monitor limits abuse server-side).
- After a review the **automatic** prompt is paused for **90 days**, or until the app reaches a **new major version** (e.g. 3.x → 4.x), whichever comes first. It then also needs 30 minutes of new use since the last review.
- A review that is still waiting for delivery also pauses the prompt.
- "Don't ask me again" is a permanent opt-out of the automatic prompt (manual reviews still work).
- State lives in `review-state.json` (`submittedAt`, `lastReviewVersion`, `usageSecondsAtReview`); the rules are in `electron/review-queue-policy.cjs` and covered by `tests/review-queue-policy.test.cjs`.
