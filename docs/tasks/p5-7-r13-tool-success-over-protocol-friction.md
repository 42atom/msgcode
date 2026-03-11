# 任务单：工具调用成功率优先于协议摩擦

## 回链

- Issue: [0017](../../issues/0017-tool-success-over-protocol-friction.md)
- Plan: docs/design/plan-260307-tool-success-over-protocol-friction.md

## 目标

1. 统一 `edit_file` 的说明书与执行合同
2. 允许 `edit_file/write_file/browser` 的显式工具偏好退回 `bash`
3. 用测试锁住“成功率优先”的新口径

## 范围

1. `src/tools/manifest.ts`
2. `src/tools/bus.ts`
3. `src/agent-backend/tool-loop.ts`
4. 相关回归测试

## 非范围

1. 不删除 `edit_file`
2. 不重做全部工具协议
3. 不新增 fake recover

## 验收

1. `edit_file` 同时支持 `edits[]` 与 `oldText/newText`
2. 显式工具偏好失败时可改走 `bash`
3. 回归测试通过
