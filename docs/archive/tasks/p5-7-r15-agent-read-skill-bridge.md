# 任务单：Agent 读 Skill 桥断裂修复

## 回链

- Issue: [0026](../../issues/0026-agent-read-skill-bridge.md)
- Plan: docs/plan/pl0026.dne.agent.agent-read-skill-bridge.md

## 目标

1. 修复自然语言 agent-first 场景无法真实执行 `read_file`
2. 让 runtime skill 场景至少暴露 `read_file + bash` 等必要工具
3. 用 scheduler skill 相关回归锁验证桥接恢复

## 范围

1. `src/agent-backend/tool-loop.ts`
2. `src/agent-backend/routed-chat.ts`
3. 相关回归测试

## 非范围

1. 不新增 fake tool
2. 不重构整个 agent-first
3. 不做 prompt 分层实验

## 验收

1. skill 场景能真实获得 `read_file`
2. 不再只输出伪 `[TOOL_CALL] read_file ...`
3. 回归测试通过
