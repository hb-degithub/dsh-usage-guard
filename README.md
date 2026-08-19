# dsh-usage-guard

English | [中文](#中文)

Usage statistics panel for [DeepSeek Harness](https://github.com/deepseek-ai) (DSH) Web GUI — silent background collection, per-model analytics, cost estimation and a daily-limit guard.

## Features

- **Silent collection** — hooks session events, folds every assistant message's token usage into daily buckets per provider × model; survives restarts, backfills from session logs on first run
- **Dashboard** in Settings → Usage: six stat cards (tokens, sessions, messages, active days, current streak, top model), a GitHub-style activity heatmap (continuous year view, weekday/month labels, hover detail card per day), a multi-series line/area trend chart (input / output / cache hit / cache write / cost, dual axes, 7d/30d switch) and a model-usage donut
- **Cost estimation** — configurable per-model prices (input / output / cache read / cache write per 1M tokens); built-in DeepSeek list prices; models without a price are excluded from cost instead of guessed
- **Daily-limit guard** — optional daily token / cost caps; `warn` mode shows a global banner, `block` mode aborts over-limit LLM requests before they hit the network
- **Bilingual** (zh/en), follows the DSH theme tokens, zero external runtime dependencies

## Install

From the DSH plugin market (Settings → 插件市场), or:

```sh
dsh plugin --profile web add dsh-usage-guard   # npm
dsh plugin --profile web add <github-url>      # or from GitHub
```

Restart `dsh web`, then open **Settings → 使用统计**.

## Develop

```sh
pnpm install
pnpm build   # tsdown + wrap-client → dist/client.js (host loads host/, browser loads dist/)
pnpm test    # vitest, incl. an SSR smoke test that renders all charts from real data
```

## License

MIT

---

## 中文

[DeepSeek Harness](https://github.com/deepseek-ai)（DSH）Web GUI 的用量统计面板——后台静默采集、按模型分析、费用估算、每日超限守卫。

### 功能

- **静默采集**——挂钩会话事件，把每条助手消息的 token 用量折叠进 天 × 提供商 × 模型 桶；重启不丢，首次运行自动从会话日志回填
- **仪表盘**（设置 → 使用统计）：六张统计卡（tokens、会话数、消息数、活跃天数、连续天数、最常用模型）、GitHub 风格活跃热力图（连续年度视图、星期/月份标注、逐日悬浮详情卡）、多序列折线/面积趋势图（输入/输出/缓存命中/缓存创建/成本，双轴，7/30 天切换）、模型用量环形图
- **费用估算**——按模型配置价格（每 1M tokens 的 输入/输出/缓存读/缓存写）；内置 DeepSeek 刊例价；未配置价格的模型不计费而不是瞎猜
- **每日超限守卫**——可选每日 token / 费用上限；`warn` 模式全局横幅提醒，`block` 模式在请求发出前直接拦截
- **中英双语**，跟随 DSH 主题令牌，零外部运行时依赖

### 安装

插件市场（设置 → 插件市场）一键安装，或：

```sh
dsh plugin --profile web add dsh-usage-guard   # npm
dsh plugin --profile web add <github 地址>      # 或从 GitHub
```

重启 `dsh web`，打开 **设置 → 使用统计**。

### 许可

MIT
