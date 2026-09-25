'use strict';

const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {ProviderCache} = require('./provider-cache.cjs');

const ok = (data, headers) => new Response(JSON.stringify(data), {headers});
const setup = t => {
 const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ltc-provider-'));
 t.after(() => fs.rmSync(dataDir, {recursive: true, force: true}));
 return dataDir;
};

test('confirmed history is available after restart when primary is down', async t => {
 const dataDir = setup(t);
 let now = 1000000;
 const route = '/api/tx/' + 'a'.repeat(64);
 const original = new ProviderCache({primary: 'https://primary.test', fallback: async () => {throw Error('offline');},
  dataDir, now: () => now, fetchImpl: async () => ok({status: {confirmed: true}, fee: 12})});
 assert.equal((await original.get(route)).source, 'litecoinspace');
 original.close();
 now += 11000;
 const health = {lastSuccess: null, lastFailure: null};
 const restarted = new ProviderCache({primary: 'https://primary.test', fallback: async () => {throw Error('offline');},
  dataDir, health, now: () => now, fetchImpl: async () => {throw Error('offline');}});
 const restored = await restarted.get(route);
 assert.equal(restored.source, 'litecoinspace');
 assert.equal(restored.stale, undefined);
 now += 600000;
 const cached = await restarted.get(route);
 assert.equal(cached.stale, true);
 assert.equal(cached.at, 1000000);
 assert.equal(health.lastSuccess, null);
 restarted.close();
});

test('concurrent callers share one primary request', async t => {
 const dataDir = setup(t);
 let release;
 let calls = 0;
 const gate = new Promise(resolve => {release = resolve;});
 const cache = new ProviderCache({primary: 'https://primary.test', fallback: async () => {throw Error('offline');},
  dataDir, fetchImpl: async () => {calls++; await gate; return ok({height: 10});}});
 const first = cache.get('/api/blocks/tip/height');
 const second = cache.get('/api/blocks/tip/height');
 release();
 assert.deepEqual(await first, await second);
 assert.equal(calls, 1);
 cache.close();
});

test('rate budget and Retry-After cooldown suppress primary calls', async t => {
 const dataDir = setup(t);
 let now = 1000000;
 let calls = 0;
 const health = {lastSuccess: null, lastFailure: null};
 const cache = new ProviderCache({primary: 'https://primary.test', fallback: async () => ({data: 'backup', source: 'backup', status: 200, at: now}),
  dataDir, now: () => now, health, maxRequests: 2, rateWindowMs: 1000, maxCooldownMs: 5000,
  fetchImpl: async () => {calls++; return new Response('busy', {status: 429, headers: {'Retry-After': '30'}});}});
 assert.equal((await cache.get('/api/a')).source, 'backup');
 assert.equal((await cache.get('/api/b')).source, 'backup');
 assert.equal(calls, 1);
 now += 5001;
 await cache.get('/api/c');
 assert.equal(calls, 2);
 now += 1000;
 await cache.get('/api/d');
 assert.equal(calls, 2);
 assert.equal(health.lastSuccess, null);
 cache.close();
});

test('request budget resumes after its window without refreshing success on fallback', async t => {
 const dataDir = setup(t);
 let now = 1000000;
 let calls = 0;
 const health = {lastSuccess: null, lastFailure: null};
 const cache = new ProviderCache({primary: 'https://primary.test', dataDir, now: () => now,
  health, maxRequests: 1, rateWindowMs: 1000,
  fallback: async () => ({data: 'backup', source: 'backup', status: 200, at: now}),
  fetchImpl: async () => {calls++; return ok({value: calls});}});
 await cache.get('/api/a');
 const successAt = health.lastSuccess;
 now += 100;
 assert.equal((await cache.get('/api/b')).source, 'backup');
 assert.equal(calls, 1);
 assert.equal(health.lastSuccess, successAt);
 now += 901;
 assert.equal((await cache.get('/api/c')).source, 'litecoinspace');
 assert.equal(calls, 2);
 cache.close();
});

test('stale cache is bounded and independent fallback takes precedence', async t => {
 const dataDir = setup(t);
 let now = 1000000;
 let fallbackWorks = true;
 const cache = new ProviderCache({primary: 'https://primary.test', dataDir, now: () => now,
  staleTtlMs: 20000, cooldownMs: 1,
  fallback: async () => {if (!fallbackWorks) throw Error('offline'); return {data: 'backup', source: 'backup', status: 200, at: now};},
  fetchImpl: async () => now === 1000000 ? ok({count: 1}) : Promise.reject(Error('timeout'))});
 const route = '/api/mempool';
 await cache.get(route);
 now += 6000;
 const backup = await cache.get(route);
 assert.equal(backup.source, 'backup');
 fallbackWorks = false;
 now += 6000;
 const stale = await cache.get(route);
 assert.equal(stale.stale, true);
 assert.equal(stale.source, 'backup');
 assert.equal(stale.at, backup.at);
 now += 20000;
 assert.equal((await cache.get(route)).status, 503);
 cache.close();
});

