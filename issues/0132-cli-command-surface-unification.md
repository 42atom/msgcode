---
id: 0132
title: 二进制命令面统一化与消费口径冻结
status: done
owner: agent
labels: [architecture, cli, docs, refactor]
risk: medium
scope: CLI 二进制命令面、help-docs 合同、skill 消费口径
plan_doc: docs/design/plan-260312-cli-command-surface-unification.md
links: []
---

## Context

当前 `msgcode` 二进制命令面已经有统一骨架，但还没有完全统一成单一语言：

- `help-docs` 已成为机器可读合同出口，但部分可执行命令仍保留历史 alias 与退役壳
- `memory`、`browser`、`file` 等 domain 的动词体系不一致
- LLM 侧既能通过原生工具与 CLI 工作，也依赖 `SKILL.md`，但“谁是真合同、谁是说明书”还没有正式冻结

如果不先冻结这层协议，后续实现很容易继续出现：

- 可执行面和公开合同分叉
- skill 文案和真实命令漂移
- LLM 既不知道该优先查 `help_docs`，也不知道哪些命令只是 alias/legacy

## Goal / Non-Goals

- Goal: 冻结 CLI 命令面的统一化方向与消费口径
- Goal: 明确“程序是真合同，skill 是说明书”
- Goal: 给后续命令统一化提供阶段性收口计划
- Non-Goals: 本轮不直接大规模重写所有 CLI 子命令
- Non-Goals: 本轮不新增新的命令总线、控制层或运行时协议层

## Plan

- [x] 冻结命令消费口径：二进制程序与 `help-docs` 为正式合同，`SKILL.md` 为使用说明
- [x] 审计现有命令面，区分 canonical / alias / retired / internal
- [x] 设计统一语法目标：`msgcode <domain> <verb>`
- [x] 规划分阶段收口：优先 `memory`、`browser`、历史 retired 命令
- [x] 规划回归锁：`help-docs`、真实可执行面、LLM 探索路径三者一致

## Acceptance Criteria

1. 计划文档明确回答“通过程序消费还是通过 skill.md 消费”的决策
2. 计划文档明确给出 canonical / alias / retired / internal 四类命令分类方法
3. 计划文档明确给出至少两阶段的 CLI 统一化收口顺序

## Notes

- 关键证据：
  - `src/cli/help.ts`
  - `src/cli/file.ts`
  - `src/cli/memory.ts`
  - `src/cli/browser.ts`
  - `src/routes/cmd-model.ts`
- 参考资料：
  - `docs/design/plan-260312-cli-is-all-agents-need-reference.md`
- 2026-03-12:
  - 已冻结消费口径：程序/`help-docs` 为正式合同，`SKILL.md` 为说明书
  - 已完成第一刀收口：`memory` 命令面只公开 `add/search/index/get/stats`
  - 兼容别名 `remember/status` 不再出现在 `memory --help`，但会在 CLI 解析前映射到 canonical 主链
  - `help-docs` 合同现显式暴露 `aliases`
  - 已完成第二刀收口：`browser gmail-readonly` 已退出公开命令面与 `help-docs` 正式合同，保留为 CLI 解析期兼容入口
  - 已完成第三刀收口：`gen-image/gen-audio` 已退出根级公开命令面，公开入口统一回 `gen`；`jobs`/`skills` 根级兼容别名也已统一在 CLI 解析期映射到 canonical 主链
  - 已补齐命令面审计结论：
    - root operator/admin canonical：`start/stop/restart/allstop/init/status/probe/doctor/about`
    - agent-facing canonical：`file/web/system/memory/thread/todo/schedule/media/gen/browser/help-docs`
    - canonical but operator/internal-facing：`job/preflight/run`
    - alias：`jobs`、`skills`、`memory remember/status`、`browser gmail-readonly`
    - retired：`file send`
    - internal compat：`skill`、`browser-gmail-readonly`、`gen-image`、`gen-audio`
  - 已写准 `help-docs` 边界：
    - 它是 agent-facing 操作命令真相源
    - root lifecycle/admin 继续由 `msgcode --help` 暴露
  - 验证：
    - `PATH="$HOME/.bun/bin:$PATH" bun test test/p5-7-r4-1-memory-contract.test.ts test/p5-7-r4-t1-smoke-verification.test.ts`
    - `PATH="$HOME/.bun/bin:$PATH" bun test test/p5-7-r7a-browser-contract.test.ts test/p5-7-r1c-hard-gate.test.ts test/p5-7-r1-file-send.test.ts`
    - `PATH="$HOME/.bun/bin:$PATH" bun test test/p5-7-r6-hotfix-gen-entry-tools-default.test.ts test/p5-7-r6-2-gen-image-contract.test.ts test/p5-7-r6-3-gen-audio-contract.test.ts`
    - `node --import tsx src/cli.ts --help`
    - `node --import tsx src/cli.ts help-docs --json`
    - `npx tsc --noEmit`
    - `npm run docs:check`

## Links

- Plan: /Users/admin/GitProjects/msgcode/docs/design/plan-260312-cli-command-surface-unification.md
- Reference: /Users/admin/GitProjects/msgcode/docs/design/plan-260312-cli-is-all-agents-need-reference.md
- Follow-up: /Users/admin/GitProjects/msgcode/issues/0133-help-docs-memory-canonical-coverage.md
