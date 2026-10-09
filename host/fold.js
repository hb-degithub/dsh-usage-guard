/**
 * 用量折叠纯函数：把会话事件流折叠成 (日期, 提供商, 模型) 维度的用量增量。
 *
 * 替换语义与 @deepseek-ai/dsh-token-meter 的 tokenUsage 投影（0.2.0：stateVersion 2）一致：
 * - 采样载体：`assistant/message` 的 `data.usage`；`assistant/message` / `assistant/attempt`
 *   的 `data.stream` 里最后一条 usage chunk；旧格式（v3 及更早）的 `assistant/chunk` 事件
 *   —— 最后这条是**有意的兼容超集**：0.2.0 的宿主只认 message/attempt，但更早的日志里
 *   「崩在某步中途、只有 chunk 采样没有 message 结算」的用量也要算进来。
 * - 同 (turn,step) 的后发样本替换先前样本（只记差值），不同 (turn,step) 全额累加。
 * - `llm/retry-started` 关闭同 (turn,step) 的替换槽：重试也是真实发出的请求，
 *   其用量要与上一次尝试累加而不是互相替换。
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

/**
 * 一次助手结算的流里最后一条 usage chunk（与 @deepseek-ai/dsh-llm 的
 * lastAssistantStreamChunk(stream, 'usage') 同一判定：倒序取第一条
 * `{ type:'chunk', chunk:{ type:'usage' } }`，usage 挂在 chunk 上）。
 */
export function lastStreamUsage(stream) {
  if (!Array.isArray(stream)) return undefined;
  for (let i = stream.length - 1; i >= 0; i -= 1) {
    const record = stream[i];
    if (record?.type === 'chunk' && record.chunk?.type === 'usage') return record.chunk.usage;
  }
  return undefined;
}

/** 提取事件携带的 (turn, step, usage)，非用量事件返回 undefined。 */
const usageOfEvent = (event) => {
  const data = event.data;
  if (event.type === 'assistant/chunk' && data?.chunk?.type === 'usage') {
    return { turn: data.turn, step: data.step, usage: data.chunk.usage };
  }
  if (event.type === 'assistant/message' && data?.usage !== undefined) {
    return { turn: data.turn, step: data.step, usage: data.usage };
  }
  if (event.type === 'assistant/message' || event.type === 'assistant/attempt') {
    const usage = lastStreamUsage(data?.stream);
    if (usage !== undefined) return { turn: data.turn, step: data.step, usage };
  }
  return undefined;
};

/**
 * 折叠一个事件。返回 { state, delta }；delta 为 null 表示无用量变化。
 * seq <= state.lastSeq 的事件是重放：用量与替换槽都不再变更，request/header 仍更新归属
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
  if (event.type === 'llm/retry-started') {
    if (event.seq <= state.lastSeq) return { state, delta: null };
    const sameStep = state.last !== null && state.last.turn === event.data?.turn && state.last.step === event.data?.step;
    if (!sameStep) return { state, delta: null };
    // 关闭替换槽并推进水位：重试后同 (turn,step) 的下一次采样按新请求全额累加
    return { state: { ...state, last: null, lastSeq: event.seq }, delta: null };
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
