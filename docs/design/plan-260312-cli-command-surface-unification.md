# plan-260312-cli-command-surface-unification

## Problem

`msgcode` 的二进制命令面已经不像早期那样散乱，但仍然存在三类主链污染：

1. 公开合同与可执行面还不完全一致  
   例：`memory remember/status` 仍可执行，但 `help-docs` 只暴露 `add/stats`
2. 不同 domain 的命令语言不一致  
   例：`file` 更接近标准 Unix 动词集，而 `browser`、`memory` 仍混有历史业务词汇
3. 程序合同和 `SKILL.md` 的职责边界还没有冻结  
   导致 LLM 不清楚该优先查 `help_docs`，还是完全依赖 skill 文案

参考文档 [CLI is All Agents Need](/Users/admin/GitProjects/msgcode/docs/design/plan-260312-cli-is-all-agents-need-reference.md) 给出的启发是对的：CLI 合同应该成为 Agent 的正式骨架。但 msgcode 当前不是输在“功能少”，而是输在“骨架还没完全收正”。

## Occam Check

### 1. 不加它，系统具体坏在哪？

- 继续出现“实际可执行命令”和“公开合同”双真相源
- LLM 不能稳定通过 `help_docs` 自发现命令，只能靠 skill 文案硬记
- 历史 alias/退役壳继续污染主命令面，降低二进制的第一公民价值

### 2. 用更少的层能不能解决？

- 能。关键不是新增控制层，而是冻结一条最薄规则：
  - **二进制程序与 `help-docs` 是正式合同**
  - **`SKILL.md` 是使用说明书**
- 然后按 domain 收口命令语法，不需要再造新的协议面

### 3. 这个改动让主链数量变多了还是变少了？

- 变少了。它消灭的是“程序合同 / skill 合同 / 历史 alias”并行漂移的多条口径。

## Decision

推荐方案：**程序优先，skill 辅助。**

### 冻结决策

1. **二进制程序是正式合同**
   - 真实可运行入口是 `msgcode ...`
   - root lifecycle/admin 命令的正式人工合同是 `msgcode --help`
   - agent/LLM 侧操作命令的机器可读正式合同是 `msgcode help-docs --json`

2. **`help_docs` 是 LLM 主探索路径**
   - 当模型不确定**操作类**命令合同，应先查 `help_docs`
   - `help_docs` 不负责 daemon/lifecycle/admin 根命令
   - 不再让 skill 承担“命令契约真相源”职责

3. **`SKILL.md` 是说明书，不是真合同**
   - 负责 `When to Use`
   - 负责最佳实践、失败路径、例子
   - 不负责定义真正的命令签名与参数真相源

4. **命令统一目标是 `msgcode <domain> <verb>`**
   - root 仅保留 lifecycle/admin 命令：
     - `start/stop/restart/status/probe/doctor/about/help-docs/init`
   - 业务能力优先进入 domain 子命令

## Alternatives

### 方案 A：程序是真合同，skill 是说明书

优点：
- 单一真相源最清晰
- 二进制价值最大化
- LLM、人类用户、自动化脚本共用同一合同面

缺点：
- 需要对历史 alias 做一次系统清理
- 要补 LLM 对 `help_docs` 的使用习惯

### 方案 B：skill-first，程序只是人类入口

不推荐。

原因：
- 会让 `SKILL.md` 与 CLI 实现长期双轨
- 命令合同漂移会越来越难收
- 与“二进制是第一公民”目标冲突

### 方案 C：保持现状，让 `help-docs` 与 alias 共存

不推荐。

原因：
- 只是延迟问题，不是解决问题
- LLM 和用户仍要面对多种语言风格

## Plan

### Phase 0：冻结命令消费协议

目标：把“谁是真合同”写死。

动作：
- 保持 `help-docs` 为唯一机器可读合同出口
- 在提示词与 skill 文案里统一写死：
  - 不确定命令时先查 `help_docs`
  - skill 只解释怎么用，不再自带私有合同

验收：
- 文档与提示词不再出现“skill 自定义命令合同”口径

### Phase 1：做命令面审计表

