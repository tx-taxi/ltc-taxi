'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {once}=require('node:events');
const {spawn}=require('node:child_process');
const http=require('node:http');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {WebSocket,WebSocketServer}=require('ws');
const wait=ms=>new Promise(r=>setTimeout(r,ms));

test('gateway collects without visitors and restores cache/snapshot after process restart',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ltc-shared-runtime-'));
 let hits=0,upstreamConnections=0;
 const upstream=http.createServer((req,res)=>{hits++;res.setHeader('content-type','application/json');res.end(JSON.stringify({count:3,vsize:1000,total_fee:100}));});
 upstream.listen(0,'127.0.0.1');await once(upstream,'listening');
 const wss=new WebSocketServer({server:upstream});
 const sample={added:Math.floor(Date.now()/1000),count:3,vbytes_per_second:2,total_fee:100,mempool_byte_weight:1000,vsizes:[1000]};
 wss.on('connection',socket=>{upstreamConnections++;socket.on('message',raw=>{
  if(JSON.parse(raw).action==='init')socket.send(JSON.stringify({blocks:[{id:'a'.repeat(64),height:100,timestamp:sample.added}],mempoolInfo:{size:3},'live-2h-chart':sample}));
 });});
 const allocator=http.createServer();allocator.listen(0,'127.0.0.1');await once(allocator,'listening');const port=allocator.address().port;await new Promise(r=>allocator.close(r));
 const url=`http://127.0.0.1:${port}`;let child;let errors='';
 const start=async()=>{
  child=spawn(process.execPath,[path.join(__dirname,'server.cjs')],{env:{...process.env,PORT:String(port),LTC_DATA_DIR:dir,LTC_PROVIDER:`http://127.0.0.1:${upstream.address()?.port||upstreamPort}`},stdio:['ignore','pipe','pipe']});
  child.stderr.on('data',d=>errors+=d);
  for(let i=0;i<100;i++){try{if((await fetch(url+'/healthz')).ok)return;}catch{}await wait(20);}
  throw Error('Gateway failed to start: '+errors);
 };
 const stop=async()=>{const exited=once(child,'exit');child.kill('SIGTERM');await exited;child=null;};
 const upstreamPort=upstream.address().port;
 let client;
 try{
  await start();
  let coverage;
  for(let i=0;i<100;i++){coverage=await(await fetch(url+'/api/local-statistics/coverage')).json();if(coverage.coverage.sampleCounts.blocks)break;await wait(20);}
  // Coverage endpoint caches summaries for30s; inspect persistence directly if
  // the first request preceded upstream initialization.
  const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(path.join(dir,'observed-stats.sqlite'));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM blocks').get().n,1);db.close();
  assert.equal(upstreamConnections,1,'collector runs before any browser connects');
  const responses=await Promise.all(Array.from({length:6},()=>fetch(url+'/api/mempool')));
  assert.equal(hits,1);assert.equal(responses[0].headers.get('x-ltc-stale'),'false');
  const observed=responses[0].headers.get('x-ltc-observed-at');
  await stop();for(const c of wss.clients)c.terminate();await new Promise(r=>wss.close(r));await new Promise(r=>upstream.close(r));
  await start();
  const cached=await fetch(url+'/api/mempool');assert.equal(cached.status,200);assert.equal(cached.headers.get('x-ltc-observed-at'),observed);
  client=new WebSocket(url.replace('http:','ws:')+'/api/v1/ws');const first=once(client,'message');
  const snapshot=JSON.parse((await first)[0]);assert.equal(snapshot.blocks[0].height,100);assert.equal(snapshot['provider-freshness'].state,'stale');
  const restored=await(await fetch(url+'/api/local-statistics/coverage')).json();assert.equal(restored.coverage.sampleCounts.blocks,1);assert.equal(restored.historicalCoverage,'observed-only');
 }finally{
  client?.terminate();if(child)await stop();for(const c of wss.clients)c.terminate();wss.close();upstream.close();fs.rmSync(dir,{recursive:true,force:true});
 }
});
