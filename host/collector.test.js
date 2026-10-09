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
const attemptStream = (seq, turn, step, u) => ({
  type: 'assistant/attempt', seq, time: T,
  data: { turn, step, stream: [{ type: 'chunk', time: T, chunk: { type: 'usage', usage: u } }] },
});
const retryStarted = (seq, turn, step) => ({ type: 'llm/retry-started', seq, time: T, data: { retryId: 'r-1', turn, step, retry: 1 } });

function writeLog(sessionId, events) {
  const d = join(sessionsDir, '--ws--', sessionId);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'session.jsonl.zstd'), frame(events));
}

/** 0.2.0 的落盘形态：会话目录里的 session.v4.jsonl.zstd，首行是带 id 的会话头。 */
function writeV4Log(dirName, headerId, events) {
  const d = join(sessionsDir, '--ws--', dirName);
  mkdirSync(d, { recursive: true });
  const log = join(d, 'session.v4.jsonl.zstd');
  writeFileSync(log, frame([{ type: 'session', version: 4, id: headerId, createdAt: T, cwd: 'H:\\ws' }, ...events]));
  return log;
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

  it('backfills 0.2.0 logs (session.v4.jsonl.zstd) and keys the watermark by the log header id', async () => {
    writeV4Log('session-dir-name', 'session-header-id', [
      header(1),
      usage(2, 1, 1, { inputTokens: 100, outputTokens: 10 }),
    ]);
    const store = new Store(storePath); store.load();
    const c = new Collector(store, sessionsDir);
    await c.backfill();
    expect(store.data.days[onlyKey(store)]).toMatchObject({ input: 100, output: 10, requests: 1 });
    // 折叠水位认日志头的 id（与实时事件的 session.id 同一取值），而不是目录名
    expect(Object.keys(store.data.sessions)).toEqual(['session-header-id']);
  });

  it('counts a retried attempt in a v4 log (attempt stream usage + llm/retry-started)', async () => {
    writeV4Log('session-retry', 'session-retry', [
      header(1),
      attemptStream(2, 1, 1, { inputTokens: 100, outputTokens: 10 }),
      retryStarted(3, 1, 1),
      usage(4, 1, 1, { inputTokens: 120, outputTokens: 30 }),
    ]);
    const store = new Store(storePath); store.load();
    const c = new Collector(store, sessionsDir);
    await c.backfill();
    // 重试前的 100/10 被保留，重试后的 120/30 累加（不是替换）
    expect(store.data.days[onlyKey(store)]).toMatchObject({ input: 220, output: 40, requests: 2 });
    // 幂等：再回填一次不变
    await c.backfill();
    expect(store.data.days[onlyKey(store)]).toMatchObject({ input: 220, output: 40, requests: 2 });
  });
});
