# Changelog

## Protocol Entries（CLAUDE.md 约束格式）

- 2026-03-07
  - browser: 正式浏览器主链从 PinchTab 切到 Patchright `connectOverCDP`，实例真相源改为共享工作 Chrome，`snapshot/action` 改用无状态 `role + name + index` ref，并把 runtime skill、prompt、CLI/manifest 一并切到 Chrome-as-State 口径 (Issue: 0016, Plan: docs/design/plan-260307-patchright-browser-cutover.md) [risk: high] [rollback: 回退 `src/runners/browser-patchright.ts` 与 browser CLI/tool-loop/skills/prompt 本轮改动，恢复 PinchTab 接线]
  - browser: `tabs.open` 缺失 `instanceId` 时会自动拉起默认 PinchTab 实例；若传入不存在的 `profileId` 也会自动忽略并退回默认 launch，并在结果中回传 `instanceId`，让“打开网页”类请求可以走通单次 browser happy path (Issue: 0020, Plan: docs/design/plan-260307-browser-open-happy-path.md) [risk: medium] [rollback: 回退 `src/runners/browser-pinchtab.ts`、`src/tools/manifest.ts`、`prompts/agents-prompt.md` 与对应测试]
  - tooling: 运行时 `llm-tool-call` allowlist 与默认 LLM 工具暴露层收口到同一过滤逻辑；未暴露工具会在执行前被直接拒绝，并新增整轮 `toolSequence` 日志便于排障 (Issue: 0019, Plan: docs/design/plan-260307-tool-bridge-runtime-hardening.md) [risk: medium] [rollback: 回退 `src/tools/bus.ts`、`src/agent-backend/tool-loop.ts`、`src/agent-backend/routed-chat.ts`、`src/handlers.ts`、`src/logger/file-transport.ts` 与对应测试]
  - tooling: 模型默认文件工具面收口为 `read_file + bash`；`write_file/edit_file` 保留兼容实现但退出默认 LLM 暴露、默认 workspace allow、`/pi on` 自动注入与命令提示主链 (Issue: 0018, Plan: docs/design/plan-260307-tool-surface-slimming-for-llm.md) [risk: medium] [rollback: 回退 `workspace/tool-loop/lmstudio/prompt/cmd-*` 与相关测试本轮改动]
  - agent-backend: `edit_file` 参数合同与执行层统一为“`edits[]` + `oldText/newText` 简写兼容”，并将 `edit_file/write_file/browser` 的显式工具偏好放宽为可退回 `bash`，减少 `MODEL_PROTOCOL_FAILED` 型失败 (Issue: 0017, Plan: docs/design/plan-260307-tool-success-over-protocol-friction.md) [risk: medium] [rollback: 回退 `src/agent-backend/tool-loop.ts`、`src/tools/bus.ts`、`src/tools/manifest.ts` 与对应测试]
  - skills: 仓库新增托管 runtime skill 真相源，`msgcode init/start` 会幂等同步 `pinchtab-browser` 到 `~/.config/msgcode/skills/`，避免安装目录缺失导致 skill 依赖丢失 (Issue: 0014, Plan: docs/design/plan-260307-runtime-skill-source-sync.md) [risk: medium] [rollback: 回退 `src/skills/runtime*`、`src/cli.ts`、`src/commands.ts` 本轮改动]
  - browser: `startBot` 预启动本地 PinchTab，并向执行核注入 PinchTab baseUrl、binary path 与共享工作 Chrome 路径，正式浏览器通道收口为 PinchTab 单一路径 (Issue: 0013, Plan: docs/design/plan-260307-pinchtab-single-browser-substrate-bootstrap.md) [risk: medium] [rollback: 回退 `src/browser/pinchtab-runtime.ts`、`src/commands.ts`、`src/agent-backend/tool-loop.ts` 与 prompt 本轮改动]
  - feishu: 当前会话上下文写入 workspace `.msgcode/config.json`，`feishu_send_file` 缺省读取 `runtime.current_chat_id`，并修复上传失败被误判为成功的问题 (Issue: 0011, Plan: docs/design/plan-260307-feishu-send-file-runtime-context.md) [risk: medium] [rollback: 回退 `listener/config/tools/feishu` 本次改动，恢复显式 chatId + 旧发送语义]
  - agent-backend: `minimax` provider 切换到 Anthropic-compatible 推荐接法，新增独立 provider 适配、Anthropic tool schema 映射与多轮 `tool_use/tool_result` 回灌 (Issue: 0010, Plan: docs/design/plan-260307-minimax-anthropic-provider.md) [risk: medium] [rollback: 回退 `src/providers/minimax-anthropic.ts` 及 `chat/tool-loop/config` 本次接线]
