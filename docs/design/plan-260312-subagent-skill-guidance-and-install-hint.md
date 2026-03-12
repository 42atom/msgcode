# plan-260312-subagent-skill-guidance-and-install-hint

## Problem

用户已经明确希望主脑能把任务委派给 `codex` / `claude-code` 这类子代理执行臂，并持续监控执行状态。但 msgcode 当前只有 tmux 执行臂骨架，还没有正式的 `subagent` 命令或原生 tool 合同。如果此时直接让 skill 假装“子代理能力已完整接线”，会再次制造程序合同与说明书双真相源。

因此这轮要先做最小正确动作：**用一个诚实的 optional skill，把“什么时候该委派、如何写子任务卡、如何验收、缺能力时怎么提示安装”收成说明书**，而不是先伪造主链。

## Occam Check

### 1. 不加它，系统具体坏在哪？

- 主脑没有统一说明书，只能临时猜“怎么把任务交给 codex/claude-code”
- 用户已经明确提出子代理模式，但仓库里还没有一个正式的 skill 去教主脑如何拆任务、如何监控、如何验收
- 后续即使接了 `subagent` 正式命令，也缺少一份可复用的 delegation 说明书

### 2. 用更少的层能不能解决？

- 能。先做一个 optional skill 就够，不需要马上加 `subagent` tool、控制面或自动路由器
- 这个 skill 必须保持诚实：当前程序没有正式合同，就明确告诉模型先检查，再决定是否可委派

### 3. 这个改动让主链数量变多了还是变少了？

- 变少了。它避免用一堆临时 prompt/聊天记忆去解释“子代理怎么做”，把这条知识收成一份可同步的说明书

## Decision

推荐方案：**先做 `subagent` optional skill，暂不实现 `subagent` runtime 主链。**

核心理由：

1. 符合“程序是真合同，skill 是说明书”
2. 符合奥卡姆剃刀：先写说明书，不先造控制层
3. 能直接服务后续真正的 `msgcode subagent ...` 主链接线

## Plan

### 1. 新增 `subagent` optional skill

文件：

- `src/skills/optional/subagent/SKILL.md`

要求：

- 名称简单，便于主脑识别
- 说明何时适合委派给子代理
- 给出子任务卡模板：
  - `goal`
  - `context`
  - `cwd`
  - `constraints`
  - `acceptance`
  - `artifact`
- 给出监控与验收要点：
  - 唯一 token
  - 必须核验产物
  - 不要只转述子代理口头结果

### 2. 明确安装提示与诚实边界

skill 必须写明：

- 优先检查 `help_docs` 是否已存在正式 `subagent` 合同
- 当前若没有正式 `subagent` 命令/tool，不得假装已委派
- 若机器未安装 `codex` / `claude-code`，应提示用户安装以获得更强能力
- `claude-code` 当前在 tmux 执行臂层对应的是 `claude` CLI

### 3. 更新 optional skill 索引与 README

文件：

- `src/skills/optional/index.json`
- `src/skills/README.md`

### 4. 补测试

文件：

- `test/p5-7-r13-runtime-skill-sync.test.ts`
- `test/p5-7-r35-subagent-skill-contract.test.ts`

验收点：

- `subagent` 会被同步到 optional skill 层
- 索引描述、README 目录树与 skill 正文一致
- skill 正文明确写到安装提示、未来正式合同与贪吃蛇 BDD 示例

## Risks

### 风险 1：skill 文案越界，假装已有正式合同

规避：

- 在 `SKILL.md` 里明确标“当前状态”
- 强制写明：先查 `help_docs`，再决定是否委派

### 风险 2：skill 名过长，主脑不易识别

规避：

- 采用最短可识别名称：`subagent`

### 风险 3：skill 与未来程序合同漂移

规避：

- skill 中把 `msgcode subagent run ...` 标注为“未来正式合同”
- 后续接线时以该 skill 为说明书基线，不再另起命名

## 评审意见

[留空,用户将给出反馈]
