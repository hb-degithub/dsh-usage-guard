import { describe, it, expect } from 'vitest';
import { zeroBuckets, dayOf, keyOf, initFold, applyEvent } from './fold.js';

const T = 1786953434034; // 真实采样时间戳

const headerEvent = (seq, provider = 'zijian', model = 'kimi-k3') => ({
  type: 'request/header', seq, time: T,
  data: { header: { config: { provider, model } } },
});
const usageChunk = (seq, turn, step, usage) => ({
  type: 'assistant/chunk', seq, time: T,
  data: { turn, step, chunk: { type: 'usage', usage } },
});
const usageMessage = (seq, turn, step, usage) => ({
  type: 'assistant/message', seq, time: T,
  data: { turn, step, usage },
});

describe('dayOf/keyOf/zeroBuckets', () => {
  it('formats local YYYY-MM-DD', () => {
    expect(dayOf(T)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it('joins key parts', () => {
    expect(keyOf('2026-08-17', 'zijian', 'kimi-k3')).toBe('2026-08-17|zijian|kimi-k3');
  });
  it('zero buckets', () => {
    expect(zeroBuckets()).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, requests: 0 });
  });
});

describe('applyEvent', () => {
  it('tracks provider/model from request/header without delta', () => {
    const r = applyEvent(initFold(), headerEvent(12));
    expect(r.delta).toBeNull();
    expect(r.state.provider).toBe('zijian');
    expect(r.state.model).toBe('kimi-k3');
  });

  it('counts a new (turn,step) sample in full with requests=1', () => {
    let s = initFold();
    s = applyEvent(s, headerEvent(12)).state;
    const r = applyEvent(s, usageChunk(15, 1, 1, { inputTokens: 100, outputTokens: 20, cacheReadTokens: 5 }));
    expect(r.delta).toEqual({
      day: dayOf(T), provider: 'zijian', model: 'kimi-k3',
      input: 100, output: 20, cacheRead: 5, cacheWrite: 0, requests: 1,
    });
  });

  it('replaces the same (turn,step) sample instead of double counting', () => {
    let s = initFold();
    s = applyEvent(s, headerEvent(12)).state;
    s = applyEvent(s, usageChunk(15, 1, 1, { inputTokens: 100, outputTokens: 20 })).state;
    const r = applyEvent(s, usageMessage(16, 1, 1, { inputTokens: 100, outputTokens: 35 }));
    expect(r.delta).toMatchObject({ input: 0, output: 15, requests: 0 });
  });

  it('ignores unrelated events', () => {
    const r = applyEvent(initFold(), { type: 'text-chunks', seq: 5, time: T, data: {} });
    expect(r.delta).toBeNull();
  });

  it('replays (seq <= lastSeq) never emit usage deltas but still adopt headers', () => {
    let s = initFold();
    s = applyEvent(s, headerEvent(12)).state;
    s = applyEvent(s, usageChunk(15, 1, 1, { inputTokens: 100, outputTokens: 20 })).state;
    // 重放 seq=15：不出 delta
    expect(applyEvent(s, usageChunk(15, 1, 1, { inputTokens: 100, outputTokens: 20 })).delta).toBeNull();
    // 重放 header（换个模型名验证仍会更新）：不出 delta，provider/model 更新
    const r = applyEvent(s, headerEvent(13, 'deepseek', 'deepseek-chat'));
    expect(r.delta).toBeNull();
    expect(r.state.provider).toBe('deepseek');
    // 重放边界之后，同 (turn,step) 替换仍基于持久化的 last 结算
    const r2 = applyEvent(s, usageMessage(16, 1, 1, { inputTokens: 100, outputTokens: 50 }));
    expect(r2.delta).toMatchObject({ input: 0, output: 30, requests: 0 });
  });
});
