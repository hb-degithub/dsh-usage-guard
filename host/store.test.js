import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store, STORE_VERSION } from './store.js';
import { DEFAULT_PRICES, costOf, priceKey } from './pricing.js';
import { initFold, keyOf } from './fold.js';

let dir, path;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'usage-stats-')); path = join(dir, 'usage-stats.json'); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const delta = (over = {}) => ({ day: '2026-08-17', provider: 'zijian', model: 'kimi-k3', input: 10, output: 5, cacheRead: 1, cacheWrite: 0, requests: 1, ...over });

describe('Store', () => {
  it('starts empty with default prices and warn guard', () => {
    const s = new Store(path); s.load();
    expect(s.data.version).toBe(STORE_VERSION);
    expect(s.data.days).toEqual({});
    expect(s.data.config.guard.mode).toBe('warn');
    expect(s.data.config.prices[priceKey('deepseek', 'deepseek-chat')]).toBeDefined();
  });

  it('accumulates deltas under the (day,provider,model) key', () => {
    const s = new Store(path); s.load();
    s.recordDelta('session-a', delta(), initFold());
    s.recordDelta('session-a', delta({ input: 3, output: 2, requests: 0 }), initFold());
    s.recordDelta('session-b', delta({ model: 'other' }), initFold());
    expect(s.data.days[keyOf('2026-08-17', 'zijian', 'kimi-k3')]).toEqual({ input: 13, output: 7, cacheRead: 2, cacheWrite: 0, requests: 1 });
    expect(s.data.days[keyOf('2026-08-17', 'zijian', 'other')].requests).toBe(1);
  });

  it('persists fold state per session and restores it', () => {
    const s = new Store(path); s.load();
    const fold = { provider: 'zijian', model: 'kimi-k3', last: { turn: 1, step: 2, buckets: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 } }, lastSeq: 42 };
    s.recordDelta('session-a', delta(), fold);
    s.flush();
    const s2 = new Store(path); s2.load();
    expect(s2.foldStateOf('session-a')).toEqual(fold);
    expect(s2.foldStateOf('session-new')).toEqual(initFold());
  });

  it('flush is atomic and skips when clean', () => {
    const s = new Store(path); s.load();
    s.flush();
    expect(existsSync(path)).toBe(false); // 无脏数据不落盘
    s.recordDelta('session-a', delta(), initFold());
    s.flush();
    expect(existsSync(path)).toBe(true);
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    expect(raw.version).toBe(STORE_VERSION);
    expect(readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]); // tmp 已 rename
  });

  it('recovers from a corrupt store file with a timestamped backup', () => {
    writeFileSync(path, '{broken json', 'utf8');
    const s = new Store(path); s.load();
    expect(s.data.days).toEqual({});
    expect(readdirSync(dir).some((f) => f.startsWith('usage-stats.json.corrupt-'))).toBe(true);
  });

  it('rejects null/array members in an otherwise valid JSON file', () => {
    writeFileSync(path, JSON.stringify({ version: 1, days: null, sessions: {}, config: { prices: {}, guard: { dailyTokens: null, dailyCost: null, mode: 'warn' } } }), 'utf8');
    const s = new Store(path); s.load();
    expect(s.data.days).toEqual({}); // 重置为空数据
    expect(s.data.sessions).toEqual({});
    expect(s.data.config.guard.mode).toBe('warn');
    expect(readdirSync(dir).some((f) => f.startsWith('usage-stats.json.corrupt-'))).toBe(true); // 有备份
  });

  it('repairs invalid config in a valid-shape file without losing history or backing up', () => {
    const good = {
      version: STORE_VERSION,
      days: { '2026-08-17|zijian|kimi-k3': { input: 10, output: 5, cacheRead: 1, cacheWrite: 0, requests: 1 } },
      sessions: { 'session-a': initFold() },
      config: { prices: structuredClone(DEFAULT_PRICES), guard: { dailyTokens: null, dailyCost: null, mode: 'bogus' } },
    };
    writeFileSync(path, JSON.stringify(good), 'utf8');
    const s = new Store(path);
    expect(() => s.load()).not.toThrow();
    expect(s.data.days).toEqual(good.days); // 历史保留
    expect(s.data.sessions).toEqual(good.sessions); // 折叠水位保留
    expect(s.data.config.guard.mode).toBe('warn'); // config 重置为默认
    expect(s.data.config.prices).toEqual(DEFAULT_PRICES);
    expect(readdirSync(dir).some((f) => f.startsWith('usage-stats.json.corrupt-'))).toBe(false); // 不备份
    s.flush(); // 修复结果落盘
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    expect(raw.config.guard.mode).toBe('warn');
    expect(raw.days).toEqual(good.days);
  });

  it('migrates a v1 store by re-folding: clears derived days and watermarks, keeps the user config', () => {
    // v1 的 days 与 sessions 水位互相矛盾（旧版本漏记了大部分样本，水位却已推到日志末尾），
    // 不能在原数据上续跑，只能整表重折。
    const v1Config = { prices: { 'a/b': { input: 3, output: 4, cacheRead: 0, cacheWrite: 0, currency: 'CNY' } }, guard: { dailyTokens: 42, dailyCost: 7, mode: 'block' } };
    writeFileSync(path, JSON.stringify({
      version: 1,
      days: { '2026-08-17|zijian|kimi-k3': { input: 10, output: 5, cacheRead: 1, cacheWrite: 0, requests: 1 } },
      sessions: { 'session-a': { provider: 'zijian', model: 'kimi-k3', last: null, lastSeq: 99999 } },
      config: v1Config,
    }), 'utf8');
    const s = new Store(path); s.load();
    expect(s.data.version).toBe(STORE_VERSION);
    expect(s.data.days).toEqual({}); // 交给随后的 backfill 按日志重建
    expect(s.data.sessions).toEqual({}); // 水位必须一起清，否则续跑补不回漏记的部分
    expect(s.data.config).toEqual(v1Config); // 价格/守卫是用户数据，保留
    expect(readdirSync(dir).some((f) => f.startsWith('usage-stats.json.corrupt-'))).toBe(false); // 不是损坏，不备份
    s.flush();
    expect(JSON.parse(readFileSync(path, 'utf8')).version).toBe(STORE_VERSION);
    // 迁移只发生一次：重折后的数据不会被下一次 load 再清掉
    const s2 = new Store(path); s2.load();
    s2.recordDelta('session-b', delta(), initFold());
    s2.flush();
    const s3 = new Store(path); s3.load();
    expect(s3.data.days[keyOf('2026-08-17', 'zijian', 'kimi-k3')].input).toBe(10);
  });

  it('backs up and resets a store written by a newer plugin version', () => {
    writeFileSync(path, JSON.stringify({
      version: STORE_VERSION + 1,
      days: {},
      sessions: {},
      config: { prices: {}, guard: { dailyTokens: null, dailyCost: null, mode: 'warn' } },
    }), 'utf8');
    const s = new Store(path); s.load();
    expect(s.data.version).toBe(STORE_VERSION);
    expect(readdirSync(dir).some((f) => f.startsWith('usage-stats.json.corrupt-'))).toBe(true);
  });

  it('does not share nested price objects with DEFAULT_PRICES', () => {
    const before = DEFAULT_PRICES['deepseek/deepseek-chat'].input;
    const s = new Store(path); s.load();
    s.data.config.prices['deepseek/deepseek-chat'].input = 9999;
    expect(DEFAULT_PRICES['deepseek/deepseek-chat'].input).toBe(before);
  });

  it('setConfig validates and replaces', () => {
    const s = new Store(path); s.load();
    expect(() => s.setConfig({ prices: {}, guard: { dailyTokens: -1, dailyCost: null, mode: 'warn' } })).toThrow();
    expect(() => s.setConfig({ prices: {}, guard: { dailyTokens: null, dailyCost: null, mode: 'bogus' } })).toThrow();
    s.setConfig({ prices: { 'a/b': { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, currency: 'CNY' } }, guard: { dailyTokens: 1000, dailyCost: 5, mode: 'block' } });
    expect(s.data.config.guard.mode).toBe('block');
  });
});

describe('pricing', () => {
  it('costOf scales per 1M tokens and returns null without a price', () => {
    expect(costOf({ input: 1_000_000, output: 500_000, cacheRead: 0, cacheWrite: 0 }, DEFAULT_PRICES[priceKey('deepseek', 'deepseek-chat')])).toBe(2 + 4);
    expect(costOf({ input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }, undefined)).toBeNull();
  });
});
