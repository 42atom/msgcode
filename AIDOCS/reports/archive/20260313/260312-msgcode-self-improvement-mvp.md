# msgcode Self-Improvement MVP 设计

日期：2026-03-12

## 结论

- `msgcode` 的 self-improvement 应采用“LLM 决定改进内容，系统约束改进边界”的实现。
- MVP 不做“自动改自己”，只做“自动提出改进候选 + 显式应用 + 回放验证”。
- `skill` 是主轴，但不是唯一落点；改进目标必须强制分类到 `none | skill | prompt | tool_contract | code`。
- MVP 默认只允许自动建议 `skill / prompt / tool_contract`，`code` 只允许建议，不允许运行时自动落地。

## 问题定义

### 我们真正想实现的不是

- 不是让 agent 自己长出新控制面
- 不是让运行时目录悄悄漂移出 repo 真相源
- 不是把偶然成功一次的路径自动产品化
- 不是让 memory、prompt、skill、code 混成一个“大脑”

### 我们真正想实现的是

- 让模型在真实任务后，对“什么值得沉淀”做价值判断
- 让沉淀结果变成可审查、可回放、可回滚的文件产物
- 让下一次同类任务减少猜测、减少试错、减少上下文浪费

## 核心原则

### 原则 1：LLM 负责内容判断，系统负责治理边界

LLM 可以决定：

- 这次是否值得改进
- 应该改哪一层
- 应该补什么说明书或合同
- 这次沉淀是否属于通用经验

系统只负责限制：

- 可改哪些层
- 可写哪些文件
- 需要哪些证据
- 必须如何验证

### 原则 2：先提候选，再应用，不做运行时直接自改

MVP 只允许：

1. 任务后生成 improvement candidate
2. 把 candidate 落成文件
3. 显式触发 apply
4. 回放验证通过后再进入 repo 真相源

禁止：

- 工具循环结束后直接改 `SKILL.md`
- 运行时直接改主 prompt
- 自动更新核心代码
- 自动把用户目录能力认定为正式产品能力

### 原则 3：改进必须命中明确层级

固定五类：

- `none`：不沉淀
- `skill`：方法说明书升级
- `prompt`：全局行为约束升级
- `tool_contract`：真实接口/说明书对齐
- `code`：实现本体修复或增强

系统不得接受“混合型大改造”。一次 candidate 只能有一个主目标层。

## 为什么这套实现适合 msgcode

### 现有主链已经有足够挂点

- 对话系统提示词组装：`src/agent-backend/prompt.ts`
- 对话上下文装配：`src/runtime/context-policy.ts`
- 工具循环日志与验证：`src/agent-backend/tool-loop.ts`
- skill 真相源与同步：`src/skills/runtime/`、`src/skills/runtime-sync.ts`
- memory 检索：`src/memory/store.ts`、`src/cli/memory.ts`

这意味着 self-improvement 不需要新增控制平面，只需要在现有链路末端补一个“候选生成器”。

### 当前最适合从 exec/tool 链开始

原因：

- `tool-loop.ts` 已经有 action journal、verify phase、traceId
- 失败模式和成功模式在这里最可观测
- skill/prompt/tool-contract 的问题，通常都在工具决策与执行环节暴露

因此 MVP 只挂 `exec/tool` 链，不先覆盖纯聊天链。

## MVP 主链

### Step 1：收集证据

挂点：

- `src/agent-backend/tool-loop.ts`

采集最小证据：

- `traceId`
- `route`
- `workspacePath`
- 用户任务摘要
- action journal
- verify result
- 最终成功/失败状态
- 重试次数
- 工具名序列

只有满足以下任一条件，才进入 Step 2：

- 同一类失败在单任务内重复 2 次以上
- 某个能力发生明显高成本试探
- 某次工作流成功且步骤稳定、可复用

### Step 2：让 LLM 产出 candidate

新增一个内部评估函数，例如：

- `evaluateImprovementCandidate(...)`

输入：

- 任务摘要
- 证据包
- 允许的目标层枚举
- 可写路径白名单

输出 JSON 固定 schema：

```json
{
  "decision": "none|skill|prompt|tool_contract|code",
  "confidence": 0.0,
  "reason": "为什么值得或不值得改进",
  "problem_pattern": "失败/成功模式",
  "evidence": [
    "tool loop step ...",
    "verify failed because ..."
  ],
  "proposed_target_paths": [
    "..."
  ],
  "change_summary": "建议修改什么",
  "replay_hint": "如何回放验证"
}
```

关键约束：

- 不给 LLM 文件系统写权限
- 只让它做分类和内容建议
- 所有 target path 必须被策略层二次校验

### Step 3：策略层过滤

新增一个极薄策略模块，例如：

- `src/improvement/policy.ts`

职责只做三件事：

1. 校验 `decision` 是否在允许枚举中
2. 校验 target path 是否在白名单中
3. 若是 `code`，直接标记为 `proposal_only`

MVP 白名单建议：

- `skill`
  - `src/skills/runtime/*/SKILL.md`
  - `src/skills/runtime/index.json`
- `prompt`
  - `prompts/agents-prompt.md`
  - `prompts/fragments/*.md`
- `tool_contract`
  - 优先是 skill 合同、prompt 片段、工具清单说明
  - 暂不允许直接把 `tool_contract` 自动落到 TS 实现
- `code`
  - 仅建议，禁止自动 apply

### Step 4：落盘 candidate

运行时候选真相源建议：

- `<workspace>/.msgcode/improvement/candidates.jsonl`

可读摘要建议：

- `<workspace>/AIDOCS/improvement/improve-YYMMDD-<traceId>.md`

其中：

