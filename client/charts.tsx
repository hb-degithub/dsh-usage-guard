import { useEffect, useRef, useState } from 'react';
import type { DayRow, ModelRow } from './api.ts';
import css from './Panel.module.css';

/** 模型配色板：蓝/绿/紫/红/橙/青/黄/粉，按 tokens 排名依次取色。 */
export const MODEL_COLORS = ['#4f6ef7', '#22c55e', '#a855f7', '#ef4444', '#f97316', '#06b6d4', '#eab308', '#ec4899'];
export const modelColor = (index: number) => MODEL_COLORS[index % MODEL_COLORS.length];

export type FmtBig = (n: number) => string;

type T = (k: string) => string;

const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const levelOf = (tokens: number, max: number) => tokens <= 0 ? 0 : (tokens / max > 0.75 ? 4 : tokens / max > 0.5 ? 3 : tokens / max > 0.25 ? 2 : 1);
const levelColor = (level: number) => level > 0 ? `color-mix(in srgb, var(--dsw-alias-brand-primary, #4f6ef7) ${level * 25}%, var(--dsw-alias-bg-layer-2, #f3f4f6))` : undefined;
const tipOf = (d: Date, cell: DayRow | undefined, fmt: FmtBig, t: T) =>
  `${d.getMonth() + 1}${t('monthUnit')}${d.getDate()}${t('dayUnit')}：${fmt(cell?.tokens ?? 0)} Tokens · ${cell?.requests ?? 0} ${t('turns')}`;

/**
 * 活跃热力图（GitHub 贡献图式单一连续视图）：
 * 列=周、行=周日~周六；左侧星期标注（一/三/五）、顶部月份标注随网格一起横向滚动；
 * 默认滚动到最右（最新一天），今天高亮描边；悬浮格子显示当日详细用量卡（按模型分行）。
 */
