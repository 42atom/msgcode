---
id: 0027
title: LLM Skill 目录开放循环 - 禁止中途阻断 LLM 合理后续动作
status: doing
owner: agent
labels: [feature, agent, skill, bug]
risk: high
scope: src/agent-backend/tool-loop.ts, src/agent-backend/routed-chat.ts, src/tools/bus.ts
plan_doc: docs/design/plan-260308-llm-skill-directory-open-loop.md
links:
  - /Users/admin/GitProjects/msgcode/issues/0026-agent-read-skill-bridge.md
created: 2026-03-08
due:
---

## Context

- Issue 0026 修复了 `read_file` 工具暴露问题
- 当前状态：`Tool Bus: SUCCESS read_file` 成功
- 随后失败：`未暴露工具：bash` + `错误码：MODEL_PROTOCOL_FAILED`

这说明：
- LLM 已经能自行判断去读 skill（进步）
- 但框架仍在中途阻止它继续做事（退步）

## Goal / Non-Goals

### Goals
- 明确告诉 LLM runtime skills 目录与必要环境路径
- 开放完成任务所需的底层工具面
- 去掉会中途阻断 LLM 的约束
- 验证 LLM 能自行读取 skill 后继续执行

### Non-Goals
- 不替 LLM 设计"skill 场景"专门流程
- 不新增 cron_add/schedule_add 等 fake tool
- 不新增 parser 层解释模型输出
- 不重构整个 agent-first 架构
- 不做 prompt 分层实验
- 不顺手改 browser/memory/thread/event-queue

## Plan

- [ ] 创建 issue + plan
- [ ] 查清哪些地方在阻止 LLM 继续
- [ ] 收正式口径：向 LLM 注入 skills 目录与环境路径
- [ ] 收底层工具面：开放必要工具
- [ ] 收中途阻断：去掉不合理拦截
- [ ] 测试
- [ ] 真机 smoke

## Evidence

### 旧失败（0026 修复前）
```
agent-first chat fallback: no tools exposed
route=no-tool
模型只吐伪 [TOOL_CALL] read_file ...
```

### 当前状态（0026 修复后）
```
Tool Bus: SUCCESS read_file
随后失败：
  未暴露工具：bash
  错误码：MODEL_PROTOCOL_FAILED
```

### 根因分析
1. LLM 读取 skill 后想继续执行 `bash` 工具
2. 框架检查工具列表，发现 `bash` 未暴露
3. 返回 `MODEL_PROTOCOL_FAILED`，阻断 LLM 合理动作

## Notes

### 已知坑
1. 不要把"支持 LLM"重新做成另一套隐式编排器
2. 不要为 scheduler/browser 单独写特判流程
3. 不要用 prompt 文案掩盖 runtime 阻断
4. 重点是开放和支持，不是继续精细化限制
