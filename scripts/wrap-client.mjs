// 把 tsdown 的 CJS 产物包进 dsh 的 __ModuleLoader__ 工厂（dshmarket 同款形态）。
import { readFileSync, writeFileSync } from 'node:fs';

const file = 'dist/client.js';
const code = readFileSync(file, 'utf8');
writeFileSync(
  file,
  'window.__ModuleLoader__.load({ id: "dsh-usage-stats", factory: (require) => {\n'
    + 'var module = { exports: {} };\nvar exports = module.exports;\n'
    + code
    + '\nreturn module.exports;\n}\n});\n',
);
console.log('wrapped dist/client.js');
