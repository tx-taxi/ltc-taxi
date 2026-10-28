'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {PrimaryTipMonitor} = require('./primary-tip-monitor.cjs');

test('independent height detects a lagging primary and clears only on a successful recovery check', async () => {
 let primaryHeight = 100, referenceHeight = 100, offline = false, now = 1234;
 const fetchImpl = async url => {
  if (offline) throw Error('offline');
  return url.startsWith('https://primary.test')
   ? new Response(String(primaryHeight))
   : Response.json({height:referenceHeight,hash:'a'.repeat(64)});
 };
 const monitor = new PrimaryTipMonitor({primary:'https://primary.test',fetchImpl,now:()=>now});
 await monitor.check(); assert.equal(monitor.behind,false);
 referenceHeight = 103; now++;
 await monitor.check(); assert.equal(monitor.behind,true);
 assert.deepEqual(monitor.reference,{height:103,hash:'a'.repeat(64),at:now});
 offline = true; primaryHeight = 103;
 await monitor.check(); assert.equal(monitor.behind,true);
 offline = false; now++;
 await monitor.check(); assert.equal(monitor.behind,false);
});

test('invalid independent height or hash never overrides the last verified observation', async () => {
 let invalid = false;
 const monitor = new PrimaryTipMonitor({primary:'https://primary.test',fetchImpl:async url =>
  url.startsWith('https://primary.test') ? new Response('100') : Response.json(invalid
   ? {height:500,hash:'invalid'} : {height:103,hash:'b'.repeat(64)})});
 await monitor.check(); assert.equal(monitor.behind,true);
 invalid = true; await monitor.check();
 assert.equal(monitor.behind,true); assert.equal(monitor.reference.height,103);
});

test('reference tip becomes stale after 90 seconds and expires after two intervals', async () => {
 let now=0;
 const monitor=new PrimaryTipMonitor({primary:'https://primary.test',now:()=>now,intervalMs:300000,
  fetchImpl:async url=>url.startsWith('https://primary.test') ? new Response('100')
   : Response.json({height:103,hash:'a'.repeat(64)})});
 await monitor.check();
 now=90000; assert.deepEqual(monitor.referenceState(),{stale:false,expired:false});
 now=90001; assert.deepEqual(monitor.referenceState(),{stale:true,expired:false});
 now=600001; assert.deepEqual(monitor.referenceState(),{stale:true,expired:true});
});

test('height and hash readers share a bounded reference refresh even across failures', async () => {
 let now=0,calls=0,release,offline=false;
 const gate=new Promise(resolve=>release=resolve);
 const monitor=new PrimaryTipMonitor({primary:'https://primary.test',now:()=>now,
  fetchImpl:async url=>{
   if(url.startsWith('https://primary.test'))return new Response('100');
   calls++;
   if(offline)throw Error('offline');
   if(calls>1)await gate;
   return Response.json({height:100+calls,hash:(calls>1?'b':'a').repeat(64)});
  }});
 await monitor.check();assert.equal(calls,1);
 now=90001;await monitor.refreshReference();assert.equal(calls,1);
 now=150000;const readers=Array.from({length:20},()=>monitor.refreshReference());
 assert.equal(calls,2);release();await Promise.all(readers);
 assert.equal(monitor.reference.height,102);assert.equal(monitor.reference.hash,'b'.repeat(64));
 now=300000;offline=true;await monitor.refreshReference();assert.equal(calls,3);
 await monitor.refreshReference();assert.equal(calls,3);
});
