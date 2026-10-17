# Rillenradar Discogs transport

Standalone authenticated, read-only transport for Rillenradar. Uses Node.js 24 and no third-party dependencies.

Build: `node --check ops/discogs-relay/server.mjs`

Start: `node ops/discogs-relay/server.mjs`

Test: `node tests/discogs-relay.mjs` (synthetic requests only)

Configure `DISCOGS_RELAY_KEY` as a random secret of at least 32 characters in the hosting service. Never commit it. The service binds to `0.0.0.0:$PORT` (default 10000). `GET /health` reports readiness without contacting Discogs.

`POST /v1/discogs` requires bearer authentication and a JSON body with only `path` and optional `token`. Only fixed, read-only Discogs endpoint families are allowed. Redirects, arbitrary destinations and credentials in URLs are rejected. Request bodies, credentials and account contents are not logged or persisted. Responses are bounded; cookies are never forwarded.

At most one request is in flight. Calls are spaced to at most 30 authenticated or 20 anonymous requests per minute. Provider Retry-After and rate-limit headers are respected. There is no route, IP or credential rotation or fallback on failure. The Site's durable shared queue must remain in front of this service to preserve pauses across restarts.

Use the free plan unless the owner approves a paid change. A free service may sleep; the Site wakes it via health requests before sending API credentials. Shared outbound IP ranges remain subject to provider quotas. Deployment alone does not verify Discogs availability.

This branch keeps the existing SearXNG Dockerfile and settings unchanged. Deploy the Node command above as a separate service.
