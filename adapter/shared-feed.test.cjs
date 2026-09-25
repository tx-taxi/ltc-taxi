'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {once} = require('node:events');
const {WebSocket, WebSocketServer} = require('ws');
const {SharedFeed} = require('./shared-feed.cjs');
const sleep = ms => new Promise(resolve=>setTimeout(resolve,ms));
async function until(check) {for(let i=0;i<100;i++){if(check())return;await sleep(10);}throw Error('Condition timed out');}

test('visitors share upstream, detail subscriptions stay isolated, cached init survives outage', async () => {
 const upstream=new WebSocketServer({port:0});await once(upstream,'listening');
 let connections=0;
 upstream.on('connection',socket=>{
  connections++;
  socket.on('message',raw=>{
   const m=JSON.parse(raw);
   if(m.action==='init')socket.send(JSON.stringify({blocks:[{id:'a',height:100}],mempoolInfo:{size:2}}));
   if(m['track-tx'])socket.send(JSON.stringify({tx:{txid:m['track-tx']}}));
  });
 });
 const cache=new Map();const store={get:k=>cache.get(k),put:(k,v)=>cache.set(k,v)};
 const health={};const observed=[];
 const feed=new SharedFeed({url:`ws://127.0.0.1:${upstream.address().port}`,store,health,observe:m=>observed.push(m),maxDetails:1});
 const downstream=new WebSocketServer({port:0});await once(downstream,'listening');downstream.on('connection',c=>feed.attach(c));
 const clients=[];const messages=[];
 try {
  for(let i=0;i<6;i++){
   const c=new WebSocket(`ws://127.0.0.1:${downstream.address().port}`);clients.push(c);messages[i]=[];c.on('message',raw=>messages[i].push(JSON.parse(raw)));await once(c,'open');c.send(JSON.stringify({action:'init'}));
  }
  await until(()=>messages.every(ms=>ms.some(m=>m.blocks)));
  assert.equal(connections,1);
  const id='a'.repeat(64);
  clients[0].send(JSON.stringify({'track-tx':id}));clients[1].send(JSON.stringify({'track-tx':id}));
  await until(()=>messages[0].some(m=>m.tx)&&messages[1].some(m=>m.tx));
  assert.equal(connections,2,'one subscription socket, not one per visitor');
  assert.equal(messages[2].some(m=>m.tx),false,'entity responses do not leak to other visitors');
  clients[2].send(JSON.stringify({'track-tx':'b'.repeat(64)}));
  await until(()=>messages[2].some(m=>m['tracking-unavailable']));assert.equal(connections,2);
  const last=feed.observedAt;
  for(const c of upstream.clients)c.terminate();
  await until(()=>health.websocket==='stale');
  clients[3].send(JSON.stringify({action:'init'}));
  await until(()=>messages[3].some(m=>m.blocks && m['provider-freshness']?.state==='stale'));
  assert.equal(feed.observedAt,last,'cache replay is not a fresh observation');
  assert.equal(observed.length,1,'new visitors do not duplicate collection');
  assert.equal(store.get('ws:snapshot').data.blocks[0].height,100);
 } finally {
  feed.close();for(const c of clients)c.terminate();for(const c of downstream.clients)c.terminate();for(const c of upstream.clients)c.terminate();
  await new Promise(resolve=>downstream.close(resolve));await new Promise(resolve=>upstream.close(resolve));
 }
});
