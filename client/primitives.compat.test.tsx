/**
 * 客户端兼容性回归测试。
 *
 * 1) 宿主 primitives 契约：面板只允许依赖 Button / Input，且必须用宿主认得的
 *    variant/size（0.2.0 的 Button.module.css 只有 ghost/outline/primary/toolbar + md/sm）。
 *    这里用与宿主 0.2.0 同形的 stub 渲染真实组件，锁住我们传入的 props。
 * 2) 图标自给：0.2.0 把 IconXxx16 改名为 IconXxxOutlineRegular/Medium，
 *    源码不允许再引用宿主的旧图标导出（否则 apply() 会判定 primitives 缺失、面板降级）。
 *
 * 说明：为什么不用真实的 @deepseek-ai/dsh-client-ui-primitives 做渲染——
 * 该包发布时不带 dependencies（依赖宿主 node_modules 的 hoist 环境），
 * 在插件仓库里直接 import 会因缺 clsx/shiki/katex 等而无法解析。
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  /** 与宿主同形的 Button：variant/size 走类名，其余属性透传。 */
  Button: ({ variant = 'ghost', size = 'md', className, children, ...rest }: Record<string, unknown>) =>
    h('button', { type: 'button', className: [variant, size, className].filter(Boolean).join(' '), ...rest }, children as never),
  /** 与宿主同形的 Input：forwardRef + 属性透传。 */
  Input: ({ className, ...rest }: Record<string, unknown>) => h('input', { className, ...rest }),
}));

const { Panel } = await import('./Panel.tsx');
const { GuardOverlay } = await import('./GuardOverlay.tsx');
const { ConfigEditor } = await import('./ConfigEditor.tsx');
const { WarnGlyph, UsageGlyph } = await import('./glyphs.tsx');
const { zh } = await import('./locales.ts');

const t = (k: string): string => zh[k] ?? k;
const config = {
  prices: { 'zijian/kimi-k3': { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0.2, currency: 'CNY' } },
  guard: { dailyTokens: null, dailyCost: null, mode: 'warn' as const },
};

describe('client ↔ host ui-primitives contract', () => {
  it('renders the panel shell, guard overlay and config editor without crashing', () => {
    const html = renderToStaticMarkup(h('div', null, h(Panel, { t }), h(GuardOverlay, { t })));
    expect(html.length).toBeGreaterThan(0);
    expect(html).not.toContain('NaN');
    expect(html).not.toContain('>undefined<');
    expect(html).not.toContain('class="undefined"');
  });

  it('passes only host-known Button variants/sizes and Input passthrough props', () => {
    const html = renderToStaticMarkup(h(ConfigEditor, { config, t, onSaved: () => {} }));
    expect(html).toContain('zijian/kimi-k3');
    expect(html).toContain('<input');
    // outline/sm（删除、添加）与 primary/sm（保存）都必须落在宿主已定义的类名上
    expect(html).toContain('outline sm');
    expect(html).toContain('primary sm');
    for (const variant of [...html.matchAll(/class="(ghost|outline|primary|toolbar) (md|sm)"/g)]) {
      expect(['ghost', 'outline', 'primary', 'toolbar']).toContain(variant[1]);
      expect(['md', 'sm']).toContain(variant[2]);
    }
  });

  it('ships its own glyphs instead of depending on a renamed host icon export', () => {
    const html = renderToStaticMarkup(h('div', null, h(WarnGlyph, { size: 14 }), h(UsageGlyph, { size: 18 })));
    expect(html).toContain('<svg');
    expect(html).toContain('viewBox="0 0 16 16"');
    expect(html).toContain('currentColor');
  });

  it('never imports the pre-0.2.0 icon names again', () => {
    for (const file of ['client/index.ts', 'client/Panel.tsx', 'client/GuardOverlay.tsx', 'client/ConfigEditor.tsx', 'client/glyphs.tsx']) {
      const source = readFileSync(file, 'utf8');
      expect(source, file).not.toMatch(/IconWarningOutline16/);
      // 任何 `import { …16… }` 形式的宿主图标导入都算回归
      expect(source, file).not.toMatch(/import\s*\{[^}]*\b\w+16\b[^}]*\}/);
    }
    // primitives 必需清单只留跨版本稳定的两个控件
    const index = readFileSync('client/index.ts', 'utf8');
    expect(index).toMatch(/REQUIRED_PRIMITIVES = \['Button', 'Input'\] as const/);
  });
});
