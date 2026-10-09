/**
 * 聚合存储：days 按 (日期|提供商|模型) 累计；sessions 持久化每个会话的折叠水位，
 * 使重启后的回填与实时采集都不重复计数。原子写；损坏自动备份重置。
 *
 * 不变量（改动前务必确认）：days 必须等于「按 sessions 里的水位续跑当前日志」的结果。
 * 一旦两者不一致，days 无法逐会话修正（只按 天×提供商×模型 聚合，追不回某个会话的贡献），
 * 唯一可靠的修法是整表重折 —— 即 bump STORE_VERSION 并加一条迁移。
 */
import { readFileSync, writeFileSync, renameSync, copyFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { zeroBuckets, keyOf, initFold } from './fold.js';
import { DEFAULT_PRICES } from './pricing.js';

/** 2：0.1.1 起一次性重折（见 migrate 注释）；1 及更早的 days 与 sessions 水位互相矛盾。 */
export const STORE_VERSION = 2;

const emptyData = () => ({
  version: STORE_VERSION,
  days: {},
  sessions: {},
  config: defaultConfig(),
});

const defaultConfig = () => ({
  prices: structuredClone(DEFAULT_PRICES),
  guard: { dailyTokens: null, dailyCost: null, mode: 'warn' },
});

const isFiniteNonNegative = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const isRecord = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

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
    let parsed;
    let shape = 'ok';
    try {
      parsed = JSON.parse(raw);
      if (!isRecord(parsed) || !isRecord(parsed.days) || !isRecord(parsed.sessions) || !isRecord(parsed.config)) throw new Error('unrecognized store shape');
      if (typeof parsed.version !== 'number') throw new Error('unrecognized store shape');
      if (parsed.version > STORE_VERSION) throw new Error('store written by a newer plugin version');
      if (parsed.version < STORE_VERSION) shape = 'migrate';
    } catch {
      shape = 'corrupt';
    }
    if (shape === 'corrupt') {
      try {
        copyFileSync(this.path, `${this.path}.corrupt-${Date.now()}`);
      } catch {
        // 备份失败也要继续重置，load() 永不抛错
      }
      this.data = emptyData();
      this.dirty = false;
      return;
    }
    if (shape === 'migrate') {
      // 一次性重折：v1 的 days 与 sessions 水位互相矛盾（旧版本漏记了大部分样本，水位却已推到
      // 日志末尾 → 续跑永远补不回来。实测本机 days 只有日志全量重折的约 1/8）。days 与 sessions
      // 都由日志推导，一起清空让随后的 backfill 按当前日志重建；config（价格/守卫）保留。
      // 注意：日志已被删除的会话，其历史用量随之从统计里消失——这是无法避免的，聚合桶追不回来源。
      this.data = { ...emptyData(), config: parsed.config };
      this.dirty = true;
    } else {
      this.data = parsed;
    }
    // 形状正确但 config 非法（多为手改配置）：仅替换 config 为默认值，保留历史数据，不备份、不抛错；
    // 标记 dirty，让下一次 flush 把修复后的文件落盘
    try {
      validateConfig(this.data.config);
    } catch {
      this.data.config = defaultConfig();
      this.dirty = true;
    }
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
    if (this.data.sessions[sessionId] === foldState) return; // applyEvent 对无变化事件返回同一引用
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
