// vitest 用：把 *.module.css 的默认导出替换成「键名即类名」的代理，
// 让 SSR 冒烟测试能断言组件引用的每个类都在 CSS 文件里有定义。
const proxy = new Proxy({}, { get: (_target, key) => String(key) });
export default proxy;