test('cached fallback survives restart and unsupported routes do not hammer it', async t => {
 const dataDir = setup(t);
 let now = 1000000;
 let fallbackCalls = 0;
 const health = {lastSuccess: null, lastFailure: null};
 const failedPaths = new Map();
 const route = '/api/blocks/tip/height';
 const cache = new ProviderCache({primary: 'https://primary.test', dataDir, now: () => now,
  health, failedPaths,
  fallback: async path => {
   fallbackCalls++;
   if (path !== route) throw Error('No independent equivalent for this capability');
   return {data: '500', source: 'blockcypher', status: 200, at: now};
  }, fetchImpl: async () => {throw Error('primary timeout');}});
 assert.equal((await cache.get(route)).source, 'blockcypher');
 assert.equal((await cache.get(route)).data, '500');
 assert.equal(fallbackCalls, 1);
 assert.equal(health.lastSuccess, null);
 assert.equal(failedPaths.has(route), true);
 await cache.get('/api/unsupported');
 await cache.get('/api/unsupported');
 assert.equal(fallbackCalls, 2);
 cache.close();
 const restarted = new ProviderCache({primary: 'https://primary.test', dataDir, now: () => now,
  fallback: async () => {throw Error('offline');}, fetchImpl: async () => {throw Error('offline');}});
 assert.equal((await restarted.get(route)).source, 'blockcypher');
 restarted.close();
});

test('fallback request budget and 429 cooldown are independent of primary', async t => {
 const dataDir = setup(t);
 let now = 1000000;
 let fallbackCalls = 0;
 const cache = new ProviderCache({primary: 'https://primary.test', dataDir, now: () => now,
  fallbackMaxRequests: 2, fallbackRateWindowMs: 1000, fallbackMaxCooldownMs: 100,
  fallback: async () => {fallbackCalls++; const error = Error('rate limited'); error.status = 429; error.retryAfter = '30'; throw error;},
  fetchImpl: async () => {throw Error('primary timeout');}});
 await cache.get('/api/a');
 await cache.get('/api/b');
 assert.equal(fallbackCalls, 1);
 now += 101;
 await cache.get('/api/c');
 assert.equal(fallbackCalls, 2);
 now += 101;
 await cache.get('/api/d');
 assert.equal(fallbackCalls, 2);
 now += 1001;
 await cache.get('/api/e');
 assert.equal(fallbackCalls, 3);
 cache.close();
});

test('distinct-route burst respects primary concurrency and fallback limits', async t => {
 const dataDir = setup(t);
 let release;
 const gate = new Promise(resolve => {release = resolve;});
 let primaryCalls = 0;
 let fallbackCalls = 0;
 const cache = new ProviderCache({primary: 'https://primary.test', dataDir,
  maxPrimaryConcurrency: 4, maxFallbackConcurrency: 2,
  fallback: async () => {fallbackCalls++; await gate; return {data: 'backup', source: 'backup', status: 200, at: Date.now()};},
  fetchImpl: async () => {primaryCalls++; await gate; return ok({value: 1});}});
 const requests = Array.from({length: 20}, (_, n) => cache.get('/api/burst/' + n));
 assert.equal(primaryCalls, 4);
 assert.equal(fallbackCalls, 2);
 release();
 const results = await Promise.all(requests);
 assert.equal(results.filter(result => result.source === 'litecoinspace').length, 4);
 assert.equal(results.filter(result => result.source === 'backup').length, 2);
 assert.equal(results.filter(result => result.status === 503).length, 14);
 cache.close();
});

test('hash-addressed block has finite historical stale window, status remains mutable', async t => {
 const dataDir = setup(t);
 let now = 1000000;
 const block = '/api/v1/block/' + 'a'.repeat(64);
 const tx = '/api/tx/' + 'b'.repeat(64);
 const cache = new ProviderCache({primary: 'https://primary.test', dataDir, now: () => now,
  fallback: async () => {throw Error('offline');},
  fetchImpl: async () => now === 1000000 ? ok({status: {confirmed: true}}) : Promise.reject(Error('offline'))});
 await cache.get(block);
 await cache.get(tx);
 now += 7 * 3600000;
 assert.equal((await cache.get(block)).stale, true);
 assert.equal((await cache.get(tx)).status, 503);
 now += 18 * 3600000;
 assert.equal((await cache.get(block)).status, 503);
 cache.close();
});
