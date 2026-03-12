# 重资源并发冲击防护 MVP

Issue: 0094

## Problem

`msgcode` 现在已经有不少局部运行时能力：

- `src/runtime/run-store.ts`：统一 runId 与最小 lifecycle 记账
- `src/runtime/task-supervisor.ts`：显式 task 的续跑与单 chat 活跃任务约束
- `src/runtime/model-service-lease.ts`：本地模型 idle release
- `src/tools/bus.ts`：`DesktopSessionPool` 的局部 single-flight
- `src/runners/tts/auto-lane.ts`：自动 TTS 的全局单 lane + latest-wins

但系统缺的不是“更多 runtime 零件”，而是一个非常薄的统一语义：

- 当多个 chat 同时打本地模型或 desktop/browser 资源时，系统应该返回什么？
- 哪些请求值得排队，哪些请求应该直接告诉用户“繁忙”？
- 哪些场景属于 `latest-wins`，根本不该进入通用队列？

如果不收口这层语义，现状会继续表现为：

- 本地模型在多并发下出现冷启动抖动、内存峰值和长尾等待
- desktop/browser 在不同 workspace 下各自局部串行，但对外没有统一 admission 口径
- 用户看到的是“慢、卡、偶发 busy、偶发超时”，而不是明确、稳定、可测试的 `queued / busy`

参考草稿 [AIDOCS/design/plan-260312-thin-agent-runtime.md](/Users/admin/GitProjects/msgcode/AIDOCS/design/plan-260312-thin-agent-runtime.md) 识别了正确的问题，但它中段已经开始长出：

- `admission gate`
- `unified lease`
- `runtime/policy.json`
- `runtime/queue.jsonl`
- `runtime/leases.json`

这些方向超出了当前真正需要的最小方案。

## Occam Check

1. 不加它，系统具体坏在哪？
   - 多 chat 并发触发 `local-model` 或 `desktop` 类重资源时，系统没有统一 admission 口径；用户只能感知到卡住、随机等待或局部模块报错，而不是稳定的 `queued / busy`。
2. 用更少的层能不能解决？
   - 能。复用现有 `run-store / task-supervisor / model-service-lease / DesktopSessionPool / AutoTtsLane`，只在执行入口前补一个非常薄的 heavy admission 层，不新增新的 runtime 控制面和全局状态文件。
3. 这个改动让主链数量变多了还是变少了？
   - 变少了。当前是每个重资源各自有局部规则；补完后会收口成统一的 `入口 -> admission -> execution` 主链。

## Decision

采用 **“重资源 admission MVP”**，不采用完整 thin runtime 草稿。

核心决策只有三条：

1. 只解决“并发冲击防护”
   - 目标是避免重资源互撞，让系统能给出稳定的 `queued / busy` 语义。
2. 只覆盖最危险的两类资源
   - Phase 1：`local-model`
   - Phase 1：`desktop`
3. 只提供三种 admission 结果
   - `run`：立刻执行
   - `queued`：进入有界等待
   - `busy`：立即拒绝，并返回明确提示

## Alternatives

### 方案 A：只做 `busy`，完全不排队

- 优点：实现最简单，不需要等待状态
- 缺点：对显式任务、自动化和可恢复任务不友好；用户需要手动重试，系统体验过于生硬

### 方案 B：有界队列 + busy overflow（推荐）

- 每类重资源默认容量 `1`
- 每类重资源允许一个很小的等待队列
- 队列满了就明确 `busy`
- 好处：足够薄，又能把最常见的“撞车”场景变成稳定语义

### 方案 C：按参考草稿实现统一 runtime 队列/租约系统

- 缺点：会新增第二套 runtime 真相源，超出当前真实问题，也违背项目“做薄”的路线

## 设计边界

### 1. 资源分类

Phase 1 只定义两类：

- `local-model`
  - 覆盖本地聊天、视觉、OCR、ASR、embedding 等同类重推理资源
  - 原则：共享同一个 admission 预算，避免多路并发把机器打满
- `desktop`
  - 覆盖 desktop/browser 类重交互资源
  - 原则：对外给出统一的忙闲语义，不再让底层 `Session busy` 直接泄漏成用户面主语义

暂不纳入：

- `tts`
  - 已有 `AutoTtsLane`，而且是典型的 latest-wins 场景
- `tmux`
  - 当前不是最危险重资源
- 其他轻量读写工具
  - 不属于本次重资源 admission 范围

### 2. 请求来源策略

不是所有请求都应该排队。

默认策略：

- 交互型消息请求
  - 优先 `busy`
  - 原因：用户正在线等待，长队列会把系统变成“无反馈的假响应”
- 显式任务 / 可恢复任务
  - 允许进入有界队列
  - 原因：这些请求具备恢复语义，排队比直接拒绝更合理
- latest-wins 场景
  - 不进入通用队列
  - 继续沿用“旧任务作废”的语义

### 3. 队列纪律

MVP 只做有界队列，不做持久化调度器。

建议规则：

- 每类重资源并发容量：`1`
- 每类重资源等待槽位：`1`
- 超过等待槽位：直接 `busy`

这意味着：

- 一个在跑
- 一个可等
- 第三个直接收到“服务器繁忙/本地资源繁忙”

为什么只给 `1` 个等待槽位：

