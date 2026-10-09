/**
 * 宿主入口装配测试：用假 cordis ctx 跑 apply()，验证
 * - 服务依赖面（inject: webServer）；
 * - 路由挂载在 /usage-stats 前缀上；
 * - 会话事件 → 折叠 → /usage-stats/summary 读到真实增量；
 * - llm/stream 守卫在超限时抛错、在 warn 模式放行；
 * - 首启回填会读取 0.2.0 的 session.v4.jsonl.zstd。
 * 这样即使不重启桌面端也能验证宿主半边对当前 dsh API 的适配。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { zstdCompressSync, constants } from 'node:zlib';
import * as plugin from './index.js';

let dir, storePath, previousHome;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'usage-guard-'));
  storePath = join(dir, 'usage-stats.json');
  previousHome = process.env.DSH_HOME;
  process.env.DSH_HOME = dir;
});
afterEach(() => {
  if (previousHome === undefined) delete process.env.DSH_HOME;
  else process.env.DSH_HOME = previousHome;
  rmSync(dir, { recursive: true, force: true });
});

const T = 1786953434034;
const frame = (lines) => zstdCompressSync(Buffer.from(lines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8'), { params: { [constants.ZSTD_c_checksumFlag]: 1 } });
const usageMessage = (seq, turn, step, usage) => ({ type: 'assistant/message', seq, time: T, data: { turn, step, usage } });
/** 守卫按「今天」统计，实时事件必须用当前时间才会落进今天的桶。 */
const liveUsage = (seq, turn, step, usage) => ({ type: 'assistant/message', seq, time: Date.now(), data: { turn, step, usage } });

/** 0.2.0 的落盘形态：sessions/<工作区>/<会话目录>/session.v4.jsonl.zstd。 */
function writeV4Log(events) {
  const sessionDir = join(dir, 'sessions', '--H-ws--', 'session-host-entry');
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(join(sessionDir, 'session.v4.jsonl.zstd'), frame([
    { type: 'session', version: 4, id: 'session-host-entry', createdAt: T, cwd: 'H:\\ws' },
    { type: 'request/header', seq: 1, time: T, data: { header: { config: { provider: 'zijian', model: 'kimi-k3-256k' } } } },
    ...events,
  ]));
}

function fakeCtx() {
  const handlers = new Map();
  const effects = [];
  const routes = [];
  const logs = [];
  return {
    handlers,
    effects,
    routes,
    logs,
    ctx: {
      on: (name, handler) => { handlers.set(name, handler); return () => handlers.delete(name); },
      effect: (callback, label) => { effects.push({ callback, label }); return () => {}; },
      logger: { info: (m) => logs.push(m), warn: (m) => logs.push(m) },
      webServer: { register: (route) => { routes.push(route); return () => {}; } },
    },
  };
}

function fakeReqRes(method, url, body, headers = {}) {
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))];
  const req = { method, url, headers: { host: '127.0.0.1:3080', ...headers }, async *[Symbol.asyncIterator]() { yield* chunks; } };
  const res = { statusCode: 200, headers: {}, body: '', setHeader(k, v) { this.headers[k] = v; }, end(s) { this.body = s ?? ''; } };
  return { req, res };
}

async function waitFor(predicate, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, 20));
  }
  return false;
}

