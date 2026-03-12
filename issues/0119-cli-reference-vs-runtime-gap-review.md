---
id: 0119
title: CLI 单工具参考与当前 runtime 主链差距审计
status: done
owner: agent
labels: [docs, refactor]
risk: medium
scope: tool-loop、Tool Bus、bash runner、tool manifest、CLI help 的设计对照与收口方向
plan_doc: docs/design/plan-260312-cli-reference-vs-runtime-gap-review.md
links: [docs/design/plan-260312-cli-is-all-agents-need-reference.md, docs/notes/research-260312-cli-reference-vs-msgcode.md]
---

## Context

用户要求把外部参考文档《CLI is All Agents Need》迁入项目 plan，并对照当前 `msgcode` 实现找出设计不足。该参考强调：

- 单一 `run(command)` 工具面
- 渐进式 help 自发现
- 错误消息直接引导下一步
- 严格区分 Unix 执行层与 LLM 呈现层
- 预算/安全边界尽量退出主链热路径

当前仓库已经在“做薄、少加层、服务 LLM”的方向上前进，但仍存在若干与该参考不完全对齐的设计点，需要结构化记录，避免后续继续靠局部补丁推进。

## Goal / Non-Goals

### Goal

- 将参考文档迁入仓库正式文档目录
- 基于真实代码主链完成一次 evidence-first 对照审计
- 输出按优先级排序的设计不足清单，并给出最小收口方向

### Non-Goals

- 本轮不直接改运行时代码
- 本轮不教条式照搬“只能保留一个工具”
- 本轮不把所有发现立即扩成大重构

## Plan

- [x] 将参考文档迁入 `docs/design/`
- [x] 审计 `tool-loop -> executeTool -> runner -> tool_result` 主链
- [x] 审计工具发现/帮助链路与当前 tool manifest 注入口径
- [x] 输出研究记录与正式 plan
- [x] 由用户决定第一批要收口的缺口
- [x] 第一批收口项按新 issue 落地：`read_file + 输出层分层`（Issue 0120）

## Acceptance Criteria

- 参考文档已进入仓库正式文档目录
- 至少一份正式 plan 文档说明问题、权衡与建议方向
- 至少一份 research 文档给出代码级证据
- 结论能明确指出“哪些点已对齐、哪些点仍不足”

## Notes

- 参考文档迁入路径：
  - `docs/design/plan-260312-cli-is-all-agents-need-reference.md`
- 重点审计文件：
  - `src/agent-backend/tool-loop.ts`
  - `src/tools/bus.ts`
  - `src/runners/bash-runner.ts`
  - `src/tools/manifest.ts`
  - `src/runtime/context-policy.ts`
  - `src/cli/help.ts`
- 主要证据方式：
  - `nl -ba` 定位源码
  - `rg` 检索设计关键词与现有计划
- 用户已选第一批收口项：
  - `read_file` 合同增强
  - `bash/read_file` 预览分层
- 已落地到：
  - `issues/0120-read-file-contract-and-preview-layering.md`
  - `docs/design/plan-260312-read-file-contract-and-preview-layering.md`

## Links

- [参考文档](/Users/admin/GitProjects/msgcode/docs/design/plan-260312-cli-is-all-agents-need-reference.md)
- [正式 Plan](/Users/admin/GitProjects/msgcode/docs/design/plan-260312-cli-reference-vs-runtime-gap-review.md)
- [研究记录](/Users/admin/GitProjects/msgcode/docs/notes/research-260312-cli-reference-vs-msgcode.md)
- [第一批实现 Issue](/Users/admin/GitProjects/msgcode/issues/0120-read-file-contract-and-preview-layering.md)
