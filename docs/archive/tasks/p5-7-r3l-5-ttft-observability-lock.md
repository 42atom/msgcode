# 任务单：P5.7-R3l-5（TTFT 补偿 + 可观测锁 + 测试坏味道治理）

优先级：P1

## 目标（冻结）

1. 进入 `plan/act` 时立即发送固定“处理中”短回执，改善 TTFT 体感。
2. 固化链路观测字段：
   - `traceId, route, phase, kernel, soulInjected`
3. 增加回归锁，防止后续重构丢字段。
4. 清理测试坏味道：将源码字符串匹配断言替换为行为断言，避免测试与实现细节强耦合。

## 范围

- `/Users/admin/GitProjects/msgcode/src/handlers.ts`
- `/Users/admin/GitProjects/msgcode/src/lmstudio.ts`
- `/Users/admin/GitProjects/msgcode/test/*p5-7-r3l-5*.test.ts`
- `/Users/admin/GitProjects/msgcode/test/p5-7-r3l-1-tool-protocol-hard-gate.test.ts`
- `/Users/admin/GitProjects/msgcode/test/p5-7-r3l-3-plan-act-report-pipeline.test.ts`
- `/Users/admin/GitProjects/msgcode/test/p5-7-r3l-4-action-journal-state-sync.test.ts`

## 非范围

1. 不做 UI 改版。
2. 不改 CLI 命令语义。
3. 不做架构再拆分（本单只做链路补偿、观测锁与测试重构）。

## 执行步骤（每步一提交）

1. `feat(p5.7-r3l-5): add immediate progress ack for plan/act phase`
2. `refactor(p5.7-r3l-5): replace source-string assertions with behavior assertions`
3. `test(p5.7-r3l-5): add observability field regression lock`

## 硬验收

1. `npx tsc --noEmit`
2. `npm test`（0 fail）
3. `npm run docs:check`
4. plan/act 阶段有短回执
5. 日志锚点字段完整
6. `R3l` 相关测试不再依赖源码字符串匹配（例如 `toContain('phase: \"act\"')`、`readFileSync(...src/lmstudio.ts)`）

## 断言口径（冻结）

1. 优先行为断言：
   - 调用真实函数，断言返回结构、字段完整性、顺序与失败保真。
2. 禁止实现细节断言：
   - 禁止通过读取源码字符串判断逻辑存在与否。
   - 禁止使用正则匹配源码文本替代运行时行为验证。
3. 允许的静态检查：
   - 仅允许检查测试规范本身（如 `.only/.skip`），不检查业务实现源码片段。
