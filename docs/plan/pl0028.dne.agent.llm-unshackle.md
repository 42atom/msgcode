# Plan: LLM 松绑计划

## Problem

当前 msgcode 对 LLM 的限制已经开始明显妨碍主链：

- 前置路由会因为“无工具暴露”直接退回 no-tool
- 中途协议会因为“未暴露工具”把合理下一步直接判死
- prompt 中存在多处“必须 / 禁止 / 最多 3 次 / 第一轮必须 tool_calls”之类硬约束
- tool-loop 仍保留单轮次数上限与硬上限

结果是：LLM 已经能理解任务，也能开始读 skill，但在执行中被框架自己的约束层阻断。

## Occam Check

### 1. 不加这次改动，系统具体坏在哪？

真实失败已经出现：

- 用户自然语言要求创建 cron
- LLM 想先读 scheduler skill
- 系统先是 `no tools exposed`
- 修到能 `read_file` 后，又在下一步被 `bash` 暴露限制打死

这说明“支持 LLM 完成任务”的主链已经被约束层反向控制。

### 2. 用更少的层能不能解决？

能。

正确方向不是新增更聪明的裁判层，而是直接删掉或放松现有阻断点：

- 减少前置 no-tool 判断
- 减少“未暴露工具即立即判死”的场景
- 删除不必要的次数上限
- 缩减 prompt 中强控制型文案

### 3. 这个改动让主链数量变多了还是变少了？

变少。

当前存在的额外旁路包括：

- no-tool 回退
- 协议失败旁路
- 次数上限续跑旁路
- prompt 强控旁路

松绑后的目标是一条主链：

`LLM 读 skills 目录 -> 自行读取 skill -> 自行调用底层工具 -> 失败后继续循环`

## Decision

采用“先盘点、再逐步拆除”的松绑策略。

核心原则：

1. 我们只告诉 LLM skills 目录与必要路径
2. 不替它设计流程，不替它提前判死
3. 默认支持 99+ 次工具调用
4. 限制只能来自明确风险边界，不能来自主观控制欲

## 限制清单

### P0：必须优先拆除

1. `no tools exposed` 前置回退
- Code: `/Users/admin/GitProjects/msgcode/src/agent-backend/routed-chat.ts:264`
- 行为：在 tool-loop 之前直接退回 dialog/no-tool
- 问题：把 skill 主链在入口打断
- 建议：删除或大幅缩窄；默认不要因为工具面为空就放弃执行

2. “未暴露工具”直接 `MODEL_PROTOCOL_FAILED`
- Code: `/Users/admin/GitProjects/msgcode/src/agent-backend/tool-loop.ts:912`, `/Users/admin/GitProjects/msgcode/src/agent-backend/tool-loop.ts:932`
- 行为：只要模型调用未在本轮 activeToolNames 里的工具，直接判死
- 问题：把合理下一步也一起打死
- 建议：在默认开放底层工具后，缩减这类硬阻断的使用范围

3. skill 主链只开放半套工具面
- Code: `/Users/admin/GitProjects/msgcode/src/agent-backend/tool-loop.ts:512`
- 行为：当前只给 `read_file`，不给 `bash`
- 问题：允许“读 skill”，却不允许“照 skill 执行”
- 建议：默认底层工具面至少 `read_file + bash`

### P1：应尽快降级

4. prompt 里的强控制型工具协议
- Code: `/Users/admin/GitProjects/msgcode/src/agent-backend/prompt.ts:25`
- 现象：
  - 最多 3 次工具调用
  - 第一轮必须优先产出 tool_calls
  - 没有工具结果前禁止给结论
- 问题：这些规则更像在约束 LLM，而不是支持它
- 建议：删除调用次数硬限制；保留少量“返回真实结果”类底线

5. 工具索引里的“禁止 / 必须”文案过强
- Code: `/Users/admin/GitProjects/msgcode/src/tools/manifest.ts:493`
- 问题：作为目录说明可以，但当前文案已经变成强裁判语气
- 建议：改成“指路型说明”，不再带强惩罚口径

