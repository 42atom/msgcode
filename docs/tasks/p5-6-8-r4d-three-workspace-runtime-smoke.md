# P5.6.8-R4d：三工作区运行时冒烟验收

## 目标

在真实工作区完成 SOUL/记忆/PI on-off 的端到端验证，作为 R4 签收门。

## 工作区范围

- `/Users/admin/msgcode-workspaces/medicpass`
- `/Users/admin/msgcode-workspaces/charai`
- `/Users/admin/msgcode-workspaces/game01`

## 执行清单

每个工作区均执行：

1. `/bind`（确认路由与 workspace 生效）
2. `/reload`（确认 SOUL 路径与条目统计）
3. `pi off` 对话一轮（无 tools 暴露）
4. `pi on` 对话一轮（四工具暴露）
5. 触发长期记忆注入（关键词或 force）
6. `/clear`（仅清 window+summary，不清 memory）
7. 复测记忆可用性（memory 仍可命中）

## 证据要求

- 每一步保留日志片段：
  - toolCallCount/toolName
  - SOUL source/path
  - memory 注入字段
- 输出统一写入验收记录（可附在本文件末尾）

## 验收

- 三工作区全部通过
- `npx tsc --noEmit` ✅
- `npm test`（0 fail）✅
- `npm run docs:check` ✅

## 失败策略

- 任一工作区失败即不签收 R4
- 失败项回写为 R4x 插单并给出最小修复路径
