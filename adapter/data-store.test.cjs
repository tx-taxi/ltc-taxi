'use strict';

const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {DataStore} = require('./data-store.cjs');

test('values and their timestamps survive reopening', t => {
 const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ltc-store-'));
 t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
 const first = new DataStore({dir});
 first.put('feed', {at: 12345, items: [1, 2]});
 first.close();
 const second = new DataStore({dir});
 assert.deepEqual(second.get('feed'), {at: 12345, items: [1, 2]});
 second.close();
});

test('retention evicts old entries and rejects oversized values', t => {
 const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ltc-store-'));
 t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
 let now = 1000;
 const store = new DataStore({dir, now: () => now, maxEntries: 2, maxBytes: 80, maxAgeMs: 100});
 store.put('a', {at: 1});
 now++;
 store.put('b', {at: 2});
 now++;
 store.put('c', {at: 3});
 assert.equal(store.get('a'), null);
 assert.deepEqual(store.get('b'), {at: 2});
 assert.equal(store.put('large', {payload: 'x'.repeat(100)}), false);
 now += 101;
 assert.equal(store.get('c'), null);
 store.close();
});