/** 异步谓词版（用于轮询路由读到的汇总）。 */
async function waitUntil(predicate, timeoutMs = 5000) {
  const start = Date.now();
  for (;;) {
    if (await predicate()) return true;
    if (Date.now() - start > timeoutMs) return false;
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** 让 fire-and-forget 的回填跑完（空 sessions 目录只需要几个 tick）。 */
const settle = () => new Promise((r) => setTimeout(r, 50));

describe('host entry (apply)', () => {
  it('declares the webServer dependency and mounts the /usage-stats prefix route', async () => {
    expect(plugin.name).toBe('dsh-usage-guard');
    expect(plugin.inject).toEqual(['webServer']);
    const { ctx, routes, effects } = fakeCtx();
    plugin.apply(ctx);
    expect(routes).toHaveLength(1);
    expect(routes[0].kind).toBe('prefix');
    expect(routes[0].path).toBe('/usage-stats');
    expect(effects.map((e) => e.label)).toContain('dsh-usage-guard: teardown');
    // apply() 里的 backfill 是 fire-and-forget：先让它跑完再拆，否则 afterEach 删掉目录后
    // 它结束时的 flush 又会 mkdir 出来，%TEMP% 里攒一堆残留目录。
    await settle();
    effects.forEach((e) => e.callback()());
  });

  it('backfills a 0.2.0 v4 log on first run and serves it through the route', async () => {
    writeV4Log([usageMessage(2, 1, 1, { inputTokens: 1200, outputTokens: 340, cacheReadTokens: 5600, cacheWriteTokens: 0 })]);
    const { ctx, routes, effects, handlers } = fakeCtx();
    plugin.apply(ctx);
    expect(await waitFor(() => existsSync(storePath))).toBe(true); // backfill() 结束时会 flush

    const { req, res } = fakeReqRes('GET', '/usage-stats/summary?days=30');
    await routes[0].handler(req, res);
    const summary = JSON.parse(res.body);
    expect(res.statusCode).toBe(200);
    expect(summary.totals.tokens).toBe(1200 + 340 + 5600);
    expect(summary.totals.sessions).toBe(1);
    expect(summary.totals.requests).toBe(1);
    expect(summary.byModel[0]).toMatchObject({ provider: 'zijian', model: 'kimi-k3-256k' });

    // 实时事件：session/event 折叠进同一天的桶
    expect(handlers.has('session/event')).toBe(true);
    handlers.get('session/event')({ id: 'session-host-entry' }, usageMessage(3, 1, 2, { inputTokens: 100, outputTokens: 10 }));
    const live = fakeReqRes('GET', '/usage-stats/summary?days=30');
    await routes[0].handler(live.req, live.res);
    expect(JSON.parse(live.res.body).totals.tokens).toBe(1200 + 340 + 5600 + 110);
    effects.forEach((e) => e.callback()());
  });

  it('guard: passes through in warn mode and blocks in block mode', async () => {
    const { ctx, routes, handlers, effects } = fakeCtx();
    plugin.apply(ctx);
    const guard = handlers.get('llm/stream');
    expect(guard).toBeTypeOf('function');
    // warn（默认）：放行，next 的返回值原样透传
    const streamed = { ok: true };
    expect(guard({}, () => streamed)).toBe(streamed);

    const readSummary = async () => {
      const r = fakeReqRes('GET', '/usage-stats/summary?days=30');
      await routes[0].handler(r.req, r.res);
      return JSON.parse(r.res.body);
    };

    // 实时事件先进入缓冲，等 apply() 内部的回填跑完才会被排空
    handlers.get('session/event')({ id: 's' }, liveUsage(2, 1, 1, { inputTokens: 5, outputTokens: 5 }));
    expect(await waitUntil(async () => (await readSummary()).totals.tokens === 10)).toBe(true);

    // 切到 block + 极小上限：今日已用 10 个 token 即视为超限
    const put = fakeReqRes('PUT', '/usage-stats/config', {
      prices: { 'zijian/kimi-k3-256k': { input: 1, output: 1, cacheRead: 1, cacheWrite: 1, currency: 'CNY' } },
      guard: { dailyTokens: 1, dailyCost: null, mode: 'block' },
    });
    await routes[0].handler(put.req, put.res);
    expect(put.res.statusCode).toBe(200);
    expect(put.res.body).toContain('"mode":"block"');
    expect(() => guard({}, () => streamed)).toThrow(/用量守卫拦截/);
    effects.forEach((e) => e.callback()());
  });
});
