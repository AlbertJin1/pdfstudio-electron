# PDF Studio Monitor server-side API-key gateway

This bridge removes the shared Monitor API key from the Electron client. The desktop app calls `client-gateway.php`; PHP reads the key from the Monitor's existing server-side configuration and forwards only allowlisted requests to the protected Monitor APIs.

## Deploy it

1. Prefer deploying the complete Universal App Monitor 2.4.18 package, which already contains the updated `public/api/client-gateway.php`. If deploying this bridge file separately, copy it to the Monitor project's `public/api/client-gateway.php`. The canonical route is `/pdfstudio-monitor/api/client-gateway.php`; hosts exposing the project root directly may also use `/pdfstudio-monitor/public/api/client-gateway.php`.
2. Set `MONITOR_API_KEY` in the Monitor project's root `.env` or in the Monitor's private `config/config.local.php`. It must be the same effective key used by the protected Monitor APIs. Do not set a second gateway-only key and never put the value in Electron.
3. No separate `config/client-gateway.php` is required. The gateway defaults to `https://pdfstudio.shares.zrok.io/pdfstudio-monitor/api`. Set `PDFSTUDIO_MONITOR_API_BASE` in the Monitor server environment / `.env` only if the server's HTTPS API root differs. An optional `config/client-gateway.php` may override this URL but must not contain API credentials.
4. PHP cURL is preferred. If the Apache PHP runtime lacks cURL, the gateway uses verified HTTPS streams; OpenSSL and `allow_url_fopen=On` must be available. Keep TLS certificate validation enabled.
5. Preserve your real server `.env` during deployments, but never include it in source/release ZIPs. `.env.example` is only a template with empty secret values. Deploy the gateway, verify it, and then restart PDF Studio or retry the Monitor connection.

## Exposed operations

- `GET ?resource=update&action=latest` — release metadata; the gateway forces `app=pdfstudio`.
- `GET ?resource=update&action=download&version=...` — raw portable EXE; `&format=zip` requests the compressed EXE package. Both are streamed by PHP without buffering the full file.
- `GET ?resource=update&action=manifest&version=...` — content-defined differential manifest.
- `POST ?resource=update&action=delta&version=...` with JSON `{ "version": "3.0.4", "chunks": ["<sha256>"] }` — only the requested verified chunk payloads. The gateway bounds the request size and validates hashes before forwarding.
- `GET ?resource=access&install_id=...` — read-only access-policy lookup.
- `POST ?resource=telemetry` — only `open`, `heartbeat`, and `close` events with validated identifiers and bounded payloads.

The gateway enforces method/resource allowlists, input validation, request-size limits, basic rate limits, HTTPS upstream validation, TLS verification, and safe upstream headers. It is not a general-purpose proxy and never returns the server API key. Rate limits are defensive throttles, not proof that a request came from an untampered client; public desktop software cannot safely contain a permanent shared secret.

## Key rotation

Rotate `MONITOR_API_KEY` only in the Monitor server configuration. Both the gateway and protected APIs use the same effective key; no Electron rebuild or client update is needed for future key rotations. Migrate any legacy publishers/integrations that use the old key before retiring it.
