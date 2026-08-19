import type { DayRow, ModelRow } from './api.ts';
import css from './Panel.module.css';

/** 模型配色板：蓝/绿/紫/红/橙/青/黄/粉，按 tokens 排名依次取色。 */
export const MODEL_COLORS = ['#4f6ef7', '#22c55e', '#a855f7', '#ef4444', '#f97316', '#06b6d4', '#eab308', '#ec4899'];
export const modelColor = (index: number) => MODEL_COLORS[index % MODEL_COLORS.length];

export type FmtBig = (n: number) => string;

/** GitHub 风格年度活跃热力图：列=周，行=周日~周六，4 档色阶。 */
export function YearHeatmap({ series, fmt, t }: { series: DayRow[]; fmt: FmtBig; t: (k: string) => string }) {
  const map = new Map(series.map((d) => [d.day, d]));
  const max = Math.max(1, ...series.map((d) => d.tokens));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  // 起点：363 天前，回对齐到周日
  const start = new Date(today.getTime() - 363 * 86400_000);
  start.setDate(start.getDate() - start.getDay());

  const weeks: React.ReactNode[] = [];
  const cursor = new Date(start);
  let w = 0;
  while (cursor <= today) {
    const cells: React.ReactNode[] = [];
    for (let dow = 0; dow < 7; dow++) {
      const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`;
      const cell = map.get(key);
      const future = cursor > today;
      let level = 0;
      if (cell && cell.tokens > 0) {
        const r = cell.tokens / max;
        level = r > 0.75 ? 4 : r > 0.5 ? 3 : r > 0.25 ? 2 : 1;
      }
      cells.push(
        <div key={key} className={css.heatCell}
          title={cell ? `${cursor.getMonth() + 1}${t('monthUnit')}${cursor.getDate()}${t('dayUnit')}：${fmt(cell.tokens)} Tokens · ${cell.requests} ${t('turns')}` : undefined}
          style={future ? { visibility: 'hidden' } : level > 0 ? { background: `color-mix(in srgb, var(--dsw-alias-brand-primary, #4f6ef7) ${level * 25}%, var(--dsw-alias-bg-layer-2, #f3f4f6))` } : undefined} />,
      );
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(<div key={w++} className={css.heatCol}>{cells}</div>);
  }
  return (
    <div>
      <div className={css.heat}>{weeks}</div>
      <div className={css.heatLegend}>
        <span>{t('less')}</span>
        {[0, 1, 2, 3, 4].map((l) => (
          <div key={l} className={css.heatCell} style={l > 0 ? { background: `color-mix(in srgb, var(--dsw-alias-brand-primary, #4f6ef7) ${l * 25}%, var(--dsw-alias-bg-layer-2, #f3f4f6))` } : undefined} />
        ))}
        <span>{t('more')}</span>
      </div>
    </div>
  );
}

/** 按天 Token 趋势：堆叠柱状图，按模型分段，X 轴每 ~7 个标签。 */
export function TrendChart({ series, models, fmt, t }: { series: DayRow[]; models: ModelRow[]; fmt: FmtBig; t: (k: string) => string }) {
  const max = Math.max(1, ...series.map((d) => d.tokens));
  const present = models.filter((m) => series.some((d) => (d.byModel[`${m.provider}/${m.model}`] ?? 0) > 0));
  const colorOf = new Map(present.map((m, i) => [`${m.provider}/${m.model}`, modelColor(i)]));
  const labelEvery = Math.max(1, Math.ceil(series.length / 7));
  return (
    <div>
      <div className={css.legend}>
        {present.map((m) => {
          const key = `${m.provider}/${m.model}`;
          return (
            <span key={key} className={css.legendItem}>
              <i className={css.legendDot} style={{ background: colorOf.get(key) }} />{key}
            </span>
          );
        })}
      </div>
      <div className={css.trend}>
        {series.map((d) => (
          <div key={d.day} className={css.trendCol}
            title={`${d.day} · ${fmt(d.tokens)} Tokens · ${d.requests} ${t('turns')}`}>
            {present.map((m) => {
              const key = `${m.provider}/${m.model}`;
              const v = d.byModel[key] ?? 0;
              if (v === 0) return null;
              return <div key={key} className={css.seg} style={{ height: `${(v / max) * 100}%`, background: colorOf.get(key) }} />;
            })}
          </div>
        ))}
      </div>
      <div className={css.xlabels}>
        {series.map((d, i) => (
          <span key={d.day} className={css.xlabel}>
            {(i % labelEvery === 0 || i === series.length - 1) ? `${Number(d.day.slice(5, 7))}/${Number(d.day.slice(8, 10))}` : ''}
          </span>
        ))}
      </div>
    </div>
  );
}

/** 模型用量：环形图（中心总数） + 明细列表（色点/名称/tokens/占比）。 */
export function ModelDonut({ models, total, fmt }: { models: ModelRow[]; total: number; fmt: FmtBig }) {
  const R = 48;
  const C = 2 * Math.PI * R;
  let offset = 0;
  const top = models.filter((m) => m.tokens > 0).slice(0, 8);
  return (
    <div className={css.donutWrap}>
      <svg width="132" height="132" viewBox="0 0 132 132" style={{ flexShrink: 0 }}>
        <circle cx="66" cy="66" r={R} fill="none" stroke="var(--dsw-alias-bg-layer-2, #f3f4f6)" strokeWidth="15" />
        {total > 0 && top.map((m, i) => {
          const frac = m.tokens / total;
          const dash = `${frac * C} ${C}`;
          const off = -offset * C;
          offset += frac;
          return <circle key={`${m.provider}/${m.model}`} cx="66" cy="66" r={R} fill="none" stroke={modelColor(i)} strokeWidth="15"
            strokeDasharray={dash} strokeDashoffset={off} transform="rotate(-90 66 66)" />;
        })}
        <text x="66" y="63" textAnchor="middle" fontSize="17" fontWeight="600" fill="var(--dsw-alias-label-primary, #1f2328)">{fmt(total)}</text>
        <text x="66" y="80" textAnchor="middle" fontSize="10" fill="var(--dsw-alias-label-tertiary, #8b93a1)">tokens</text>
      </svg>
      <div className={css.donutList}>
        {top.map((m, i) => {
          const share = total > 0 ? m.tokens / total : 0;
          return (
            <div key={`${m.provider}/${m.model}`} className={css.donutRow}>
              <i className={css.legendDot} style={{ background: modelColor(i) }} />
              <span className={css.donutName}>{m.provider}/{m.model}</span>
              <span className={css.grow} />
              <span className={css.muted}>{fmt(m.tokens)}</span>
              <span className={css.donutShare}>{(share * 100).toFixed(share < 0.1 && share > 0 ? 1 : 0)}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
