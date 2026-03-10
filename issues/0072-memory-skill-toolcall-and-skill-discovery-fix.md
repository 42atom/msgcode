---
id: 0072
title: 群聊记忆调用与可选技能发现收口
status: done
owner: agent
labels: [bug, feature, docs]
risk: medium
scope: 修复群聊把 memory 当工具名导致的记忆失败，并把 optional skill 汇总进运行时主索引以改善发现性
plan_doc: docs/design/plan-260311-memory-skill-toolcall-and-skill-discovery-fix.md
links:
  - docs/design/plan-260311-memory-skill-toolcall-and-skill-discovery-fix.md
  - prompts/agents-prompt.md
  - src/skills/runtime-sync.ts
  - test/p5-7-r13-runtime-skill-sync.test.ts
  - test/p5-7-r3n-system-prompt-file-ref.test.ts
---

## Context

群聊里模型在需要查询记忆时发出了不存在的 `memory` tool call，而不是按 skill 约定走 `bash + main.sh` 或 `msgcode memory` CLI，导致日志里出现 `TOOL_NOT_ALLOWED`。同时，repo 内置 optional skill 只同步到 `~/.config/msgcode/skills/optional/index.json`，主索引不汇总，模型默认发现性偏弱。

## Goal / Non-Goals

### Goal

- 修复群聊记忆检索时把 `memory` 当工具名的提示词误导
- 让运行时主索引汇总 optional skill 摘要，改善模型默认发现性
- 保持 optional skill 仍然是按需加载，不变成常驻上下文

### Non-Goals

- 不新增 memory 工具
- 不把人物识别、记忆或 optional skill 平台化
- 不改 skill 来源分层主设计

## Plan

- [x] 调整系统提示词，明确 `memory` 不是工具名
- [x] 调整技能发现口径，主索引显式汇总基础与 optional skill 摘要
- [x] 修改 runtime-sync，把 optional skill 摘要并入 `~/.config/msgcode/skills/index.json`
- [x] 补 runtime skill sync 与 prompt 回归锁
- [x] 同步运行时 skill 目录并重启 daemon
- [x] 更新 changelog

## Acceptance Criteria

- 群聊提示词明确禁止发出 `memory` tool call
- `~/.config/msgcode/skills/index.json` 可见 optional skill 摘要
- optional skill 物理目录仍位于 `~/.config/msgcode/skills/optional/`
- 相关测试通过

## Notes

- 日志证据：
  - `/Users/admin/.config/msgcode/log/msgcode.log`
  - `2026-03-10 16:05:36` 出现 `Tool Bus: FAILURE memory` 与 `TOOL_NOT_ALLOWED`
- 修复后验证：
  - `PATH="$HOME/.bun/bin:$PATH" bun test test/p5-7-r13-runtime-skill-sync.test.ts`
  - `PATH="$HOME/.bun/bin:$PATH" bun test test/p5-7-r3n-system-prompt-file-ref.test.ts`
  - 结果：`8 pass / 0 fail`

## Links

- [prompts/agents-prompt.md](/Users/admin/GitProjects/msgcode/prompts/agents-prompt.md)
- [src/skills/runtime-sync.ts](/Users/admin/GitProjects/msgcode/src/skills/runtime-sync.ts)
- [test/p5-7-r13-runtime-skill-sync.test.ts](/Users/admin/GitProjects/msgcode/test/p5-7-r13-runtime-skill-sync.test.ts)
- [test/p5-7-r3n-system-prompt-file-ref.test.ts](/Users/admin/GitProjects/msgcode/test/p5-7-r3n-system-prompt-file-ref.test.ts)
