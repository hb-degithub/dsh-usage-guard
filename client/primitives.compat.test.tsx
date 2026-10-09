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
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  /** 与宿主同形的 Button：variant/size 走类名，其余属性透传。 */
  Button: ({ variant = 'ghost', size = 'md', className, children, ...rest }: Record<string, unknown>) =>
    h('button', { type: 'button', className: [variant, size, className].filter(Boolean).join(' '), ...rest }, children as never),
  /** 与宿主同形的 Input：forwardRef + 属性透传。 */
  Input: ({ className, ...rest }: Record<string, unknown>) => h('input', { className, ...rest }),
}));

/**
 * 宿主**真实安装的** Button 样式表里定义了哪些类名。
 * Button 的 variant/size 就是 className 查表（`clsx(css.button, css[variant], css[size])`），
 * 所以类名是否存在就是「宿主认不认这个 variant/size」的硬证据——宿主要是删了 .outline，
 * 面板会静默渲染成一个没有描边的按钮，而不是报错。
 */
function hostButtonClasses(): Set<string> {
  const manifest = createRequire(import.meta.url).resolve('@deepseek-ai/dsh-client-ui-primitives/package.json');
  const css = readFileSync(join(dirname(manifest), 'lib', 'Button.module.css'), 'utf8');
  return new Set([...css.matchAll(/\.([a-zA-Z][\w]*)\s*[{:,]/g)].map((m) => m[1]));
}

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
  it('the installed host stylesheet still defines every Button variant/size the panel uses', () => {
    const classes = hostButtonClasses();
    expect(classes.size).toBeGreaterThan(0); // 样式表读到了（路径/打包形态没变）
    for (const name of ['ghost', 'outline', 'primary', 'toolbar', 'md', 'sm']) {
      expect(classes.has(name), `host Button.module.css no longer defines .${name}`).toBe(true);
    }
  });

  it('renders the panel shell, guard overlay and config editor without crashing', () => {
    const html = renderToStaticMarkup(h('div', null, h(Panel, { t }), h(GuardOverlay, { t })));
    expect(html.length).toBeGreaterThan(0);
    expect(html).not.toContain('NaN');
    expect(html).not.toContain('>undefined<');
    expect(html).not.toContain('class="undefined"');
  });

  it('every variant/size the editor actually passes exists in the host stylesheet', () => {
    const html = renderToStaticMarkup(h(ConfigEditor, { config, t, onSaved: () => {} }));
    expect(html).toContain('zijian/kimi-k3');
    expect(html).toContain('<input');
    const classes = hostButtonClasses();
    const passed = [...html.matchAll(/class="([a-z]+) (md|sm)"/g)];
    expect(passed.length).toBeGreaterThan(0); // 真的渲染出了带 variant/size 的按钮
    for (const [, variant, size] of passed) {
      expect(classes.has(variant), `host stylesheet lacks .${variant}`).toBe(true);
      expect(classes.has(size), `host stylesheet lacks .${size}`).toBe(true);
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
