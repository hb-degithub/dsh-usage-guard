/**
 * SSR 冒烟测试：用本机真实用量数据（~/.dsh/usage-stats.json）走 host buildSummary，
 * 再服务端渲染全部图表组件。验证：不崩溃、无 NaN/undefined、引用的 CSS 类全部有定义。
 * CSS 模块经 vitest alias 换成「键名即类名」代理，因此 class 名可直接比对。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildSummary } from '../host/routes.js';
import { HeatmapCard, TrendCard, ModelDonut } from './charts.tsx';
import { zh } from './locales.ts';

const t = (k: string): string => zh[k] ?? k;
const fmt = (n: number): string => n.toLocaleString();

const raw = JSON.parse(readFileSync(`${process.env.USERPROFILE}/.dsh/usage-stats.json`, 'utf8'));
const summary = buildSummary({ data: raw }, 366);

const markup = renderToStaticMarkup(
  h('div', null,
    h(HeatmapCard, { series: summary.series, fmt, t }),
    h(TrendCard, { series: summary.series, fmt, t }),
    h(ModelDonut, { models: summary.byModel, total: summary.totals.tokens, fmt }),
  ),
);

describe('client SSR smoke (real production data)', () => {
  it('summary from real data has expected shape', () => {
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
  it('heatmap tooltips cover empty days too (reference behavior)', () => {
    // 连续年度视图：每格（含无数据日）都应有 title 提示，今天带高亮描边类
    const tips = [...markup.matchAll(/title="(\d+)月(\d+)日：/g)];
    expect(tips.length).toBeGreaterThan(300);
    expect(markup).toContain('heatCellToday');
  });
});
