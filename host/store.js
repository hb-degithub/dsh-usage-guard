/**
 * 聚合存储：days 按 (日期|提供商|模型) 累计；sessions 持久化每个会话的折叠水位，
 * 使重启后的回填与实时采集都不重复计数。原子写；损坏自动备份重置。
 */
import { readFileSync, writeFileSync, renameSync, copyFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { zeroBuckets, keyOf, initFold } from './fold.js';
import { DEFAULT_PRICES } from './pricing.js';

export const STORE_VERSION = 1;

const emptyData = () => ({
  version: STORE_VERSION,
  days: {},
  sessions: {},
  config: {
    prices: { ...DEFAULT_PRICES },
    guard: { dailyTokens: null, dailyCost: null, mode: 'warn' },
  },
});

const isFiniteNonNegative = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;

function validateConfig(config) {
  if (typeof config !== 'object' || config === null) throw new Error('config must be an object');
  const { prices, guard } = config;
  if (typeof prices !== 'object' || prices === null) throw new Error('config.prices must be an object');
  for (const [key, price] of Object.entries(prices)) {
    if (!key.includes('/')) throw new Error(`price key "${key}" must be "<provider>/<model>"`);
    for (const field of ['input', 'output', 'cacheRead', 'cacheWrite']) {
      if (!isFiniteNonNegative(price[field])) throw new Error(`price ${key}.${field} must be a non-negative number`);
    }
    if (typeof price.currency !== 'string' || price.currency === '') throw new Error(`price ${key}.currency is required`);
  }
  if (typeof guard !== 'object' || guard === null) throw new Error('config.guard must be an object');
  for (const field of ['dailyTokens', 'dailyCost']) {
    const v = guard[field];
    if (v !== null && !isFiniteNonNegative(v)) throw new Error(`guard.${field} must be null or a non-negative number`);
  }
  if (guard.mode !== 'warn' && guard.mode !== 'block') throw new Error('guard.mode must be "warn" or "block"');
}

export class Store {
  constructor(path) {
    this.path = path;
    this.data = emptyData();
    this.dirty = false;
  }

  load() {
    let raw;
    try {
      raw = readFileSync(this.path, 'utf8');
    } catch {
      return; // 首次运行：文件不存在
    }
    try {
      const parsed = JSON.parse(raw);
      if (parsed?.version !== STORE_VERSION || typeof parsed.days !== 'object' || typeof parsed.sessions !== 'object' || typeof parsed.config !== 'object') {
        throw new Error('unrecognized store shape');
      }
      validateConfig(parsed.config);
      this.data = parsed;
    } catch {
      copyFileSync(this.path, `${this.path}.corrupt-${Date.now()}`);
      this.data = emptyData();
    }
    this.dirty = false;
  }

  recordDelta(sessionId, delta, foldState) {
    const key = keyOf(delta.day, delta.provider, delta.model);
    const buckets = this.data.days[key] ?? zeroBuckets();
    this.data.days[key] = buckets;
    buckets.input += delta.input;
    buckets.output += delta.output;
    buckets.cacheRead += delta.cacheRead;
    buckets.cacheWrite += delta.cacheWrite;
    buckets.requests += delta.requests;
    this.data.sessions[sessionId] = foldState;
    this.dirty = true;
  }

  noteState(sessionId, foldState) {
    this.data.sessions[sessionId] = foldState;
    this.dirty = true;
  }

  foldStateOf(sessionId) {
    return this.data.sessions[sessionId] ?? initFold();
  }

  setConfig(config) {
    validateConfig(config);
    this.data.config = config;
    this.dirty = true;
  }

  flush() {
    if (!this.dirty) return;
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data), 'utf8');
    renameSync(tmp, this.path);
    this.dirty = false;
  }
}
