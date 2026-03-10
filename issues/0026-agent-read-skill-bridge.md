---
id: 0026
title: Agent 读 Skill 桥断裂 - 自然语言无法真实执行 read_file
status: done
owner: agent
labels: [feature, agent, skill, bug]
risk: high
scope: src/agent-backend/tool-loop.ts, src/agent-backend/routed-chat.ts
plan_doc: docs/design/plan-260308-agent-read-skill-bridge.md
links:
  - docs/tasks/p5-7-r15-agent-read-skill-bridge.md
  - /Users/admin/GitProjects/msgcode/issues/0022-scheduler-skill-bash-mainline.md
  - /Users/admin/GitProjects/msgcode/issues/0024-skill-single-source-runtime.md
  - /Users/admin/GitProjects/msgcode/issues/0027-llm-skill-directory-open-loop.md
created: 2026-03-08
due:
---

## Context

- Issue 0022/0024 完成了 scheduler skill 单真相源收口
- 当前遗留问题：自然语言 agent-first 轮次无法真实执行 `read_file` 读取 runtime skill
- 用户看到的是伪 `[TOOL_CALL] read_file ...` 文本，不是真实工具执行

## Goal / Non-Goals

### Goals
- 查清为什么自然语言 skill 场景下 `read_file` 没有真实执行
- 修成：模型能真实调用 `read_file` 读取 runtime skill
- 用 scheduler skill 做最小回归验证

### Non-Goals
- 不扩到 bash
- 不重构整个 agent-first
- 不新增 cron_add/schedule_add 等 fake tool
- 不加 parser 解释 [TOOL_CALL] 文本
- 不碰 prompt 分层

## Plan

- [x] 创建 issue + plan
- [x] 拿证据（代码根因）
- [x] 修 read_file 桥
- [x] 补测试
- [x] 真机链路后续转入 Issue 0027 继续验证
- [x] 提交

## Evidence

### 日志证据 (2026-03-07 17:20:58)
```
2026-03-07 17:20:58.646 [INFO ] [agent-backend] agent-first chat fallback: no tools exposed
2026-03-07 17:20:58.350 [INFO ] [listener] routeFound=true, projectDir=/Users/admin/msgcode-workspaces/smoke/ws-a
```

### 根因分析
1. `routed-chat.ts:71-73`:
   ```typescript
   const toolsAvailable = options.hasToolsAvailable ?? (
       !!workspacePath && (await getToolsForLlm(workspacePath)).length > 0
   );
   ```
2. `getToolsForLlm()` 要求 `pi.enabled: true` 才返回非空
3. workspace `smoke/ws-a` 没有 `pi.enabled`，所以 `toolsAvailable = false`
4. 落到 `no-tool` 路由，纯 chat 模型无法执行工具

### 断裂点
- `getToolsForLlm()` 的 `pi.enabled` 检查太严格
- skill 场景应该允许默认读文件能力

## Notes

### 已知坑
1. 不要把问题扩成"整个 agent-first 都重做"
2. 先只修 read_file，不碰 bash
3. 不要用 prompt 掩盖 runtime 根因

### 修复结果
1. `getToolsForLlm()` 在 skill 场景不再因为 `pi.enabled` 缺失而返回空工具集
2. 最小桥接验证已由回归锁覆盖：`test/p5-7-r15-agent-read-skill-bridge.test.ts`
3. 后续“读完 skill 后继续 bash / browser / mem”的开放循环验证，已由 Issue 0027 继续承接

### 2026-03-09 关单同步
1. 本单目标是修 `read_file` 桥，而不是完成整个 skill open-loop
2. 当前根因、修复、测试、后续承接都已明确，状态从 `doing` 同步为 `done`

## Links

- Plan: `docs/design/plan-260308-agent-read-skill-bridge.md`
- Task: `docs/tasks/p5-7-r15-agent-read-skill-bridge.md`
