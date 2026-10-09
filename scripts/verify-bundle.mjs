/**
 * 产物校验：直接加载 dist/client.js（宿主真正下发的那个文件），
 * 用假的 __ModuleLoader__ / require 表把它当浏览器模块跑一遍。
 *
 * 校验点（都是历史上踩过的坑）：
 * - 形态：window.__ModuleLoader__.load({ id, factory })，id 必须是包名；
 * - 纯模块表：require() 的说明符只能是宿主 seed 的字（或插件自己的 dsh.client 声明），
 *   否则浏览器侧会 throw（module table 里没有这个字）；
 * - 样式内联：CSS 模块打成 <style data-plugin-css="dsh-usage-guard/Panel.module.css">；
 * - apply() 真的注册了 settings.section / shell.overlay，且缺 primitives 时降级为提示。
 *
 * 用法：node scripts/verify-bundle.mjs
 */
import { readFileSync } from 'node:fs';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

/** 宿主 shell 在 window.__ModuleLoader__.create() 里种子化（platform singleton）的字。 */
const SEED = new Set([
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
]);

const failures = [];
const check = (ok, message) => {
  if (!ok) failures.push(message);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${message}`);
};

const code = readFileSync('dist/client.js', 'utf8');

/* ---------- 形态 ---------- */
check(code.startsWith('window.__ModuleLoader__.load({ id: "dsh-usage-guard", factory: (require) => {'), 'bundle registers window.__ModuleLoader__.load with the package id');
const requires = [...new Set([...code.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]))];
check(requires.length > 0, `the bundle actually calls require() (found ${requires.length} specifier(s))`);
console.log(`     require() specifiers: ${requires.join(', ')}`);
for (const specifier of requires) {
  check(SEED.has(specifier) || specifier.startsWith('dsh-usage-guard'), `require("${specifier}") resolves from the host module table`);
}
check(!/IconWarningOutline16/.test(code), 'bundle no longer references the pre-0.2.0 icon export');
check(code.includes('data-plugin-css'), 'CSS module styles are inlined into the bundle');

/* ---------- 假 document：验证样式注入 ---------- */
const styleTags = [];
const documentStub = {
  querySelector: () => null,
  createElement: () => ({ dataset: {}, textContent: '' }),
  head: { appendChild: (tag) => styleTags.push(tag) },
};

/* ---------- 材质化工厂 ---------- */
let registration;
const windowStub = { __ModuleLoader__: { load: (r) => { registration = r; } } };
// 材质化工厂（样式注入与 CSS 模块包装都在 factory 内部，只有材质化时才执行）
new Function('window', 'document', code)(windowStub, documentStub);
check(registration?.id === 'dsh-usage-guard', 'factory registers under id "dsh-usage-guard"');
check(styleTags.length === 0, 'script execution itself injects no styles (lazy factory)');

/** 与宿主同形的最小 primitives stub（只保留面板真正用到的两个导出）。 */
const primitivesStub = {
  Button: ({ variant = 'ghost', size = 'md', className, children, ...rest }) =>
    h('button', { type: 'button', className: [variant, size, className].filter(Boolean).join(' '), ...rest }, children),
  Input: ({ className, ...rest }) => h('input', { className, ...rest }),
};

const moduleTable = {
  react: await import('react'),
  'react/jsx-runtime': await import('react/jsx-runtime'),
  'react-dom': await import('react-dom'),
  'react-dom/client': await import('react-dom/client'),
  '@deepseek-ai/dsh-client-ui-primitives': primitivesStub,
};

const exports = registration.factory((specifier) => {
  if (Object.hasOwn(moduleTable, specifier)) return moduleTable[specifier];
  throw new Error(`module table miss: ${specifier}`);
});
check(styleTags.length === 1 && styleTags[0].dataset.pluginCss === 'dsh-usage-guard/Panel.module.css', 'materialization injects exactly one owned <style data-plugin-css> tag');

/* ---------- apply() 注册行为 ---------- */
const registrations = [];
let dicts;
const ctx = {
  effect: () => {},
  locale: {
    register: (_ns, value) => { dicts = value; return value; },
    bind: () => (key) => dicts.zh[key] ?? key,
  },
  slots: {
    inject: (_slot, register) => register(),
    register: (meta, component) => { registrations.push({ meta, component }); return () => {}; },
  },
};
exports.apply(ctx);

const section = registrations.find((r) => r.meta.name === 'settings.section');
const overlay = registrations.find((r) => r.meta.name === 'shell.overlay');
check(section?.meta.id === 'usage-stats', 'registers the settings.section entry id "usage-stats"');
check(section?.meta.locale === 'dsh-usage-guard' && typeof section?.meta.label === 'function', 'section carries its locale namespace and a label thunk');
check(overlay !== undefined, 'registers the shell.overlay entry');
check(overlay?.meta.locale === 'dsh-usage-guard', 'overlay carries the locale namespace so the banner follows language changes');
check(Array.isArray(exports.inject) && exports.inject.join() === 'slots,locale', `client inject face is ${JSON.stringify(exports.inject)}`);

const markup = renderToStaticMarkup(h(section.component));
check(markup.length > 0 && !markup.includes('undefined'), 'section component renders with the host-shaped primitives');

/* ---------- 缺 primitives 时降级 ---------- */
const registrations2 = [];
const missingTable = { ...moduleTable, '@deepseek-ai/dsh-client-ui-primitives': {} };
const exportsMissing = registration.factory((specifier) => missingTable[specifier]);
exportsMissing.apply({ ...ctx, slots: { inject: (_s, r) => r(), register: (meta, component) => { registrations2.push({ meta, component }); return () => {}; } } });
const fallback = registrations2.find((r) => r.meta.name === 'settings.section');
check(renderToStaticMarkup(h(fallback.component)).includes('宿主缺少 ui-primitives'), 'missing primitives degrade to an upgrade hint instead of a blank dialog');

console.log(failures.length === 0 ? '\nbundle verification passed' : `\n${failures.length} check(s) failed`);
process.exit(failures.length === 0 ? 0 : 1);
