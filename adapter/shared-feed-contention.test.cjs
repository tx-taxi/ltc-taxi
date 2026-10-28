'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {once} = require('node:events');
const {DatabaseSync} = require('node:sqlite');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {WebSocket, WebSocketServer} = require('ws');
const {DataStore} = require('./data-store.cjs');
const {ObservedStats} = require('./observed-stats.cjs');
const {SharedFeed} = require('./shared-feed.cjs');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check) {
 for (let i = 0; i < 300; i++) { if (check()) return; await sleep(20); }
 throw Error('Timed out waiting for feed data');
}

test('live feed survives locked history and cache, then persists again after locks clear', async () => {
 const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ltc-sqlite-contention-'));
 const store = new DataStore({dir});
 const stats = new ObservedStats({directory: dir});
 const upstream = new WebSocketServer({port: 0});
 await once(upstream, 'listening');
 const connected = once(upstream, 'connection');
 const health = {};
 const feed = new SharedFeed({url: `ws://127.0.0.1:${upstream.address().port}`, store, health, observe: value => stats.observe(value)});
 const [source] = await connected;
 const downstream = new WebSocketServer({port: 0});
 await once(downstream, 'listening');
 downstream.on('connection', client => feed.attach(client));
 const client = new WebSocket(`ws://127.0.0.1:${downstream.address().port}`);
 const messages = [];
 client.on('message', data => messages.push(JSON.parse(data)));
 await once(client, 'open');
 const historyLock = new DatabaseSync(path.join(dir, 'observed-stats.sqlite'));
 const cacheLock = new DatabaseSync(path.join(dir, 'cache.sqlite'));
 try {
  historyLock.exec('BEGIN IMMEDIATE');
  cacheLock.exec('BEGIN IMMEDIATE');
  source.send(JSON.stringify({blocks: [{id: 'a'.repeat(64), height: 100}]}));
  await until(() => messages.some(message => message.blocks?.[0]?.height === 100));
  assert.equal(feed.freshness().state, 'live');
  historyLock.exec('ROLLBACK');
  cacheLock.exec('ROLLBACK');
  source.send(JSON.stringify({blocks: [{id: 'b'.repeat(64), height: 101}]}));
  await until(() => messages.some(message => message.blocks?.[0]?.height === 101));
  assert.equal(stats.series().blocks.at(-1).height, 101);
  assert.equal(store.get('ws:snapshot').data.blocks[0].height, 101);
 } finally {
  try { historyLock.exec('ROLLBACK'); } catch {}
  try { cacheLock.exec('ROLLBACK'); } catch {}
  historyLock.close(); cacheLock.close(); feed.close(); client.terminate();
  for (const socket of downstream.clients) socket.terminate();
  for (const socket of upstream.clients) socket.terminate();
  await new Promise(resolve => downstream.close(resolve));
  await new Promise(resolve => upstream.close(resolve));
  stats.close(); store.close(); fs.rmSync(dir, {recursive: true, force: true});
 }
});