- 2026-03-06
  - browser: 引入 `pinchtab@0.7.7` 作为浏览器底座依赖，并记录首轮真实验证结论（优先对接 HTTP API，避免直接包 CLI 主链路） (Issue: 0004, Plan: docs/design/plan-260306-web-transaction-platform-core.md) [risk: medium] [rollback: 移除 `pinchtab` 依赖并回退 README/验证文档更新]
  - browser: 收口 PinchTab timeout 与 baseUrl 语义，新增 `BROWSER_TIMEOUT` / `BROWSER_ORCHESTRATOR_URL_REQUIRED`，并将 browser timeout 向上映射为 `TOOL_TIMEOUT` (Issue: 0004, Plan: docs/design/plan-260306-web-transaction-platform-core.md) [risk: low] [rollback: 回退 `src/runners/browser-pinchtab.ts`、`src/tools/bus.ts`、README 本次修复]
  - browser: 新增共享工作 Chrome 根目录口径与 `msgcode browser root` 命令，默认路径固定为 `$WORKSPACE_ROOT/.msgcode/chrome-profiles/<name>` (Issue: 0004, Plan: docs/design/plan-260306-web-transaction-platform-core.md) [risk: low] [rollback: 回退 `src/browser/chrome-root.ts`、`src/cli/browser.ts`、README 本次更新]
- 2026-02-23
  - refactor: agent-backend 核心模块拆分与 lmstudio 兼容壳化 (Issue: 0002, Plan: docs/design/plan-260223-r9-t7-agent-backend-core-extraction.md) [risk: high] [rollback: 回退 commits 771fa49 和 4e13c0d 恢复 lmstudio.ts 主实现]
  - docs: 建立文档协议目录（issues/design/notes/adr）并迁移 changelog 主路径到 `docs/CHANGELOG.md` (Issue: 0001, Plan: docs/design/plan-260223-r9-t8-repo-protocol-alignment.md) [risk: medium] [rollback: 保留根 CHANGELOG stub，恢复脚本检查前版本]

---

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.3.0] - 2026-02-17

### Added
- SOUL Mod Market（安装/切换/回滚）：
  - `msgcode soul market list`
  - `msgcode soul market install <source>`
  - `msgcode soul use <id>[@version]`
  - `msgcode soul rollback`
- PI Debug 字段：`activeSoulId`、`activeSoulVersion`
- 发布文档：`docs/release/v2.3.0.md`

### Changed
- Slash 命令收敛到注册表渲染（`/help` 与注册表一致）
- `/soul` 进入主命令路径，修复“识别但不处理”的黑洞问题
- 未知命令提示改为从注册表动态生成
- README 首屏定位更新为“Mac 上的 AI 智能体，iMessage 通道优先”

### Deprecated
- `/persona` 命令族退役（保留兼容提示壳）

### Migration
- 请将 `/persona` 操作迁移到 `/soul`
- `schedule` 作为独立命令保留，不再作为 `soul` 别名

### Verification
- `npx tsc --noEmit`
- `npm test`（530 pass / 0 fail）
- `npm run docs:check`

## [1.0.0] - 2025-02-11

### Added
- **Message -> Safari 端到端能力**: Desktop Bridge 基础设施
  - `desktop.hotkey` - 发送快捷键（cmd+l, enter 等）
  - `desktop.typeText` - 通过剪贴板输入文本
  - `desktop.observe` - 截图 + AX 树证据落盘
  - `desktop.click` - 点击 UI 元素（需 confirm token）
  - `desktop.find` - 查找 UI 元素
  - `desktop.waitUntil` - 等待 UI 条件成立
  - `desktop.listModals` - 列出模态窗口
  - `desktop.dismissModal` - 关闭模态窗口
  - `desktop.abort` - 中止正在执行的请求
- LaunchAgent 支持：Mach Service 长期运行
- 测试钩子系统（`desktop._test.*`）：
  - `desktop._test.injectModalDetector` - 注入 mock modal 检测器
  - `desktop._test.clearModalDetector` - 清除 mock modal 检测器
- 安全机制：
  - Confirm Token 一次性确认
  - Allowlist 白名单验证
  - Evidence 证据强制落盘 workspace 内
  - Abort 中止能力
- 冒烟测试脚本：`scripts/desktop/smoke-message-safari.sh`

### Changed
- 架构变更：Bridge Server 从独立 XPC Service 改为内置 HostApp 进程
- TCC 权限检查现在指向 HostApp（com.msgcode.desktop.host）

### Security
- 测试钩子需要同时满足：
  1. 环境变量 `OPENCLAW_DESKTOP_TEST_HOOKS=1`
  2. 请求参数 `meta._testMode=true`
- LaunchAgent 支持通过 `install --test` 启用测试模式

### Testing
- 单元测试：417 个测试全部通过
- Safari E2E 冒烟测试验证通过
- 验收 executionId 示例（v1.0.0）：
  - hotkey cmd+l: `0F4C464C-6A5D-41FC-A780-1E7824BC4C4F`
  - typeText URL: `61DE7C34-D2F9-4715-AD23-14F9EBB0F832`
  - hotkey enter: `85B6A98B-5063-4BEA-B3F9-2FAA05784EA4`
  - observe: `E8D717C8-551F-4622-959B-E93C48B81744`

### Known Limitations
- macOS 仅（依赖 AXUIElement API）
- 需要辅助功能和屏幕录制权限
- Safari 以外的应用支持待验证
- 复杂 UI 场景（如多级菜单、动态内容）需进一步测试

### Documentation
- `docs/desktop/README.md` - Desktop Bridge API 文档
- `mac/MsgcodeDesktopHost/README.md` - HostApp 架构与使用
- `mac/MsgcodeDesktopHost/docs/desktop/README.md` - LaunchAgent 与测试钩子

[2.3.0]: https://github.com/yourorg/msgcode/releases/tag/v2.3.0
[1.0.0]: https://github.com/yourorg/msgcode/releases/tag/v1.0.0
