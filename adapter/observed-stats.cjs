'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {DatabaseSync} = require('node:sqlite');

const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_SAMPLES = 100000;
const MAX_BLOCKS = 50000;
const MAX_NATIVE_SAMPLES = 100000;
const PRUNE_INTERVAL_MS = 60 * 1000;
const SAMPLE_INTERVAL_MS = 30 * 1000;
const MEMPOOL_FIELDS = ['loaded', 'size', 'bytes', 'usage', 'maxmempool', 'mempoolminfee', 'minrelaytxfee'];
const BLOCK_FIELDS = ['timestamp', 'tx_count', 'size', 'weight', 'difficulty'];

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function observedMempool(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const result = {};
  for (const key of MEMPOOL_FIELDS) {
    if (key === 'loaded' ? typeof value[key] === 'boolean' : finite(value[key])) result[key] = value[key];
  }
  return Object.keys(result).length ? result : null;
}

function observedBlock(value) {
  if (!value || typeof value !== 'object' || !Number.isSafeInteger(value.height) || value.height < 0 ||
      typeof value.id !== 'string' || !/^[a-fA-F0-9]{64}$/.test(value.id)) return null;
  const block = {height: value.height, id: value.id.toLowerCase()};
  if (typeof value.previousblockhash === 'string' && /^[a-fA-F0-9]{64}$/.test(value.previousblockhash)) {
    block.previousblockhash = value.previousblockhash.toLowerCase();
  }
  for (const key of BLOCK_FIELDS) if (finite(value[key])) block[key] = value[key];
  const pool = value.extras?.pool;
  if (pool && typeof pool === 'object' && typeof pool.name === 'string' && pool.name.trim()) {
    block.pool = {name: pool.name};
    if (typeof pool.slug === 'string' && pool.slug) block.pool.slug = pool.slug;
    if (Number.isSafeInteger(pool.id)) block.pool.id = pool.id;
  }
  return block;
}

function nativeSample(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const addedAt = nativeAddedAt(value.added);
  if (addedAt === null ||
      !['count', 'vbytes_per_second', 'total_fee', 'mempool_byte_weight'].every(key => finite(value[key])) ||
      !Array.isArray(value.vsizes) || !value.vsizes.every(finite)) return null;
  const data = {added: value.added, count: value.count, vbytes_per_second: value.vbytes_per_second,
    total_fee: value.total_fee, mempool_byte_weight: value.mempool_byte_weight, vsizes: value.vsizes};
  if (finite(value.min_fee)) data.min_fee = value.min_fee;
  return {addedAt, data};
}

function nativeAddedAt(added) {
  if (finite(added) && added >= 0) return Math.round(added * 1000);
  if (typeof added !== 'string' || !added) return null;
  const numeric = /^\d+(?:\.\d+)?$/.test(added) ? Number(added) : NaN;
  const timestamp = finite(numeric) ? numeric * 1000 : Date.parse(added);
  return finite(timestamp) && timestamp >= 0 ? Math.round(timestamp) : null;
}

