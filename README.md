# dsh-usage-guard

English | [中文](#中文)

Usage statistics panel for [DeepSeek Harness](https://github.com/deepseek-ai) (DSH) Web GUI — silent background collection, per-model analytics, cost estimation and a daily-limit guard.

## Features

- **Silent collection** — hooks session events, folds every assistant message's token usage into daily buckets per provider × model; survives restarts, backfills from session logs on first run
- **Matches the harness's own accounting** — usage is read from `assistant/message` (`data.usage`), from the last usage chunk embedded in an `assistant/message` / `assistant/attempt` stream, and from legacy `assistant/chunk` events; `llm/retry-started` closes the replacement slot so a retried attempt **adds up** instead of overwriting the failed one (same rule as `dsh-token-meter`)
- **Reads every session-log generation** — canonical `session.v<N>.jsonl.zstd` (format v4, what DSH 0.2.x writes) as well as legacy `session.jsonl.zstd`, uncompressed `.jsonl`, and picks the highest generation per session directory
- **Dashboard** in Settings → Usage: six stat cards (tokens, sessions, requests, active days, current streak, top model), a GitHub-style activity heatmap (continuous year view, weekday/month labels, hover detail card per day), a multi-series line/area trend chart (input / output / cache hit / cache write / cost, dual axes, 7d/30d switch) and a model-usage donut
- **Cost estimation** — configurable per-model prices (input / output / cache read / cache write per 1M tokens); built-in DeepSeek list prices; models without a price are excluded from cost instead of guessed
- **Daily-limit guard** — optional daily token / cost caps; `warn` mode shows a global banner, `block` mode aborts over-limit LLM requests before they hit the network
- **Bilingual** (zh/en), follows the DSH theme tokens (`--dsw-alias-*`), ships its own icons so host icon renames cannot blank the panel, zero external runtime dependencies

## Install

**Desktop app** (profile name `desktop`) — use the CLI bundled with the app:

```sh
dsh plugin --profile desktop add <path-or-package-or-github-url>
```

If `dsh` is not on your `PATH` (the desktop installer does not add it by default), call the bundled launcher instead — or turn the command line on from the app's own settings:

```sh
"<install dir>\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop add <spec>
```

Fully quit DeepSeek Harness Desktop, then start it again (the host half of a plugin only loads at boot), and open **Settings → 使用统计 / Usage**. The CLI forwards everything after `add` to pnpm, so an absolute local path, an npm name or a GitHub URL all work; the bundle layer (`dsh.profile.bundles`) is updated automatically. Installing from a GitHub URL builds the client bundle through the `prepare` script, which pnpm may hold back until you approve it under `allowBuilds` — the npm package needs no building.

**Web profile** (`dsh web`):

```sh
dsh plugin --profile web add dsh-usage-guard   # npm
dsh plugin --profile web add <github-url>      # or from GitHub
```

Restart `dsh web`, then open **Settings → 使用统计**.

## Upgrading

Statistics live in `$DSH_HOME/usage-stats.json`. Everything in it except your prices and guard settings is derived from the session logs, and **upgrading to 0.1.1 rebuilds that derived data once** on first start (the day buckets it replaces were missing roughly 7/8 of the real usage — the old watermarks had already passed the end of each log, so nothing could be recovered incrementally). Expect the totals to jump to the real figures after that first start; usage belonging to session logs you have since deleted is gone for good.

## Compatibility

| DSH | Session log | Notes |
| --- | --- | --- |
| 0.2.x (desktop 0.2.0-rc.2 verified) | `session.v4.jsonl.zstd` | current target; icons come from the plugin itself because `IconXxx16` was renamed to `IconXxxOutlineRegular/Medium` |
| 0.1.x | `session.jsonl.zstd` | host half unchanged; client panel works while `Button` / `Input` still exist |

## Develop

```sh
pnpm install
pnpm build          # tsdown + wrap-client → dist/client.js (host loads host/, browser loads dist/)
pnpm test           # vitest: host fold/log/route/store/guard + client rendering
pnpm verify:bundle  # loads dist/client.js the way the browser does and checks registrations
pnpm verify:parity  # replays your real session logs and diffs the fold against a transcription of dsh-token-meter's projection
pnpm check          # test + build + verify:bundle
```

`pnpm test` also replays **real** session logs: `client/render.smoke.test.tsx` renders the charts from `~/.dsh/usage-stats.json`.

## License

MIT

---

## 中文

[DeepSeek Harness](https://github.com/deepseek-ai)（DSH）Web GUI 的用量统计面板——后台静默采集、按模型分析、费用估算、每日超限守卫。

### 功能

- **静默采集**——挂钩会话事件，把每条助手消息的 token 用量折叠进 天 × 提供商 × 模型 桶；重启不丢，首次运行自动从会话日志回填
- **与宿主自己的口径一致**——用量取自 `assistant/message` 的 `data.usage`、`assistant/message` / `assistant/attempt` 流里内嵌的最后一条 usage chunk，以及旧格式的 `assistant/chunk` 事件；`llm/retry-started` 会关闭替换槽，让重试的那次请求**累加**而不是覆盖掉失败的那次（与 `dsh-token-meter` 同一套规则）
- **认得每一代会话日志**——规范的 `session.v<N>.jsonl.zstd`（格式 v4，DSH 0.2.x 的落盘名）、旧的 `session.jsonl.zstd`、未压缩的 `.jsonl`；同一会话目录取最高代次
- **仪表盘**（设置 → 使用统计）：六张统计卡（tokens、会话数、请求数、活跃天数、连续天数、最常用模型）、GitHub 风格活跃热力图（连续年度视图、星期/月份标注、逐日悬浮详情卡）、多序列折线/面积趋势图（输入/输出/缓存命中/缓存创建/成本，双轴，7/30 天切换）、模型用量环形图
- **费用估算**——按模型配置价格（每 1M tokens 的 输入/输出/缓存读/缓存写）；内置 DeepSeek 刊例价；未配置价格的模型不计费而不是瞎猜
- **每日超限守卫**——可选每日 token / 费用上限；`warn` 模式全局横幅提醒，`block` 模式在请求发出前直接拦截
- **中英双语**，跟随 DSH 主题令牌（`--dsw-alias-*`）；图标自带（宿主改图标名不会把面板弄成白屏），零外部运行时依赖

### 安装

**桌面端**（profile 名为 `desktop`）——用应用自带的 CLI：

```sh
dsh plugin --profile desktop add <本地绝对路径 / npm 包名 / GitHub 地址>
```

`dsh` 默认不在 `PATH` 上（桌面安装包不会加），可以直接调应用自带的启动器，或在应用设置里打开命令行：

```sh
"<安装目录>\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop add <规格>
```

装完**完全退出 DeepSeek Harness 桌面端再启动**（插件的宿主半边只在启动时加载），然后打开 **设置 → 使用统计**。命令会把 `add` 之后的内容原样转给 pnpm，本地路径、npm 包名、GitHub 地址都可以；bundle 层（`dsh.profile.bundles`）会自动补上。从 GitHub 地址安装时，客户端产物由 `prepare` 脚本现场构建，pnpm 可能要求先在 `allowBuilds` 里授权；npm 包则无需构建。

**web profile**（`dsh web`）：

```sh
dsh plugin --profile web add dsh-usage-guard   # npm
dsh plugin --profile web add <github 地址>      # 或从 GitHub
```

重启 `dsh web`，打开 **设置 → 使用统计**。

### 升级说明

统计数据存在 `$DSH_HOME/usage-stats.json`。除了价格与守卫设置，里面的内容都由会话日志推导，**升级到 0.1.1 后首次启动会整表重折一次**：被替换掉的那些日桶大约只记了真实用量的 1/8（旧版本的水位已经推到了每个日志末尾，增量续跑永远补不回来，实测本机 ×8.07）。首次启动后总量会跳到真实值；日志已被删除的会话，其历史用量会随之消失（聚合桶追不回来源）。

### 兼容性

| DSH | 会话日志 | 说明 |
| --- | --- | --- |
| 0.2.x（已核对桌面端 0.2.0-rc.2） | `session.v4.jsonl.zstd` | 当前适配目标；图标由插件自带，因为宿主的 `IconXxx16` 已改名为 `IconXxxOutlineRegular/Medium` |
| 0.1.x | `session.jsonl.zstd` | 宿主半边不变；客户端面板在 `Button` / `Input` 仍存在时继续可用 |

### 开发

```sh
pnpm install
pnpm build          # tsdown + wrap-client → dist/client.js（宿主加载 host/，浏览器加载 dist/）
pnpm test           # vitest：宿主 fold/日志/路由/存储/迁移/守卫/入口装配 + 客户端渲染
pnpm verify:bundle  # 按浏览器的方式加载 dist/client.js 并校验注册行为
pnpm verify:parity  # 用本机真实会话日志与 dsh-token-meter 投影的逐行转写对拍
pnpm check          # test + build + verify:bundle
```

`pnpm test` 里还有真实数据的冒烟测试：`client/render.smoke.test.tsx` 会用 `$DSH_HOME/usage-stats.json`（缺省 `~/.dsh`）渲染全部图表，本机没有该文件时退回合成数据。

### 许可

MIT
