# P5.6.8-R4f：日志文本格式化去重（`inboundText/responseText`）

## 任务目标

消除 `file-transport.ts` 内 `inboundText/responseText` 的重复“转义 + 截断”逻辑，建立单一真相源，避免后续行为漂移。

## 已确认决策

- 决策 `1A`：helper 放在独立文件 `src/logger/format-text.ts`
- 决策 `2A`：helper 仅 logger 内部使用，不做对外 re-export
- 补充约束：禁止 `await import`，统一静态 import

## 实施范围

- `src/logger/format-text.ts`（新建）
- `src/logger/file-transport.ts`（替换两处重复逻辑为 helper 调用）
- `test/logger.format-text.test.ts`（新建）
- `src/logger/README.md`（同步模块职责）

## 非范围

- 不改日志字段名（`inboundText` / `responseText`）
- 不改开关语义（`MSGCODE_LOG_PLAINTEXT_INPUT`）
- 不改默认截断阈值（500）
- 不改其它模块日志格式

## 实施步骤

1. 新建纯函数 `formatLogTextField(value, maxChars = 500)`
   - 行为：`\\` / `"` / 换行转义，超长截断并追加 `…`
2. `file-transport.ts` 两处替换为统一 helper
3. 增加单测覆盖：
   - 转义正确性
   - 截断边界（=500、>500）
   - 空值/`null`/`undefined` 输入行为
4. 更新 `src/logger/README.md` 说明 helper 边界与调用点

## 验收标准（三门）

- `npx tsc --noEmit` ✅
- `npm test -- test/logger.file-transport.test.ts test/logger.format-text.test.ts` ✅
- `npm run docs:check` ✅

## 风险与回退

- 风险：极低（纯重构，零语义变更）
- 回退：若观测行为不一致，回滚 `format-text.ts` 接入提交，恢复原实现

## 交付物

- 迁移映射表（旧逻辑 -> helper）
- 三门验收日志
- 变更说明（确认零语义变更）