- 足够挡住最常见的并发冲击
- 不会把系统变成“后台积压一堆已经过时的任务”
- 不需要新建 `queue.jsonl` 之类的持久化结构

### 4. 状态真相源

MVP 不新增新的全局状态文件。

明确不做：

- `runtime/policy.json`
- `runtime/queue.jsonl`
- `runtime/leases.json`
- `runtime/runs.jsonl` 之外的新总账文件

优先复用：

- `run-store`
- `task-supervisor`
- 现有 `model-service-lease`
- 现有 `DesktopSessionPool`

如果后续需要观测 admission 决策，优先：

- 结构化日志
- 现有 run/event 输出

而不是先落盘一套新控制面文件。

## MVP 主链

推荐最小主链：

1. 入口识别本次请求是否触发重资源
2. 归类为 `local-model` 或 `desktop`
3. 询问统一 admission
4. admission 返回：
   - `run`
   - `queued`
   - `busy`
5. 执行层按结果处理：
   - `run`：立刻执行
   - `queued`：进入内存等待
   - `busy`：明确返回用户态错误/提示

推荐薄接口（示意，不是最终签名）：

```ts
type HeavyResourceKind = "local-model" | "desktop";

type AdmissionAction = "run" | "queued" | "busy";

interface HeavyAdmissionRequest {
  resource: HeavyResourceKind;
  source: "message" | "task" | "heartbeat" | "schedule";
  sessionKey: string;
  runLabel: string;
  queueable: boolean;
}

interface HeavyAdmissionDecision {
  action: AdmissionAction;
  reason: "capacity-available" | "queued-behind-active" | "queue-full";
}
```

关键点：

- admission 只做容量判断和有界排队
- 不做业务决策
- 不做智能优先级
- 不做自动 fallback

## 与现有模块的关系

### `run-store`

- 继续负责最小 lifecycle 记账
- MVP 不要求它先变成完整调度器

### `task-supervisor`

- 继续负责显式 task 续跑
- 未来若某些 task 命中重资源，可让它们成为 `queueable=true` 的主要来源

### `model-service-lease`

- 继续负责服务闲置释放
- 后续实现里，它前面增加 admission，但不重写它的职责

### `DesktopSessionPool`

- 继续保留模块内 single-flight
- 但用户面“忙”的主语义应该往上一层收口，不再让底层错误成为唯一反馈

### `AutoTtsLane`

- 保持现状
- 作为“latest-wins 不该进入通用队列”的正面例子

## Implementation Plan

1. 冻结术语与范围
   - 在 issue/plan 中固定：
     - `heavy resource`
     - `queued`
     - `busy`
     - `latest-wins`
   - 明确 Phase 1 只做 `local-model` 与 `desktop`
2. 新增薄 admission 模块
   - 建议路径：`src/runtime/heavy-admission.ts`
   - 只维护内存容量与有界等待，不落新文件
3. 先接 `local-model`
   - 接入 `chat / vision / asr / media pipeline` 这类本地推理入口
   - 命中容量时返回 `queued` 或 `busy`
4. 再接 `desktop`
   - 在调用 `DesktopSessionPool` 前统一做 admission
   - 不再把底层 `Session busy` 直接当作外层主语义
5. 观测与日志
   - 为 `run / queued / busy` 输出稳定结构化日志
   - 必要时在已有状态输出里暴露最小 admission 观测字段
6. 测试
   - 并发本地模型：一个执行，一个排队/繁忙
   - 并发 desktop：一个执行，一个排队/繁忙
   - latest-wins 场景保持原样，不被通用队列接管

## Risks

1. 误把 admission 做成第二套 runtime 控制面
   - 回滚：删掉 admission 队列，只保留 `busy` 拒绝；绝不引入持久化队列文件
2. 把所有请求都塞进队列，导致系统看似“稳定”但其实越来越迟钝
   - 缓解：默认只有显式可恢复任务可排队；交互消息优先 `busy`
3. 现有局部 single-flight 与新 admission 语义重叠，出现双重排队
   - 缓解：实现时先统一外层 admission，再逐步收口局部 `busy` 文案和错误语义

## Test Plan

1. 本地模型并发
   - 同时触发两个 `local-model` 重任务
   - 验证：一个运行；另一个不是隐式卡死，而是 `queued` 或 `busy`
2. desktop 并发
   - 同时触发两个 `desktop` 请求
   - 验证：系统返回统一 admission 语义，而不是只暴露底层 `Session busy`
3. latest-wins 回归
   - 自动 TTS 连续触发
   - 验证：继续保持“旧任务过时即丢弃”，不进入通用队列
4. 非目标不回归
   - 普通轻量 chat 与文件工具不受影响
5. 工程门槛
   - `bun test`
   - `npx tsc --noEmit`

## Progress

当前仅冻结规划，不进入实现。

- 已确认参考草稿只作输入，不作真相源：
  - [AIDOCS/design/plan-260312-thin-agent-runtime.md](/Users/admin/GitProjects/msgcode/AIDOCS/design/plan-260312-thin-agent-runtime.md)
- 已确认现有可复用主链：
  - `src/runtime/run-store.ts`
  - `src/runtime/task-supervisor.ts`
  - `src/runtime/model-service-lease.ts`
  - `src/tools/bus.ts`
  - `src/runners/tts/auto-lane.ts`

（章节级）评审意见：[留空,用户将给出反馈]
