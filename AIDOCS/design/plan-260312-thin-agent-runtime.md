# 薄 Agent Runtime 前瞻方案

## Problem

当前 `msgcode` 已经具备很多“运行时零件”：

- `workspace` 作为文件边界
- `sessionKey` 作为统一会话语义
- per-chat lane queue
- heartbeat / task supervisor / event queue
- model lease / desktop session idle release / auto TTS single lane

但这些能力还没有被统一成一条清晰主链。现在最容易出问题的地方不是单个功能，而是**多 workspace、多 chat、多长任务并发时的资源争抢与语义漂移**：

- `chat -> workspace` 已有绑定，但 `workspace != thread != task`
- 同一 chat 串行了，不代表同一类重资源被全局串行
- `maxConcurrentTasks` 有配置，没有真正执行
- 资源探针只观测，不做 admission / backpressure
- 多个 chat 可以指向同一 workspace，长期会让“目录边界”和“调度边界”继续混在一起

如果继续只在局部补丁，系统会越来越像“未来的 agent OS”，但没有真正的调度与资源纪律，后面会先乱，再被迫补重控制面。

## Occam Check

### 不加它，系统具体坏在哪？

- 当多个 chat 同时触发本地模型 / browser / desktop / TTS / ASR 时，系统缺少统一 admission gate，容易出现内存顶满、冷启动风暴、任务互相卡住。
- 当 workspace 数量增长后，当前“per-chat 串行 + 局部 lease”不足以表达全局资源预算，排障会越来越依赖经验而不是稳定规则。
- `workspace`、`session`、`task`、`thread` 语义继续漂，后面每加一种入口（surface / webhook / automation）都要再补一次映射逻辑。

### 用更少的层能不能解决？

能。

不做 gateway，不做远程 control plane，不做真正的“OS”。

只补两件事：

1. 冻结统一名词与主链。
2. 在现有 daemon 内增加一个**很薄的 admission + resource gate**。

### 这个改动让主链数量变多了还是变少了？

变少了。

从“消息链 / task 链 / heartbeat 链 / job 链 / 局部资源 lane 各自为政”，收口成：

`workspace -> session -> run -> resource gate -> execution -> artifacts`

## Decision

推荐把系统定义为：

**文件系统优先的薄 Agent Runtime**

而不是：

- 不是“bot 集合”
- 也不是“完整 agent OS”

这样做的目标是：

- 保留文件系统真相源
- 保留单 daemon 主链
- 提前补全局资源纪律
- 避免过早平台化

## 核心模型

### 1. 五个固定名词

#### Workspace

职责：

- 文件/配置/证据边界
- artifact / memory / thread / schedule 的存储根

不负责：

- 直接代表线程
- 直接代表任务

#### Session

定义：

- 一个稳定交互身份
- 建议继续使用现有语义：`channel + chat + workspace`

职责：

- 串行化的最小边界
- 短期上下文窗口与 thread 文件的挂载点

#### Run

定义：

- 一次正式执行

职责：

- 被调度
- 被观测
- 被记账

状态建议固定为：

- `accepted`
- `queued`
- `running`
- `blocked`
- `completed`
- `failed`
- `cancelled`
- `rejected`

#### Task

定义：

- 一个长期意图，跨多个 run

职责：

- checkpoint
- verify
- resume / blocked reason

#### Resource Lease

定义：

- 稀缺执行资源的一次占用权

资源类型建议固定为：

- `local-model`
- `browser`
- `desktop`
- `tts`
- `asr`
- `tmux`

### 2. 单一主链

任何入口都走同一条语义主链：

1. 入口产生 `run request`
2. 解析到 `workspace + session + run class`
3. 进入 admission gate
4. 获取 resource lease
5. 执行
6. 写回 run / task / artifacts / thread

入口只负责“提出运行请求”，不直接抢资源。

## 最小设计方案

### A. 冻结“边界不变量”

这是最重要的一步，先于任何代码。

必须明确：

1. `workspace` 是文件边界，不是调度边界
2. `session` 是串行边界
3. `run` 是调度边界
4. `task` 是长期恢复边界
5. `resource lease` 是资源占用边界

只要这五个概念不混，系统就不会轻易长歪。

### B. 增加薄 Admission Gate

新增一个很薄的运行时模块，建议名字：

- `src/runtime/admission.ts`

职责只做三件事：

1. 给 run 打标签
2. 判断是否允许现在执行
3. 决定 `直接运行 / 排队 / 拒绝`

不做：

- 业务判断
- 自动 fallback
- 复杂编排

#### 建议的 run class

- `light`
  - 纯对话、轻命令、只读命令
- `heavy-local-model`
  - 本地大模型、视觉、本地 embedding
- `heavy-browser`
  - browser / desktop
- `heavy-media`
  - TTS / ASR / 图片生成

#### admission 规则建议

- `light`：直接执行
- `heavy-local-model`：全局最多 1
- `heavy-browser`：全局最多 1
- `heavy-media`：按资源细分，默认每类最多 1
- 同一 `session`：永远串行
- 超过预算：
  - 有意义则 `queued`
  - 无意义则 `rejected`

例子：

- 自动 TTS 已经过时，直接 `rejected(latest-wins)`
- 用户主动触发的图片生成，可 `queued`
- 本地模型内存接近阈值时，新 heavy run 直接 `queued`

### C. 把局部资源闸门收口成统一 Lease