- JSONL 作为机器真相源
- Markdown 作为人类审查入口

每条 candidate 必含：

- `id`
- `createdAt`
- `traceId`
- `decision`
- `confidence`
- `problemPattern`
- `evidence`
- `targetPaths`
- `status: suggested|approved|applied|rejected|verified`

### Step 5：显式 apply

新增 CLI，不接入自动主循环：

- `msgcode improve list`
- `msgcode improve show <id>`
- `msgcode improve apply <id>`

`apply` 的行为：

- 只读取 candidate
- 只对 `skill / prompt / tool_contract` 生效
- 生成最小 patch
- patch 目标必须仍在白名单中
- 不允许直接改 `code`

### Step 6：回放验证

apply 后必须立刻执行 replay：

- 优先用原始任务 prompt 重放
- 若涉及工具任务，读取 action journal 关键信号校验
- 至少验证一条：
  - 工具发现步骤减少
  - 错误不再复现
  - 调用路径更直接

验证通过才把 candidate 状态改为 `verified`。

## 目标层的判定口径

### 1. skill

适用：

- 模型不知道该用什么能力
- 模型知道大概方向，但不会正确调用
- 需要固定“何时使用 / 如何调用 / 失败边界”

不适用：

- 工具实现本身坏了
- prompt 全局策略错误

### 2. prompt

适用：

- 多种任务都反复出现同一种行为偏差
- 属于全局执行原则，而不是某个具体能力说明

不适用：

- 只影响单个能力或单个工具

### 3. tool_contract

适用：

- 文档、manifest、skill 合同与真实行为不一致
- 模型是被错误合同误导

MVP 中它优先落在“文档和说明书”，不是直接落到实现代码。

### 4. code

适用：

- 已证明说明书无误，仍然失败
- 实现本体存在真实缺陷

MVP 中只允许建议，不允许自动写代码。

## 为什么不让 LLM 直接改自己

### 原因 1：防止制度权力上收

LLM 可以判断“该不该改”，但不能默认拥有：

- 修改治理边界
- 新增长期结构层
- 扩大正式真相源

### 原因 2：防止运行时漂移

`msgcode` 的正式能力真相源应该仍在 repo：

- `src/skills/runtime/`
- `prompts/`

运行时只能提出候选，不能悄悄长成另一套正式系统。

### 原因 3：防止把偶然成功误判成通用经验

必须经过 replay，才能证明某次改进是“可复用方法”，不是“环境巧合”。

## 最小实现模块

MVP 建议新增最少四个文件：

- `src/improvement/types.ts`
- `src/improvement/policy.ts`
- `src/improvement/store.ts`
- `src/improvement/evaluate.ts`

可选 CLI：

- `src/cli/improvement.ts`

不新增 manager，不新增 daemon，不新增后台学习服务。

## 与现有代码的具体衔接点

### Hook A：候选生成入口

文件：

- `src/agent-backend/tool-loop.ts`

位置：

- 一轮工具任务完成后
- 已经拿到 final result、verify result、action journal 的时点

### Hook B：正式 skill 落点

文件：

- `src/skills/runtime/`
- `src/skills/runtime/index.json`

同步链：

- `src/skills/runtime-sync.ts`

### Hook C：正式 prompt 落点

文件：

- `prompts/agents-prompt.md`
- `prompts/fragments/*.md`

组装链：

- `src/agent-backend/prompt.ts`

### Hook D：未来 recall 证据源

现状可用：

- `src/summary.ts`
- `src/runtime/context-policy.ts`
- `src/memory/store.ts`

但 MVP 不把 recall 并进 self-improvement 主链，只作为后续证据源扩展。

## 红线

以下行为一票否决：

- 运行时自动修改 repo 正式代码
- 自动在用户目录创建正式 skill 并长期生效
- 在没有 replay 的情况下标记“已改进成功”
- 一次 candidate 同时跨 `skill + prompt + code` 多层修改
- 把 user memory、workspace memory、product capability 混写到一个位置

## MVP 里程碑

### M1：候选生成

- 从 `tool-loop` 收证据
- 生成 candidate JSON
- 落盘 JSONL + Markdown

验收：

- 不改任何正式能力文件
- 只新增候选文件

### M2：显式 apply

- 支持 `skill / prompt / tool_contract` 的白名单 patch
- `code` 仅输出建议

验收：

- 生成 patch 前后可审查
- 非白名单路径全部拒绝

### M3：回放验证

- apply 后自动跑最小 replay
- 根据 replay 改状态

验收：

- 没有 replay，不允许 `verified`

## 一句话宪法

`msgcode` 的 self-improvement 不是让系统自己长层，而是让 LLM 把经验变成可审查文件；LLM 负责决定改进内容，系统只负责限制改进边界。 

## 证据

- Code: `/Users/admin/GitProjects/msgcode/src/agent-backend/prompt.ts`
- Code: `/Users/admin/GitProjects/msgcode/src/runtime/context-policy.ts`
- Code: `/Users/admin/GitProjects/msgcode/src/agent-backend/tool-loop.ts`
- Code: `/Users/admin/GitProjects/msgcode/src/skills/runtime-sync.ts`
- Code: `/Users/admin/GitProjects/msgcode/src/memory/store.ts`
- Code: `/Users/admin/GitProjects/msgcode/src/cli/memory.ts`
- Code: `/Users/admin/GitProjects/GithubDown/hermes-agent/agent/prompt_builder.py`
- Code: `/Users/admin/GitProjects/GithubDown/hermes-agent/tools/skill_manager_tool.py`
- Code: `/Users/admin/GitProjects/GithubDown/hermes-agent/tools/memory_tool.py`
