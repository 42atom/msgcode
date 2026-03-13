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

**Agent 最终直接使用 `ghost_*` 原生工具；若需要迁移层，也只能是短命脚手架，不能成为长期 contract adapter。**

**`confirm token` 不上升为全局审批层，只允许保留在 `ghost-mcp-client` 的局部高危动作校验里。**

核心理由：

1. `ghost-os` 已经在桌面 computer-use substrate 上明显比当前 `msgcode/mac` 成熟。
2. 用户已明确要求所有插件级能力可关闭，且不得污染 core；`ghost-os` 更适合作为可替换手臂，而不是 core 内置层。
3. 保留 `msgcode` 的薄 core，远比继续扩张自研桌面执行层更符合长期路线。
4. `ghost-os` 自带成熟 MCP 工具面与说明书资产，长期继续罩一层 `desktop.*` 假面具，只会重新制造兼容债务。

## Plan

1. 冻结边界
   - 在架构口径上明确：
     - `msgcode core` 负责 `run / session / task / context / memory / artifacts / schedule / channel`
     - desktop computer-use 归入插件层
   - 验收：
     - 后续设计与实现不得再把 AX/vision/click/type/window/recipe 直接写入 core 语义

2. 定义最薄挂载 seam
   - `msgcode` 只负责挂载 `ghost mcp`
   - 不把 `ghost-os` 的内部对象模型写入 core
   - 不新增 desktop manager / plugin platform / controller
   - 验收：
     - `ghost-os` 可整体关闭
     - core 关闭 desktop plugin 后仍可独立运行

3. 重新定位当前 `mac/`
   - 将 `mac/` 重新定义为 shell / host / local entry
   - 停止继续把它做成完整桌面执行引擎
   - 验收：
     - 自研 `mac` 不再承担新增 desktop execution 主功能

4. 暴露真实能力面
   - Agent 直接拿到 `ghost_*` 原生工具
   - 不长期保留 `desktop.* -> ghost_*` 的翻译层
   - 若存在迁移层，只能用于短期切换，不进入稳定设计
   - 验收：
     - 最终现役桌面工具面是 `ghost_*`
     - 旧 `desktop` contract 可退役

5. 局部安全校验
   - 若 click/type/drag 等高危动作仍需确认，token 校验只留在 `ghost-mcp-client`
   - 禁止把它升级为总线级全局审批层
   - 验收：
     - Tool Bus 不新增新的全局裁判/审批结构

6. skill 与文档
   - 基于 `ghost-os/GHOST-MCP.md` 衍生 msgcode 本地 skill
   - skill 只讲如何使用 `ghost_*`、何时优先 recipes、失败时先查哪里
   - 更新 README / 上手文档，明确安装与健康检查流程
   - 验收：
     - 用户能靠 README 完成安装
     - Agent 能靠 skill 学会正确使用 `ghost_*`

7. 安装策略
   - 默认采用显式依赖安装：README / doctor / preflight 提示用户执行 `brew install ... && ghost setup`
   - 不在 `msgcode` 默认安装链路里静默代装第三方 binary
   - 如需“一起安装”，只能做成明确 opt-in 的 helper，不得默认执行
   - 验收：
     - 默认安装不绑死 `ghost-os`
     - 用户显式选择时，才允许 helper 协助安装

## Risks

1. 风险：把 `ghost-os` 直接当成新 core，用它的对象模型反向污染 `msgcode`
   - 回滚/降级：回到“只做挂载、不吸收对象模型”的收口口径，禁止直接把 `ghost-os` 语义写入 `run/session/task/context`

2. 风险：在替换前就提前废掉当前 `mac` 壳，导致本机体验中断
   - 回滚/降级：保留 `mac/` 作为 shell/host 过渡层，先替换执行层，再评估壳是否还需要

3. 风险：为了接 `ghost-os` 新增 manager / bus / 平台层
   - 回滚/降级：坚持单一主链，只保留薄挂载 seam，不引入 plugin platform

4. 风险：为了平滑迁移，长期保留 `desktop.* -> ghost_*` 兼容层
   - 回滚/降级：把迁移层标记为短命脚手架，稳定后直接退役旧 contract

5. 风险：为了个别高危动作，把 confirm 升级成全局审批系统
   - 回滚/降级：只保留 `ghost-mcp-client` 局部 token gate，不做全局层

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

### 方案 D：长期保留 `desktop.*`，底层偷偷翻成 `ghost_*`

不推荐。

原因：

- 会形成新的兼容债务
- 掩盖真实能力面
- 为新功能扩展制造重复映射成本

## Migration / Rollout

建议分四阶段：

1. 架构冻结阶段
   - 不再新增自研 desktop execution 主功能
   - 写清 `ghost_*` 将成为最终工具面
   - 冻结“局部 token、不上升全局审批层”的口径

2. 安装与说明书阶段
   - README 写明安装：`brew install ghostwright/ghost-os/ghost-os && ghost setup`
   - doctor / preflight 提示缺失依赖
   - 衍生 msgcode 本地 `ghost` skill

3. 挂载与灰度阶段
   - 做最薄 `ghost-mcp-client`
   - 暴露 `ghost_*` 给 Agent
   - 保持 core 与 shell 稳定
   - 如需迁移层，仅作为短期脚手架使用

4. legacy 收尾阶段
   - 旧桌面执行路径逐步下线
   - 只保留壳或将其移入 `.trash/`

## Test Plan

当前仅是架构方案，不执行代码测试。

后续实施时，至少需要：

- `ghost_*` 工具挂载与调用验证
- plugin on/off 验证
- core 无 desktop plugin 仍可运行的验证
- `ghost-os` 缺失时的 fail-closed 提示验证
- desktop plugin 替换后 run/task/context 主链不变的验证

## Observability

后续实施时应补最小观测：

- desktop plugin enabled/disabled
- 当前 desktop plugin provider
- `ghost` binary / setup / doctor 状态
- `ghost_*` 调用成功/失败率
- 是否出现 core 依赖 plugin 细节的越界调用

（章节级）评审意见：[留空,用户将给出反馈]
