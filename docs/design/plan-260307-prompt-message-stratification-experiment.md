# Plan: Prompt 消息分层重排实验

Issue: 0021

## Problem

当前 msgcode 的执行链把基础规则、工具协议、历史摘要、窗口消息和当前请求按较扁平的 message 序列拼接给模型。外部真实使用反馈表明，改成“system 规则上半截 + 多条 user 上下文材料 + system 规则下半截”的分层格式后，长程追忆和稳定性更好，但 msgcode 还没有验证这种结构是否真的提升工具调用正确率、长上下文命中和幻觉控制。

## Occam Check

- 不加它，系统具体坏在哪？
  当前 prompt 结构可能在长上下文和复杂记忆注入场景里继续把“规则、记忆、近期窗口、当前任务”混成一个注意力平面，导致模型更容易丢细节、错位回忆或工具调用不稳。
- 用更少的层能不能解决？
  能。先不改记忆系统、不改工具桥接，只重排现有 message 结构，做最小 A/B 实验。
- 这个改动让主链数量变多了还是变少了？
  实验阶段主链不变；若实验通过，未来会把单条大 system 的混合结构收口成更清楚的一条正式消息编排主链。

## Decision

先做“消息分层重排实验”，不直接切正式主链。

实验口径：

1. **硬规则仍在 system**
   - 工具协议
   - 权限边界
   - 输出约束
   - 浏览器/文件/skill 等正式口径
2. **上下文材料可拆到多条 user**
   - 历史摘要
   - 最近窗口消息摘要或最近若干真实消息
   - 其他结构化记忆块/表格
3. **先做 A/B**
   - A：现状编排
   - B：system 上半截 + user 分层材料 + system 下半截
4. **不碰回答术**
   - 只比较消息结构，不新增回答裁判层

## Alternatives

### 方案 A：维持现状，只微调文案

- 优点：改动最小
- 缺点：无法验证“消息层级”本身是否是关键变量

### 方案 B：一次性改正式主链

- 优点：动作快
- 缺点：风险高，没有对照组，难以确认提升来自结构还是其他偶然因素

### 方案 C：先做最小 A/B 实验（推荐）

- 优点：变量收敛，能直接验证消息分层本身是否有效
- 缺点：需要补一点实验开关和观测

推荐：方案 C。

## 方法解释

### 1. 当前接线点

主要改动点应限定在：

- `/Users/admin/GitProjects/msgcode/src/agent-backend/prompt.ts`
- `/Users/admin/GitProjects/msgcode/src/agent-backend/tool-loop.ts`
- `/Users/admin/GitProjects/msgcode/src/agent-backend/chat.ts`
- 如需 provider 侧适配，再看：
  - `/Users/admin/GitProjects/msgcode/src/providers/minimax-anthropic.ts`

### 2. 实验版消息结构

#### 对照组 A：现状

```text
system:
  基础规则 + 工具协议 + 运行时提示 + skill 提示
assistant:
  历史摘要（当前实现）
user/assistant:
  最近窗口消息
user:
  当前请求
```

#### 实验组 B：分层消息

```text
system:
  规则上半截（身份、边界、工具协议、权限约束）

user:
  [历史摘要]
  ...

user:
  [最近窗口]
  ...

user:
  [重要记忆/结构化表格]
  ...

system:
  规则下半截（输出约束、运行时口径、browser/file/skill 真相源）

user:
  当前请求
```

### 3. system / user 分工冻结

#### 必须留在 system

- 工具协议
- 风险边界
- 权限/路径/运行时真相源
- 输出格式硬约束

#### 可以转成 user 分层材料

- 历史摘要
- 最近消息窗口
- 记忆表格
- 结构化上下文补充

### 4. 验证指标

#### 硬指标

1. 工具调用正确率
   - 未暴露工具调用次数
   - `MODEL_PROTOCOL_FAILED` 次数
   - `TOOL_BAD_ARGS` 次数
2. 长上下文命中率
   - 对已知历史事实的回忆命中数
3. 幻觉率
   - 明显编造工具结果/历史细节次数

#### 软指标

1. 回答一致性
2. 长链剧情追忆自然度
3. 用户主观稳定性评分

### 5. 观测要求

实验阶段至少补这些观测：

- 当前消息编排模式：`promptLayout=baseline|stratified`
- system 消息数 / user 消息数
- summary/window/context 各自字符数
- 工具错误码聚合

## Plan

1. 明确基线与实验开关
- 修改：
  - `/Users/admin/GitProjects/msgcode/src/agent-backend/prompt.ts`
  - `/Users/admin/GitProjects/msgcode/src/agent-backend/tool-loop.ts`
- 验收点：
  - 能区分 baseline / stratified 两种消息布局

2. 实现最小实验版消息编排
- 修改：
  - `/Users/admin/GitProjects/msgcode/src/agent-backend/tool-loop.ts`
  - `/Users/admin/GitProjects/msgcode/src/agent-backend/chat.ts`
  - 如有必要：`/Users/admin/GitProjects/msgcode/src/providers/minimax-anthropic.ts`
- 验收点：
  - 不改工具桥，只改 messages 结构

3. 增加观测与回归
- 修改：
  - prompt/tool-loop 相关测试
  - 运行时日志
- 验收点：
  - 能对比两种编排的工具错误率和上下文表现

4. 小规模真实对照
- 验收点：
  - 至少完成一组长上下文、多记忆注入、浏览器/文件工具混合任务的对照

## Risks

1. 若把过多“系统真相源”下沉到 user，模型可能把规则和普通上下文混淆。
回滚/降级：保留所有硬规则在 system，只下沉摘要和记忆材料。

2. 不同 provider 对多条 user 消息的敏感度可能不同。
回滚/降级：先在当前主 provider 做实验，不同时改所有 provider 逻辑。

3. 观测不足会导致“体感提升但不可验证”。
回滚/降级：先补最小日志，再做真实实验。

## Rollback

- 回退 prompt/tool-loop 的实验开关与分层消息编排，恢复当前 baseline 消息结构。

## Test Plan

- 基线：现有 prompt/tool-loop 测试继续通过
- 新增：
  - baseline vs stratified message layout 构造测试
  - provider 请求载荷结构测试
  - 关键工具协议不被 user 消息覆盖的回归测试

## Observability

- 新增运行时字段：
  - `promptLayout`
  - `systemMessageCount`
  - `userMessageCount`
  - `summaryChars`
  - `windowChars`
  - `memoryTableChars`

（章节级）评审意见：[留空，用户将给出反馈]
