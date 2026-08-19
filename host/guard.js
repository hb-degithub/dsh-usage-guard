/**
 * 超限守卫：block 模式下经 llm/stream 瀑布拒绝请求；warn 模式一律放行
 * （提醒由客户端面板/横幅负责，host 不注入会话消息——spec §5 语义调整）。
 *
 * llm/stream 瀑布签名（已核实）：
 * - cordis/lib/index.js:317-325 waterfall(...args)：末参为最内层 next，
 *   监听形如 (…args, next)；cordis 的 next 闭包不接受参数；
 *   不调用 next 并抛错即中断链。
 * - dsh-llm/lib/index.js:1418：ctx.waterfall(this, "llm/stream", options, inner)
 *   → 监听签名 (options, next)；next: () => AsyncIterable<StreamChunk>
 *   （dsh-llm/lib/types/index.d.ts:43）。
 * - 返回值必须同步给出 AsyncIterable（stream() 直接返回瀑布结果）；
 *   middleware 的同步抛错会原样传播（dsh-llm/lib/index.js:1409-1410），
 *   参考 dsh-llm/lib/invariant.js:63 的 (_options, next) => validateStream(next(), fail)。
 */
import { guardStatus } from './routes.js';

export function installGuard(ctx, store) {
  return ctx.on('llm/stream', (request, next) => {
    const { guard } = store.data.config;
    if (guard.mode === 'block') {
      const status = guardStatus(store);
      if (status.over) {
        throw new Error(`dsh-usage-guard: 已超用量上限（${status.reasons.join('；')}），请求已被用量守卫拦截（可在设置 → 用量统计 中调整阈值或切回提醒模式）`);
      }
    }
    // 与 cordis 一致按 (request) 调用 next：生产中实参被忽略（原 args 经闭包转发），
    // 同时兼容把 next 当作 inner 回调直接模拟的调用方。
    return next(request);
  });
}
