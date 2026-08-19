import { useEffect, useState } from 'react';
import type { Config, Summary } from './api.ts';
import { fetchCalendar, fetchConfig, fetchSummary } from './api.ts';
import { BarChart, CalendarHeat } from './charts.tsx';
import { ConfigEditor } from './ConfigEditor.tsx';

const fmtTokens = (n: number) => n.toLocaleString();
const fmtCost = (c: number | null) => c === null ? '—' : `¥${c.toFixed(2)}`;

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

  if (error !== '') return <p>{t('loadFail')}</p>;
  if (!summary || !config) return <p>…</p>;

  const card = { padding: 12, borderRadius: 8, background: 'var(--dsw-alias-bg-l2, #f5f5f5)', minWidth: 120 } as const;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, fontSize: 13 }}>
      {summary.guard.over && (
        <div style={{ padding: 10, borderRadius: 8, background: 'var(--dsw-alias-warning-bg, #fff4e0)', color: 'var(--dsw-alias-warning, #a05a00)' }}>
          ⚠ {t('overLimit')}：{summary.guard.reasons.join('；')}
        </div>
      )}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div style={card}><div>{t('today')}</div><strong>{fmtTokens(summary.today.tokens)}</strong><div>{fmtCost(summary.today.cost)}</div></div>
        <div style={card}><div>{t('month')}</div><strong>{fmtTokens(summary.series.reduce((a, d) => a + d.tokens, 0))}</strong></div>
        <div style={card}><div>{t('total')}</div><strong>{fmtTokens(summary.totals.tokens)}</strong><div>{fmtCost(summary.totals.cost)}</div></div>
        <div style={card}><div>{t('requests')}</div><strong>{fmtTokens(summary.totals.requests)}</strong></div>
      </div>
      {summary.totals.tokens === 0 && <p style={{ opacity: 0.7 }}>{t('empty')}</p>}
      <section><h4>{t('month')}</h4><BarChart series={summary.series} /></section>
      <section><h4>{t('calendar')}</h4><CalendarHeat month={month} days={calendar} onMonth={setMonth} /></section>
      <section>
        <h4>{t('byModel')}</h4>
        <table style={{ borderCollapse: 'collapse', fontSize: 12 }}>
          <thead><tr><th style={{ textAlign: 'left' }}>{t('providerModel')}</th><th>{t('tokens')}</th><th>{t('requests')}</th><th>{t('cost')}</th></tr></thead>
          <tbody>
            {summary.byModel.map((m) => (
              <tr key={`${m.provider}/${m.model}`}>
                <td style={{ paddingRight: 12 }}>{m.provider}/{m.model}</td>
                <td style={{ textAlign: 'right', paddingRight: 12 }}>{fmtTokens(m.tokens)}</td>
                <td style={{ textAlign: 'right', paddingRight: 12 }}>{m.requests}</td>
                <td style={{ textAlign: 'right' }}>{m.cost === null ? `— (${t('unknownPrice')})` : fmtCost(m.cost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <ConfigEditor config={config} t={t} onSaved={(c) => {
        setConfig(c);
        fetchSummary().then(setSummary).catch(() => {}); // 价格变更后立即刷新费用
        fetchCalendar(month).then((r) => setCalendar(r.days)).catch(() => {});
      }} />
    </div>
  );
}
