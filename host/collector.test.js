import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { zstdCompressSync, constants } from 'node:zlib';
import { Store } from './store.js';
import { Collector } from './collector.js';

let dir, storePath, sessionsDir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'collector-'));
  storePath = join(dir, 'usage-stats.json');
  sessionsDir = join(dir, 'sessions');
  mkdirSync(sessionsDir, { recursive: true });
});
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const frame = (events) => zstdCompressSync(Buffer.from(events.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8'), { params: { [constants.ZSTD_c_checksumFlag]: 1 } });
const T = 1786953434034;
const header = (seq, provider = 'zijian', model = 'kimi-k3') => ({ type: 'request/header', seq, time: T, data: { header: { config: { provider, model } } } });
const usage = (seq, turn, step, u) => ({ type: 'assistant/message', seq, time: T, data: { turn, step, usage: u } });

function writeLog(sessionId, events) {
  const d = join(sessionsDir, '--ws--', sessionId);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'session.jsonl.zstd'), frame(events));
}

// dayOf(T) 由本地时区决定，测试从 store 里读实际 key 而不是硬编码：
const onlyKey = (store) => Object.keys(store.data.days)[0];

describe('Collector', () => {
  it('backfills historical logs once (idempotent)', async () => {
    writeLog('session-a', [header(1), usage(2, 1, 1, { inputTokens: 100, outputTokens: 10 }), usage(3, 1, 2, { inputTokens: 50, outputTokens: 5 })]);
    const store = new Store(storePath); store.load();
    const c = new Collector(store, sessionsDir);
    await c.backfill();
    const buckets = store.data.days[onlyKey(store)];
    expect(buckets).toMatchObject({ input: 150, output: 15, requests: 2 });
    // 再来一次：不变
    await c.backfill();
    expect(store.data.days[onlyKey(store)]).toMatchObject({ input: 150, output: 15, requests: 2 });
  });

  it('continues a backfilled session from live events without double counting', async () => {
    writeLog('session-a', [header(1), usage(2, 1, 1, { inputTokens: 100, outputTokens: 10 })]);
    const store = new Store(storePath); store.load();
    const c = new Collector(store, sessionsDir);
    await c.backfill();
    // 实时：同 (turn,step) 替换 + 新步
    c.handleEvent('session-a', usage(3, 1, 1, { inputTokens: 100, outputTokens: 30 }));
    c.handleEvent('session-a', usage(4, 1, 2, { inputTokens: 20, outputTokens: 2 }));
    expect(store.data.days[onlyKey(store)]).toMatchObject({ input: 120, output: 32, requests: 2 });
  });

  it('buffers live events until their session is backfilled, then replays in seq order', async () => {
    writeLog('session-a', [header(1), usage(2, 1, 1, { inputTokens: 100, outputTokens: 10 })]);
    const store = new Store(storePath); store.load();
    const c = new Collector(store, sessionsDir);
    // 回填前先到的实时事件（seq 3 在日志里还没有）
    c.handleEvent('session-a', usage(3, 1, 1, { inputTokens: 100, outputTokens: 25 }));
    await c.backfill();
    expect(store.data.days[onlyKey(store)]).toMatchObject({ input: 100, output: 25, requests: 1 });
  });

  it('handles sessions with no log (live-only)', async () => {
    const store = new Store(storePath); store.load();
    const c = new Collector(store, sessionsDir);
    await c.backfill();
    c.handleEvent('session-live', header(1));
    c.handleEvent('session-live', usage(2, 1, 1, { inputTokens: 7, outputTokens: 3 }));
    expect(store.data.days[onlyKey(store)]).toMatchObject({ input: 7, output: 3, requests: 1 });
  });

  it('survives a corrupt log file without failing the whole backfill', async () => {
    writeLog('session-a', [header(1), usage(2, 1, 1, { inputTokens: 100, outputTokens: 10 })]);
    const bad = join(sessionsDir, '--ws--', 'session-bad');
    mkdirSync(bad, { recursive: true });
    writeFileSync(join(bad, 'session.jsonl.zstd'), Buffer.from([1, 2, 3, 4]));
    const store = new Store(storePath); store.load();
    const c = new Collector(store, sessionsDir);
    await c.backfill();
    expect(store.data.days[onlyKey(store)]).toMatchObject({ input: 100, output: 10, requests: 1 });
  });
});
