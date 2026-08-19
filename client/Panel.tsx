import { useEffect, useState } from 'react';
import { IconWarningOutline16 } from '@deepseek-ai/dsh-client-ui-primitives';
import type { Config, Summary } from './api.ts';
import { fetchCalendar, fetchConfig, fetchSummary } from './api.ts';
import { BarChart, CalendarHeat } from './charts.tsx';
import { ConfigEditor } from './ConfigEditor.tsx';
import css from './Panel.module.css';

const fmtTokens = (n: number) => n.toLocaleString();
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
  const [month, setMonth] = useState(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; });
  const [calendar, setCalendar] = useState<Record<string, { tokens: number; cost: number | null; requests: number }>>({});
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([fetchSummary(), fetchConfig()])
      .then(([s, c]) => { setSummary(s); setConfig(c); })
      .catch(() => setError('loadFail'));
  }, []);
  useEffect(() => {
    fetchCalendar(month).then((r) => setCalendar(r.days)).catch(() => {});
  }, [month]);

  if (error !== '') return <p className={css.err}>{t('loadFail')}</p>;
  if (!summary || !config) return <p className={css.empty}>…</p>;

  const monthTokens = summary.series.reduce((a, d) => a + d.tokens, 0);
  return (
    <div className={css.root}>
      <div className={css.head}>
        <UsageGlyph />
        <h2 className={css.title}>{t('nav')}</h2>
      </div>

      {summary.guard.over && (
        <div className={css.banner}>
          <span className={css.bannerIcon}><IconWarningOutline16 size={14} /></span>
          <span>{t('overLimit')}：{summary.guard.reasons.join('；')}</span>
        </div>
      )}

      <div className={css.stats}>
        <div className={css.stat}>
          <span className={css.statLabel}>{t('today')}</span>
          <span className={css.statValue}>{fmtTokens(summary.today.tokens)}</span>
          <span className={css.statSub}>{fmtCost(summary.today.cost)}</span>
        </div>
        <div className={css.stat}>
          <span className={css.statLabel}>{t('month')}</span>
          <span className={css.statValue}>{fmtTokens(monthTokens)}</span>
          <span className={css.statSub}>{t('tokens')}</span>
        </div>
        <div className={css.stat}>
          <span className={css.statLabel}>{t('total')}</span>
          <span className={css.statValue}>{fmtTokens(summary.totals.tokens)}</span>
          <span className={css.statSub}>{fmtCost(summary.totals.cost)}</span>
        </div>
        <div className={css.stat}>
          <span className={css.statLabel}>{t('requests')}</span>
          <span className={css.statValue}>{fmtTokens(summary.totals.requests)}</span>
          <span className={css.statSub}>{t('total')}</span>
        </div>
      </div>

      {summary.totals.tokens === 0 && <p className={css.empty}>{t('empty')}</p>}

      <section className={css.card}>
        <h3 className={css.secTitle}>{t('month')}</h3>
        <BarChart series={summary.series} t={t} />
      </section>

      <section className={css.card}>
        <h3 className={css.secTitle}>{t('calendar')}</h3>
        <CalendarHeat month={month} days={calendar} onMonth={setMonth} t={t} />
      </section>

      <section className={css.card}>
        <h3 className={css.secTitle}>{t('byModel')}</h3>
        <table className={css.tbl}>
          <thead>
            <tr>
              <th>{t('providerModel')}</th>
              <th className={css.num}>{t('tokens')}</th>
              <th className={css.num}>{t('requests')}</th>
              <th className={css.num}>{t('cost')}</th>
            </tr>
          </thead>
          <tbody>
            {summary.byModel.map((m) => (
              <tr key={`${m.provider}/${m.model}`}>
                <td>{m.provider}/{m.model}</td>
                <td className={css.num}>{fmtTokens(m.tokens)}</td>
                <td className={css.num}>{m.requests}</td>
                <td className={css.num}>
                  {m.cost === null ? <span className={css.muted} title={t('unknownPrice')}>—</span> : fmtCost(m.cost)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className={css.card}>
        <ConfigEditor config={config} t={t} onSaved={(c) => {
          setConfig(c);
          fetchSummary().then(setSummary).catch(() => {}); // 价格变更后立即刷新费用
          fetchCalendar(month).then((r) => setCalendar(r.days)).catch(() => {});
        }} />
      </section>
    </div>
  );
}
