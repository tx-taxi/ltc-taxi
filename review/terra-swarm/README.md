LTC live-feed API recovery, 2026-09-25

Production REST returned retryable 503 while the shared WebSocket held nine complete native blocks. The gateway now reuses that same dataset for known block/list/height/tip routes. Unknown history still uses REST. Block observation time is tracked independently of unrelated stats; after 90 seconds responses explicitly say stale, after 15 minutes they fall through to REST. Snapshots persist that original time.

Validation: 22 adapter tests passed, including stale/outage/history boundaries. Local :4475 consumed the existing public native feed (LTC_PROVIDER=https://ltc.tx.taxi, review only) and returned nine blocks, tip 3184331, source litecoinspace-websocket. Direct upstream from this workstation was unavailable; production upstream connectivity is separately verified after deployment. No provider or UI redesign.
