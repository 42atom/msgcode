# test-suite-modernization-after-core-refactor

## Problem

主代码已经完成一轮较大收口，但测试仍残留一批“源码字符串锁”。这类测试把 `handlers.ts`、`context-policy.ts`、`tool-loop.ts`、`workspace.ts`、`lmstudio.ts` 的写法直接写死，代码只要重构但行为不变，测试就会先漂，反过来诱导开发者去回退已收口好的主链。

Issue: 0092

## Occam Check

1. 不加这次收口，系统具体坏在哪？
   - 测试会继续把“实现换形不变义”误报成失败，发布门槛再次失真，开发者无法分辨真 bug 和旧锁漂移。
2. 用更少的层能不能解决？
   - 能。直接改测试去锁导出合同、运行时行为和持久化结果，不加新测试平台、不加兼容层。
3. 这个改动让主链数量变多了还是变少了？
   - 变少了。测试、代码和文档重新指向同一份运行时真相源。

## Decision

采用“分层清伪锁”的最小方案：

1. 保留真正有价值的硬切断言
   - 例如退役文件不存在、旧旁路不再导出、兼容壳不再转发旧入口
2. 替换高漂移源码字符串锁
   - 改为验证导出常量、导出函数、行为结果、持久化副作用、CLI/contract 输出
3. 分四批清理高漂移区
   - 第一批：`context-policy / fs_scope / hard-cut`
   - 第二批：`handlers / system prompt / scheduler / summary injection`
   - 第三批：`default model / alias guard / local model retry / routed-chat / tool-loop quota`
   - 第四批：`listener / codex policy / feishu message handler context`
4. 不一次性清空全部静态锁
   - 先拿最容易误导开发者的那批，后续分批推进

## Alternatives

### 方案 A：继续保留当前静态锁

- 缺点：代码每次收口都得同步改一堆字符串测试，测试变成实现注释，不是行为保护。

### 方案 B：一次性把所有静态锁全部删掉

- 缺点：会误删掉真正重要的硬切断言，回归保护反而变弱。

### 方案 C：分层保留有价值断言，迁走高漂移伪锁（推荐）

- 优点：测试噪音下降，同时不丢失对退役路径和外部合同的保护。

## Plan

1. 建立专项真相源
   - `issues/0092-test-suite-modernization-after-core-refactor.md`
   - `docs/design/plan-260312-test-suite-modernization-after-core-refactor.md`
2. 第一批：改造 `context-policy` 相关测试
   - `test/p5-7-r9-t2-context-budget-compact.test.ts`
   - `test/p5-7-r9-t3-memory-persistence-clear-boundary.test.ts`
   - `test/p6-agent-run-core-phase3-context-policy.test.ts`
   - 验收：改用导出常量、`assembleAgentContext()` 行为、持久化结果与 helper 输出
3. 第一批：改造 `fs_scope` 与 `hard-cut`
   - `test/p5-7-r3i-fs-scope-policy.test.ts`
   - `test/p5-6-8-r3e-hard-cut.test.ts`
   - 验收：`fs_scope` 锁行为结果；`hard-cut` 仅保留退役旁路与运行时暴露边界
4. 第二批：改造 `handlers / system prompt / scheduler / summary injection`
   - `test/p5-6-8-r4b-window-summary-injection.test.ts`
   - `test/p5-6-7-r6-smoke-static.test.ts`
   - `test/p5-6-2-r1-regression.test.ts`
   - `test/p5-7-r3n-system-prompt-file-ref.test.ts`
   - `test/p5-7-r17-scheduler-pointer-only.test.ts`
   - 验收：不再锁 `handlers/context-policy/tool-loop` 源码字面量，改锁真实上下文注入、reload 输出、prompt 文件解析与 manifest 合同
5. 第三批：改造 `default model / alias guard / local model retry / routed-chat / tool-loop quota`
   - `test/p5-7-r6b-default-model-preference.test.ts`
   - `test/p5-7-r26-local-model-load-retry.test.ts`
   - `test/p5-7-r3e-model-alias-guard.test.ts`
   - `test/p5-7-r20-llm-unshackle-phase2.test.ts`
   - `test/p5-7-r21-routed-chat-unshackle-phase3.test.ts`
   - 验收：默认模型、别名归一化、load/retry、no-tool 决策、quota 不再依赖源码字符串
