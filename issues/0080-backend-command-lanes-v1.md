---
id: 0080
title: 执行基座命令面重构为 backend lanes v0.1
status: done
owner: agent
labels: [feature, refactor, docs, test]
risk: medium
scope: 收口 /backend /local /api /tmux 与模型覆盖命令，退化旧 /model 为状态页与兼容入口
plan_doc: docs/design/plan-260311-backend-command-lanes-v1.md
links: []
---

## Context

用户确认现有 `/model` 设计过于混杂，当前一条命令同时承担：

- 切当前执行基座
- 切本地 backend 预设
- 切 tmux client
- 兼带状态查询

这导致命令面语义不稳定，用户难以判断自己到底切的是：

- 当前主分支
- 分支内 provider/app/client
- 模型覆盖值

用户已确认新的命令协议方向：

- `/backend local | api | tmux`
- `/local omlx | lmstudio`
- `/api minimax | deepseek | openai | ...`
- `/tmux codex | claude-code`
- `/text-model <id|auto>`
- `/vision-model <id|auto>`
- `/tts-model <id|auto>`
- `/embedding-model <id|auto>`
- `/model status`

并确认以下冻结口径：

- `embedding-model` 协议上可见、可配，但默认低曝光
- `/model status` 只显示当前分支的模型配置，不显示另一分支模型值
- 模型层不引入 `clear/reset`，统一使用 `auto`

## Goal / Non-Goals

- Goal: 将执行基座切换与 provider/app/client 预设彻底拆开
- Goal: 引入 `backend lanes` 命令面，并保持状态展示一致
- Goal: 让 `text/vision/tts/embedding-model` 支持按当前分支存储覆盖值
- Goal: 保留旧 `/model xxx` 作为兼容 alias，避免当前工作流断裂
- Goal: 当前实现覆盖 `minimax | deepseek | openai | omlx | lmstudio | codex | claude-code`
- Non-Goals: 不新增平台化控制面或 supervisor
- Non-Goals: 不做自动 fallback 到云端
- Non-Goals: 不在本轮重构 tmux/runtime 主链
- Non-Goals: 不在本轮引入新的模型发现策略层

## Plan

- [x] 冻结命令字典文档并补实现级 Issue / Plan
- [x] 将 `/backend /local /api /tmux` 接入路由命令层
- [x] 增加 `api-provider` 预设真相源，解除“当前 backend”和“API 预设”耦合
- [x] 增加按分支存储的 `text/vision/tts/embedding-model` 配置
- [x] 让 `/model status` 成为唯一聚合状态页
- [x] 将旧 `/model xxx` 退化为兼容 alias
- [x] 补测试并更新帮助/提示文案
- [x] 将 `tts-model` 真接入当前分支的 TTS 执行链与 `/mode` 状态回显
- [x] 更新 changelog

## Acceptance Criteria

1. `/backend` 只负责切当前执行主分支
2. `/local /api /tmux` 无参返回当前值，有参只改对应分支预设
3. `/model status` 始终显示 `backend/local-app/api-provider/tmux-client`
4. `/model status` 只显示当前激活分支的 `text/vision/tts/embedding-model`
5. `text-model auto` 等价于“当前分支不指定覆盖值”
6. 旧 `/model minimax|omlx|codex|...` 仍可用，但内部走新命令协议
7. 本轮不新增自动路由/fallback/多层控制面

## Notes

- 协议真相源：`AIDOCS/design/command-dictionary-260311-backend-lanes-v1.md`
- 现有关键实现文件：
  - `src/config/workspace.ts`
  - `src/routes/commands.ts`
  - `src/routes/cmd-model.ts`
  - `src/routes/cmd-info.ts`
  - `src/routes/cmd-bind.ts`
  - `src/runtime/session-orchestrator.ts`
  - `src/handlers.ts`
- 当前已存在的本地 backend 真相源：
  - `src/local-backend/registry.ts`
- Tests:
  - `npm test -- test/routes.commands.test.ts test/p5-7-r8c-agent-backend-single-source.test.ts test/p5-7-r24-backend-command-lanes.test.ts test/p5-7-r9-t7-step4-compatibility-lock.test.ts test/p5-7-r9-t2-runtime-capabilities.test.ts test/p5-7-r23-vision-mainline.test.ts test/p5-7-r3e-model-alias-guard.test.ts test/p5-6-13-r2a-tts-qwen-contract.test.ts`
- Runtime:
  - `tts-model` 已不只是配置项；当前分支设置会直接影响 `src/runners/tts.ts` 的后端选择顺序，并体现在 `/mode` 的 `TTS: mode=...` 与 `tts-model=...` 回显
- Typecheck:
  - `npx tsc --noEmit` 仍有仓库既存错误，集中在 `src/feishu/transport.ts` 与 `src/routes/cmd-schedule.ts`

## Links

- Plan: docs/design/plan-260311-backend-command-lanes-v1.md
- Protocol: AIDOCS/design/command-dictionary-260311-backend-lanes-v1.md
