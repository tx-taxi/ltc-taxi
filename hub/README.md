# Litecoin native hub strip

Local review extraction from source `6ba310edebe7fa33f4643ff4eecdbca3d1041fc7`, reconciled against approved palette baseline `e66ca7ff4`. Intervening production changes concern shared social cards/provenance; the native strip source is unchanged. Existing LTC checkout and deployment ownership remain untouched.

Build the router artifact with:

```sh
node hub/build.cjs /home/lukee/dev/tx-taxi-router-hub/public/assets/native-strips/ltc
```

`entry.ts` imports the actual LTC `BlockchainComponent`, `BlockchainBlocksComponent`, `MempoolBlocksComponent`, native templates/SCSS, amounts, fee labels, pools and supporting presentation components. `facade.ts` supplies per-mount state and the actual `litecoinMempoolFeeColors`. LTC units remain native `LTC` and `lit/vB`. Source styles are isolated in a shadow root, and destination/resource adapters point to `https://ltc.tx.taxi`.

The wrapper retains a fractional scroll accumulator while synchronizing actual user scroll. Programmatic DOM scroll rounding must not replace that accumulator: the initial skeleton offset can end in .5px, and re-reading the rounded value before subtracting the offset shifts a mobile strip by one pixel. The native start component owns a separate scroll model; the extraction preserves the same resulting positions without a visual offset adjustment.

`feed.js` uses LTC's native WebSocket stream, bounded initial-data/silence deadlines, retry backoff and abort cleanup. It reverses native wire blocks into rendering order; it does not calculate fees or own upstream-provider failover. `live-fixture.json` records the first complete native init response; later partial snapshots intentionally omit initialization loading flags and are not interchangeable.

Router checks: `node scripts/verify-ltc-parity.mjs` and `node scripts/verify-ltc-lifecycle.mjs`. Parity compares fixed data/time at1440px and390px against the current public explorer, freezing only native opacityPulse at the same phase in screenshot browsers. Production animations remain unchanged. Lifecycle verifies LTC failure isolation while BTC/ETH stay live, recovery and actual block-link navigation. Evidence is under router `review/parity-ltc/`, `review/ltc-current.json` and `review/ltc-lifecycle.json`.
