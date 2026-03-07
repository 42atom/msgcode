---
id: 0013
title: PinchTab 单一浏览器底座预启动与路径注入
status: done
owner: agent
labels: [feature, refactor, docs]
risk: medium
scope: browser/prompt/startup/skills
plan_doc: docs/design/plan-260307-pinchtab-single-browser-substrate-bootstrap.md
links:
  - issues/0004-web-transaction-platform-core.md
  - issues/0005-browser-tool-not-exposed-to-llm.md
created: 2026-03-07
due:
---

## Context

- 当前 `msgcode` 的浏览器主链已经冻结为 PinchTab，但实际运行仍然缺两块前提：
  - `startBot()` 不会预启动 PinchTab，只会在 browser 调用时直接打 HTTP。
  - 执行核没有拿到 PinchTab baseUrl、Chrome 工作根、PinchTab 二进制等明确路径，模型容易继续猜环境。
- `src/runners/browser-pinchtab.ts` 当前只负责 HTTP API 调用和错误分类，不负责 PinchTab 进程预热与运行时信息解析。
- `src/browser/chrome-root.ts` 已经能提供共享工作 Chrome 根目录、profilesRoot 和 launchCommand，但这套路径信息还没有注入给执行核。
- 用户已明确冻结方向：
  - PinchTab 是唯一正式浏览器通道。
  - `agent-browser` 不进入正式主链，只保留为可随时外装的参考 skill。
  - 先把调用基础坐稳，不在本轮提前混入 bot 检测规避和指纹浏览器扩展。

## Goal / Non-Goals

### Goals

- 在 `startBot()` 生命周期内预启动并验活本地 PinchTab。
- 为 browser 主链提供单一运行时真相源：PinchTab baseUrl、binary path、Chrome root、profilesRoot、launchCommand。
- 把这些浏览器路径信息明确注入执行核，禁止模型继续猜浏览器环境。
- 增加一个 `pinchtab-browser` 本地 skill，作为 PinchTab CLI 合同与工作说明入口。
- 明确正式口径：PinchTab 是唯一浏览器底座，`agent-browser` 不进入正式主链。

### Non-Goals

- 本轮不实现指纹浏览器、代理池、行为模拟或其他反检测增强。
- 本轮不重做整个 skill 系统，只做最小本地 skill 增补。
- 本轮不新增第二套 browser substrate，也不恢复 `agent-browser` 主链。

## Plan

- [x] 创建并评审 Plan 文档：`docs/design/plan-260307-pinchtab-single-browser-substrate-bootstrap.md`
- [x] 新增 PinchTab 运行时解析与预启动模块，支持本地 binary/baseUrl 健康检查。
- [x] 在 `startBot()` 中接入 PinchTab 预启动，并记录启动/失败证据。
- [x] 在执行核 prompt 中注入 PinchTab baseUrl、binary path、Chrome root、launchCommand，并明确禁止使用 `agent-browser`。
- [x] 新增本地 `pinchtab-browser` skill，更新全局 skills 索引。
- [x] 补 PinchTab 预启动与 prompt 注入回归锁，确保单一路径成立。

## Acceptance Criteria

1. `msgcode start` / `restart` 后，本地 PinchTab 未启动时会被自动拉起并通过健康检查。
2. 执行核收到的 system prompt 中包含明确的：
   - PinchTab orchestrator baseUrl
   - PinchTab binary path
   - Chrome profilesRoot
   - 当前工作 Chrome root
   - launchCommand
3. 执行核被明确约束为：
   - 浏览器正式通道只有 PinchTab / `browser` 工具
   - 不允许使用 `agent-browser` 作为正式路径
4. 本地 `~/.config/msgcode/skills/index.json` 中新增 `pinchtab-browser` skill，且入口文件存在。
5. 至少有一组测试锁住：
   - PinchTab 预启动逻辑
   - 浏览器运行时路径注入 prompt

## Notes

- Docs：`node_modules/pinchtab/README.md`（`pinchtab serve --port 9867`）
- Code：`src/runners/browser-pinchtab.ts`、`src/browser/chrome-root.ts`、`src/commands.ts`、`src/agent-backend/tool-loop.ts`
- Docs：`docs/notes/research-260306-pinchtab-validation.md`
- 冻结口径（2026-03-07）：
  - PinchTab 是唯一正式浏览器底座
  - `agent-browser` 只保留为参考资产，不进入主链
- Tests：
  - `PATH="$HOME/.bun/bin:$PATH" bun test test/p5-7-r13-pinchtab-bootstrap.test.ts test/p5-7-r9-t2-skill-global-single-source.test.ts test/p5-7-r7a-browser-runner.test.ts test/p5-7-r7a-browser-tool-bus.test.ts`
  - 结果：19 pass, 0 fail
- CLI 验证：
  - `./bin/msgcode browser profiles list --json`
  - 结果：`status=pass`，返回 4 个现有 PinchTab profiles
- Logs：
  - `/Users/admin/.config/msgcode/log/msgcode.log`
  - `2026-03-07 04:53:57.074 [INFO ] [commands] PinchTab 已就绪`
- Runtime skill：
  - 已新增 `~/.config/msgcode/skills/pinchtab-browser/{SKILL.md,main.sh}`
  - 已更新 `~/.config/msgcode/skills/index.json`

## Links

- Plan: `docs/design/plan-260307-pinchtab-single-browser-substrate-bootstrap.md`
- Related: `issues/0004-web-transaction-platform-core.md`
- Related: `issues/0005-browser-tool-not-exposed-to-llm.md`
