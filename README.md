# msgcode

> Feishu-first personal agent runtime on macOS.

当前版本：`v2.4.0`

当前桌面能力面：`ghost_*`

当前发布说明：`docs/release/v2.4.0.md`

一句话定义：

- **msgcode = AI 的操作系统化工作底座：在用户授权下，给一个可靠主脑完整、真实、可验证的电脑能力，让它按 persona 工作、管理子代理，并通过文件真相源持续完成真实任务。**

msgcode 的目标是把「个人智能体」做成可长期运行的基础设施，而不是一次性的聊天应用。

## 主管道

```text
Feishu / CLI
    |
    v
msgcode
  I/O -----------> 输入、命令、回复、产物回传
    |
    v
  调度 ----------> heartbeat / wake / dispatch / subagent
    |
    v
  资源 ----------> LLM / files / memory / browser / ghost_*
    |
    v
workspace files / issues / AIDOCS
```

入口理解先抓这条主链：

- I/O 系统回答“怎么进来、怎么出去”
- 调度系统回答“什么时候做、拆给谁做”
- 资源系统回答“能用什么”

## 快速开始

### 1. 环境要求

- macOS（建议 Apple Silicon）
- Node.js + npm
- `tmux`
- 飞书企业自建应用凭据（`FEISHU_APP_ID` / `FEISHU_APP_SECRET`）
- Chrome/Chromium（供浏览器自动化底座使用）
- `ghost-os`（默认且唯一的桌面自动化桥，供 `ghost_*` 使用）

先安装 `ghost-os`：

```bash
brew install ghostwright/ghost-os/ghost-os
ghost setup
ghost doctor
ghost status
```

### 2. 安装依赖

```bash
cd <msgcode-dir>
npm install
```

说明：

