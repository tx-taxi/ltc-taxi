# Shared Litecoin data service

Local implementation candidate. No deployment, provider purchase or new public
registration is authorized by this change. Source baseline: `6ba310ede`.

## Behavior

- One background native dashboard WebSocket runs per gateway process, including
  when no visitors are connected. Native single-target detail subscriptions share
  connections by subscription identity, capped at eight total. This is not one
  socket per visitor, nor a promise that all native subscription types fit in one
  upstream socket. Browser backpressure and reconnect attempts are bounded.
- SQLite stores REST response bodies, source and original observation timestamps,
  plus the last global stream snapshot. Cached replay never counts as fresh data.
  Credentials/query-string requests are not persisted. HTTP response headers
  retain `X-LTC-Source`, `X-LTC-Stale`, `X-LTC-Observed-At`.
- Primary REST defaults to60 requests/minute and four concurrent requests.
  BlockCypher fallback has a separate budget/cooldown. Known unsupported
  capabilities do not become fabricated equivalents. Rate limits and outages
  activate cooldown; identical in-flight requests are coalesced.
- History storage is bounded, not an archival indexer: mutable stale responses
  expire after one hour; hash-addressed block recovery after24 hours. Confirmed
  transaction status and height mappings are revalidated. General SQLite cache
  retention is30 days/5000 entries/32MiB payloads. Stats retention is90 days with
  row caps and throttled sampling. A replica has its own budget: use one gateway
  collector per chain until an explicit leader/shared-service arrangement exists.
- Only received live measurements accumulate. Block observations are deduplicated
  and conflicting heights invalidate later observed records. Mining pool counts
  represent observed/tagged blocks, not complete network market share or historical
  pool coverage. Missing metrics remain missing.
- `/api/local-statistics/coverage` and `/api/local-statistics/series` expose honest
  observed coverage. The existing two-hour chart can fall back to actual retained
  native chart samples; a visible warning and coverage headers identify partial
  local history. Other historical mining/chart APIs are not silently synthesized.

## Storage and configuration

Node24+ is required for `node:sqlite`. `LTC_DATA_DIR` defaults to `adapter/data`
locally and `/app/data` in Docker. Before any rollout, configure a **named persistent
volume or stable bind mount at `/app/data`**, writable by UID1000. The Dockerfile
declares the directory, but an anonymous volume alone is not a redeploy persistence
guarantee. Keep databases out of image builds, source control and HTTP resources.
Do not run multiple writers against an arbitrary network-mounted SQLite database.

Optional controls: `LTC_REST_REQUESTS_PER_MINUTE`, `LTC_MAX_DETAIL_FEEDS`.
Existing `LTC_PROVIDER`, `LTC_STATIC_ROOT`, `LTC_ROUTER_ORIGIN`, `PORT` and
`LTC_SITE_ORIGIN` remain supported. Keys are not needed for the current provider.

## Verification

Local review: `http://127.0.0.1:4380`. From this worktree run
`node scripts/shared-data-local.cjs start` or `node scripts/shared-data-local.cjs stop`.
The launcher uses the production frontend build in `frontend/dist/mempool/browser`,
copies its existing resources and keeps live data under `.local/shared-data/data`.
After frontend edits rebuild with `node node_modules/@angular/cli/bin/ng.js build
--configuration production --localize=false` from `frontend`, then restart the
local launcher. Runtime code changes also require a restart. No fixture data is
seeded into the review database.

Run `node --test adapter/*.test.cjs` for bounded behavioral checks. Shared-feed
checks use actual local WebSockets; runtime checks restart the actual gateway and
verify persisted timestamps/snapshots and background collection with no visitors.
These do not certify public provider availability. The older
`scripts/verify-provider.cjs` depends on live BlockCypher availability and assumes
immediate retry; it is not a deterministic circuit-breaker acceptance check.

The provider outage can still leave a cold cache empty. This change reduces load
and preserves already observed data; it does not manufacture fresh blocks or
replace missing address indexing or historical mining data.

## DOGE integration handoff

DOGE is concurrently owned by the UTXO integrator. Its BlockCypher protocol and
existing `adapter/dogecoin.cjs` are not LTC's native mempool WebSocket protocol.
Reuse the storage/budget/fanout design, not LTC wire payloads, units or provider
labels. Implement collection once outside browser connection handlers; fan out
normalized snapshots and preserve DOGE-specific data validation. Carry over
independent request/event quotas, source timestamps, persistent history and honest
coverage. Do not copy this LTC adapter wholesale or overwrite the active DOGE
worktree. DOGE integration is pending owner coordination, not verified by LTC tests.
