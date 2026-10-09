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
// dsh 0.2.0：助手结算的用量可以只出现在 data.stream 内嵌的 usage chunk 上（chunk 挂在 record.chunk）
const attemptWithStreamUsage = (seq, turn, step, usage) => ({
  type: 'assistant/attempt', seq, time: T,
  data: {
    turn, step,
    stream: [
      { type: 'chunk', time: T, chunk: { type: 'text-delta', text: 'hi' } },
      { type: 'chunk', time: T, chunk: { type: 'usage', usage } },
    ],
  },
});
const retryStarted = (seq, turn, step) => ({
  type: 'llm/retry-started', seq, time: T,
  data: { retryId: 'r-1', turn, step, retry: 1 },
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

  it('reads usage embedded in an assistant/attempt stream (0.2.0 carrier)', () => {
    let s = initFold();
    s = applyEvent(s, headerEvent(12)).state;
    const r = applyEvent(s, attemptWithStreamUsage(15, 1, 1, { inputTokens: 300, outputTokens: 40, cacheWriteTokens: 7 }));
    expect(r.delta).toEqual({
      day: dayOf(T), provider: 'zijian', model: 'kimi-k3',
      input: 300, output: 40, cacheRead: 0, cacheWrite: 7, requests: 1,
    });
    // 同一步随后结算的 assistant/message 仍是替换语义（该步的累计值，只补差值）
    const r2 = applyEvent(r.state, usageMessage(16, 1, 1, { inputTokens: 320, outputTokens: 55 }));
    expect(r2.delta).toMatchObject({ input: 20, output: 15, requests: 0 });
  });

  it('accumulates a retried attempt instead of replacing it (llm/retry-started closes the slot)', () => {
    let s = initFold();
    s = applyEvent(s, headerEvent(12)).state;
    s = applyEvent(s, attemptWithStreamUsage(15, 1, 1, { inputTokens: 100, outputTokens: 10 })).state;
    const retry = applyEvent(s, retryStarted(16, 1, 1));
    expect(retry.delta).toBeNull();
    expect(retry.state.last).toBeNull(); // 替换槽已关闭
    const r = applyEvent(retry.state, usageMessage(17, 1, 1, { inputTokens: 120, outputTokens: 30 }));
    // 重试是真实发生的第二次请求：全额累加，而不是把 100/10 换成 120/30
    expect(r.delta).toEqual({
      day: dayOf(T), provider: 'zijian', model: 'kimi-k3',
      input: 120, output: 30, cacheRead: 0, cacheWrite: 0, requests: 1,
    });
  });

  it('ignores a retry marker for another step and a replayed one', () => {
    let s = initFold();
    s = applyEvent(s, headerEvent(12)).state;
    s = applyEvent(s, usageChunk(15, 1, 1, { inputTokens: 100, outputTokens: 20 })).state;
    expect(applyEvent(s, retryStarted(16, 2, 1)).state).toBe(s); // 别的 (turn,step)：无变化
    // 重放（seq <= lastSeq）不得清空替换槽
    const replayed = { ...retryStarted(14, 1, 1), seq: 14 };
    expect(applyEvent(s, replayed).state.last).not.toBeNull();
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
