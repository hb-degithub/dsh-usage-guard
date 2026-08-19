/**
 * dsh-usage-stats client：在设置页注册「用量统计」section。
 * 视觉与 dshmarket 同一套语言：CSS 变量令牌 + @deepseek-ai/dsh-client-ui-primitives。
 */
import { createElement as h } from 'react';
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives';
import { zh, en } from './locales.ts';
import { Panel } from './Panel.tsx';
import { GuardOverlay } from './GuardOverlay.tsx';
import css from './Panel.module.css';

const NS = 'dsh-usage-stats';

/** 面板用到的 primitives 导出；旧宿主缺失时降级为提示而不是白屏。 */
const REQUIRED_PRIMITIVES = ['Button', 'Input', 'IconWarningOutline16', 'IconChevronLeftOutline14', 'IconChevronRightOutline14'] as const;
const missingPrimitives = (): string[] => REQUIRED_PRIMITIVES.filter((k) => (primitives as Record<string, unknown>)[k] === undefined);

interface LocaleService {
  register(namespace: string, dicts: { zh: Record<string, string>; en: Record<string, string> }): unknown;
  bind(namespace: string): (key: string) => string;
}
interface SlotsService {
  inject(slot: string, register: () => unknown): void;
  register(meta: Record<string, unknown>, component: () => unknown): unknown;
}
interface UsageClientContext {
  effect(callback: () => unknown, label?: string): void;
  locale: LocaleService;
  slots: SlotsService;
}

export const name = 'dsh-usage-stats';
export const inject = ['slots', 'locale', 'theme'];

export function apply(ctx: UsageClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-usage-stats: dictionaries');
  const t = ctx.locale.bind(NS);
  const missing = missingPrimitives();
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'usage-stats',
    order: 45,
    label: () => t('nav'),
    locale: NS,
    inject: () => ({ t }),
  }, missing.length === 0
    ? () => h(Panel, { t })
    : () => h('p', { className: css.err }, `dsh-usage-stats: 宿主缺少 ui-primitives 导出（${missing.join(', ')}），请升级 dsh`)));
  try {
    ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'usage-stats-guard', label: () => 'dsh-usage-stats' }, GuardOverlay));
  } catch { /* 旧宿主无此槽位：仅丢失全局提醒，面板横幅仍在 */ }
}
