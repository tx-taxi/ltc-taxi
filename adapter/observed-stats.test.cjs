'use strict';

const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {ObservedStats} = require('./observed-stats.cjs');

const hash = digit => digit.repeat(64);
function block(height, digit, extra = {}) {
  return {height, id: hash(digit), timestamp: 1700000000 + height, ...extra};
}
function withStats(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ltc-observed-'));
  try { run(directory); } finally { fs.rmSync(directory, {recursive: true, force: true}); }
}
function withClock(start, run) {
  const actualNow = Date.now;
  let now = start;
  Date.now = () => now;
  try { run(value => { now = value; }); } finally { Date.now = actualNow; }
}

test('persists native observations across restart and does not recount init blocks', () => withStats(directory => {
  let stats = new ObservedStats({directory});
  const init = {blocks: [block(10, 'a', {extras: {pool: {name: 'Pool A'}}}), block(11, 'b')],
    mempoolInfo: {size: 13, bytes: 4000}, vBytesPerSecond: 0};
  stats.observe(JSON.stringify(init));
  stats.observe({blocks: init.blocks});
  stats.close();

  stats = new ObservedStats({directory});
  assert.equal(stats.summary().coverage.sampleCounts.blocks, 2);
  assert.equal(stats.summary().coverage.sampleCounts.mempool, 1);
  assert.equal(stats.summary().coverage.sampleCounts.vBytesPerSecond, 1);
  assert.deepEqual({...stats.summary().pools.counts}, {'Pool A': 1});
  assert.equal(stats.summary().pools.taggedBlocks, 1);
  assert.equal(stats.series().mempool[0].vBytesPerSecond, 0);
  assert.equal(stats.series().blocks[0].pool.name, 'Pool A');
  assert.equal(stats.summary().historicalCoverage, 'observed-only');
  assert.ok(stats.summary().coverage.start <= stats.summary().coverage.end);
  stats.close();
}));

test('does not fabricate absent metrics or mining attribution', () => withClock(1800000000000, setNow => withStats(directory => {
  const stats = new ObservedStats({directory});
  stats.observe({mempoolInfo: {size: 4}, block: block(22, 'c')});
  setNow(1800000030000);
  stats.observe({vBytesPerSecond: 8});
  stats.observe({mempoolInfo: {}, vBytesPerSecond: null, block: {height: 23}});
  assert.deepEqual(stats.summary().coverage.sampleCounts, {mempool: 1, vBytesPerSecond: 1, blocks: 1, native: 0});
  assert.deepEqual(stats.series().mempool.map(sample => [sample.mempoolInfo, sample.vBytesPerSecond]),
    [[{size: 4}, undefined], [undefined, 8]]);
  assert.deepEqual({...stats.summary().pools.counts}, {});
  assert.equal(stats.summary().pools.observedBlocks, 1);
  stats.close();
})));

test('retains exact native chart samples, deduplicates, and filters by source time newest-first', () => withClock(1800000000000, setNow => withStats(directory => {
  let stats = new ObservedStats({directory});
  const native = {added: new Date(Date.now() - 15000).toISOString(), count: 9, vbytes_per_second: 3,
    total_fee: 110, mempool_byte_weight: 400, min_fee: 1, vsizes: [2, 5, 0]};
  const newer = {...native, added: (Date.now() - 10000) / 1000, count: 7, vsizes: [4]};
  delete newer.min_fee;
  const stale = {...native, added: (Date.now() - 120000) / 1000, count: 8};
  const future = {...native, added: (Date.now() + 120000) / 1000, count: 10};
  stats.observe({'live-2h-chart': native});
  stats.observe({'live-2h-chart': native});
  stats.observe({'live-2h-chart': newer});
  stats.observe({'live-2h-chart': stale});
  stats.observe({'live-2h-chart': future});
  stats.observe({'live-2h-chart': {added: Date.now() / 1000}});
  setNow(Date.now() + 1000);
  assert.deepEqual(stats.nativeSeries(60_000), [newer, native]);
  assert.deepEqual(stats.nativeSeries(0), []);
  assert.equal(stats.summary().coverage.native.count, 4);
  stats.close();
  stats = new ObservedStats({directory});
  assert.deepEqual(stats.nativeSeries(60_000), [newer, native]);
  stats.close();
})));

test('merges partial mempool measurements within 30 seconds and postpones full pruning', () => withClock(1800000000000, setNow => withStats(directory => {
  const stats = new ObservedStats({directory});
  let prunes = 0;
  const prune = stats.prune.bind(stats);
  stats.prune = now => { prunes++; prune(now); };
  stats.observe({mempoolInfo: {size: 2}, block: block(1, 'a')});
  setNow(Date.now() + 5000);
  stats.observe({vBytesPerSecond: 4, block: block(2, 'b')});
  stats.observe({mempoolInfo: {bytes: 100}});
  assert.deepEqual(stats.series().mempool, [{observedAt: Date.now(), mempoolInfo: {size: 2, bytes: 100}, vBytesPerSecond: 4}]);
  assert.equal(stats.series().blocks.length, 2);
  assert.equal(prunes, 0);
  setNow(Date.now() + 60000);
  stats.observe({vBytesPerSecond: 5});
  assert.equal(stats.series().mempool.length, 2);
  assert.equal(prunes, 1);
  stats.close();
})));

test('counts unusual pool names without prototype collisions', () => withStats(directory => {
  const stats = new ObservedStats({directory});
  stats.observe({blocks: [block(1, 'a', {extras: {pool: {name: '__proto__'}}}),
    block(2, 'b', {extras: {pool: {name: '__proto__'}}})]});
  assert.equal(stats.summary().pools.counts.__proto__, 2);
  stats.close();
}));

test('replaces a conflicting height and drops later observed blocks', () => withStats(directory => {
  const stats = new ObservedStats({directory});
  stats.observe({blocks: [block(100, 'a'), block(101, 'b'), block(102, 'c')]});
  stats.observe({block: block(101, 'd')});
  assert.deepEqual(stats.series().blocks.map(({height, id}) => [height, id]), [[100, hash('a')], [101, hash('d')]]);
  stats.observe({block: block(102, 'e', {previousblockhash: hash('f')})});
  assert.deepEqual(stats.series().blocks.map(({height, id}) => [height, id]), [[100, hash('a')], [102, hash('e')]]);
  stats.close();
}));
