// 把 tsdown 的 CJS 产物包进 dsh 的 __ModuleLoader__ 工厂（dshmarket 同款形态），
// 并把 dist/style.css（@tsdown/css 抽出的 CSS 模块样式）内联成 <style> 注入——
// 客户端只加载 client.js 一个文件，外链 CSS 拿不到。
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const file = 'dist/client.js';
const code = readFileSync(file, 'utf8');

let injectCss = '';
const cssFile = 'dist/style.css';
if (existsSync(cssFile)) {
  const css = readFileSync(cssFile, 'utf8');
  injectCss = 'var __styleTagId = "dsh-usage-stats/Panel.module.css";\n'
    + 'if (typeof document !== "undefined" && document.querySelector(\'style[data-plugin-css="\' + __styleTagId + \'"]\') === null) {\n'
    + '  var __tag = document.createElement("style");\n'
    + '  __tag.dataset.plugin = "dsh-usage-stats";\n'
    + '  __tag.dataset.pluginCss = __styleTagId;\n'
    + `  __tag.textContent = ${JSON.stringify(css)};\n`
    + '  document.head.appendChild(__tag);\n'
    + '}\n';
}

writeFileSync(
  file,
  'window.__ModuleLoader__.load({ id: "dsh-usage-stats", factory: (require) => {\n'
    + 'var module = { exports: {} };\nvar exports = module.exports;\n'
    + injectCss
    + code
    + '\nreturn module.exports;\n}\n});\n',
);
console.log('wrapped dist/client.js' + (injectCss !== '' ? ' (+ inlined style.css)' : ''));
