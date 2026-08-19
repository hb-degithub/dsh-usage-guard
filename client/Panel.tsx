import { useEffect, useState } from 'react';
import { IconWarningOutline16 } from '@deepseek-ai/dsh-client-ui-primitives';
import type { Config, Summary } from './api.ts';
import { fetchConfig, fetchSummary } from './api.ts';
import { TrendChart, YearHeatmap, ModelDonut, type FmtBig } from './charts.tsx';
import { ConfigEditor } from './ConfigEditor.tsx';
import css from './Panel.module.css';

const fmtCost = (c: number | null) => c === null ? '—' : `¥${c.toFixed(2)}`;

/** 面板标题前的柱状图 glyph：currentColor，跟随主题。 */
function UsageGlyph({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style={{ flexShrink: 0 }}>
      <rect x="1.75" y="8.75" width="3.5" height="5.5" rx="0.9" fill="currentColor" />
      <rect x="6.25" y="4.75" width="3.5" height="9.5" rx="0.9" fill="currentColor" />
      <rect x="10.75" y="1.75" width="3.5" height="12.5" rx="0.9" fill="currentColor" />
    </svg>
  );
}

export function Panel({ t }: { t: (k: string) => string }) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [range, setRange] = useState<7 | 30>(30);
  const [error, setError] = useState('');

  // 中文大数格式（亿/万），英文用 M/k —— 由 t('numStyle') 决定
  const fmtBig: FmtBig = (n) => {
    if (t('numStyle') === 'cn') {
      if (n >= 1e8) return `${(n / 1e8).toFixed(1)}亿`;
      if (n >= 1e4) return `${(n / 1e4).toFixed(1)}万`;
      return n.toLocaleString();
    }
    if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
    return String(n);
  };

  useEffect(() => {
    Promise.all([fetchSummary(), fetchConfig()])
      .then(([s, c]) => { setSummary(s); setConfig(c); })
      .catch(() => setError('loadFail'));
  }, []);

  if (error !== '') return <p className={css.err}>{t('loadFail')}</p>;
  if (!summary || !config) return <p className={css.empty}>…</p>;

  const trendSeries = summary.series.slice(-range);
  const stats = [
    { label: t('tokens'), value: fmtBig(summary.totals.tokens), sub: fmtCost(summary.totals.cost), small: false },
    { label: t('sessions'), value: fmtBig(summary.totals.sessions), sub: '', small: false },
    { label: t('messages'), value: fmtBig(summary.totals.requests), sub: '', small: false },
    { label: t('activeDays'), value: String(summary.activeDays), sub: '', small: false },
    { label: t('streak'), value: String(summary.currentStreak), sub: '', small: false },
    summary.topModel !== null
      ? { label: t('topModel'), value: summary.topModel.name, sub: `${t('share')} ${(summary.topModel.share * 100).toFixed(0)}%`, small: true }
      : { label: t('topModel'), value: '—', sub: '', small: false },
  ];

  return (
    <div className={css.root}>
      <div className={css.head}>
        <UsageGlyph />
        <h2 className={css.title}>{t('nav')}</h2>
        <span className={css.grow} />
        <div className={css.pills}>
          {([7, 30] as const).map((r) => (
            <button key={r} className={range === r ? css.pillOn : css.pill} onClick={() => setRange(r)}>
              {r === 7 ? t('range7') : t('range30')}
            </button>
          ))}
        </div>
      </div>

      {summary.guard.over && (
        <div className={css.banner}>
          <span className={css.bannerIcon}><IconWarningOutline16 size={14} /></span>
          <span>{t('overLimit')}：{summary.guard.reasons.join('；')}</span>
        </div>
      )}

      {summary.totals.tokens === 0 && <p className={css.empty}>{t('empty')}</p>}

      <div className={css.stats6}>
        {stats.map((s) => (
          <div key={s.label} className={css.stat}>
            <span className={css.statLabel}>{s.label}</span>
            <span className={s.small ? css.statValueSm : css.statValue} title={s.value}>{s.value}</span>
            <span className={css.statSub}>{s.sub}</span>
          </div>
        ))}
      </div>

      <section className={css.card}>
        <h3 className={css.secTitle}>{t('heatmap')}</h3>
        <YearHeatmap series={summary.series} fmt={fmtBig} t={t} />
      </section>

      <section className={css.card}>
        <h3 className={css.secTitle}>{t('trend')}</h3>
        <TrendChart series={trendSeries} models={summary.byModel} fmt={fmtBig} t={t} />
      </section>

      <section className={css.card}>
        <h3 className={css.secTitle}>{t('modelUsage')}</h3>
        <ModelDonut models={summary.byModel} total={summary.totals.tokens} fmt={fmtBig} />
      </section>

      <section className={css.card}>
        <ConfigEditor config={config} t={t} onSaved={(c) => {
          setConfig(c);
          fetchSummary().then(setSummary).catch(() => {}); // 价格变更后立即刷新费用
        }} />
      </section>
    </div>
  );
}
