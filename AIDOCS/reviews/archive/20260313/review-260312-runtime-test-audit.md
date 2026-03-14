# msgcode 运行时与测试整体审计

日期：2026-03-12

## 结论

本次审计没有看到典型的“多锁互等”式死锁，但看到了更现实的风险：

- 有 1 个高优先级会话挂死点，会表现为请求长时间超时、后续请求被误判为 busy。
- 有 2 个会导致状态串写或容量失控的并发/状态边界问题。
- 有 1 个长期运行下的内存滞留点。
- 当前测试体系不能证明“函数覆盖率 98%-100%”，也没有把最危险的真实故障路径纳入门禁。

## Findings

### P1. DesktopSessionPool 在子进程异常退出时不会立即拒绝挂起请求，会把 workspace 会话卡成假忙

证据：

- `SessionState` 同时维护了 `pendingRequests` 和 `responseResolvers`，但真正请求路径只注册了 `responseResolvers`。[Code: `src/tools/bus.ts` `SessionState`](/Users/admin/GitProjects/msgcode/src/tools/bus.ts#L1324)
- `close` / `error` 事件只遍历 `pendingRequests` 做 reject，没有清空或拒绝 `responseResolvers`。[Code: `src/tools/bus.ts` `proc.on("close")`](/Users/admin/GitProjects/msgcode/src/tools/bus.ts#L1430) [Code: `src/tools/bus.ts` `proc.on("error")`](/Users/admin/GitProjects/msgcode/src/tools/bus.ts#L1442)
- `sendRequest()` 把 `isProcessing` 设为 `true` 后，只有 `promise` 结束才会在 `finally` 里复位。[Code: `src/tools/bus.ts` `sendRequest`](/Users/admin/GitProjects/msgcode/src/tools/bus.ts#L1464) [Code: `src/tools/bus.ts` `finally`](/Users/admin/GitProjects/msgcode/src/tools/bus.ts#L1516)

影响：

- 子进程如果在响应前崩溃，请求不会立即失败，而是要等超时。
- 超时前 `session.isProcessing` 一直保持为 `true`，同一 workspace 的后续请求会命中 `Session busy`。
- `responseResolvers` 中的项要等 timeout 才会清理，属于“短期可累积”的滞留。

结论：

- 这不是传统锁死锁，但在用户侧表现会非常像“卡死”。

缺失测试：

- 代码库中没有针对 `DesktopSessionPool` 的单元测试，也没有覆盖“请求进行中时 session close/error”的测试门禁。
- `package.json` 虽然有 `desktop:smoke`，但它不在 `test:all` 主门禁里。[Code: `package.json` scripts](/Users/admin/GitProjects/msgcode/package.json#L9)

### P1. thread-store 仅以 chatId 做缓存 key，同一 chat 重新绑定 workspace 时可能继续写旧目录

证据：

- 进程级缓存 `threadCache` 只按 `chatId` 建索引。[Code: `src/runtime/thread-store.ts` `threadCache`](/Users/admin/GitProjects/msgcode/src/runtime/thread-store.ts#L43)
- `ensureThread()` 一旦命中缓存，直接返回旧 `ThreadInfo`，完全不校验新的 `workspacePath`。[Code: `src/runtime/thread-store.ts` `ensureThread`](/Users/admin/GitProjects/msgcode/src/runtime/thread-store.ts#L172)

影响：

- 如果同一个 chat 后续路由到了新 workspace，线程文件仍可能落到旧 workspace。
- 这是状态串写问题，会让“目录即边界”的假设失真。

现有测试缺口：

- 现有用例只测了“不同 chat 写入不同 workspace”。[Code: `test/p5-6-13-r2-thread-store.test.ts`](/Users/admin/GitProjects/msgcode/test/p5-6-13-r2-thread-store.test.ts#L240)
- 没有测“同一个 chat 切换 workspace 后必须新建线程或拒绝复用旧缓存”。

### P2. maxConcurrentTasks 只是配置项，没有真正参与调度限制

证据：

- `TaskSupervisor` 接收并保存了 `maxConcurrentTasks` 配置。[Code: `src/runtime/task-supervisor.ts` constructor](/Users/admin/GitProjects/msgcode/src/runtime/task-supervisor.ts#L49)
- `onHeartbeatTick()` 取出所有 runnable tasks 后直接顺序执行，没有任何并发额度判断或 admission gate。[Code: `src/runtime/task-supervisor.ts` `onHeartbeatTick`](/Users/admin/GitProjects/msgcode/src/runtime/task-supervisor.ts#L338)

影响：

- 用户和代码注释容易以为存在“总并发上限”，但当前没有。
- 任务多起来时，只能依赖外层 per-chat 串行，不能阻止跨 chat 的重任务堆积。

测试缺口：

- 未发现针对 `maxConcurrentTasks` 的行为测试。

### P2. ModelServiceLeaseManager 释放后不会回收 states map，长期运行会积累冷服务元数据

证据：

- 管理器用 `Map<string, ModelServiceLeaseState>` 保存全部服务状态。[Code: `src/runtime/model-service-lease.ts` `states`](/Users/admin/GitProjects/msgcode/src/runtime/model-service-lease.ts#L68)
- `releaseState()` 只更新 `released` 和日志，不会删除已释放且无 in-flight 的 state。[Code: `src/runtime/model-service-lease.ts` `releaseState`](/Users/admin/GitProjects/msgcode/src/runtime/model-service-lease.ts#L206)

影响：

- 对固定少量服务问题不大。
- 对长期运行且服务名高基数的场景，内存会单调增长，属于冷状态滞留。

现有测试现状：

- 现有测试验证了 TTL 和 in-flight 语义，但没有验证状态淘汰或高基数服务场景。[Code: `test/p5-7-r12-t7-model-service-idle-release.test.ts`](/Users/admin/GitProjects/msgcode/test/p5-7-r12-t7-model-service-idle-release.test.ts#L29)

### P2. 当前测试体系不能证明函数覆盖率 98%-100%，也没有把 coverage 作为门禁

证据：

- `test` 只运行 `bun test`，`test:all` 只是在其后追加 `bdd` 和 `docs:check`，没有 `coverage`、`c8`、`nyc`、阈值配置或失败门槛。[Code: `package.json` scripts](/Users/admin/GitProjects/msgcode/package.json#L9)
- 仓库当前约有 `150` 个 `*.test.ts` 文件、约 `1636` 个 `describe/it` 块，但数量不能等价为函数覆盖率证明。

影响：

- 现在最多只能说“测试很多”，不能说“函数覆盖 98%-100% 已被制度化保证”。
- 任何关于高覆盖率的结论，当前都缺 CI 级证据。

### P2. mock 现实性不够，危险路径集中缺失在“子进程生命周期 / 资源压力 / 部分失败”这三类

证据：

- `model-service-lease` 的网络测试主要是 `globalThis.fetch` 级别桩，验证的是分支选择，不是现实网络行为，例如超时、半开连接、慢响应、body 异常和重复释放冲突。[Code: `test/p5-7-r12-t7-model-service-idle-release.test.ts`](/Users/admin/GitProjects/msgcode/test/p5-7-r12-t7-model-service-idle-release.test.ts#L100)
- 线程存储测试使用真实临时目录，文件系统层面相对真实，这是优点。[Code: `test/p5-6-13-r2-thread-store.test.ts`](/Users/admin/GitProjects/msgcode/test/p5-6-13-r2-thread-store.test.ts#L22)
- 但没有看到针对 `DesktopSessionPool` 的真实子进程故障模拟：未覆盖 partial stdout、close-before-response、stdin backpressure、idle kill 与 in-flight request 竞争。

影响：

- 当前 mock 更像“验证 happy path 与静态分支”，而不是“模拟真实生产故障”。
- 最危险的运行时模块，恰好缺最真实的测试。

## 并发与死锁判断

结论：

- 没发现典型互斥锁死锁。
- 主要风险是“会话级卡死 / 饥饿 / 假忙”而不是经典死锁。

原因：

- 代码主链多采用单线程事件循环 + per-chat queue 串行化。[Code: `src/commands.ts` `enqueueLane`](/Users/admin/GitProjects/msgcode/src/commands.ts#L603) [Code: `src/commands.ts` `handleInbound`](/Users/admin/GitProjects/msgcode/src/commands.ts#L718)
- 没看到多把锁交叉等待。
- 真正危险的是 Promise 没有在进程退出时被及时收敛，导致上层 lane 被长超时拖住。

## 建议补测清单

### 运行时高优先级补测

1. `DesktopSessionPool`：
   - 请求发出后子进程立即 `close`
   - 请求发出后子进程触发 `error`
   - `stdout` 返回半行 JSON，再进程退出
   - `stdin.write()` 返回 `false` 后，是否留下悬挂 resolver

2. `thread-store`：
   - 同一 `chatId` 先绑定 `workspaceA`，再绑定 `workspaceB`
   - 期望：明确拒绝复用，或显式迁移，或新建线程

3. `TaskSupervisor`：
   - 构造 3 个 runnable tasks，设置 `maxConcurrentTasks=1/2`
   - 期望：调度行为与配置一致，而不是“配置存在但无效果”

4. `ModelServiceLeaseManager`：
   - 10k 个不同服务名 touch/release 后，`states.size` 是否收敛
   - releaseAction 抛错重试后，最终是否会永久保留冷 state

### 测试门禁补强

1. 把 coverage 纳入主门禁
2. 单独统计函数覆盖率，而不是只看测试数
3. 为“进程崩溃、IO 部分失败、慢资源释放”建立故障注入测试
4. 把 `desktop:smoke` 这类更接近现实的测试纳入持续门禁，而不是只作为人工脚本

## 已验证事实

### 已运行测试

命令：

```bash
LOG_FILE=false LOG_LEVEL=warn IMSG_PATH=/usr/bin/false PATH="$HOME/.bun/bin:$PATH" \
bun test test/p5-6-13-r2-thread-store.test.ts test/p5-7-r12-t7-model-service-idle-release.test.ts
```

结果：

- 18 个测试全部通过。
- 这说明现有回归锁本身是绿的。
- 但这些用例没有覆盖本审计指出的高风险分支。

## 审计结论

如果要“重新生成”，我建议优先级按下面顺序：

1. 先修 `DesktopSessionPool` 的请求收敛和崩溃路径测试。
2. 再修 `thread-store` 的 workspace 绑定语义。
3. 再决定 `maxConcurrentTasks` 是真做还是删配置。
4. 最后补 coverage 门禁和高真实性故障注入测试。

这样改动最少，但能把最危险的主链风险先压住。