目标：把当前可执行面分类清楚。

分类：
- `canonical`：正式公开、推荐使用
- `alias`：暂时兼容，不公开为主合同
- `retired`：显式退役壳，仅用于报错迁移
- `internal`：只服务内部/调试，不进入主合同

优先审计：
- `memory`
- `browser`
- `file`
- `skills`
- root lifecycle/admin

验收：
- 每个 domain 有一张 canonical/alias/retired 对照表

### 当前审计快照（2026-03-12）

#### Root operator/admin canonical

- `start`
- `stop`
- `restart`
- `allstop`
- `init`
- `status`
- `probe`
- `doctor`
- `about`

说明：
- 这些命令继续通过 `msgcode --help` 暴露
- 它们属于操作员/运维入口，不进入 `help-docs` 的 agent-facing 合同

#### Agent-facing canonical

- `file find|read|write|delete|move|copy`
- `web search|fetch`
- `system info|env`
- `memory add|search|stats`
- `thread list|messages|active|switch`
- `todo add|list|done`
- `schedule add|list|remove|enable|disable`
- `media screen`
- `gen image|selfie|tts|music`
- `browser root|profiles list|instances list|instances launch|instances stop|tabs open|tabs list|snapshot|text|action|eval`
- `help-docs`

#### Canonical but operator/internal-facing

- `job add|list|status|enable|disable|delete`
- `preflight`
- `run`

说明：
- 这些命令是真实主链的一部分，但不属于当前 LLM 首选探索面
- 因此保留在程序里，不进入 `help-docs` 的 agent-facing 合同

#### Aliases

- `jobs -> job`
- `skills -> skill`
- `memory remember -> memory add`
- `memory status -> memory stats`
- `browser gmail-readonly -> browser-gmail-readonly`

#### Retired

- `file send`
- `skill`

#### Internal compat

- `browser-gmail-readonly`
- `gen-image`
- `gen-audio`

### Phase 2：统一命令语言

目标：减少不同 domain 的方言。

建议优先顺序：

1. `memory`
   - canonical 目标：`add/search/index/get/stats`
   - alias：`remember/status`

2. `browser`
   - 继续保留 `profiles/instances/tabs` 这类对象分层
   - 评估 `gmail-readonly` 是否转为 retired/internal

3. `file`
   - 基本已接近目标
   - 继续保持 `find/read/write/delete/move/copy`
   - `file send` 继续作为 retired 壳，后续评估是否彻底退出二进制主面

验收：
- `help-docs` 与实际推荐用法一致
- legacy/alias 不再污染公开合同

### Phase 3：让 LLM 真正通过程序消费

目标：让模型先走程序合同，再看 skill。

动作：
- 在主提示词中明确：
  - 原生工具优先
  - 不确定 CLI 合同时先查 `help_docs`
  - skill 只在需要边界、步骤、经验时加载
- 对关键 domain 做真实 BDD：
  - `browser`
  - `memory`
  - `file`

验收：
- 自然语言任务里，模型能通过 `help_docs` 和 CLI 合同完成探索

### Phase 4：移除历史污染项

候选：
- `memory remember`
- `memory status`
- `browser gmail-readonly`
- 其他只剩迁移价值的 retired 壳

原则：
- 先退公开合同
- 再退代码主面
- 保留必要过渡期

## Risks

1. **过度统一，伤到现有有效工作流**
   - 回滚：保留 alias 但从公开合同移除，不立即删代码

2. **把 skill 价值削弱成无用注释**
   - 缓解：skill 不退役，仍负责 `When to Use`、最佳实践与失败路径

3. **LLM 一时还不会稳定先查 `help_docs`**
   - 缓解：通过提示词和真实 BDD 验收逐步训练，不新增控制层

## Test Plan

后续实现阶段至少验证：

- `help-docs --json` 是否覆盖所有 canonical 命令
- alias 是否仍可执行但不进入正式合同
- 真实自然语言任务里，模型是否能通过 `help_docs` 自发现命令
- 真实 Feishu BDD 中，browser/file/memory 三类任务是否能走 canonical 命令面

## 评审意见

[留空,用户将给出反馈]
