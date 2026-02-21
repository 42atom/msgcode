# 任务单：P5.7-R3l-5（TTFT 补偿 + 可观测锁）

优先级：P1

## 目标（冻结）

1. 进入 `plan/act` 时立即发送固定“处理中”短回执，改善 TTFT 体感。
2. 固化链路观测字段：
   - `traceId, route, phase, kernel, soulInjected`
3. 增加回归锁，防止后续重构丢字段。

## 范围

- `/Users/admin/GitProjects/msgcode/src/handlers.ts`
- `/Users/admin/GitProjects/msgcode/src/lmstudio.ts`
- `/Users/admin/GitProjects/msgcode/test/*p5-7-r3l-5*.test.ts`

## 非范围

1. 不做 UI 改版。
2. 不改 CLI 命令语义。

## 执行步骤（每步一提交）

1. `feat(p5.7-r3l-5): add immediate progress ack for plan/act phase`
2. `test(p5.7-r3l-5): add observability field regression lock`

## 硬验收

1. `npx tsc --noEmit`
2. `npm test`（0 fail）
3. `npm run docs:check`
4. plan/act 阶段有短回执
5. 日志锚点字段完整
