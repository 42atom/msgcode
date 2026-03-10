# msgcode

> Feishu-first personal agent runtime on macOS.

msgcode 的目标是把「个人智能体」做成可长期运行的基础设施，而不是一次性的聊天应用。

它有两条执行线：
- `Agent 线`（默认）：本地模型 + 记忆 + SOUL + skills + tool loop
- `Tmux 线`：把复杂工程任务交给 `codex` / `claude-code` 等终端代理执行

产品叙事版文档：`docs/product/pitch.md`

## 系统模型（先看这段）

| 维度 | Agent 线（默认） | Tmux 线（复杂任务） |
|---|---|---|
| 角色 | 会话中枢（理解/记忆/编排） | 执行通道（终端代理转发） |
| 能力 | SOUL、记忆注入、tool loop、TTS | Shell / Git / 代码编辑 / 长任务 |
| 状态管理 | msgcode 管理会话上下文 | tmux 会话保持执行状态 |
| 典型触发 | 日常对话、轻任务 | 多步骤编程、重型工程任务 |
| 切换方式 | `/model agent-backend` | `/model codex` 或 `/model claude-code` |

固定边界：
- `Agent 线`承载业务语义（记忆、人格、技能）。
- `Tmux 线`只做忠实转发与回传，不隐式注入业务语义。

## 架构铁律（LLM 支持优先）

msgcode 的默认原则不是“约束 LLM”，而是“支持 LLM 完成任务”。

- 严禁框架自作主张给 LLM 加约束。
- 框架职责是桥接，不是裁判；默认提供能力、上下文与真实结果，不替 LLM 做主。
- 只要风险没有明确越界，框架必须优先放行主链，不得人为拆断合理步骤。
- skill 场景必须支持完整闭环：`读 skill -> 执行 skill -> 失败后继续循环`。
- 严禁只开放半套能力，把 LLM 引到一半再拦住。
- 限制只能来自明确风险边界，不能来自主观偏好、协议洁癖或“为了更可控”。
- 当 LLM 遇到困难时，框架必须继续给它工具、上下文和循环机会，不得中途判死。
- 默认能力主链：`LLM 先读 runtime skill -> 再用 bash / CLI / 文件协议执行`。

## 快速开始

### 1. 环境要求

- macOS（建议 Apple Silicon）
- Node.js + npm
- `tmux`
- 飞书企业自建应用凭据（`FEISHU_APP_ID` / `FEISHU_APP_SECRET`）
- Chrome/Chromium（供浏览器自动化底座使用）
- iMessage 仅在显式启用 `imsg` transport 时需要

### 2. 安装依赖

```bash
cd <msgcode-dir>
npm install
```

说明：
- `npm install` 现在会安装 `patchright` 依赖，正式浏览器主链通过 `connectOverCDP` 连接共享工作 Chrome。
- 共享工作 Chrome 数据根默认落在：`$WORKSPACE_ROOT/.msgcode/chrome-profiles/<name>`
- 当前正式浏览器主链：Patchright + Chrome-as-State

### 3. 初始化配置

```bash
# 全局安装后
msgcode init

# 或使用 npm exec
npm exec msgcode -- init
```

初始化会补齐：
- `~/.config/msgcode/souls/default/SOUL.md`
- `~/.config/msgcode/souls/active.json`
- `~/.config/msgcode/skills/`

### 4. 配置 `~/.config/msgcode/.env`

```bash
MY_EMAIL=me@company.com
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxx
WORKSPACE_ROOT=/Users/<you>/msgcode-workspaces

# 可选：仅在显式启用 iMessage transport 时需要
# MSGCODE_TRANSPORTS=imsg,feishu
# IMSG_PATH=/Users/<you>/msgcode/vendor/imsg/v0.4.0/imsg
```

默认 transport 口径：
- 配置飞书凭据时，默认只启 `feishu`
- 未配置飞书凭据时，回退到 `imsg`
- 如需显式启用 iMessage，请设置 `MSGCODE_TRANSPORTS=imsg` 或 `MSGCODE_TRANSPORTS=imsg,feishu`

Browser Core 配置口径：
- 正式浏览器主链不再依赖 PinchTab orchestrator/baseUrl/binary 环境变量。
- 正式连接方式固定为 Patchright `connectOverCDP` + 共享工作 Chrome root。
- Chrome 工作数据根默认放在：`$WORKSPACE_ROOT/.msgcode/chrome-profiles/<name>`
- 默认工作根名：`work-default`
- 如需查看或创建默认路径，可执行：
  - `npx tsx src/cli.ts browser root --json`
  - `npx tsx src/cli.ts browser root --ensure --json`

### 5. 启动服务

```bash
# 后台
msgcode start

# 或前台调试
msgcode start -d
```

### 6. 在飞书群绑定项目

1. 新建飞书群并拉入 msgcode 机器人
2. 在群里发送：

```text
/bind acme/ops
/start
/status
```

`/bind` 后会创建：
- `<WORKSPACE>/.msgcode/config.json`
- `<WORKSPACE>/.msgcode/providers.json`
- `<WORKSPACE>/.msgcode/SOUL.md`

## 最小命令集（根 README 口径）

| 命令 | 用途 |
|---|---|
| `/start` | 启动会话 |
| `/status` | 查看会话状态 |
| `/bind <dir>` | 绑定工作目录 |
| `/where` | 查看当前绑定 |
| `/unbind` | 解除绑定 |
| `/model [runner]` | 切换执行臂 |
| `/mode` | 查看语音模式 |
| `/tts <text>` | 文本转语音 |
| `/voice <text>` | 先回答再语音 |
| `/soul` | SOUL 管理入口 |
| `/help` | 命令真相源 |
| `/info` | 处理状态 |

更多命令请以运行时 `/help` 输出为准。

## Desktop Bridge（可选）

```bash
open mac/MsgcodeDesktopHost/MsgcodeDesktopHost.app
npx tsx src/cli.ts /desktop health
npx tsx src/cli.ts /desktop observe
```

完整文档：`docs/desktop/`

## 记忆机制（L0/L1/L2）

- `L0` 会话窗口：`<workspace>/.msgcode/sessions/<chatId>.jsonl`
- `L1` 会话摘要：上下文接近预算时压缩旧轮次
- `L2` 长期记忆：数据文件在 `<workspace>/memory/*.md`，索引在 `~/.config/msgcode/memory/index.sqlite`

`/clear` 只清理 `L0/L1`，不清理 `L2`。

## Known Limits

- 飞书已是主通道；iMessage 仅作为本地可选通道保留，受 macOS 本地权限与系统升级影响更大。
- Tmux 代理属于“终端通道”，输出质量受上游 CLI 工具更新影响。
- 命令在不同运行态可见性不同，出现分歧时一律以 `/help` 输出为准。

## 文档索引

- `docs/README.md` 文档总入口
- `docs/product/pitch.md` 产品叙事与定位
- `docs/desktop/` Desktop Bridge 文档
- `src/README.md` 代码分层与职责
- `test/README.md` 测试结构与回归约束
- `scripts/README.md` 脚本目录说明
- `docs/CHANGELOG.md` 变更日志

## 许可

MIT
