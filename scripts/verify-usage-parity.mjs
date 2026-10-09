/**
 * 口径对拍：把插件的折叠规则与宿主 @deepseek-ai/dsh-token-meter 的 tokenUsage 投影
 * （0.2.0，stateVersion 2）在**真实会话日志**上逐一比较，并顺带给出「适配前旧规则」的同场数据。
 *
 * 参照实现是**逐行转写**，不是 import 包本体：dsh-token-meter 是一个 cordis 插件，
 * 只存在于宿主自己的 app.asar 依赖树里（node_modules 里没有它，投影定义也不是公开导出），
 * 所以这里把它的纯投影逻辑抄了一份。转写对象与核对方式：
 *   <安装目录>/resources/app.asar → dsh/node_modules/@deepseek-ai/dsh-token-meter/lib/index.js
 *   （tokenUsageProjectionDefinition，stateVersion 2；usageOf / bucketsFrom / addReplacing）
 * 抄件与宿主存在共同误读的风险无法靠这个脚本自身排除——它排除的是「我们的折叠与这份语义不一致」。
 * 规则小结：
 * - 采样：assistant/message 的 data.usage，否则取该事件（或 assistant/attempt）
 *   data.stream 里最后一条 usage chunk；
 * - 同 (turn,step) 的后发样本替换先前样本，不同 (turn,step) 累加；
 * - llm/retry-started 关闭同 (turn,step) 的替换槽（重试的用量要累加）。
 *
 * 用法：node scripts/verify-usage-parity.mjs [sessionsRoot] [limit] [generation]
 * 默认 sessionsRoot = %DSH_HOME%/sessions（或 ~/.dsh/sessions），按文件大小取样。
 */
import { readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { applyEvent, initFold } from '../host/fold.js';
import { readSessionLog } from '../host/logscan.js';

const dshHome = process.env.DSH_HOME !== undefined && process.env.DSH_HOME !== '' ? process.env.DSH_HOME : join(homedir(), '.dsh');
const sessionsRoot = process.argv[2] ?? join(dshHome, 'sessions');
const limit = Number(process.argv[3] ?? 12);
const generationFilter = process.argv[4] === undefined ? undefined : Number(process.argv[4]);

/* ---------- 参考实现：dsh-token-meter 0.2.0 tokenUsage 投影 ---------- */
const zero = () => ({ uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });
const bucketsFrom = (usage) => ({
  uncachedInputTokens: usage.inputTokens,
  outputTokens: usage.outputTokens,
  cacheReadTokens: usage.cacheReadTokens ?? 0,
  cacheWriteTokens: usage.cacheWriteTokens ?? 0,
});
const bucketsEqual = (a, b) => a.uncachedInputTokens === b.uncachedInputTokens && a.outputTokens === b.outputTokens
  && a.cacheReadTokens === b.cacheReadTokens && a.cacheWriteTokens === b.cacheWriteTokens;
const addReplacing = (totals, previous, next) => ({
  uncachedInputTokens: totals.uncachedInputTokens - (previous?.uncachedInputTokens ?? 0) + next.uncachedInputTokens,
  outputTokens: totals.outputTokens - (previous?.outputTokens ?? 0) + next.outputTokens,
  cacheReadTokens: totals.cacheReadTokens - (previous?.cacheReadTokens ?? 0) + next.cacheReadTokens,
  cacheWriteTokens: totals.cacheWriteTokens - (previous?.cacheWriteTokens ?? 0) + next.cacheWriteTokens,
});
function lastAssistantStreamChunk(stream, type) {
  if (!Array.isArray(stream)) return undefined;
  for (let i = stream.length - 1; i >= 0; i -= 1) {
    const record = stream[i];
    if (record.type === 'chunk' && record.chunk.type === type) return record.chunk;
  }
  return undefined;
}
function usageOf(event) {
  if (event.type === 'assistant/message' && event.data.usage !== undefined) return event.data.usage;
  if (event.type !== 'assistant/message' && event.type !== 'assistant/attempt') return undefined;
  return lastAssistantStreamChunk(event.data.stream, 'usage')?.usage;
}
function referenceTotals(events) {
  let state = { totals: zero(), last: null };
  for (const event of events) {
    if (event.type === 'llm/retry-started') {
      if (state.last?.turn === event.data.turn && state.last.step === event.data.step) state = { ...state, last: null };
      continue;
    }
    if (event.type !== 'assistant/message' && event.type !== 'assistant/attempt') continue;
    const sample = usageOf(event);
    if (sample === undefined) continue;
    const { turn, step } = event.data;
    const buckets = bucketsFrom(sample);
    const previous = state.last !== null && state.last.turn === turn && state.last.step === step ? state.last.buckets : undefined;
    if (previous !== undefined && bucketsEqual(previous, buckets)) continue;
    state = { totals: addReplacing(state.totals, previous, buckets), last: { turn, step, buckets } };
  }
  return state.totals;
}

/* ---------- 适配前的旧规则（仅 assistant/chunk + assistant/message.usage，无重试语义） ---------- */
function legacyTotals(events) {
  let state = initFold();
  const totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, requests: 0 };
  for (const event of events) {
    if (event.type === 'request/header') {
      const config = event.data?.header?.config;
      if (config) state = { ...state, provider: config.provider ?? state.provider, model: config.model ?? state.model, lastSeq: event.seq > state.lastSeq ? event.seq : state.lastSeq };
      continue;
    }
    if (event.seq <= state.lastSeq) continue;
    let found;
    if (event.type === 'assistant/chunk' && event.data?.chunk?.type === 'usage') found = { turn: event.data.turn, step: event.data.step, usage: event.data.chunk.usage };
    else if (event.type === 'assistant/message' && event.data?.usage !== undefined) found = { turn: event.data.turn, step: event.data.step, usage: event.data.usage };
    if (found === undefined) continue;
    const buckets = bucketsFrom(found.usage);
    const same = state.last !== null && state.last.turn === found.turn && state.last.step === found.step;
    const prev = same ? state.last.buckets : undefined;
    totals.input += buckets.uncachedInputTokens - (prev?.uncachedInputTokens ?? 0);
    totals.output += buckets.outputTokens - (prev?.outputTokens ?? 0);
    totals.cacheRead += buckets.cacheReadTokens - (prev?.cacheReadTokens ?? 0);
    totals.cacheWrite += buckets.cacheWriteTokens - (prev?.cacheWriteTokens ?? 0);
    totals.requests += same ? 0 : 1;
    state = { ...state, last: { turn: found.turn, step: found.step, buckets }, lastSeq: event.seq };
  }
  return totals;
}

