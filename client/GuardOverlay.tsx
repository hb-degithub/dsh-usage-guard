import { useEffect, useState } from 'react';
import type { Summary } from './api.ts';
import { fetchSummary } from './api.ts';
import { WarnGlyph } from './glyphs.tsx';
import css from './Panel.module.css';

/**
 * warn 模式全局提醒：轮询 summary，超限时在页面顶部显示横幅。
 * `t` 由 client/index.ts 传入 locale 绑定的翻译函数；缺省时退回中文文案。
 */
export function GuardOverlay({ t }: { t?: (k: string) => string } = {}) {
  const [summary, setSummary] = useState<Summary | null>(null);
  useEffect(() => {
    let alive = true;
    const poll = () => fetchSummary().then((s) => { if (alive) setSummary(s); }).catch(() => {});
    poll();
    const timer = setInterval(poll, 30_000);
    return () => { alive = false; clearInterval(timer); };
  }, []);
  if (!summary?.guard.over) return null;
  const title = t === undefined ? '用量超限' : t('overLimit');
  return (
    <div className={css.overlay}>
      <WarnGlyph size={14} />
      <span>{title}：{summary.guard.reasons.join('；')}</span>
    </div>
  );
}
