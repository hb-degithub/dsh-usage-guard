import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from './store.js';
import { mountUsageRoutes } from './routes.js';
import { initFold, keyOf, dayOf } from './fold.js';

let dir, store, handler;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'routes-'));
  store = new Store(join(dir, 's.json')); store.load();
  const webServer = { register: (route) => { handler = route.handler; return () => {}; } };
  mountUsageRoutes(webServer, store);
});
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

function seed() {
  const today = dayOf(Date.now());
  store.recordDelta('s1', { day: today, provider: 'zijian', model: 'kimi-k3', input: 1000, output: 200, cacheRead: 0, cacheWrite: 0, requests: 3 }, initFold());
  store.recordDelta('s2', { day: today, provider: 'deepseek', model: 'deepseek-chat', input: 1_000_000, output: 500_000, cacheRead: 0, cacheWrite: 0, requests: 1 }, initFold());
  // 历史日须落在与今天不同的月份（日历测试断言它不出现在本月）：用固定的远古日期避免随当前日期失效
  store.recordDelta('s3', { day: '2020-01-15', provider: 'zijian', model: 'kimi-k3', input: 5, output: 5, cacheRead: 0, cacheWrite: 0, requests: 1 }, initFold());
  store.flush();
  return today;
}

function fakeReqRes(method, url, body, headers = {}) {
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))];
  const req = { method, url, headers: { host: '127.0.0.1:3080', ...headers }, async *[Symbol.asyncIterator]() { yield* chunks; } };
  const res = { statusCode: 200, headers: {}, body: '', setHeader(k, v) { this.headers[k] = v; }, end(s) { this.body = s ?? ''; } };
  return { req, res };
}

describe('routes', () => {
  it('GET summary aggregates tokens, computes cost only for priced models', async () => {
    const today = seed();
    const { req, res } = fakeReqRes('GET', '/usage-stats/summary?days=30');
    await handler(req, res);
    const out = JSON.parse(res.body);
    expect(res.statusCode).toBe(200);
    expect(out.totals.tokens).toBe(1000 + 200 + 1_000_000 + 500_000 + 10);
    // deepseek-chat 有价：1M*2 + 0.5M*8 = 6 元；kimi-k3 无价 → cost null 部分出现在 unknownPriceModels
    expect(out.unknownPriceModels).toEqual(['zijian/kimi-k3']);
    expect(out.byModel.find((m) => m.model === 'deepseek-chat').cost).toBe(6);
    expect(out.byModel.find((m) => m.model === 'kimi-k3').cost).toBeNull();
    expect(out.today.day).toBe(today);
    expect(out.guard.over).toBe(false);
  });

  it('GET calendar returns per-day map for the month', async () => {
    const today = seed();
    const month = today.slice(0, 7);
    const { req, res } = fakeReqRes('GET', `/usage-stats/calendar?month=${month}`);
    await handler(req, res);
    const out = JSON.parse(res.body);
    expect(out.days[today].tokens).toBe(1000 + 200 + 1_000_000 + 500_000);
    expect(out.days['2020-01-15']).toBeUndefined(); // 非本月不出现
  });

  it('PUT config rejects cross-origin and invalid bodies, accepts same-origin', async () => {
    const bad = fakeReqRes('PUT', '/usage-stats/config', { prices: {}, guard: { dailyTokens: null, dailyCost: null, mode: 'warn' } }, { origin: 'http://evil.example' });
    await handler(bad.req, bad.res);
    expect(bad.res.statusCode).toBe(403);

    const invalid = fakeReqRes('PUT', '/usage-stats/config', { prices: {}, guard: { dailyTokens: -1, dailyCost: null, mode: 'warn' } }, { origin: 'http://127.0.0.1:3080' });
    await handler(invalid.req, invalid.res);
    expect(invalid.res.statusCode).toBe(422);

    const good = fakeReqRes('PUT', '/usage-stats/config', { prices: { 'zijian/kimi-k3': { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, currency: 'CNY' } }, guard: { dailyTokens: 100, dailyCost: null, mode: 'block' } }, { origin: 'http://127.0.0.1:3080' });
    await handler(good.req, good.res);
    expect(good.res.statusCode).toBe(200);
    expect(store.data.config.guard.mode).toBe('block');
  });

  it('guard status flips over when today exceeds the token limit', async () => {
    seed();
    store.setConfig({ prices: store.data.config.prices, guard: { dailyTokens: 100, dailyCost: null, mode: 'warn' } });
    const { req, res } = fakeReqRes('GET', '/usage-stats/summary');
    await handler(req, res);
    const out = JSON.parse(res.body);
    expect(out.guard.over).toBe(true);
    expect(out.guard.reasons.length).toBeGreaterThan(0);
  });

  it('unknown sub-path returns 404', async () => {
    const { req, res } = fakeReqRes('GET', '/usage-stats/nope');
    await handler(req, res);
    expect(res.statusCode).toBe(404);
  });
});
