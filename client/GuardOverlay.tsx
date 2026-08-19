import { useEffect, useState } from 'react';
import type { Summary } from './api.ts';
import { fetchSummary } from './api.ts';

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
    <div style={{
      position: 'fixed', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 9999,
      background: 'var(--dsw-alias-warning-bg, #fff4e0)', color: 'var(--dsw-alias-warning, #a05a00)',
      padding: '8px 12px', borderRadius: 8, fontSize: 12,
    }}>
      ⚠ 用量超限：{summary.guard.reasons.join('；')}
    </div>
  );
}
