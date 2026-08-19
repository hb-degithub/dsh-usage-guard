/**
 * dsh-usage-guard host 入口：装配采集器、HTTP 路由与守卫。
 * 纯 JS ESM、零运行时依赖；任何内部失败只记日志，绝不拖垮宿主。
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Store } from './store.js';
import { Collector } from './collector.js';
import { mountUsageRoutes } from './routes.js';
import { installGuard } from './guard.js';

export const name = 'dsh-usage-guard';
export const inject = ['webServer'];

export function apply(ctx) {
  const dshHome = process.env.DSH_HOME && process.env.DSH_HOME !== ''
    ? process.env.DSH_HOME
    : join(homedir(), '.dsh');
  const store = new Store(join(dshHome, 'usage-stats.json'));
  store.load();
  const collector = new Collector(store, join(dshHome, 'sessions'));

  const offSession = ctx.on('session/event', (session, event) => {
    try {
      collector.handleEvent(String(session.id), event);
    } catch (error) {
      ctx.logger?.warn?.(`[dsh-usage-guard] event fold failed: ${error?.message ?? error}`);
    }
  });
  const disposeRoutes = mountUsageRoutes(ctx.webServer, store);
  const offGuard = installGuard(ctx, store);
  const timer = setInterval(() => {
    try {
      collector.flush();
    } catch (error) {
      ctx.logger?.warn?.(`[dsh-usage-guard] flush failed: ${error?.message ?? error}`);
    }
  }, 2000);

  ctx.effect(() => () => {
    offSession();
    disposeRoutes();
    offGuard();
    clearInterval(timer);
    collector.flush();
  }, 'dsh-usage-guard: teardown');

  // 历史回填在后台进行；期间到达的实时事件由 collector 缓冲。
  collector.backfill().then(
    () => ctx.logger?.info?.('[dsh-usage-guard] 历史回填完成'),
    (error) => ctx.logger?.warn?.(`[dsh-usage-guard] 历史回填失败：${error?.message ?? error}`),
  );
}
