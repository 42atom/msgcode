---
id: 0164
title: run-events: record skill SKILL.md read_file path (audit only)
status: done
owner: agent
labels: [chore, observability]
risk: low
scope: agent-backend/tool-loop + runtime/run-events
plan_doc: ""
links: []
---

## Context
用户要求给出“LLM 是否真的读取了 skill 说明书”的证据。当前 `~/.config/msgcode/run-core/run-events.jsonl` 能证明发生过 `read_file`，但不记录 `args.path` 或最终解析后的真实路径，无法做到可审计的“读了哪个 SKILL.md”。

## Goal / Non-Goals
Goal
- 为 run events 增加最薄审计字段：当且仅当 `read_file` 成功读取 `~/.config/msgcode/skills/**/SKILL.md` 时，落盘 `run:tool.details.readFilePath=<absolute path>`。

Non-Goals
- 不记录任意 `read_file` 的读取路径（避免扩大隐私面与噪声）。
- 不记录文件内容，不改动 tool bus 行为，不新增拦截/gate。

## Plan
- [x] 在 tool-loop `actionJournal` 成功条目上记录 `readFilePath`（仅 skills/**/SKILL.md）。
- [x] 在 run-events `run:tool.details` 透传 `readFilePath`（可选字段）。
- [x] 增加回归测试锁定该字段存在且不会污染其他工具事件。

## Acceptance Criteria
- `run:tool`（toolName=read_file）可选附带 `details.readFilePath`，且只在 skills/**/SKILL.md 场景出现。
- 不记录 skill 内容，不记录任意非 skills 路径。
- `npx tsc --noEmit` 与相关测试通过。

## Notes
- 实现采用 fail-closed：路径不满足 `~/.config/msgcode/skills/**/SKILL.md` 直接不记录。

## Links
N/A

