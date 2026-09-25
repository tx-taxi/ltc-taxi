'use strict';

const {DataStore} = require('./data-store.cjs');

function ttl(path, data) {
 if (isBlockRecord(path)) return 6 * 3600000;
 if (/^\/api\/tx\/[a-f0-9]{64}$/.test(path) && data?.status?.confirmed) return 600000;
 if (/^\/api\/block-height\/\d+$/.test(path)) return 300000;
 if (path.includes('statistics') || path.includes('/mining/') || path.includes('prices')) return 60000;
 return 5000;
}

function isBlockRecord(path) {
 return /^\/api\/(?:v1\/)?block\/[a-f0-9]{64}$/.test(path);
}

function retryAfterMs(value, now, cap) {
 if (!value) return 0;
 const seconds = Number(value);
 const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now;
 return Number.isFinite(delay) ? Math.min(cap, Math.max(0, delay)) : 0;
}

class ProviderCache {
 constructor({primary, fallback, health, failedPaths, fetchImpl = globalThis.fetch, store,
  dataDir, now = Date.now, timeoutMs = 7000, maxRequests = 120, rateWindowMs = 60000,
  cooldownMs = 5000, maxCooldownMs = 60000, staleTtlMs = 3600000,
  historyStaleTtlMs = 24 * 3600000, maxPrimaryConcurrency = 4,
  fallbackMaxRequests = 30, fallbackRateWindowMs = 3600000,
  fallbackCooldownMs = 60000, fallbackMaxCooldownMs = 3600000,
  maxFallbackConcurrency = 2,
  maxCacheEntries = 500} = {}) {
  if (!primary || typeof fallback !== 'function') throw new TypeError('primary and fallback(path) are required');
  this.primary = primary.replace(/\/$/, '');
  this.fallback = fallback;
  this.health = health || {primary, lastSuccess: null, lastFailure: null};
  this.failedPaths = failedPaths || new Map();
  this.fetchImpl = fetchImpl;
  this.store = store || new DataStore({dir: dataDir});
  this.ownsStore = !store;
  this.now = now;
  this.timeoutMs = timeoutMs;
  this.maxRequests = maxRequests;
  this.rateWindowMs = rateWindowMs;
  this.cooldownMs = cooldownMs;
  this.maxCooldownMs = maxCooldownMs;
  this.staleTtlMs = staleTtlMs;
  this.historyStaleTtlMs = historyStaleTtlMs;
  this.maxPrimaryConcurrency = maxPrimaryConcurrency;
  this.fallbackMaxRequests = fallbackMaxRequests;
  this.fallbackRateWindowMs = fallbackRateWindowMs;
  this.fallbackCooldownMs = fallbackCooldownMs;
  this.fallbackMaxCooldownMs = fallbackMaxCooldownMs;
  this.maxFallbackConcurrency = maxFallbackConcurrency;
  this.maxCacheEntries = maxCacheEntries;
  this.cache = new Map();
  this.inflight = new Map();
  this.requests = [];
  this.cooldownUntil = 0;
  this.failures = 0;
  this.primaryActive = 0;
  this.fallbackActive = 0;
  this.fallbackRequests = [];
  this.fallbackCooldownUntil = 0;
  this.fallbackFailures = 0;
  this.fallbackFailedPaths = new Map();
 }
 get(path) {
  if (typeof path !== 'string' || !/^\/api\//.test(path) || path.startsWith('//'))
   return Promise.reject(new TypeError('Expected an absolute API path'));
  const now = this.now();
  let saved = this.cache.get(path);
  // Query strings may contain credentials; never persist or restore them.
  if (!saved && !path.includes('?')) saved = this.store.get(path);
  if (saved && saved.status === 200 && now - saved.at < ttl(path, saved.data)) return Promise.resolve(saved);
  if (this.inflight.has(path)) return this.inflight.get(path);
  const pending = this.load(path, saved);
  this.inflight.set(path, pending);
  pending.finally(() => this.inflight.delete(path)).catch(() => {});
  return pending;
 }
 async load(path, saved) {
  const now = this.now();
  this.requests = this.requests.filter(at => at > now - this.rateWindowMs);
  if (now >= this.cooldownUntil && this.requests.length < this.maxRequests && this.primaryActive < this.maxPrimaryConcurrency) {
   this.requests.push(now);
   this.primaryActive++;
   try {
    const response = await this.fetchImpl(this.primary + path, {signal: AbortSignal.timeout(this.timeoutMs)});
    if (!response.ok) {
     const error = new Error(`Provider HTTP ${response.status}`);
     error.status = response.status;
     error.retryAfter = response.headers.get('retry-after');
     throw error;
    }
    const raw = await response.text();
    let data;
    try { data = JSON.parse(raw); } catch { data = raw; }
    const headers = {};
    if (response.headers.has('x-total-count')) headers['x-total-count'] = response.headers.get('x-total-count');
    const result = {data, source: 'litecoinspace', status: 200, at: this.now(), headers};
    this.health.lastSuccess = result.at;
    this.failedPaths.delete(path);
    this.failures = 0;
    this.cooldownUntil = 0;
    this.save(path, result);
    return result;
   } catch (error) {
    if (error.status === 404) {
     this.failedPaths.delete(path);
     return {data: {error: 'Not found'}, source: 'litecoinspace', status: 404, at: this.now()};
    }
    if (!error.status || error.status === 429 || error.status >= 500) {
     this.failures++;
     const delay = Math.max(Math.min(this.maxCooldownMs, this.cooldownMs * 2 ** Math.min(this.failures - 1, 16)),
      retryAfterMs(error.retryAfter, this.now(), this.maxCooldownMs));
     this.cooldownUntil = this.now() + delay;
    }
    this.recordFailure(path, error);
   } finally { this.primaryActive--; }
  } else this.recordFailure(path, new Error(now < this.cooldownUntil ? 'Provider cooling down' :
   this.primaryActive >= this.maxPrimaryConcurrency ? 'Provider concurrency limit' : 'Provider rate budget exhausted'));
  const backup = await this.tryFallback(path);
  if (backup) return backup;
  // Hash-addressed block records have a longer finite recovery window. Confirmation
  // state, height mappings, and transaction lists remain on the mutable limit.
  const staleLimit = isBlockRecord(path) ? this.historyStaleTtlMs : this.staleTtlMs;
  if (saved?.status === 200 && this.now() - saved.at <= staleLimit)
   return {...saved, stale: true};
  return {data: {error: 'Provider unavailable', retryable: true}, source: 'unavailable', status: 503, at: this.now()};
 }
 async tryFallback(path) {
  const now = this.now();
  this.fallbackRequests = this.fallbackRequests.filter(at => at > now - this.fallbackRateWindowMs);
  if (now < this.fallbackCooldownUntil || now < (this.fallbackFailedPaths.get(path) || 0) ||
   this.fallbackRequests.length >= this.fallbackMaxRequests || this.fallbackActive >= this.maxFallbackConcurrency) return null;
  this.fallbackRequests.push(now);
  this.fallbackActive++;
  try {
   const result = await this.fallback(path);
   if (!result || result.status !== 200) throw new Error('Fallback unavailable');
   this.fallbackFailures = 0;
   this.fallbackCooldownUntil = 0;
   this.fallbackFailedPaths.delete(path);
   this.save(path, result);
   return result;
  } catch (error) {
   const delay = retryAfterMs(error.retryAfter, this.now(), this.fallbackMaxCooldownMs);
   if (error.status === 429 || error.status >= 500 || !error.status && /timeout|offline|network|fetch failed/i.test(error.message)) {
    this.fallbackFailures++;
    this.fallbackCooldownUntil = this.now() + Math.max(delay,
     Math.min(this.fallbackMaxCooldownMs, this.fallbackCooldownMs * 2 ** Math.min(this.fallbackFailures - 1, 16)));
   } else {
    this.fallbackFailedPaths.set(path, this.now() + this.fallbackCooldownMs);
    if (this.fallbackFailedPaths.size > 500) this.fallbackFailedPaths.delete(this.fallbackFailedPaths.keys().next().value);
   }
   return null;
  } finally { this.fallbackActive--; }
 }
 save(path, result) {
  this.cache.delete(path);
  this.cache.set(path, result);
  if (this.cache.size > this.maxCacheEntries) this.cache.delete(this.cache.keys().next().value);
  if (!path.includes('?')) this.store.put(path, result);
 }
 recordFailure(path, error) {
  const at = this.now();
  this.failedPaths.set(path, at);
  if (this.failedPaths.size > 500) this.failedPaths.delete(this.failedPaths.keys().next().value);
  this.health.lastFailure = {at, message: error.message};
 }
 close() { if (this.ownsStore) this.store.close(); }
}

module.exports = {ProviderCache};