class ObservedStats {
  constructor({directory = process.env.LTC_DATA_DIR} = {}) {
    if (typeof directory !== 'string' || !directory) throw new TypeError('directory or LTC_DATA_DIR is required');
    fs.mkdirSync(directory, {recursive: true});
    this.db = new DatabaseSync(path.join(directory, 'observed-stats.sqlite'));
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS samples (
        sequence INTEGER PRIMARY KEY,
        observed_at INTEGER NOT NULL,
        mempool_info TEXT,
        vbytes_per_second REAL
      );
      CREATE INDEX IF NOT EXISTS samples_observed_at ON samples(observed_at);
      CREATE TABLE IF NOT EXISTS blocks (
        height INTEGER PRIMARY KEY,
        hash TEXT NOT NULL,
        observed_at INTEGER NOT NULL,
        data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS blocks_observed_at ON blocks(observed_at);
      CREATE TABLE IF NOT EXISTS native_samples (
        added TEXT PRIMARY KEY,
        observed_at INTEGER NOT NULL,
        data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS native_samples_observed_at ON native_samples(observed_at);
    `);
    if (!this.db.prepare('PRAGMA table_info(native_samples)').all().some(column => column.name === 'added_at')) {
      this.db.exec('ALTER TABLE native_samples ADD COLUMN added_at INTEGER');
      const backfill = this.db.prepare('UPDATE native_samples SET added_at = ? WHERE added = ?');
      for (const row of this.db.prepare('SELECT added, data FROM native_samples').iterate()) {
        const addedAt = nativeAddedAt(JSON.parse(row.data).added);
        if (addedAt !== null) backfill.run(addedAt, row.added);
      }
    }
    this.db.exec('CREATE INDEX IF NOT EXISTS native_samples_added_at ON native_samples(added_at)');
    this.insertSample = this.db.prepare('INSERT INTO samples (observed_at, mempool_info, vbytes_per_second) VALUES (?, ?, ?)');
    this.sampleInBucket = this.db.prepare('SELECT sequence, mempool_info, vbytes_per_second FROM samples WHERE observed_at >= ? AND observed_at < ? ORDER BY sequence DESC LIMIT 1');
    this.updateSample = this.db.prepare('UPDATE samples SET observed_at = ?, mempool_info = ?, vbytes_per_second = ? WHERE sequence = ?');
    this.blockAt = this.db.prepare('SELECT hash, data FROM blocks WHERE height = ?');
    this.insertBlock = this.db.prepare('INSERT INTO blocks (height, hash, observed_at, data) VALUES (?, ?, ?, ?)');
    this.updateBlock = this.db.prepare('UPDATE blocks SET data = ? WHERE height = ?');
    this.removeFromHeight = this.db.prepare('DELETE FROM blocks WHERE height >= ?');
    this.pruneSamples = this.db.prepare('DELETE FROM samples WHERE observed_at < ?');
    this.pruneBlocks = this.db.prepare('DELETE FROM blocks WHERE observed_at < ?');
    this.capSamples = this.db.prepare('DELETE FROM samples WHERE sequence NOT IN (SELECT sequence FROM samples ORDER BY sequence DESC LIMIT ?)');
    this.capBlocks = this.db.prepare('DELETE FROM blocks WHERE height NOT IN (SELECT height FROM blocks ORDER BY observed_at DESC, height DESC LIMIT ?)');
    this.insertNative = this.db.prepare('INSERT OR IGNORE INTO native_samples (added, observed_at, data, added_at) VALUES (?, ?, ?, ?)');
    this.pruneNative = this.db.prepare('DELETE FROM native_samples WHERE observed_at < ?');
    this.capNative = this.db.prepare('DELETE FROM native_samples WHERE added NOT IN (SELECT added FROM native_samples ORDER BY observed_at DESC, added DESC LIMIT ?)');
    this.lastPrune = Date.now();
    this.prune(this.lastPrune);
  }

  prune(now) {
    const cutoff = now - RETENTION_MS;
    this.pruneSamples.run(cutoff);
    this.pruneBlocks.run(cutoff);
    this.pruneNative.run(cutoff);
    this.capSamples.run(MAX_SAMPLES);
    this.capBlocks.run(MAX_BLOCKS);
    this.capNative.run(MAX_NATIVE_SAMPLES);
    this.lastPrune = now;
  }

  observe(message) {
    if (Buffer.isBuffer(message)) message = message.toString('utf8');
    if (typeof message === 'string') {
      try { message = JSON.parse(message); } catch { return; }
    }
    if (!message || typeof message !== 'object' || Array.isArray(message)) return;
    const mempoolInfo = observedMempool(message.mempoolInfo);
    const speed = finite(message.vBytesPerSecond) ? message.vBytesPerSecond : null;
    const candidates = [];
    if (Array.isArray(message.blocks)) candidates.push(...message.blocks);
    if (message.block) candidates.push(message.block);
    const blocks = candidates.map(observedBlock).filter(Boolean).sort((a, b) => a.height - b.height);
    const native = nativeSample(message['live-2h-chart']);
    if (!mempoolInfo && speed === null && !blocks.length && !native) return;
    const now = Date.now();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (mempoolInfo || speed !== null) {
        const bucketStart = Math.floor(now / SAMPLE_INTERVAL_MS) * SAMPLE_INTERVAL_MS;
        const previous = this.sampleInBucket.get(bucketStart, bucketStart + SAMPLE_INTERVAL_MS);
        if (previous) {
          const merged = mempoolInfo ? {...(previous.mempool_info ? JSON.parse(previous.mempool_info) : {}), ...mempoolInfo} :
            (previous.mempool_info ? JSON.parse(previous.mempool_info) : null);
          this.updateSample.run(now, merged ? JSON.stringify(merged) : null,
            speed === null ? previous.vbytes_per_second : speed, previous.sequence);
        } else {
          this.insertSample.run(now, mempoolInfo ? JSON.stringify(mempoolInfo) : null, speed);
        }
      }
      if (native) this.insertNative.run(String(native.data.added), now, JSON.stringify(native.data), native.addedAt);
      for (const block of blocks) {
        const existing = this.blockAt.get(block.height);
        if (existing?.hash === block.id) {
          // A later copy may contain pool metadata absent from the first observation.
          const merged = {...JSON.parse(existing.data), ...block};
          if (JSON.stringify(merged) !== existing.data) this.updateBlock.run(JSON.stringify(merged), block.height);
          continue;
        }
        const parent = block.previousblockhash && this.blockAt.get(block.height - 1);
        if (parent && parent.hash !== block.previousblockhash) this.removeFromHeight.run(block.height - 1);
        if (existing) this.removeFromHeight.run(block.height);
        this.insertBlock.run(block.height, block.id, now, JSON.stringify(block));
      }
      if (now - this.lastPrune >= PRUNE_INTERVAL_MS) this.prune(now);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  summary() {
    const samples = this.db.prepare(`SELECT MIN(observed_at) AS start, MAX(observed_at) AS end, COUNT(*) AS count,
      COUNT(mempool_info) AS mempool_count, COUNT(vbytes_per_second) AS speed_count,
      MIN(CASE WHEN mempool_info IS NOT NULL THEN observed_at END) AS mempool_start,
      MAX(CASE WHEN mempool_info IS NOT NULL THEN observed_at END) AS mempool_end,
      MIN(CASE WHEN vbytes_per_second IS NOT NULL THEN observed_at END) AS speed_start,
      MAX(CASE WHEN vbytes_per_second IS NOT NULL THEN observed_at END) AS speed_end FROM samples`).get();
    const blocks = this.db.prepare('SELECT MIN(observed_at) AS start, MAX(observed_at) AS end, COUNT(*) AS count FROM blocks').get();
    const native = this.db.prepare('SELECT MIN(observed_at) AS start, MAX(observed_at) AS end, COUNT(*) AS count FROM native_samples').get();
    const poolCounts = Object.create(null);
    let poolTaggedBlocks = 0;
    for (const row of this.db.prepare('SELECT data FROM blocks').iterate()) {
      const pool = JSON.parse(row.data).pool;
      if (!pool) continue;
      poolTaggedBlocks++;
      poolCounts[pool.name] = (poolCounts[pool.name] || 0) + 1;
    }
    const starts = [samples.start, blocks.start, native.start].filter(value => value !== null);
    const ends = [samples.end, blocks.end, native.end].filter(value => value !== null);
    return {
      historicalCoverage: 'observed-only',
      coverage: {
        start: starts.length ? Math.min(...starts) : null,
        end: ends.length ? Math.max(...ends) : null,
        sampleCounts: {mempool: samples.mempool_count, vBytesPerSecond: samples.speed_count, blocks: blocks.count, native: native.count},
        samples: {start: samples.start, end: samples.end, count: samples.count},
        mempool: {start: samples.mempool_start, end: samples.mempool_end, count: samples.mempool_count},
        vBytesPerSecond: {start: samples.speed_start, end: samples.speed_end, count: samples.speed_count},
        blocks: {start: blocks.start, end: blocks.end, count: blocks.count},
        native: {start: native.start, end: native.end, count: native.count},
      },
      pools: {counts: poolCounts, taggedBlocks: poolTaggedBlocks, observedBlocks: blocks.count},
    };
  }

  series() {
    return {
      historicalCoverage: 'observed-only',
      mempool: [...this.db.prepare('SELECT observed_at, mempool_info, vbytes_per_second FROM samples ORDER BY sequence').iterate()]
        .map(row => ({observedAt: row.observed_at, ...(row.mempool_info === null ? {} : {mempoolInfo: JSON.parse(row.mempool_info)}),
          ...(row.vbytes_per_second === null ? {} : {vBytesPerSecond: row.vbytes_per_second})})),
      blocks: [...this.db.prepare('SELECT observed_at, data FROM blocks ORDER BY height').iterate()]
        .map(row => ({observedAt: row.observed_at, ...JSON.parse(row.data)})),
    };
  }

  nativeSeries(windowMs) {
    if (!Number.isFinite(windowMs) || windowMs < 0) throw new RangeError('windowMs must be a non-negative finite number');
    const now = Date.now();
    return [...this.db.prepare('SELECT data FROM native_samples WHERE added_at >= ? AND added_at <= ? ORDER BY added_at DESC, added DESC')
      .iterate(now - windowMs, now)].map(row => JSON.parse(row.data));
  }

  close() {
    this.db.close();
  }
}

module.exports = {ObservedStats};
