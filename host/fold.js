/**
 * 用量折叠纯函数：把会话事件流折叠成 (日期, 提供商, 模型) 维度的用量增量。
 * 替换语义与 @deepseek-ai/dsh-token-meter 的 tokenUsage 投影一致：
 * 同 (turn,step) 的后发样本替换先前样本，不同 (turn,step) 累加。
 */

export const zeroBuckets = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, requests: 0 });

/** 本地时区 YYYY-MM-DD。 */
export function dayOf(timeMs) {
  const d = new Date(timeMs);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export const keyOf = (day, provider, model) => `${day}|${provider}|${model}`;

export function initFold() {
  return { provider: 'unknown', model: 'unknown', last: null, lastSeq: -1 };
}

const bucketsFromUsage = (usage) => ({
  input: usage.inputTokens ?? 0,
  output: usage.outputTokens ?? 0,
  cacheRead: usage.cacheReadTokens ?? 0,
  cacheWrite: usage.cacheWriteTokens ?? 0,
});

/** 提取事件携带的 (turn, step, usage)，非用量事件返回 undefined。 */
const usageOfEvent = (event) => {
  if (event.type === 'assistant/chunk' && event.data?.chunk?.type === 'usage') {
    return { turn: event.data.turn, step: event.data.step, usage: event.data.chunk.usage };
  }
  if (event.type === 'assistant/message' && event.data?.usage !== undefined) {
    return { turn: event.data.turn, step: event.data.step, usage: event.data.usage };
  }
  return undefined;
};

/**
 * 折叠一个事件。返回 { state, delta }；delta 为 null 表示无用量变化。
 * seq <= state.lastSeq 的事件是重放：usage 不再记账，request/header 仍更新归属
 * （回填从持久化水位恢复时，水位之后的替换结算需要水位之前的归属信息）。
 */
export function applyEvent(state, event) {
  if (event.type === 'request/header') {
    const config = event.data?.header?.config;
    if (!config) return { state, delta: null };
    const next = {
      ...state,
      provider: config.provider ?? state.provider,
      model: config.model ?? state.model,
    };
    if (event.seq > state.lastSeq) next.lastSeq = event.seq;
    return { state: next, delta: null };
  }
  if (event.seq <= state.lastSeq) return { state, delta: null };
  const found = usageOfEvent(event);
  if (found === undefined) return { state, delta: null };
  const buckets = bucketsFromUsage(found.usage);
  const sameStep = state.last !== null && state.last.turn === found.turn && state.last.step === found.step;
  const prev = sameStep ? state.last.buckets : null;
  const delta = {
    day: dayOf(event.time),
    provider: state.provider,
    model: state.model,
    input: buckets.input - (prev?.input ?? 0),
    output: buckets.output - (prev?.output ?? 0),
    cacheRead: buckets.cacheRead - (prev?.cacheRead ?? 0),
    cacheWrite: buckets.cacheWrite - (prev?.cacheWrite ?? 0),
    requests: sameStep ? 0 : 1,
  };
  const next = { ...state, last: { turn: found.turn, step: found.step, buckets }, lastSeq: event.seq };
  const nonzero = delta.input !== 0 || delta.output !== 0 || delta.cacheRead !== 0 || delta.cacheWrite !== 0 || delta.requests !== 0;
  return { state: next, delta: nonzero ? delta : null };
}