6. 跑 targeted suites 与全量回归
   - `PATH="$HOME/.bun/bin:$PATH" bun test <targeted suites>`
   - `PATH="$HOME/.bun/bin:$PATH" bun test`
7. 第四批：改造 `listener / codex policy / feishu message handler context`
   - `test/p5-6-13-r4-listener-trigger.test.ts`
   - `test/p5-7-r9-t5-codex-policy-dedup.test.ts`
   - `test/p6-feishu-message-context-phase1.test.ts`
   - `test/p6-feishu-message-context-phase2.test.ts`
   - 验收：真实临时 workspace + 真实 handler/router + 最少 mock；Node+tsx 隔离 listener 黑盒；通过 env/Context 控分支，不拦截基础层函数
8. 记录剩余下一批入口
   - 重点关注 `listener / transport / feishu context / direct log / tool result clip` 等仍锁源码写法的测试

## Risks

1. 某些静态锁其实在保护关键合同，清理时可能误删保护。
   - 回滚/降级：优先把断言迁成运行时/导出合同，不直接删除；如发现保护价值，保留但收紧边界。
2. `context-policy` 行为测试容易被能力探测或本地环境拖慢。
   - 回滚/降级：统一通过 env override 固定预算与能力，避免无关网络依赖。
3. `hard-cut` 类测试如果全改成行为测试，可能失去对退役文件回流的早期拦截。
   - 回滚/降级：文件不存在、兼容入口不存在这类断言继续保留。

## Test Plan

1. `PATH="$HOME/.bun/bin:$PATH" bun test test/p5-7-r9-t2-context-budget-compact.test.ts test/p5-7-r9-t3-memory-persistence-clear-boundary.test.ts test/p6-agent-run-core-phase3-context-policy.test.ts test/p5-7-r3i-fs-scope-policy.test.ts test/p5-6-8-r3e-hard-cut.test.ts`
2. 若首批通过，再视情况扩跑相关主链测试：
   - `test/p5-7-r9-t7-step4-compatibility-lock.test.ts`
   - `test/tools.bus.test.ts`
   - `test/routes.commands.test.ts`

## Observability

- 在 issue Notes 中记录：
  - 三批改造文件
  - targeted suites 与全量结果
  - 剩余高漂移静态锁清单

## Progress

已完成：

1. 第一批：
   - `test/p5-7-r9-t2-context-budget-compact.test.ts`
   - `test/p5-7-r9-t3-memory-persistence-clear-boundary.test.ts`
   - `test/p6-agent-run-core-phase3-context-policy.test.ts`
   - `test/p5-7-r3i-fs-scope-policy.test.ts`
   - `test/p5-6-8-r3e-hard-cut.test.ts`
2. 第二批：
   - `test/p5-6-8-r4b-window-summary-injection.test.ts`
   - `test/p5-6-7-r6-smoke-static.test.ts`
   - `test/p5-6-2-r1-regression.test.ts`
   - `test/p5-7-r3n-system-prompt-file-ref.test.ts`
   - `test/p5-7-r17-scheduler-pointer-only.test.ts`
3. 第三批：
   - `test/p5-7-r6b-default-model-preference.test.ts`
   - `test/p5-7-r26-local-model-load-retry.test.ts`
   - `test/p5-7-r3e-model-alias-guard.test.ts`
   - `test/p5-7-r20-llm-unshackle-phase2.test.ts`
   - `test/p5-7-r21-routed-chat-unshackle-phase3.test.ts`
4. 第四批：
   - `test/p5-6-13-r4-listener-trigger.test.ts`
   - `test/p5-7-r9-t5-codex-policy-dedup.test.ts`
   - `test/p6-feishu-message-context-phase1.test.ts`
   - `test/p6-feishu-message-context-phase2.test.ts`

当前结果：

- 静态锁文件数：`60 -> 58 -> 54 -> 50`
- 关键 targeted：
  - 第一批+第二批：`52 pass / 0 fail`
  - 第三批：`17 pass / 0 fail`
  - 第四批+相邻主链：`51 pass / 0 fail`
- 全量回归：
  - `PATH="$HOME/.bun/bin:$PATH" bun test` -> `1500 pass / 0 fail`

（章节级）评审意见：[留空,用户将给出反馈]
