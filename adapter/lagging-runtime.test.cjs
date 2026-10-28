'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {once} = require('node:events');
const {spawn} = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {WebSocket, WebSocketServer} = require('ws');

test('gateway does not present lagging primary data or missing transactions as current', async () => {
 const dir = fs.mkdtempSync(path.join(os.tmpdir(),'ltc-lagging-runtime-'));
 fs.writeFileSync(path.join(dir,'index.html'),'<html><head></head><body></body></html>');
 const block = {id:'a'.repeat(64),height:100,tx_count:2,timestamp:Math.floor(Date.now()/1000)};
 const upstream = http.createServer((req,res) => {
  if (req.url === '/api/blocks/tip/height') return res.end('100');
  if (req.url === '/reference') return res.end(JSON.stringify({height:103,hash:'b'.repeat(64)}));
  if (req.url === '/api/blocks') return res.end(JSON.stringify([block]));
  if (req.url === '/api/tx/'+'d'.repeat(64)) return res.end(JSON.stringify({status:{confirmed:false},fee:100}));
  if (req.url.startsWith('/api/tx/')) {res.statusCode=404; return res.end('Not found');}
  res.end('{}');
 });
 upstream.listen(0,'127.0.0.1'); await once(upstream,'listening');
 const wss = new WebSocketServer({server:upstream});
 wss.on('connection', ws => ws.on('message', raw => {
  if (JSON.parse(raw).action === 'init') ws.send(JSON.stringify({blocks:[block]}));
 }));
 const allocator=http.createServer(); allocator.listen(0,'127.0.0.1'); await once(allocator,'listening');
 const port=allocator.address().port; await new Promise(resolve=>allocator.close(resolve));
 const origin=`http://127.0.0.1:${upstream.address().port}`;
 const url=`http://127.0.0.1:${port}`;
 const child=spawn(process.execPath,[path.join(__dirname,'server.cjs')],{env:{...process.env,PORT:String(port),LTC_DATA_DIR:dir,LTC_STATIC_ROOT:dir,LTC_PROVIDER:origin,LTC_REFERENCE_TIP_URL:origin+'/reference'},stdio:'ignore'});
 let client;
 try {
  let ready=false;
  for (let i=0;i<100;i++) {try {const r=await fetch(url+'/healthz');if(r.ok){ready=true;break;}} catch {} await new Promise(r=>setTimeout(r,20));}
  assert.ok(ready,'gateway started');
  const tip=await fetch(url+'/api/blocks/tip/height');
  assert.equal(await tip.text(),'103'); assert.equal(tip.headers.get('x-ltc-source'),'blockcypher');
  const blocks=await fetch(url+'/api/blocks'); assert.equal(blocks.headers.get('x-ltc-stale'),'true');
  const tx=await fetch(url+'/api/tx/'+ 'c'.repeat(64)); assert.equal(tx.status,503);
  const page=await fetch(url+'/tx/'+ 'd'.repeat(64));assert.equal(page.status,503);
  assert.doesNotMatch(await page.text(),/Pending Litecoin transaction/);
  client=new WebSocket(url.replace('http:','ws:')+'/api/v1/ws');
  const [raw]=await once(client,'message'); const initial=JSON.parse(raw);
  assert.equal(initial['provider-freshness'].state,'stale');
 } finally {
  client?.terminate(); const exited=once(child,'exit');child.kill('SIGTERM');await exited;
  for (const c of wss.clients) c.terminate(); await new Promise(r=>wss.close(r));
  await new Promise(r=>upstream.close(r));fs.rmSync(dir,{recursive:true,force:true});
 }
});