- `npm install` 会安装 `patchright` 依赖
- 正式浏览器主链通过 `connectOverCDP` 连接共享工作 Chrome
- 共享工作 Chrome 数据根默认落在：`$WORKSPACE_ROOT/.msgcode/chrome-profiles/<name>`

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
```

默认 transport 口径：

- 当前主链固定为 `feishu`
- 未配置飞书凭据时，`preflight/start` 会明确报缺 `FEISHU_APP_ID / FEISHU_APP_SECRET`

浏览器与桌面口径：

- 正式浏览器主链固定为 Patchright `connectOverCDP` + 共享工作 Chrome root
- Chrome 工作数据根默认放在：`$WORKSPACE_ROOT/.msgcode/chrome-profiles/<name>`
- 默认工作根名：`work-default`
- 如需查看或创建默认路径，可执行：
  - `npx tsx src/cli.ts browser root --json`
  - `npx tsx src/cli.ts browser root --ensure --json`
- msgcode 会直接暴露 `ghost_*` 原生工具，不再长期保留 `desktop.* -> ghost_*` 翻译层
- msgcode 不自己实现点击、识别、标注、grounding 等桌面自动化细节；这些能力由 `ghost-os` 提供，msgcode 只做薄桥接
- 未安装 `ghost-os` 时，`ghost_*` 工具会 fail-closed 返回真实缺失事实和安装指引
- `ghost status` 未 ready 时，msgcode 会补跑一次 `ghost doctor`，把最小诊断事实回给模型

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

### 7. 开发与测试边界

- 日常 CLI：优先用 `msgcode ...` 或 `./bin/msgcode ...`
- 开发直跑源码：用 `node --import tsx src/cli.ts ...`，或 `npm run cli:node -- ...`
- `npm test` / `npm run test:bun` 只跑 Bun 安全子集
- 任何会触达 `better-sqlite3` 的路径，不要直接塞进 Bun 进程
- 飞书真机 smoke 基座见：`docs/testing/feishu-live-smoke.md`

## 当前主链

### 三大板块

1. 资源管理
- `LLM`
- 文件系统
- tools / browser / ghost / memory

2. 调度系统
- `heartbeat`
- `cron / wake`
- `dispatch / subagent`

3. I/O 系统
- Feishu / mail / voice / browser / desktop
- 多模态输入
- 多模态输出

### 双执行线

| 维度 | Agent 线（默认） | Tmux 线（复杂任务） |
|---|---|---|
| 角色 | 会话中枢（理解/记忆/编排） | 执行通道（终端代理转发） |
| 能力 | SOUL、记忆注入、tool loop、TTS | Shell / Git / 代码编辑 / 长任务 |
| 状态管理 | msgcode 管理会话上下文 | tmux 会话保持执行状态 |
| 典型触发 | 日常对话、轻任务 | 多步骤编程、重型工程任务 |
| 切换方式 | `/model agent-backend` | `/model codex` 或 `/model claude-code` |

固定边界：

- `Agent 线`承载业务语义（记忆、人格、技能）
- `Tmux 线`只做忠实转发与回传，不隐式注入业务语义

## 设计原则

**不是 AI 要家，是让 AI 工作的人，应该给它一个像样的家。**

- msgcode 的定位是薄 runtime，不是替 AI 做主的控制平台
- 默认主链是：`模型 -> 工具/CLI/文件 -> 真实结果 -> 模型`
- 能落成文件真相源的，先落文件；不能落的，只做薄 runtime
- `skill` 首先是说明书，不是替模型做决定的控制器

当前产品口径：

- 当前桌面桥：`ghost-os`
- 当前实现目标：薄 runtime，默认把真实电脑能力暴露给 LLM
- 最终产品方向：`menu App + 单面板 + web系统面板`

延伸阅读：

- `docs/product/pitch.md`
- `CONTRIBUTING.md`
- `docs/README.md`

## 最小命令集

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

## Legacy Desktop Bridge（遗留显式链路）

- 当前默认桌面能力面已切到 `ghost_*` 原生工具
- 自研 Desktop Bridge 已整体迁入 `docs/archive/retired-desktop-bridge/`
- 不要再把旧 `mac/` / `docs/desktop/` 当默认入口，现役桌面能力以 `ghost_*` 为准

## 退役名对照

- `desktop` → `ghost_*`
- `shell` → `bash`
- `run_skill` → `SKILL.md + 原生工具/正式 CLI`
- `mem` → `memory skill + msgcode memory + 自动注入`

## 记忆机制（L0/L1/L2）

- `L0` 会话窗口：`<workspace>/.msgcode/sessions/<chatId>.jsonl`
- `L1` 会话摘要：上下文接近预算时压缩旧轮次
- `L2` 长期记忆：数据文件在 `<workspace>/memory/*.md`，索引在 `~/.config/msgcode/memory/index.sqlite`

`/clear` 只清理 `L0/L1`，不清理 `L2`。

开发补充：

- `L2` 的文件真相源可以直接读写
- `index.sqlite` 只是派生索引；坏了可以删后重建
- 若要直跑源码执行 `memory index`，请走 `node --import tsx src/cli.ts memory index ...`

## Known Limits

- 当前正式消息通道只有飞书；未来 app/web client 会接在更薄的 channel seam 上，而不是恢复旧 iMessage 主链
- Tmux 代理属于“终端通道”，输出质量受上游 CLI 工具更新影响
- 命令在不同运行态可见性不同，出现分歧时一律以 `/help` 输出为准

## 文档索引

- `docs/README.md` 文档总入口
- `docs/testing/feishu-live-smoke.md` 飞书真机 smoke 默认基座
- `docs/product/pitch.md` 产品叙事与定位
- `docs/archive/retired-desktop-bridge/` Legacy Desktop Bridge 版本化归档（非现役上手入口）
- `CONTRIBUTING.md` 开源协作与文档边界说明
- `src/README.md` 代码分层与职责
- `test/README.md` 测试结构与回归约束
- `scripts/README.md` 脚本目录说明
- `docs/CHANGELOG.md` 变更日志

## 许可

MIT