当前已经有三类雏形：

- `model-service-lease`
- `DesktopSessionPool` single-flight
- `AutoTtsLane`

建议不要新发明第二套调度器，而是统一成一个薄接口：

```ts
type ResourceKind =
  | "local-model"
  | "browser"
  | "desktop"
  | "tts"
  | "asr"
  | "tmux";

interface AcquireLeaseInput {
  sessionKey: string;
  runId: string;
  resource: ResourceKind;
  policy: "exclusive" | "shared";
}
```

目标不是把所有实现揉成一个大 manager，而是把：

- 申请
- 占用
- 释放
- 观测字段

统一口径。

### D. 加一个全局 Runtime Policy 文件

建议新增一个全局真相源：

- `~/.config/msgcode/runtime/policy.json`

最小字段：

```json
{
  "resourceCaps": {
    "local-model": 1,
    "browser": 1,
    "desktop": 1,
    "tts": 1,
    "asr": 1
  },
  "memoryGuard": {
    "rssHighWaterMb": 8192,
    "queueHeavyWhenAboveMb": 6144
  }
}
```

作用：

- 让限制是显式文件，不藏在代码常量里
- 便于不同机器调参
- 便于 probe / status 读同一真相源

### E. 明确全局与局部状态放哪里

#### Workspace 内

继续放：

- `.msgcode/threads/`
- `.msgcode/sessions/`
- `.msgcode/tasks/`
- `artifacts/`
- `memory/`

#### 全局配置目录

新增或收口：

- `runtime/policy.json`
- `runtime/queue.jsonl`
- `runtime/leases.json`
- `run-core/runs.jsonl`

原则：

- 和 workspace 强相关的状态，放 workspace
- 跨 workspace 竞争的状态，放全局

## 关键策略

### 1. 先 admission，后加载资源

任何 heavy run 都必须先过 admission，再触发：

- 模型加载
- browser 启动
- desktop session 启动
- TTS / ASR 推理

否则会出现：

- 资源先被拉起
- 然后才发现系统已经饱和

这会直接制造内存峰值。

### 2. backpressure 必须显式对用户可见

不要静默等。

排队时明确返回：

- 当前状态：`queued`
- 前面还有几个同类 heavy run
- 预计由 heartbeat / completion event 唤醒

这样系统忙不是“卡死”，而是“可解释”。

### 3. 默认 fail-closed，不猜

如果无法判断：

- run 属于哪类资源
- 当前 resource cap 是否允许
- 这个任务是否还有意义

默认：

- 不启动重资源
- 进入 `queued` 或 `rejected`

而不是偷偷跑。

### 4. latest-wins 只用于“过时即无意义”的任务

适用：

- 自动 TTS
- 自动图片摘要
- 某些轮后提示

不适用：

- 用户明确发起的长任务
- schedule job
- 需要证据闭环的 task

### 5. probe 不再只看，还要能喂给 admission

现在 resource probe 只是观测。

建议后续改成：

- `probeResources()` 产出结构化 snapshot
- admission 读取最近 snapshot 决定是否允许新 heavy run

但不要让 probe 直接调度；仍然由 admission 做决定。

## 实施步骤

### Phase 1：冻结语义，不改行为

目标：

- 把 `workspace / session / run / task / resource lease` 五个名词写成正式协议

交付：

- 设计文档
- 关键模块注释修正

验收：

- 团队对“一个目录不是一个线程”没有二义性

### Phase 2：引入 admission gate（只管 heavy run）

目标：

- 不动轻链路
- 先把最危险的 heavy run 收口

改动建议：

- 在执行前统一调用 `admission.check()`
- 先接 `local-model / browser / desktop / tts / asr`

验收：

- 多 chat 并发时，heavy run 不再直接互撞

### Phase 3：统一 lease 口径

目标：

- 把 `model-service-lease`、`DesktopSessionPool`、`AutoTtsLane` 的观测字段和生命周期对齐

验收：

- status/probe 能看到当前占用的资源和等待队列

### Phase 4：显式 backpressure 回包

目标：

- 用户能看到 queued / rejected / retry reason

验收：

- “系统很忙”有明确证据和文案，不再像随机卡顿

### Phase 5：再考虑 automation / surface / 多 agent

前提：

- 前四阶段稳定

到这一步才有资格谈更像“agent OS”的东西。

## Non-Goals

本方案明确不做：

- 不做 OpenClaw 式 gateway
- 不做远程 pairing / 节点控制面
- 不做平台级插件市场
- 不做自动智能调度器替用户决定优先级
- 不做“为了更完整”新增第二主链

## Risks

### 风险 1：排队变多，用户感觉更慢

缓解：

- 先只限制 heavy run
- 对 light run 保持直通
- 明确 queued 文案与 ETA

### 风险 2：阈值设太死，机器利用率下降

缓解：

- cap 从配置文件读取
- 先保守，再根据真实日志调参

### 风险 3：实现时又长出第二套状态机

缓解：

- admission 只做三件事：允许 / 排队 / 拒绝
- 不让 admission 持有业务逻辑

## Recommendation

一句话推荐：

**把 msgcode 定位成“文件系统优先的薄 Agent Runtime”，先补统一 admission 和资源纪律，刻意不做重 OS。**

这是最有前瞻性、同时最不容易把系统做歪的路线。

## 评审意见

[留空,用户将给出反馈]