6. preferredToolName / mismatch 协议
- Code: `/Users/admin/GitProjects/msgcode/src/agent-backend/tool-loop.ts:874`, `/Users/admin/GitProjects/msgcode/src/agent-backend/tool-loop.ts:920`, `/Users/admin/GitProjects/msgcode/src/agent-backend/tool-loop.ts:1103`
- 问题：对工具偏好过度执念，容易把合理替代路径打死
- 建议：默认关闭或弱化，仅在明确高风险工具时保留

### P2：建议评估后拆除

7. 单轮工具调用与步骤上限
- Code: `/Users/admin/GitProjects/msgcode/src/agent-backend/tool-loop.ts:941`, `/Users/admin/GitProjects/msgcode/src/agent-backend/tool-loop.ts:1045`
- 字段：`perTurnToolCallLimit` / `perTurnToolStepLimit` / `HARD_CAP_TOOL_CALLS` / `HARD_CAP_TOOL_STEPS`
- 问题：会把本应继续循环的问题切成 quota continuation 旁路
- 建议：改为 99+ 或直接取消；至少默认不作为阻断条件

8. LEVEL_2 degrade 强制 no-tool
- Code: `/Users/admin/GitProjects/msgcode/src/agent-backend/routed-chat.ts:94`
- 问题：把能力问题偷换成降级裁判
- 建议：除非有明确外部风险，避免强制 no-tool

## Plan

### 步骤 1：先拆主链阻断

- `/Users/admin/GitProjects/msgcode/src/agent-backend/routed-chat.ts`
- `/Users/admin/GitProjects/msgcode/src/agent-backend/tool-loop.ts`

验收点：
- 不再默认 no-tool
- skill 主链能连续执行 `read_file + bash`

### 步骤 2：再拆 prompt 与工具索引硬约束

- `/Users/admin/GitProjects/msgcode/src/agent-backend/prompt.ts`
- `/Users/admin/GitProjects/msgcode/prompts/agents-prompt.md`
- `/Users/admin/GitProjects/msgcode/src/tools/manifest.ts`

验收点：
- 不再出现“最多 3 次”“第一轮必须 tool_calls”这类强控制文案
- skills 目录说明保留，但裁判语气移除

### 步骤 3：最后拆 quota / hard cap

- `/Users/admin/GitProjects/msgcode/src/agent-backend/tool-loop.ts`
- `/Users/admin/GitProjects/msgcode/src/agent-backend/types.ts`
- 相关 continuation / quota tests

验收点：
- 默认允许 99+ 次工具调用
- 不再因为次数限制把主链截断

## Risks

1. 过快删除约束可能让旧测试大面积失效
- 处理：同步更新冻结测试，不保留已失真的旧合同

2. 过度松绑可能暴露真实权限边界问题
- 处理：只保留明确风险边界，不保留主观流程限制

3. 多处限制叠加，容易出现“修了一层还有别层卡住”
- 处理：按 P0 -> P1 -> P2 顺序一层层拆，并用真实日志回归

## Test Plan

1. 自然语言 scheduler 场景：
- 应能真实读 skill
- 应能继续 bash
- 不再伪 `[TOOL_CALL]`

2. browser / file 类 skill 场景：
- 不再被前置 no-tool 或 preferred-tool 协议打死

3. 长循环场景：
- 不再被单轮次数上限提前截断

## Observability

重点观察日志：

- `agent-first chat fallback: no tools exposed`
- `MODEL_PROTOCOL_FAILED`
- `Tool Bus: SUCCESS read_file`
- `Tool Bus: SUCCESS bash`
- `TOOL_LOOP_LIMIT_EXCEEDED`

目标是：

- 前两者下降到接近 0
- 后两者在主链中稳定出现
- 次数上限类错误默认不再出现

---

**评审意见**：[留空，用户将给出反馈]
