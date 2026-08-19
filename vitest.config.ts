import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vitest/config';

const stub = fileURLToPath(new URL('./scripts/css-module-stub.mjs', import.meta.url));

/** 把所有 *.module.css 导入解析到「键名即类名」代理 stub（供 SSR 冒烟测试断言类名）。 */
const cssModuleStub: Plugin = {
  name: 'css-module-stub',
  enforce: 'pre',
  resolveId(id) {
    if (id.endsWith('.module.css')) return stub;
    return null;
  },
};

export default defineConfig({
  plugins: [cssModuleStub],
});
