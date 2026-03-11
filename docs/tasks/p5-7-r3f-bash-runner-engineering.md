# 任务单：P5.7-R3f（Bash Runner 工程化）

优先级：P0（工具链稳定性第一优先）

## 目标（冻结）

1. 将 `bash` 从 `Tool Bus` 内联实现抽离为独立 runner。
2. 支持可中断执行（abort/timeout 必须 kill process tree）。
3. 支持执行过程流式输出（partial update）。
4. 支持大输出尾部截断 + 完整输出落盘（full output path 可追踪）。

## 范围

- `src/tools/runners/bash-runner.ts`（新增）
- `src/tools/bus.ts`（bash 分支改接 runner）
- `test/*p5-7-r3f*.test.ts`（新增）

## 非范围

1. 不改 tool loop 多工具策略（该项在 R3g）。
2. 不改模型路由策略（该项在 R3j）。
3. 不改 read/write/edit 权限口径（该项在 R3i）。

## 实施步骤（每步一提交）

### R3f-1：Runner 基础实现

提交建议：`feat(p5.7-r3f): add bash runner with timeout and abort`

1. 新增 `bash-runner.ts`，提供 `runBashCommand()`。
2. 明确输入输出合同：`command/cwd/timeoutMs/signal/onUpdate`。
3. 实现 timeout + abort + 子进程树清理。

### R3f-2：输出治理

提交建议：`feat(p5.7-r3f): add bash output truncation and full log path`

1. 增加 tail truncation（按行数/字节双阈值）。
2. 超阈值时落临时文件并返回 `fullOutputPath`。
3. partial update 只返回截断窗口，避免内存膨胀。

### R3f-3：Tool Bus 接线

提交建议：`refactor(p5.7-r3f): wire tool bus bash to bash runner`

1. `bus.ts` 的 `case "bash"` 改为调用 runner。
2. 失败合同保持统一：`TOOL_TIMEOUT/TOOL_EXEC_FAILED`。
3. 结构化日志补齐：`exitCode/stdoutTail/stderrTail/fullOutputPath`。

### R3f-4：回归锁

提交建议：`test(p5.7-r3f): add bash runner regression lock`

1. 超时杀进程回归测试。
2. 大输出截断与落盘回归测试。
3. 中断后无悬挂进程测试。

## 硬验收

1. `npx tsc --noEmit`
2. `npm test`（0 fail）
3. `npm run docs:check`
4. 大输出场景可返回 `fullOutputPath`
5. 超时后无孤儿进程
6. 无新增 `.only/.skip`

## 验收回传模板

```md
# P5.7-R3f 验收报告

## 提交
- <sha> <message>

## Gate
- npx tsc --noEmit:
- npm test:
- npm run docs:check:

## 关键证据
- timeout kill process tree:
- truncation + fullOutputPath:
- no orphan process:
```
