# OpenClaw 作为通用任务 Harness，Terminal Coding Agent 作为专用编码引擎

## 背景

当前需要冻结一个关键定位判断：

- `Codex`、`Claude Code` 这类 Terminal Coding Agent，本质上是 **面向 Coding 深度优化** 的执行引擎
- `OpenClaw` 本质上是 **面向通用任务** 的长期在线 agent runtime / harness
- 因此，`OpenClaw -> 调用 Terminal Coding Agent` 是正确分层

这条判断对 `msgcode` 很关键，因为它直接决定后续 Agent Core 的职责边界。

## 核心结论

`msgcode` 不应该试图变成另一个 `Codex` 或 `Claude Code`。

更正确的定位是：

- `msgcode` 负责通用任务 runtime
- coding 子任务交给 Terminal Coding Agent
- `msgcode` 负责把复杂任务拆到正确执行面，再把结果收回统一 run/session 主链

一句话：

**`msgcode` 应该像 OpenClaw 一样做通用任务 harness，而不是重造 coding agent 本体。**

## 文档归类

这篇文档在当前体系中应归类为：

**专项执行引擎插件研究**

它回答的是：

- 通用任务 harness 和 coding 专项引擎如何分层
- 后续 coding 子任务该如何通过 harness 接入

它不是 future console 文档，也不是 surface 文档。

## 为什么这条分层是对的

### 1. 模型专项优化不同

- `Codex` / `Claude Code`：
  - 强在代码理解、改动、测试、修复、repo 内导航
- `OpenClaw`：
  - 强在 session、run、长期任务、设备/通道/交付面编排

把两者混成一个系统，通常会导致：

- 通用 runtime 变重
- coding 主链被非编码场景污染
- 结果是两边都做不深

### 2. 终局产品需要的是“总控 + 专项引擎”

终局上，一个通用智能体系统需要：

- 统一任务入口
- 长期运行
- 多通道与多交付面
- 对不同专项任务调用最合适的执行引擎

coding 只是其中一个专项执行面。

### 3. 这符合当前项目的“做薄”原则

如果 `msgcode` 直接把 coding loop、repo reasoning、patch/test/review 全部自己做掉，
后面一定会走向厚控制层。

更薄的路径是：

- `msgcode` 只负责：
  - run
  - session
  - task
  - context
  - channel
  - artifact
  - human handoff
- coding 能力通过 Terminal Coding Agent 接入

## 对 msgcode 的设计要求

### 必须坚持的边界

#### msgcode 负责

- 通用任务入口与路由
- run lifecycle
- session 统一语义
- 长期任务与 blocked/resume
- 上下文装配
- 交付与 artifact
- 通道集成（当前 Feishu，后续 Telegram / Discord）

#### Terminal Coding Agent 负责

- repo 理解
- coding 计划
- 文件改动
- 测试执行
- 代码修复与 review

#### 不应该做的事

- 不让 `msgcode` 直接长成“另一个 coding agent”
- 不在 `msgcode` 内重写一套厚的 coding-specific 控制面
- 不把所有复杂任务都强行翻译成 coding workflow

## 对 Agent Core 的直接启发

### 1. Run Core 仍然是主线

后续 Agent Core 收口方向不变：

- 每次执行都是正式 run
- session/run/task/context 统一

但 run 里要允许挂接不同执行引擎：

- general task turn
- coding agent turn
- browser turn
- future local service turn

### 2. 未来要的是“代理调用编码代理”

不是：

- 用户直接和 coding agent 粘死

而是：

- 用户和 `msgcode` 交互
- `msgcode` 判断这是不是 coding 子任务
- 若是，则调用 Terminal Coding Agent
- 结果回到统一 run/session

### 3. 这也是 surface/mobile 之后能成立的前提

如果后面有：

- PWA / 原生壳
- 页面交付面
- 远程访问

它们都应该消费 `msgcode` 的通用任务主链，
而不是直接消费 coding agent 的私有过程。

## 当前冻结的产品判断

当前阶段，`msgcode` 的定位冻结为：

**本地优先的通用任务智能体 runtime。**

其中 coding 是专项能力，不是系统本体。

## 非目标

- 本文不定义 ACP 的具体协议实现
- 本文不立即引入 coding-agent adapter
- 本文不改变当前 Phase 2 / Phase 3 的 Run Core 排期

## 后续影响

后续做 Agent Core 时，所有方案都要满足下面这条判断：

**这个改动是在增强通用任务 harness，还是在把 `msgcode` 变成另一个 coding agent？**

如果答案是后者，默认不做。
