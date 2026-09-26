# Litecoin documentation evidence review

Reviewed 2026-09-26 for the ltc.tx.taxi documentation surface.

## Verified service contract

- `adapter/server.cjs` accepts only `GET` and `HEAD`; other methods receive
  `405 Read-only local explorer`. REST paths under `/api/` are served from the
  shared block snapshot when fresh or from the bounded provider cache.
- Successful API responses identify their source, stale state, and observation
  time with `X-LTC-Source`, `X-LTC-Stale`, and `X-LTC-Observed-At`.
- `adapter/provider-cache.cjs` defaults to 60 primary requests per minute and
  four concurrent primary requests. A source miss is 404 and an unavailable
  source is 503.
- `adapter/shared-feed.cjs` keeps one dashboard feed, shares matching detail
  subscriptions, caps detail feeds at eight, and reports `provider-freshness`.
  Persisted snapshots are marked stale when the upstream is not live.
- `adapter/observed-stats.cjs` records bounded observations only. The local
  coverage and series endpoints therefore do not represent a complete
  historical index.

## Chain facts and scope

- Litecoin uses 100,000,000 litoshis per LTC, targets 2.5-minute blocks,
  retargets every 2,016 blocks, and halves its subsidy every 840,000 blocks.
  These consensus parameters are verified in the
  [Litecoin Core source](https://github.com/litecoin-project/litecoin).
- MWEB data is separate from ordinary transparent block transactions. Litecoin
  Core requires an extension block and a final HogEx marker after activation;
  its validation code also reconciles peg-ins and peg-outs. See
  [MWEB block validation](https://github.com/litecoin-project/litecoin/blob/master/src/mweb/mweb_node.cpp).
- The explorer documents transparent-chain address and transaction views and
  explicitly does not claim visibility into MWEB private transfer details.

## Deliberate exclusions

The public gateway does not expose transaction broadcast, Electrum RPC,
Lightning, replacement-policy tooling, or an enterprise API. Those are absent
from the Litecoin documentation tabs and endpoint catalog.
