'use strict';

// Probe the public fallback on a bounded schedule. A successful HTTP response
// alone does not mean the primary is still following the chain.
class PrimaryTipMonitor {
 constructor({primary, referenceUrl = 'https://api.blockcypher.com/v1/ltc/main', fetchImpl = fetch, now = Date.now, intervalMs = 300000,
  timeoutMs = 5000, maxLag = 2, onChange = () => {}}) {
  Object.assign(this, {primary, referenceUrl, fetchImpl, now, intervalMs, timeoutMs, maxLag, onChange});
  this.behind = false; this.primaryHeight = null; this.reference = null; this.pending = null;
  this.referencePending = null; this.lastReferenceAttempt = null;
 }
 start() {
  this.check();
  this.timer = setInterval(() => this.check(), this.intervalMs);
  this.timer.unref();
 }
 referenceState() {
  if (!this.reference) return null;
  const age = Math.max(0, this.now() - this.reference.at);
  return {stale:age > 90000, expired:age > 2*this.intervalMs};
 }
 async check() {
  if (this.pending) return this.pending;
  this.pending = this.probe().finally(() => { this.pending = null; });
  return this.pending;
 }
 async probe() {
  try {
   this.lastReferenceAttempt = this.now();
   const options = () => ({signal: AbortSignal.timeout(this.timeoutMs)});
   const [primary, reference] = await Promise.all([
    this.fetchImpl(this.primary + '/api/blocks/tip/height', options()),
    this.fetchImpl(this.referenceUrl, options())
   ]);
   if (!primary.ok || !reference.ok) return;
   const primaryText = (await primary.text()).trim();
   const tip = await reference.json();
   if (!/^\d+$/.test(primaryText) || !Number.isSafeInteger(tip.height) || tip.height < 0 ||
       typeof tip.hash !== 'string' || !/^[a-f0-9]{64}$/i.test(tip.hash)) return;
   const height = Number(primaryText);
   if (!Number.isSafeInteger(height)) return;
   this.primaryHeight = height;
   this.reference = {height: tip.height, hash: tip.hash, at: this.now()};
   this.behind = tip.height - height > this.maxLag;
   this.onChange();
  } catch { /* Keep the last confirmed result when either provider cannot be checked. */ }
 }
 // Share the single reference response between height and hash readers. At
 // most one additional probe per 150 seconds, independent of the detail
 // fallback budget. Failed probes are also rate limited.
 async refreshReference() {
  if (this.pending) {await this.pending; if (!this.referenceState()?.stale) return;}
  if (this.referencePending) return this.referencePending;
  if (this.lastReferenceAttempt !== null && this.now()-this.lastReferenceAttempt < 150000) return;
  this.lastReferenceAttempt = this.now();
  this.referencePending = (async () => {
   try {
    const response = await this.fetchImpl(this.referenceUrl,{signal:AbortSignal.timeout(this.timeoutMs)});
    if (!response.ok) return;
    const tip = await response.json();
    if (!Number.isSafeInteger(tip.height) || tip.height < 0 || typeof tip.hash !== 'string' || !/^[a-f0-9]{64}$/i.test(tip.hash)) return;
    this.reference = {height:tip.height,hash:tip.hash,at:this.now()};
   } catch { /* Preserve the last verified observation until it expires. */ }
  })().finally(() => {this.referencePending = null;});
  return this.referencePending;
 }
 stop() { clearInterval(this.timer); }
}

module.exports = {PrimaryTipMonitor};
