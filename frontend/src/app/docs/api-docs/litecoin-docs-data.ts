const mainnet = [''];
const noJs = { '': false };

function example(path: string, response: string) {
  return {
    default: {
      codeTemplate: { curl: path },
      codeSampleMainnet: { curl: [], esModule: [], commonJS: [], response },
      codeSampleTestnet: { curl: [], esModule: [], commonJS: [], response: '' },
      codeSampleSignet: { curl: [], esModule: [], commonJS: [], response: '' },
      codeSampleLiquid: { curl: [], esModule: [], commonJS: [], response: '' },
      codeSampleLiquidTestnet: { curl: [], esModule: [], commonJS: [], response: '' },
    },
  };
}

function rest(category: string, fragment: string, title: string, path: string, description: string, response: string) {
  return { type: 'endpoint', category, fragment, title, httpRequestMethod: 'GET', urlString: path,
    description: { default: description }, showConditions: mainnet, showJsExamples: noJs, codeExample: example(path, response) };
}

export const litecoinRestApiDocsData = [
  { type: 'category', category: 'chain', fragment: 'chain', title: 'Chain', showConditions: mainnet },
  rest('chain', 'tip-height', 'GET Tip Height', '/blocks/tip/height',
    'Returns the current Litecoin tip height as plain text.', '2840000'),
  rest('chain', 'recent-blocks', 'GET Recent Blocks', '/blocks',
    'Returns the most recently observed blocks. This is served from the shared feed while it is fresh; otherwise the gateway uses its read-only REST source.',
    '[{ "id": "block hash", "height": 2840000, "timestamp": 0, "tx_count": 0 }]'),
  rest('chain', 'block-by-hash', 'GET Block', '/block/:hash',
    'Returns an observed block by its 64-character hash. Use <code>/block-height/:height</code> first when starting with a height.',
    '{ "id": "block hash", "height": 2840000, "tx_count": 0 }'),
  rest('chain', 'block-height', 'GET Block Hash by Height', '/block-height/:height',
    'Returns the canonical block hash for a height as plain text.', 'block hash'),
  rest('chain', 'block-transactions', 'GET Block Transactions', '/block/:hash/txs',
    'Returns the transparent transactions in a block. MWEB transfer details are not exposed as ordinary address history.',
    '[{ "txid": "transaction id", "status": { "confirmed": true } }]'),
  { type: 'category', category: 'transactions', fragment: 'transactions', title: 'Transactions and addresses', showConditions: mainnet },
  rest('transactions', 'transaction', 'GET Transaction', '/tx/:txid',
    'Returns a transparent transaction by ID. Pending status can change; clients should treat it as a snapshot.',
    '{ "txid": "transaction id", "fee": 0, "status": { "confirmed": false } }'),
  rest('transactions', 'transaction-status', 'GET Transaction Status', '/tx/:txid/status',
    'Returns the current confirmation state for a transaction.', '{ "confirmed": true, "block_height": 2840000 }'),
  rest('transactions', 'address', 'GET Address', '/address/:address',
    'Returns aggregate transparent-chain statistics for a valid Litecoin address. It cannot reveal MWEB balances, recipients, or private transfer amounts.',
    '{ "address": "ltc1…", "chain_stats": { "tx_count": 0 } }'),
  rest('transactions', 'address-transactions', 'GET Address Transactions', '/address/:address/txs',
    'Returns the first page of transparent transactions for an address. Continue confirmed history with <code>/address/:address/txs/chain/:last-confirmed-txid</code>.',
    '[{ "txid": "transaction id", "status": { "confirmed": true } }]'),
  { type: 'category', category: 'mempool', fragment: 'mempool', title: 'Mempool and observed history', showConditions: mainnet },
  rest('mempool', 'mempool', 'GET Mempool Summary', '/mempool',
    'Returns the gateway’s current upstream mempool summary. It describes one node’s view, not a network-wide queue.',
    '{ "count": 0, "vsize": 0, "total_fee": 0 }'),
  rest('mempool', 'fees', 'GET Fee Estimates', '/v1/fees/recommended',
    'Returns fee estimates in <code>lit/vB</code>. Estimates are observations, not confirmation guarantees.',
    '{ "fastestFee": 1, "halfHourFee": 1, "hourFee": 1, "economyFee": 1, "minimumFee": 1 }'),
  rest('mempool', 'coverage', 'GET Observed Coverage', '/local-statistics/coverage',
    'Returns only locally retained observation coverage and sample counts. It does not claim archival or complete mining history.',
    '{ "historicalCoverage": "observed-only", "coverage": { "sampleCounts": { "blocks": 0 } } }'),
  rest('mempool', 'series', 'GET Observed Series', '/local-statistics/series',
    'Returns bounded, locally observed samples for the available mempool, block, and native feed measurements.',
    '{ "mempool": [], "blocks": [], "native": [] }'),
  { type: 'category', category: 'service', fragment: 'service', title: 'Service behavior', showConditions: mainnet },
  rest('service', 'provider-health', 'GET Provider Health', '/provider-health',
    'Returns gateway freshness and health metadata. This endpoint may probe the current mempool summary before reporting an idle state.',
    '{ "stale": false, "feed": { "state": "live" } }'),
];

