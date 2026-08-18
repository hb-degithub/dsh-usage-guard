import type { DayRow } from './api.ts';

const fmt = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);

/** 近 30 天柱状图：纯 div。 */
export function BarChart({ series }: { series: DayRow[] }) {
  const max = Math.max(1, ...series.map((d) => d.tokens));
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 96, padding: '8px 0' }}>
      {series.map((d) => (
        <div key={d.day} title={`${d.day}\n${d.tokens.toLocaleString()} tokens · ${d.requests} 次`}
          style={{ flex: 1, height: `${Math.max(2, (d.tokens / max) * 88)}px`, background: 'var(--dsw-alias-accent, #4c8dff)', borderRadius: 2, minWidth: 3 }} />
      ))}
    </div>
  );
}

/** 月历热力图：CSS grid，颜色深度按 tokens。 */
export function CalendarHeat({ month, days, onMonth }: {
  month: string;
  days: Record<string, { tokens: number; cost: number | null; requests: number }>;
  onMonth: (month: string) => void;
}) {
  const [y, m] = month.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const count = new Date(y, m, 0).getDate();
  const max = Math.max(1, ...Object.values(days).map((d) => d.tokens));
  const shift = (delta: number) => {
    const d = new Date(y, m - 1 + delta, 1);
    onMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };
  const cells = [] as React.ReactNode[];
  for (let i = 0; i < first.getDay(); i++) cells.push(<div key={`pad-${i}`} />);
  for (let day = 1; day <= count; day++) {
    const key = `${month}-${String(day).padStart(2, '0')}`;
    const cell = days[key];
    const alpha = cell ? 0.15 + 0.85 * (cell.tokens / max) : 0;
    cells.push(
      <div key={key} title={cell ? `${key}\n${cell.tokens.toLocaleString()} tokens · ${cell.requests} 次${cell.cost !== null ? ` · ¥${cell.cost.toFixed(2)}` : ''}` : key}
        style={{
          aspectRatio: '1', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 11, background: cell ? `rgba(76,141,255,${alpha.toFixed(2)})` : 'var(--dsw-alias-bg-l2, #f0f0f0)',
          color: alpha > 0.55 ? '#fff' : 'var(--dsw-alias-label-secondary, #666)',
        }}>
        {day}
      </div>,
    );
  }
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <button onClick={() => shift(-1)}>←</button>
        <strong>{month}</strong>
        <button onClick={() => shift(1)}>→</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 3 }}>{cells}</div>
    </div>
  );
}
