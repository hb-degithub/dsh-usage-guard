import { Button, IconChevronLeftOutline14, IconChevronRightOutline14 } from '@deepseek-ai/dsh-client-ui-primitives';
import type { DayRow } from './api.ts';
import css from './Panel.module.css';

/** 近 30 天柱状图：纯 div，品牌色。 */
export function BarChart({ series, t }: { series: DayRow[]; t: (k: string) => string }) {
  const max = Math.max(1, ...series.map((d) => d.tokens));
  return (
    <div className={css.chart}>
      {series.map((d) => (
        <div key={d.day} className={css.barCol}
          title={`${d.day} · ${d.tokens.toLocaleString()} tokens · ${d.requests} ${t('requests')}`}>
          <div className={css.bar} style={{ height: `${Math.max(2, (d.tokens / max) * 100)}%` }} />
        </div>
      ))}
    </div>
  );
}

/** 月历热力图：颜色深度按 tokens，今日描边。 */
export function CalendarHeat({ month, days, onMonth, t }: {
  month: string;
  days: Record<string, { tokens: number; cost: number | null; requests: number }>;
  onMonth: (month: string) => void;
  t: (k: string) => string;
}) {
  const [y, m] = month.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const count = new Date(y, m, 0).getDate();
  const max = Math.max(1, ...Object.values(days).map((d) => d.tokens));
  const shift = (delta: number) => {
    const d = new Date(y, m - 1 + delta, 1);
    onMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };
  const now = new Date();
  const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const weekdays = t('weekdays').split(',');

  const cells = [] as React.ReactNode[];
  for (let i = 0; i < first.getDay(); i++) cells.push(<div key={`pad-${i}`} />);
  for (let day = 1; day <= count; day++) {
    const key = `${month}-${String(day).padStart(2, '0')}`;
    const cell = days[key];
    const alpha = cell ? 0.15 + 0.85 * (cell.tokens / max) : 0;
    const cls = [css.calCell];
    if (cell && alpha > 0.55) cls.push(css.calCellOn);
    if (key === todayKey) cls.push(css.calCellToday);
    cells.push(
      <div key={key} className={cls.join(' ')}
        title={cell ? `${key} · ${cell.tokens.toLocaleString()} tokens · ${cell.requests} ${t('requests')}${cell.cost !== null ? ` · ¥${cell.cost.toFixed(2)}` : ''}` : key}
        style={cell ? { background: `color-mix(in srgb, var(--dsw-alias-brand-primary, #4f6ef7) ${Math.round(alpha * 100)}%, transparent)` } : undefined}>
        {day}
      </div>,
    );
  }
  return (
    <div>
      <div className={css.calNav}>
        <Button variant="outline" size="sm" icon={<IconChevronLeftOutline14 size={14} />} onClick={() => shift(-1)} aria-label="prev month" />
        <span className={css.calMonth}>{month}</span>
        <Button variant="outline" size="sm" icon={<IconChevronRightOutline14 size={14} />} onClick={() => shift(1)} aria-label="next month" />
      </div>
      <div className={css.calGrid} style={{ marginTop: 8 }}>
        {weekdays.map((w, i) => <div key={i} className={css.calDow}>{w}</div>)}
        {cells}
      </div>
    </div>
  );
}
