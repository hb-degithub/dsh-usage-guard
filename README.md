# dsh-usage-stats 用量统计插件

DSH Web GUI 的用量统计插件：实时采集各会话 token 用量，按 天 × 提供商 × 模型 聚合，
在设置页提供「用量统计」面板（近 30 天柱状图、月历热力图、按模型汇总、费用估算），
并支持每日 token / 费用上限守卫（warn 全局提醒 / block 拦截）。

## 构建

```powershell
pnpm install
pnpm build
```

## 安装

```powershell
dsh plugin --profile web add <此目录>
```

注意：先 build 再安装；link 方式安装不会触发 prepack，dist 缺失会导致加载失败。

## 生效

重启 `dsh web` 后插件加载。

## 验证清单

1. 设置页侧边栏出现「用量统计」入口，打开可见面板；
2. `curl http://127.0.0.1:3080/usage-stats/summary` 返回 JSON（含 today / series / guard）；
3. 聊一句后刷新面板，今日用量增加；配置每日上限并超限后，页面顶部出现 ⚠ 提醒。