test('slow independent tip check does not hold unrelated successful API reads', async () => {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ltc-slow-reference-'));
 let referenceResponse, notifyReference;
 const referenceRequested=new Promise(resolve=>notifyReference=resolve);
 const upstream=http.createServer((req,res)=>{
  if(req.url==='/reference') {referenceResponse=res;notifyReference();return;}
  if(req.url==='/api/blocks/tip/height')return res.end('100');
  if(req.url==='/api/mempool')return res.end(JSON.stringify({count:3}));
  res.statusCode=404;res.end();
 });
 upstream.listen(0,'127.0.0.1');await once(upstream,'listening');
 const allocator=http.createServer();allocator.listen(0,'127.0.0.1');await once(allocator,'listening');
 const port=allocator.address().port;await new Promise(resolve=>allocator.close(resolve));
 const origin=`http://127.0.0.1:${upstream.address().port}`;
 const child=spawn(process.execPath,[path.join(__dirname,'server.cjs')],{env:{...process.env,PORT:String(port),LTC_DATA_DIR:dir,LTC_PROVIDER:origin,LTC_REFERENCE_TIP_URL:origin+'/reference'},stdio:'ignore'});
 try {
  await referenceRequested;
  const response=await Promise.race([
   fetch(`http://127.0.0.1:${port}/api/mempool`),
   new Promise((_,reject)=>setTimeout(()=>reject(Error('unrelated read waited for reference')),1000))
  ]);
  assert.equal(response.status,200);assert.equal((await response.json()).count,3);
 } finally {
  referenceResponse?.end(JSON.stringify({height:100,hash:'a'.repeat(64)}));
  const exited=once(child,'exit');child.kill('SIGTERM');await exited;
  upstream.closeAllConnections();await new Promise(r=>upstream.close(r));fs.rmSync(dir,{recursive:true,force:true});
 }
});

test('concurrent height and hash readers share bounded refresh and recover after a reference outage', async () => {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ltc-reference-clock-'));
 const clock=path.join(dir,'clock');const preload=path.join(dir,'clock.cjs');
 const start=1793210000000;fs.writeFileSync(clock,String(start));
 fs.writeFileSync(preload,`Date.now = () => Number(require('node:fs').readFileSync(${JSON.stringify(clock)}, 'utf8'));`);
 let references=0,fail=false;
 const upstream=http.createServer((req,res)=>{
  if(req.url==='/api/blocks/tip/height')return res.end('100');
  if(req.url==='/reference') {
   references++;
   if(fail){res.statusCode=503;return res.end('offline');}
   return res.end(JSON.stringify({height:references===1?103:104,hash:(references===1?'b':'c').repeat(64)}));
  }
  res.end('{}');
 });
 upstream.listen(0,'127.0.0.1');await once(upstream,'listening');
 const allocator=http.createServer();allocator.listen(0,'127.0.0.1');await once(allocator,'listening');
 const port=allocator.address().port;await new Promise(resolve=>allocator.close(resolve));
 const origin=`http://127.0.0.1:${upstream.address().port}`;
 const child=spawn(process.execPath,[path.join(__dirname,'server.cjs')],{env:{...process.env,PORT:String(port),LTC_DATA_DIR:dir,LTC_PROVIDER:origin,LTC_REFERENCE_TIP_URL:origin+'/reference',NODE_OPTIONS:`--require=${preload}`},stdio:'ignore'});
 const url=`http://127.0.0.1:${port}`;
 try {
  let ready=false;
  for(let i=0;i<100;i++){try{if((await fetch(url+'/healthz')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,20));}
  assert.ok(ready);
  assert.equal(await (await fetch(url+'/api/blocks/tip/height')).text(),'103');
  assert.equal(references,1);
  fail=true;fs.writeFileSync(clock,String(start+150000));
  const readBoth=()=>Promise.all(Array.from({length:12},(_,i)=>fetch(url+'/api/blocks/tip/'+(i%2?'hash':'height'))));
  const stale=await readBoth();assert.equal(references,2);
  assert.ok(stale.every(r=>r.headers.get('x-ltc-stale')==='true'));
  assert.equal(await stale[0].text(),'103');assert.equal(await stale[1].text(),'b'.repeat(64));
  fail=false;fs.writeFileSync(clock,String(start+300000));
  const fresh=await readBoth();assert.equal(references,3);
  assert.ok(fresh.every(r=>r.headers.get('x-ltc-stale')==='false'));
  assert.equal(await fresh[0].text(),'104');assert.equal(await fresh[1].text(),'c'.repeat(64));
 } finally {
  const exited=once(child,'exit');child.kill('SIGTERM');await exited;
  upstream.closeAllConnections();await new Promise(r=>upstream.close(r));fs.rmSync(dir,{recursive:true,force:true});
 }
});
