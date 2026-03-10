# plan-260310-ghost-os-desktop-plugin-replacement

## Problem

当前 `msgcode` 已经明确走“薄 core + 插件能力”路线，但桌面执行层还处在危险状态：

- `msgcode/mac` 当前更像权限宿主 + bridge + 桌面壳
- 若继续在其上扩张 click/type/window/recipe/vision 等能力，core 周边会越来越厚
- 本地引入的 `ghost-os` 已经是成熟得多的桌面 computer-use substrate

真正的问题不是“要不要做桌面能力”，而是：

**桌面能力应由谁实现，以及它应处在什么层级。**

### Occam Check

- 不加这层，系统具体坏在哪？
  - 若不引入成熟桌面插件实现，当前自研 `mac` 路径会继续扩张为第二个重 runtime，重复造轮子，长期侵蚀 core 边界。
- 用更少的层能不能解决？
  - 可以。不是新增平台，而是把“桌面执行层”直接替换成现成插件实现，并保持 core 不变。
- 这个改动让主链数量变多了还是变少了？
  - 变少。桌面执行主链从“自研 bridge 持续膨胀”收口为“统一 desktop plugin contract + ghost-os 首个实现”。

## Decision

选定方案：

**冻结当前自研桌面执行层的继续扩张。**

**将 `ghost-os` 定位为 `msgcode` 的桌面执行插件首个正式实现。**

**`msgcode core` 只保留 run/session/task/context/artifact 等统一 substrate，不吸收 desktop automation 细节。**

核心理由：

1. `ghost-os` 已经在桌面 computer-use substrate 上明显比当前 `msgcode/mac` 成熟。
2. 用户已明确要求所有插件级能力可关闭，且不得污染 core；`ghost-os` 更适合作为可替换手臂，而不是 core 内置层。
3. 保留 `msgcode` 的薄 core，远比继续扩张自研桌面执行层更符合长期路线。

## Plan

1. 冻结边界
   - 在架构口径上明确：
     - `msgcode core` 负责 `run / session / task / context / memory / artifacts / schedule / channel`
     - desktop computer-use 归入插件层
   - 验收：
     - 后续设计与实现不得再把 AX/vision/click/type/window/recipe 直接写入 core 语义

2. 定义薄的 desktop plugin contract
   - 只定义 `msgcode core` 真正需要的桌面能力面
   - 不暴露 `ghost-os` 的内部对象模型给 core
   - 验收：
     - contract 可由 `ghost-os` 提供
     - contract 关闭后，core 仍可独立运行

3. 重新定位当前 `mac/`
   - 将 `mac/` 重新定义为 shell / host / local entry
   - 停止继续把它做成完整桌面执行引擎
   - 验收：
     - 自研 `mac` 不再承担新增 desktop execution 主功能

4. 后续迁移顺序（不在本轮实现）
   - 第一步：做 `ghost-os` 能力差距表与 contract 映射
   - 第二步：做 `ghost-os` 作为 desktop plugin 的最小适配
   - 第三步：把旧执行路径降级为 legacy
   - 第四步：再评估是否保留 `mac` 壳

## Risks

1. 风险：把 `ghost-os` 直接当成新 core，用它的对象模型反向污染 `msgcode`
   - 回滚/降级：回到“只定义薄 desktop plugin contract”的收口口径，禁止直接把 `ghost-os` 语义写入 `run/session/task/context`

2. 风险：在替换前就提前废掉当前 `mac` 壳，导致本机体验中断
   - 回滚/降级：保留 `mac/` 作为 shell/host 过渡层，先替换执行层，再评估壳是否还需要

3. 风险：为了接 `ghost-os` 新增 manager / bus / 平台层
   - 回滚/降级：坚持单一主链，只保留一个薄 contract，不引入 plugin platform

## Alternatives

### 方案 A：继续扩张自研 `mac` 执行层

不推荐。

原因：

- 重复造桌面 automation 轮子
- 与“薄 core + 插件能力”路线冲突
- 长期维护成本高

### 方案 B：完全删除 `mac/`，让 `ghost-os` 单独承担一切

暂不推荐。

原因：

- 过于激进
- 可能丢掉当前已有的本机壳、权限宿主和入口体验

### 方案 C：保留 `mac` 壳，替换桌面执行层为 `ghost-os`

推荐。

原因：

- 最符合“保留 shell，替换 arm”
- 迁移风险最小
- 不影响 core 主线

## Migration / Rollout

建议分三阶段：

1. 架构冻结阶段
   - 不再新增自研 desktop execution 主功能
   - 先写清边界和 contract

2. 插件替换阶段
   - 做 `ghost-os` 适配
   - 保持 core 与 shell 稳定

3. legacy 收尾阶段
   - 旧桌面执行路径逐步下线
   - 只保留壳或将其移入 `.trash/`

## Test Plan

当前仅是架构方案，不执行代码测试。

后续实施时，至少需要：

- contract 级集成验证
- plugin on/off 验证
- core 无 desktop plugin 仍可运行的验证
- desktop plugin 替换后 run/task/context 主链不变的验证

## Observability

后续实施时应补最小观测：

- desktop plugin enabled/disabled
- 当前 desktop plugin provider
- contract 调用成功/失败率
- 是否出现 core 依赖 plugin 细节的越界调用

（章节级）评审意见：[留空,用户将给出反馈]