/* ---------- 插件当前规则 ---------- */
function pluginTotals(events) {
  let state = initFold();
  const totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, requests: 0 };
  for (const event of events) {
    const result = applyEvent(state, event);
    state = result.state;
    if (result.delta === null) continue;
    totals.input += result.delta.input;
    totals.output += result.delta.output;
    totals.cacheRead += result.delta.cacheRead;
    totals.cacheWrite += result.delta.cacheWrite;
    totals.requests += result.delta.requests;
  }
  return totals;
}

/* ---------- 取样真实日志 ---------- */
const logs = [];
const walk = (dir) => {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(path);
      continue;
    }
    const parsed = /^session(?:\.v(\d+))?\.jsonl(?:\.zstd)?$/.exec(entry.name);
    if (parsed === null) continue;
    logs.push({ path, generation: parsed[1] === undefined ? 0 : Number(parsed[1]), size: statSync(path).size });
  }
};
walk(sessionsRoot);
if (logs.length === 0) {
  console.error(`no session logs under ${sessionsRoot}`);
  process.exit(2);
}
logs.sort((a, b) => b.size - a.size);
const selected = generationFilter === undefined ? logs : logs.filter((log) => log.generation === generationFilter);
console.log(`sessions root: ${sessionsRoot}`);
console.log(`generations present: ${[...new Set(logs.map((l) => l.generation))].sort().join(', ')}`);
console.log(`comparing ${Math.min(limit, selected.length)} of ${selected.length} selected logs\n`);

let compared = 0;
let mismatched = 0;
for (const log of selected.slice(0, limit)) {
  let read;
  try {
    read = readSessionLog(log.path);
  } catch (error) {
    console.log(`SKIP  v${log.generation} ${log.path}\n      unreadable: ${error.message}`);
    continue;
  }
  const reference = referenceTotals(read.events);
  const plugin = pluginTotals(read.events);
  const legacy = legacyTotals(read.events);
  const same = reference.uncachedInputTokens === plugin.input && reference.outputTokens === plugin.output
    && reference.cacheReadTokens === plugin.cacheRead && reference.cacheWriteTokens === plugin.cacheWrite;
  compared += 1;
  if (!same) mismatched += 1;
  console.log([
    `${same ? 'OK  ' : 'DIFF'} v${log.generation} ${read.sessionId}`,
    `      token-meter in=${reference.uncachedInputTokens} out=${reference.outputTokens} cr=${reference.cacheReadTokens} cw=${reference.cacheWriteTokens}`,
    `      plugin      in=${plugin.input} out=${plugin.output} cr=${plugin.cacheRead} cw=${plugin.cacheWrite} requests=${plugin.requests}`,
    `      pre-adapt   in=${legacy.input} out=${legacy.output} cr=${legacy.cacheRead} cw=${legacy.cacheWrite} requests=${legacy.requests}`,
  ].join('\n'));
}
console.log(`\ncompared ${compared}, mismatched ${mismatched}`);
process.exit(mismatched === 0 ? 0 : 1);