export const litecoinWsApiDocsData = [
  { type: 'category', category: 'connection', fragment: 'connection', title: 'Connection', showConditions: mainnet },
  { type: 'endpoint', category: 'connection', fragment: 'initial-snapshot', title: 'Initial snapshot', httpRequestMethod: 'websocket', showConditions: mainnet, showJsExamples: noJs,
    description: { default: 'Connect to <code>/api/v1/ws</code>, then send <code>{ "action": "init" }</code>. The server returns the current shared snapshot when one is available, followed by a <code>provider-freshness</code> object.' },
    payload: '{ "action": "init" }', codeExample: example('', '') },
  { type: 'category', category: 'streams', fragment: 'streams', title: 'Shared streams', showConditions: mainnet },
  { type: 'endpoint', category: 'streams', fragment: 'live-data', title: 'Subscribe to shared data', httpRequestMethod: 'websocket', showConditions: mainnet, showJsExamples: noJs,
    description: { default: 'Send <code>action: "want"</code> for shared dashboard data. Available shared keys include <code>blocks</code>, <code>mempool-blocks</code>, <code>stats</code>, and <code>live-2h-chart</code>. The gateway fans out one upstream dashboard feed; it does not promise per-visitor feeds.' },
    payload: '{ "action": "want", "data": ["blocks", "mempool-blocks", "stats", "live-2h-chart"] }', codeExample: example('', '') },
  { type: 'endpoint', category: 'streams', fragment: 'tracked-entity', title: 'Track a transaction or address', httpRequestMethod: 'websocket', showConditions: mainnet, showJsExamples: noJs,
    description: { default: 'A transaction or address can be tracked through the native upstream subscription protocol. Detail feeds are shared by identical subscriptions and capped at eight across this gateway. When capacity is unavailable, the server sends <code>tracking-unavailable</code>.' },
    payload: '{ "track-tx": "transaction id", "watch-mempool": true }\n\n{ "track-address": "ltc1…" }', codeExample: example('', '') },
  { type: 'endpoint', category: 'streams', fragment: 'freshness', title: 'Interpret freshness', httpRequestMethod: 'websocket', showConditions: mainnet, showJsExamples: noJs,
    description: { default: '<code>provider-freshness</code> is <code>live</code>, <code>stale</code>, or <code>unavailable</code>. A cached snapshot may be delivered during an outage, but is always marked stale rather than presented as current.' },
    payload: '{ "provider-freshness": { "state": "live", "observedAt": 0 } }', codeExample: example('', '') },
];

export const litecoinFaqData = [
  { type: 'category', category: 'Litecoin', fragment: 'litecoin', title: 'Litecoin basics', showConditions: mainnet },
  { type: 'endpoint', category: 'Litecoin', fragment: 'ltc-overview', title: 'What does this explorer show?', showConditions: mainnet },
  { type: 'endpoint', category: 'Litecoin', fragment: 'ltc-fees', title: 'How are Litecoin amounts and fees shown?', showConditions: mainnet },
  { type: 'category', category: 'privacy', fragment: 'privacy', title: 'MWEB and privacy', showConditions: mainnet },
  { type: 'endpoint', category: 'privacy', fragment: 'ltc-mweb', title: 'Why are some MWEB details unavailable?', showConditions: mainnet },
  { type: 'category', category: 'data', fragment: 'data', title: 'Data and confirmation', showConditions: mainnet },
  { type: 'endpoint', category: 'data', fragment: 'ltc-data-freshness', title: 'Why can pending data or a fee estimate change?', showConditions: mainnet },
  { type: 'endpoint', category: 'data', fragment: 'ltc-search', title: 'What can I search?', showConditions: mainnet },
];
