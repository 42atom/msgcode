---
id: 0026
title: Agent 读 Skill 桥断裂 - 自然语言无法真实执行 read_file
status: open
owner: agent
labels: [feature, agent, skill, bug]
risk: high
scope: src/agent-backend/tool-loop.ts, src/agent-backend/routed-chat.ts
plan_doc: docs/design/plan-260308-agent-read-skill-bridge.md
links:
  - /Users/admin/GitProjects/msgcode/issues/0022-scheduler-skill-bash-mainline.md
  - /Users/admin/GitProjects/msgcode/issues/0024-skill-single-source-runtime.md
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

- [ ] 创建 issue + plan
- [ ] 拿证据（代码根因）
- [ ] 修 read_file 桥
- [ ] 补测试
- [ ] 真机 smoke
- [ ] 提交

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
