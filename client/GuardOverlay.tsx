import { useEffect, useState } from 'react';
import { IconWarningOutline16 } from '@deepseek-ai/dsh-client-ui-primitives';
import type { Summary } from './api.ts';
import { fetchSummary } from './api.ts';
import css from './Panel.module.css';

/** warn 模式全局提醒：轮询 summary，超限时在页面顶部显示横幅。 */
export function GuardOverlay() {
  const [summary, setSummary] = useState<Summary | null>(null);
  useEffect(() => {
    let alive = true;
    const poll = () => fetchSummary().then((s) => { if (alive) setSummary(s); }).catch(() => {});
    poll();
    const timer = setInterval(poll, 30_000);
    return () => { alive = false; clearInterval(timer); };
  }, []);
  if (!summary?.guard.over) return null;
  return (
    <div className={css.overlay}>
      <IconWarningOutline16 size={14} />
      <span>用量超限：{summary.guard.reasons.join('；')}</span>
    </div>
  );
}
