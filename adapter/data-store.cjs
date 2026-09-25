'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {DatabaseSync} = require('node:sqlite');

class DataStore {
 constructor({dir = process.env.LTC_DATA_DIR || path.join(__dirname, 'data'), filename = 'cache.sqlite',
  maxEntries = 5000, maxBytes = 32 * 1024 * 1024, maxAgeMs = 30 * 86400000, now = Date.now} = {}) {
  this.maxEntries = maxEntries;
  this.maxBytes = maxBytes;
  this.maxAgeMs = maxAgeMs;
  this.now = now;
  fs.mkdirSync(dir, {recursive: true, mode: 0o700});
  this.db = new DatabaseSync(path.join(dir, filename));
  this.db.exec(`PRAGMA journal_mode=DELETE; PRAGMA auto_vacuum=FULL;
   CREATE TABLE IF NOT EXISTS entries (key TEXT PRIMARY KEY, value TEXT NOT NULL, saved_at INTEGER NOT NULL, bytes INTEGER NOT NULL);
   CREATE INDEX IF NOT EXISTS entries_age ON entries(saved_at);`);
  this.read = this.db.prepare('SELECT value, saved_at FROM entries WHERE key = ?');
  this.write = this.db.prepare(`INSERT INTO entries(key,value,saved_at,bytes) VALUES(?,?,?,?)
   ON CONFLICT(key) DO UPDATE SET value=excluded.value,saved_at=excluded.saved_at,bytes=excluded.bytes`);
  this.remove = this.db.prepare('DELETE FROM entries WHERE key = ?');
  this.pruneOld = this.db.prepare('DELETE FROM entries WHERE saved_at < ?');
  this.size = this.db.prepare('SELECT COUNT(*) AS count, COALESCE(SUM(bytes),0) AS bytes FROM entries');
  this.oldest = this.db.prepare('SELECT key FROM entries ORDER BY saved_at, rowid LIMIT 1');
  this.prune();
 }
 get(key) {
  const row = this.read.get(key);
  if (!row) return null;
  if (row.saved_at < this.now() - this.maxAgeMs) { this.remove.run(key); return null; }
  return JSON.parse(row.value);
 }
 put(key, value) {
  if (typeof key !== 'string' || !key || Buffer.byteLength(key) > 2048) throw new RangeError('Invalid cache key');
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new TypeError('Cache value must be JSON serializable');
  const bytes = Buffer.byteLength(key) + Buffer.byteLength(serialized);
  if (bytes > this.maxBytes) return false;
  this.write.run(key, serialized, this.now(), bytes);
  this.prune();
  return true;
 }
 prune() {
  this.pruneOld.run(this.now() - this.maxAgeMs);
  let size = this.size.get();
  while (size.count > this.maxEntries || size.bytes > this.maxBytes) {
   this.remove.run(this.oldest.get().key);
   size = this.size.get();
  }
 }
 close() { this.db.close(); }
}

module.exports = {DataStore};