export function HeatmapCard({ series, models, fmt, t }: { series: DayRow[]; models: ModelRow[]; fmt: FmtBig; t: T }) {
  const map = new Map(series.map((d) => [d.day, d]));
  const max = Math.max(1, ...series.map((d) => d.tokens));
  const monthNames = t('monthNames').split(',');
  const dows = t('weekdays').split(',');
  const colorOf = new Map(models.map((m, i) => [`${m.provider}/${m.model}`, modelColor(i)]));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayK = dayKey(today);
  const start = new Date(today.getTime() - 363 * 86400_000);
  start.setDate(start.getDate() - start.getDay());

  // 挂载后滚到最右（最新），避免用户手动拖
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el !== null) el.scrollLeft = el.scrollWidth;
  }, []);

  // 悬浮详情卡状态：相对卡片容器定位
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ date: Date; cell: DayRow | undefined; left: number; top: number; above: boolean } | null>(null);
  const enter = (e: React.MouseEvent<HTMLDivElement>, d: Date, cell: DayRow | undefined) => {
    const wrap = wrapRef.current?.getBoundingClientRect();
    if (wrap === undefined) return;
    const r = e.currentTarget.getBoundingClientRect();
    setHover({
      date: new Date(d),
      cell,
      left: Math.max(96, Math.min(wrap.width - 96, r.left - wrap.left + r.width / 2)),
      top: r.top - wrap.top,
      above: r.top - wrap.top > 150,
    });
  };

  const weeks: React.ReactNode[] = [];
  const labels: string[] = [];
  const cursor = new Date(start);
  let w = 0;
  let prevMonth = -1;
  while (cursor <= today) {
    labels.push(cursor.getMonth() !== prevMonth ? monthNames[cursor.getMonth()] : '');
    prevMonth = cursor.getMonth();
    const cells: React.ReactNode[] = [];
    for (let dow = 0; dow < 7; dow++) {
      const d = new Date(cursor);
      const key = dayKey(d);
      const cell = map.get(key);
      const level = levelOf(cell?.tokens ?? 0, max);
      cells.push(
        <div key={key} className={key === todayK ? `${css.heatCell} ${css.heatCellToday}` : css.heatCell}
          role="img" aria-label={tipOf(d, cell, fmt, t)}
          onMouseEnter={cursor > today ? undefined : (e) => enter(e, d, cell)}
          onMouseLeave={() => setHover(null)}
          style={cursor > today ? { visibility: 'hidden' } : level > 0 ? { background: levelColor(level) } : undefined} />,
      );
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(<div key={w++} className={css.heatCol}>{cells}</div>);
  }

  const hcell = hover?.cell;
  const modelRows = hcell ? Object.entries(hcell.byModel).sort((a, b) => b[1] - a[1]).slice(0, 4) : [];
  return (
    <>
      <div className={css.cardHeadRow}>
        <h3 className={css.secTitle}>{t('heatmap')}</h3>
        <span className={css.grow} />
        <span className={css.heatLegend} style={{ marginTop: 0 }}>
          <span>{t('less')}</span>
          {[0, 1, 2, 3, 4].map((l) => (
            <div key={l} className={css.heatCell} style={l > 0 ? { background: levelColor(l) } : undefined} />
          ))}
          <span>{t('more')}</span>
        </span>
      </div>
      <div className={css.heatWrap} ref={wrapRef}>
        <div className={css.heatScroll} ref={scrollRef}>
          <div className={css.heatInner}>
            <div className={css.heatMonths}>
              <span className={css.heatDowSpacer} />
              {labels.map((l, i) => <span key={i} className={css.heatMonth}>{l}</span>)}
            </div>
            <div className={css.heatRows}>
              <div className={css.heatDows}>
                {dows.map((d, i) => <span key={i} className={css.heatDow}>{i % 2 === 1 ? d : ''}</span>)}
              </div>
              <div className={css.heat}>{weeks}</div>
            </div>
          </div>
        </div>
        {hover !== null && (
          <div className={css.tip} style={{
            left: hover.left,
            top: hover.top,
            transform: hover.above ? 'translate(-50%, -100%) translateY(-6px)' : 'translate(-50%, 8px)',
          }}>
            <div className={css.tipTitle}>{hover.date.getMonth() + 1}{t('monthUnit')}{hover.date.getDate()}{t('dayUnit')}</div>
            <div className={css.tipRow}><span>Tokens</span><span className={css.grow} /><span className={css.tipVal}>{fmt(hcell?.tokens ?? 0)}</span></div>
            <div className={css.tipRow}><span>{t('requests')}</span><span className={css.grow} /><span className={css.tipVal}>{hcell?.requests ?? 0}</span></div>
            <div className={css.tipRow}><span>{t('serInput')} / {t('serOutput')}</span><span className={css.grow} /><span className={css.tipVal}>{(hcell?.input ?? 0).toLocaleString()} / {(hcell?.output ?? 0).toLocaleString()}</span></div>
            <div className={css.tipRow}><span>{t('serCacheHit')} / {t('serCacheCreate')}</span><span className={css.grow} /><span className={css.tipVal}>{(hcell?.cacheRead ?? 0).toLocaleString()} / {(hcell?.cacheWrite ?? 0).toLocaleString()}</span></div>
            {hcell?.cost !== null && hcell !== undefined && (
              <div className={css.tipRow}><span>{t('cost')}</span><span className={css.grow} /><span className={css.tipVal}>¥{hcell.cost.toFixed(2)}</span></div>
            )}
            {modelRows.length > 0 && <div className={css.tipDivider} />}
            {modelRows.map(([key, tokens]) => (
              <div key={key} className={css.tipRow}>
                <i className={css.legendDot} style={{ background: colorOf.get(key) ?? '#8b93a1' }} />
                <span>{key}</span>
                <span className={css.grow} />
                <span className={css.tipVal}>{fmt(tokens)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

/** 使用趋势卡片：多序列折线/面积图 + 7/30 天切换（选择器在卡片右上角，参照截图）。 */
export function TrendCard({ series, fmt, t }: { series: DayRow[]; fmt: FmtBig; t: T }) {
  const [range, setRange] = useState<7 | 30>(30);
  return (
    <>
      <div className={css.cardHeadRow}>
        <h3 className={css.secTitle}>{t('trend')}</h3>
        <span className={css.grow} />
        <div className={css.pills}>
          {([7, 30] as const).map((r) => (
            <button key={r} className={range === r ? css.pillOn : css.pill} onClick={() => setRange(r)}>
              {r === 7 ? t('range7') : t('range30')}
            </button>
          ))}
        </div>
      </div>
      <TrendChart series={series.slice(-range)} fmt={fmt} t={t} />
    </>
  );
}

interface SeriesDef {
  label: string;
  color: string;
  dashed?: boolean;
  area?: boolean;
  axis: 'token' | 'cost';
  get: (d: DayRow) => number | null;
}

/** 多序列折线/面积图：左轴 tokens（输入/输出面积填充、缓存命中/创建虚线），右轴成本（品红虚线）；悬浮十字线 + 详情框。 */
function TrendChart({ series, fmt, t }: { series: DayRow[]; fmt: FmtBig; t: T }) {
  const [hover, setHover] = useState<number | null>(null);
  if (series.length === 0) return <p className={css.empty}>…</p>;

  const defs: SeriesDef[] = [
    { label: t('serCost'), color: '#ec4899', dashed: true, axis: 'cost', get: (d) => d.cost },
    { label: t('serCacheCreate'), color: '#f97316', dashed: true, axis: 'token', get: (d) => d.cacheWrite },
    { label: t('serCacheHit'), color: '#a855f7', axis: 'token', get: (d) => d.cacheRead },
    { label: t('serInput'), color: '#4f6ef7', area: true, axis: 'token', get: (d) => d.input },
    { label: t('serOutput'), color: '#22c55e', area: true, axis: 'token', get: (d) => d.output },
  ];
  const W = 760, H = 260, PL = 48, PR = 48, PT = 12, PB = 26;
  const iw = W - PL - PR, ih = H - PT - PB;
  const n = series.length;
  const maxTok = Math.max(1, ...series.flatMap((d) => [d.input, d.output, d.cacheRead, d.cacheWrite]));
  const maxCost = Math.max(0.01, ...series.map((d) => d.cost).filter((c): c is number => c !== null));
  const x = (i: number) => PL + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
  const yT = (v: number) => PT + ih - (v / maxTok) * ih;
  const yC = (v: number) => PT + ih - (v / maxCost) * ih;
  const base = PT + ih;

  const linePath = (def: SeriesDef) => {
    let p = '';
    let pen = false;
    series.forEach((d, i) => {
      const v = def.get(d);
      if (v === null) { pen = false; return; }
      const y = def.axis === 'cost' ? yC(v) : yT(v);
      p += `${pen ? ' L' : ' M'}${x(i).toFixed(1)},${y.toFixed(1)}`;
      pen = true;
    });
    return p;
  };
  const areaPath = (def: SeriesDef) => {
    let p = ` M${x(0).toFixed(1)},${base}`;
    series.forEach((d, i) => { p += ` L${x(i).toFixed(1)},${yT(def.get(d) ?? 0).toFixed(1)}`; });
    return p + ` L${x(n - 1).toFixed(1)},${base} Z`;
  };

  const tickCount = 4;
  const tokTicks = Array.from({ length: tickCount + 1 }, (_, i) => (maxTok / tickCount) * i);
  const costTicks = Array.from({ length: tickCount + 1 }, (_, i) => (maxCost / tickCount) * i);
  const labelEvery = Math.max(1, Math.ceil(n / 8));
  const fmtCostTick = (v: number) => `¥${v >= 100 ? v.toFixed(0) : v >= 1 ? v.toFixed(1) : v.toFixed(2)}`;

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const i = n <= 1 ? 0 : Math.round(((px - PL) / iw) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  };

  const hd = hover !== null ? series[hover] : null;
  const tipLeftPct = hover !== null ? Math.max(10, Math.min(90, (x(hover) / W) * 100)) : 0;

  return (
    <div>
      <div className={css.legend}>
        {defs.map((def) => (
          <span key={def.label} className={css.legendItem}>
            <i className={css.legendLine} style={def.dashed === true
              ? { background: `repeating-linear-gradient(90deg, ${def.color} 0 3px, transparent 3px 5px)` }
              : { background: def.color }} />
            {def.label}
          </span>
        ))}
      </div>
      <div className={css.trendWrap}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" onMouseMove={onMove} onMouseLeave={() => setHover(null)} style={{ display: 'block' }}>
          <defs>
            {defs.filter((d) => d.area === true).map((d) => (
              <linearGradient key={d.color} id={`g-${d.color.slice(1)}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={d.color} stopOpacity="0.25" />
                <stop offset="100%" stopColor={d.color} stopOpacity="0.02" />
              </linearGradient>
            ))}
          </defs>
          {/* 横向网格线 + 左轴 token 刻度 + 右轴成本刻度 */}
          {tokTicks.map((v, i) => (
            <g key={i}>
              <line x1={PL} x2={W - PR} y1={yT(v)} y2={yT(v)} stroke="var(--dsw-alias-border-l2, #e5e7eb)" strokeWidth="1" strokeDasharray={i === 0 ? undefined : '3 4'} />
              <text x={PL - 6} y={yT(v) + 3} textAnchor="end" fontSize="10" fill="var(--dsw-alias-label-tertiary, #8b93a1)">{v === 0 ? '0' : fmt(v)}</text>
              <text x={W - PR + 6} y={yC(costTicks[i]) + 3} textAnchor="start" fontSize="10" fill="var(--dsw-alias-label-tertiary, #8b93a1)">{fmtCostTick(costTicks[i])}</text>
            </g>
          ))}
          {/* X 轴日期标签 */}
          {series.map((d, i) => (i % labelEvery === 0 || i === n - 1) && (
            <text key={d.day} x={x(i)} y={H - 8} textAnchor="middle" fontSize="10" fill="var(--dsw-alias-label-tertiary, #8b93a1)">
              {Number(d.day.slice(5, 7))}/{Number(d.day.slice(8, 10))}
            </text>
          ))}
          {/* 面积填充（输入/输出） */}
          {defs.filter((d) => d.area === true).map((d) => (
            <path key={`area-${d.color}`} d={areaPath(d)} fill={`url(#g-${d.color.slice(1)})`} />
          ))}
          {/* 折线 */}
          {defs.map((d) => (
            <path key={d.label} d={linePath(d)} fill="none" stroke={d.color} strokeWidth="1.8"
              strokeDasharray={d.dashed === true ? '5 4' : undefined} strokeLinejoin="round" strokeLinecap="round" />
          ))}
          {/* 悬浮十字线 + 数据点 */}
          {hover !== null && (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={PT} y2={base} stroke="var(--dsw-alias-label-tertiary, #8b93a1)" strokeWidth="1" strokeDasharray="3 3" />
              {defs.map((def) => {
                const v = def.get(series[hover]);
                if (v === null) return null;
                return <circle key={def.label} cx={x(hover)} cy={def.axis === 'cost' ? yC(v) : yT(v)} r="3" fill={def.color} stroke="var(--dsw-alias-bg-layer-1, #fff)" strokeWidth="1.5" />;
              })}
            </g>
          )}
        </svg>
        {hd !== null && (
          <div className={css.tip} style={{ left: `${tipLeftPct}%` }}>
            <div className={css.tipTitle}>{hd.day}</div>
            {defs.map((def) => {
              const v = def.get(hd);
              if (v === null) return null;
              return (
                <div key={def.label} className={css.tipRow}>
                  <i className={css.legendDot} style={{ background: def.color }} />
                  <span>{def.label}</span>
                  <span className={css.grow} />
                  <span className={css.tipVal}>{def.axis === 'cost' ? fmtCostTick(v) : v.toLocaleString()}</span>
                </div>
              );
            })}
          </div>
        )}
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
