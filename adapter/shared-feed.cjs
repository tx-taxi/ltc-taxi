'use strict';
const {WebSocket} = require('ws');

const SNAPSHOT_KEYS = ['blocks', 'mempool-blocks', 'mempoolInfo', 'vBytesPerSecond', 'fees', 'da', 'conversions', 'backendInfo', 'backend', 'loadingIndicators', 'transactions', 'previousRetarget', 'rbfLatestSummary', 'live-2h-chart'];
const DETAIL_KEYS = ['track-tx', 'track-address', 'track-addresses', 'track-wallet', 'track-asset', 'track-mempool-block', 'track-rbf', 'track-stratum'];

// One durable global feed. Single-target native subscriptions are shared by
// subscription identity, never by browser, and capped independently of traffic.
class SharedFeed {
 constructor({url, health, store, observe = () => {}, maxDetails = 8, staleMs = 90000, WebSocketClass = WebSocket}) {
  Object.assign(this, {url, health, store, observe, maxDetails, staleMs, WebSocketClass});
  this.clients = new Map(); this.details = new Map(); this.stopped = false; this.connectionAttempts = [];
  const saved = store?.get('ws:snapshot');
  this.snapshot = saved?.data || {}; this.observedAt = saved?.at || 0; this.blocksObservedAt = saved?.blocksAt || 0;
  this.core = this.channel(null);
  this.timer = setInterval(() => {
   const now = Date.now();
   for (const channel of [this.core, ...this.details.values()]) {
    if (channel.socket?.readyState === 1) {
     if (now - channel.receivedAt > this.staleMs) channel.socket.terminate();
     else channel.socket.send(JSON.stringify({action:'ping'}));
    }
   }
   this.status();
  }, 15000);
  this.timer.unref();
 }
 send(client, data) {
  if (client.readyState !== 1) return;
  if (client.bufferedAmount > 2 * 1024 * 1024) { client.close(1013, 'Slow consumer'); return; }
  client.send(JSON.stringify(data));
 }
 freshness() {
  return {state: this.core?.socket?.readyState === 1 && this.core.hasData && this.observedAt && Date.now()-this.observedAt < this.staleMs ? 'live' : this.observedAt ? 'stale' : 'unavailable', observedAt:this.observedAt || null};
 }
 status() {
  const freshness = this.freshness();
  this.health.websocket = freshness.state;
  for (const client of this.clients.keys()) this.send(client, {'provider-freshness':freshness});
 }
 channel(subscription) {
  const channel = {subscription, socket:null, retry:null, attempts:0, receivedAt:0, cached:null, clients:new Set(), closed:false};
  const connect = () => {
   if (this.stopped || channel.closed) return;
   this.connectionAttempts = this.connectionAttempts.filter(at=>Date.now()-at<60000);
   if (this.connectionAttempts.length >= 12) {
    channel.retry=setTimeout(connect,Math.max(1000,60000-(Date.now()-this.connectionAttempts[0])));
    channel.retry.unref();return;
   }
   this.connectionAttempts.push(Date.now());
   channel.hasData=false;
   const socket = channel.socket = new this.WebSocketClass(this.url, {handshakeTimeout:7000, maxPayload:16*1024*1024});
   channel.receivedAt = Date.now();
   socket.on('open', () => {
    if (subscription) {
     socket.send(JSON.stringify({action:'want',data:['blocks']}));
     socket.send(JSON.stringify(subscription));
    }
    else {
     socket.send(JSON.stringify({action:'init'}));
     socket.send(JSON.stringify({action:'want', data:['blocks','mempool-blocks','stats','live-2h-chart']}));
     socket.send(JSON.stringify({'track-rbf-summary':true}));
    }
   });
   socket.on('message', raw => {
    let message; try {message = JSON.parse(raw.toString());} catch {return;}
    if (!message || typeof message !== 'object' || Array.isArray(message)) return;
    channel.receivedAt = Date.now();
    if (message.pong && Object.keys(message).length === 1) return;
    channel.attempts = 0;
    if (subscription) {
     // Projected deltas cannot initialize a late subscriber. A bounded refresh
     // on join obtains the upstream's native full snapshot for every subscriber.
     if (!message['projected-block-transactions']?.delta) {channel.cached = message;channel.cachedAt=Date.now();}
     else channel.cached = null;
     for (const client of channel.clients) this.send(client, message);
     return;
    }
    let useful = false;
    for (const key of SNAPSHOT_KEYS) if (message[key] !== undefined) { this.snapshot[key] = message[key]; useful = true; }
    if (message.block?.id && Number.isInteger(message.block.height)) {
     const blocks = this.snapshot.blocks || [];
     this.snapshot.blocks = [...blocks.filter(b=>b.height < message.block.height), message.block].sort((a,b)=>a.height-b.height).slice(-15);
     useful = true;
    }
    if (message.blocks || message.block) this.blocksObservedAt = Date.now();
    if (useful) {
     channel.hasData=true;
     this.observedAt = Date.now(); this.health.lastSuccess = this.observedAt;
     this.observe(message);
     if (!this.lastPersist || Date.now()-this.lastPersist > 5000 || message.block) {
      this.store?.put('ws:snapshot', {data:this.snapshot, at:this.observedAt, blocksAt:this.blocksObservedAt}); this.lastPersist = Date.now();
     }
    }
    // Never broadcast entity-specific responses through the shared channel.
    const safe = Object.fromEntries(Object.entries(message).filter(([key])=>SNAPSHOT_KEYS.includes(key) || key === 'block'));
    for (const [client,state] of this.clients) {
     // A tracked transaction's block and confirmation must arrive together from
     // its subscription; otherwise the general block can win the race.
     if (state.subscription['track-tx'] && state.channel?.socket?.readyState === 1) {
      this.send(client,Object.fromEntries(Object.entries(safe).filter(([key])=>key!=='block'&&key!=='blocks')));
     } else this.send(client,safe);
    }
    this.status();
   });
   socket.on('error', () => {});
   socket.on('close', () => {
    if (this.stopped || channel.closed) return;
    if (subscription) {
     channel.cached=null;
     for(const client of channel.clients)this.send(client,{'tracking-unavailable':{reason:'Tracking feed reconnecting',retryable:true}});
    }
    if (!subscription) this.status();
    const delay = Math.min(60000, 1000 * 2 ** Math.min(channel.attempts++,6)) + Math.floor(Math.random()*500);
    channel.retry = setTimeout(connect,delay); channel.retry.unref();
   });
  };
  connect(); return channel;
 }
 attach(client) {
  const state = {subscription:{}, channel:null, lastRefresh:0}; this.clients.set(client,state);
  const init = () => {
   // Persisted snapshots are useful during outages, but never reported as live.
   if (this.observedAt && Date.now()-this.observedAt < 3600000) {
    const initial = Object.fromEntries(Object.entries(this.snapshot).filter(([key])=>key!=='live-2h-chart'));
    this.send(client,{...initial,'provider-freshness':this.freshness()});
   }
   else this.send(client,{'provider-freshness':this.freshness()});
  };
  init();
  client.on('message', raw => {
   if (raw.length > 8192) {client.close(1009,'Subscription too large');return;}
   let message;try {message=JSON.parse(raw.toString());}catch {return;}
   if (!message || typeof message !== 'object' || Array.isArray(message)) return;
   if (message.action === 'ping') this.send(client,{pong:true,'provider-freshness':this.freshness()});
   if (message.action === 'init' || message.action === 'want' || message['refresh-blocks']) init();
   let changed = false;
   for (const key of DETAIL_KEYS) if (message[key] !== undefined) {
    const value = message[key];
    if (value === 'stop' || value === null || value === false || value === -1 || Array.isArray(value) && !value.length) delete state.subscription[key];
    else if (typeof value === 'string' && value.length <= 150 || key === 'track-mempool-block' && Number.isInteger(value) && value >= 0 && value < 8 || key === 'track-addresses' && Array.isArray(value) && value.length <= 10 && value.every(v=>typeof v==='string'&&v.length<=150)) state.subscription[key]=value;
    else continue;
    changed = true;
   }
   if (message['watch-mempool'] !== undefined) state.subscription['watch-mempool'] = message['watch-mempool'] === true;
   if (changed) this.subscribe(client,state);
  });
  client.on('close',()=>{this.release(client,state);this.clients.delete(client);});
  client.on('error',()=>{});
 }
 release(client,state) {
  if (!state.channel) return;
  const channel = state.channel; channel.clients.delete(client); state.channel = null;
  if (!channel.clients.size) {
   channel.closed = true; clearTimeout(channel.retry); channel.socket?.terminate(); this.details.delete(channel.key);
  }
 }
 subscribe(client,state) {
  const subscription = Object.fromEntries(Object.entries(state.subscription).sort(([a],[b])=>a.localeCompare(b)));
  if (!subscription['track-tx']) delete subscription['watch-mempool'];
  const key = JSON.stringify(subscription);
  if (state.channel?.key === key) {
   const c=state.channel;
   if (c.cached && Date.now()-c.cachedAt<this.staleMs) this.send(client,c.cached);
   else if (c.socket?.readyState===1 && Date.now()-(c.lastRefresh||0)>2000) {c.socket.send(key);c.lastRefresh=Date.now();}
   return;
  }
  this.release(client,state);
  if (!Object.keys(subscription).length) return;
  let channel=this.details.get(key);
  if (!channel) {
   if (this.details.size >= this.maxDetails) {this.send(client,{'tracking-unavailable':{reason:'Shared tracking capacity reached',retryable:true}});return;}
   channel=this.channel(subscription);channel.key=key;this.details.set(key,channel);
  }
  channel.clients.add(client);state.channel=channel;
  if (channel.cached && Date.now()-channel.cachedAt<this.staleMs) this.send(client,channel.cached);
  else if (channel.socket?.readyState===1 && Date.now()-(channel.lastRefresh||0)>2000) {channel.socket.send(key);channel.lastRefresh=Date.now();}
 }
 close() {
  this.stopped=true;clearInterval(this.timer);
  if (this.observedAt) this.store?.put('ws:snapshot',{data:this.snapshot,at:this.observedAt});
  for (const channel of [this.core,...this.details.values()]) {channel.closed=true;clearTimeout(channel.retry);channel.socket?.terminate();}
  for (const client of this.clients.keys()) client.close(1001,'Service stopping');
 }
}
module.exports={SharedFeed};
