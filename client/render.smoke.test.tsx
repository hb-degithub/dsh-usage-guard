/**
 * SSR 冒烟测试：取用量数据走 host buildSummary，再服务端渲染全部图表组件。
 * 验证：不崩溃、无 NaN/undefined、引用的 CSS 类全部有定义。
 * CSS 模块经 vitest alias 换成「键名即类名」代理，因此 class 名可直接比对。
 *
 * 数据来源：本机 `$DSH_HOME/usage-stats.json`（开发机上是真实生产数据）；
 * 该文件不存在时（CI、干净机器、Linux 上 USERPROFILE 未定义）退回同一形状的合成数据集，
 * 断言集合不变——否则这个测试会把发布流水线拖垮，而不是保护它。
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildSummary } from '../host/routes.js';
import { HeatmapCard, TrendCard, ModelDonut } from './charts.tsx';
import { zh } from './locales.ts';

const t = (k: string): string => zh[k] ?? k;
const fmt = (n: number): string => n.toLocaleString();

const dshHome = process.env.DSH_HOME !== undefined && process.env.DSH_HOME !== '' ? process.env.DSH_HOME : join(homedir(), '.dsh');
const storePath = join(dshHome, 'usage-stats.json');
const usesRealData = existsSync(storePath);
console.log(`[render.smoke] data source: ${usesRealData ? storePath : 'synthetic fixture'}`);

/** 与 store 同形状的合成数据：跨 400 天、含价格配置与守卫默认值。 */
function syntheticStore() {
  const pad = (n: number) => String(n).padStart(2, '0');
  const days: Record<string, unknown> = {};
  for (let i = 0; i < 400; i += 3) {
    const d = new Date(Date.now() - i * 86400_000);
    days[`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}|zijian|kimi-k3`] = {
      input: 1000 + (i % 7) * 137,
      output: 200 + (i % 5) * 31,
      cacheRead: 5000 + i * 11,
      cacheWrite: 0,
      requests: 3 + (i % 4),
    };
  }
  return {
    version: 1,
    days,
    sessions: { 'synthetic-1': { provider: 'zijian', model: 'kimi-k3', last: null, lastSeq: 0 } },
    config: {
      prices: { 'zijian/kimi-k3': { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0, currency: 'CNY' } },
      guard: { dailyTokens: null, dailyCost: null, mode: 'warn' },
    },
  };
}

const raw = usesRealData ? JSON.parse(readFileSync(storePath, 'utf8')) : syntheticStore();
const summary = buildSummary({ data: raw }, 366);

const markup = renderToStaticMarkup(
  h('div', null,
    h(HeatmapCard, { series: summary.series, models: summary.byModel, fmt, t }),
    h(TrendCard, { series: summary.series, fmt, t }),
    h(ModelDonut, { models: summary.byModel, total: summary.totals.tokens, fmt }),
  ),
);

describe(`client SSR smoke (${usesRealData ? 'local production data' : 'synthetic fixture'})`, () => {
  it('summary has the expected shape', () => {
    expect(summary.series.length).toBeGreaterThan(0);
    expect(summary.totals.tokens).toBeGreaterThan(0);
    expect(summary.totals.sessions).toBeGreaterThan(0);
    expect(summary.byModel.length).toBeGreaterThan(0);
    expect(summary.topModel).not.toBeNull();
  });
  it('renders heatmap/trend/donut without crash, NaN or undefined', () => {
    expect(markup.length).toBeGreaterThan(500);
    expect(markup).not.toContain('NaN');
    expect(markup).not.toContain('>undefined<');
    expect(markup).not.toContain('class="undefined"');
  });
  it('every CSS class referenced by components is defined in Panel.module.css', () => {
    const cssText = readFileSync('client/Panel.module.css', 'utf8');
    const defined = new Set([...cssText.matchAll(/\.([a-zA-Z][\w]*)\s*[{:,]/g)].map((m) => m[1]));
    const used = new Set([...markup.matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1].split(' ').filter(Boolean)));
    const missing = [...used].filter((c) => !defined.has(c));
    expect(missing).toEqual([]);
  });
  it('heatmap cells expose per-day aria labels and today highlight', () => {
    // 连续年度视图：每格（含无数据日）都有 aria-label 摘要（悬浮详情卡为交互层，SSR 不触发）
    const tips = [...markup.matchAll(/aria-label="(\d+)月(\d+)日：/g)];
    expect(tips.length).toBeGreaterThan(300);
    expect(markup).toContain('heatCellToday');
  });
});
