# msgcode

> iMessage-first personal agent runtime on macOS.

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

## 快速开始

### 1. 环境要求

- macOS（建议 Apple Silicon）
- Node.js + npm
- `tmux`
- iMessage 可用账号
- Chrome/Chromium（供浏览器自动化底座使用）

### 2. 安装依赖

```bash
cd <msgcode-dir>
npm install
```

说明：
- `npm install` 现在会同时安装 `pinchtab` npm 依赖，并自动下载对应平台的 PinchTab 二进制。
- 默认二进制落在：`~/.pinchtab/bin/<version>/`
- 当前验证版本：`0.7.7`

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
MY_EMAIL=me@icloud.com
IMSG_PATH=/Users/<you>/msgcode/vendor/imsg/v0.4.0/imsg
WORKSPACE_ROOT=/Users/<you>/msgcode-workspaces
PINCHTAB_BASE_URL=http://127.0.0.1:9867
```

Browser Core 配置口径：
- `PINCHTAB_BASE_URL` / `PINCHTAB_URL` 当前只支持指向 **PinchTab orchestrator/dashboard** 地址。
- 不要把 `pinchtab connect` 返回的实例 URL 填到这里；那类 URL 不支持 `profiles.*` / `instances.*` 管理接口。
- `PINCHTAB_TOKEN` 可选；如果服务启用了鉴权，再显式配置。
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

### 6. 在 iMessage 绑定项目

1. 新建群聊并拉入 msgcode 账号
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

- iMessage 适配依赖 macOS 本地能力，系统升级可能影响稳定性。
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
