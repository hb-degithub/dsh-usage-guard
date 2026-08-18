/**
 * dsh-usage-stats client：在设置页注册「用量统计」section。
 * 只用宿主注入的 react；UI 为原生 HTML + dsh CSS 变量，不依赖 ui-primitives。
 */
import { createElement as h } from 'react';
import { zh, en } from './locales.ts';
import { Panel } from './Panel.tsx';

const NS = 'dsh-usage-stats';

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
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'usage-stats',
    order: 45,
    label: () => t('nav'),
    locale: NS,
    inject: () => ({ t }),
  }, () => h(Panel, { t })));
}
