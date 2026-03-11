# P5.7-R11 无子代理执行框架（参考规则提炼落地）

## 目标

在不引入子代理/多进程 agent 的前提下，把 `advance-minimax-m2-cursor-rules` 的可复用方法落地为 msgcode 可执行主链：

1. 工具优先：`Tools before text`
2. 先读后改：`Read before edit`
3. 先验后交：`Verify before deliver`
4. 禁止空谈：`No philosophical essays`

## 范围与约束（冻结）

1. 不新增子代理机制，不新增多模型角色进程。
2. 使用单代理多阶段：`plan -> read -> act -> verify -> report`。
3. 维持现有 `agent-backend` 主链，不回退到 `lmstudio` 命名。
4. 所有策略必须可观测、可测试、可回归锁。

## 子任务拆分

### R11-1 核心规则常驻层

- 文件：`/Users/admin/GitProjects/msgcode/prompts/agents-prompt.md`
- 文件：`/Users/admin/GitProjects/msgcode/src/agent-backend/prompt.ts`
- 目标：
  - 固化四条硬规则（工具优先/先读后改/先验后交/禁空谈）
  - 明确技能索引读取路径和调用优先级
- 验收：
  - `help-docs --json` 不受影响
  - 回归测试锁定硬规则字符串与行为断言

### R11-2 单代理阶段机统一

- 文件：`/Users/admin/GitProjects/msgcode/src/agent-backend/routed-chat.ts`
- 文件：`/Users/admin/GitProjects/msgcode/src/handlers.ts`
- 目标：
  - 把 tool/complex-tool 统一到固定阶段机：`plan -> read -> act -> verify -> report`
  - `tool` 路由至少保留显式 `read/act/verify/report` 阶段日志
- 验收：
  - 阶段顺序可断言
  - 不新增额外无意义 LLM 轮次

### R11-3 先读后改硬门

- 文件：`/Users/admin/GitProjects/msgcode/src/tools/bus.ts`
- 目标：
  - 对 `write_file` / `edit_file` / 高风险 `bash` 改写命令增加前置读检查
  - 若缺失前置读取证据：返回固定错误码（例如 `TOOL_PRECONDITION_FAILED`）
- 验收：
  - 正向链路：read -> edit 成功
  - 反向链路：直接 edit 被拒绝且错误码稳定

### R11-4 验证策略矩阵

- 文件：`/Users/admin/GitProjects/msgcode/src/agent-backend/tool-loop.ts`
- 文件：`/Users/admin/GitProjects/msgcode/src/lmstudio.ts`（兼容层只允许透传）
- 目标：
  - 按工具类型定义最小验证动作：
    - 文件改动：回读 + 差异摘要
    - bash 执行：退出码 + stderr/stdout tail
    - 生成类：输出文件存在 + 大小 > 0
  - `report` 阶段必须消费验证结果，不允许只复述“已完成”
- 验收：
  - actionJournal 新增 verify 证据字段
  - 无验证证据时报告失败而非伪成功

### R11-5 失败升级与降级策略

- 文件：`/Users/admin/GitProjects/msgcode/src/slo-degrade.ts`
- 文件：`/Users/admin/GitProjects/msgcode/src/agent-backend/routed-chat.ts`
- 目标：
  - 定义连续失败升级策略：协议失败/工具失败/空输出失败分开计数
  - 达阈值后自动切换安全路径（安全模型或纯文本模式）
- 验收：
  - 失败计数、触发阈值、恢复条件全可观测
  - 回归锁覆盖升级与恢复

### R11-6 真实冒烟门与派发话术

- 文件：`/Users/admin/GitProjects/msgcode/scripts/`
- 文件：`/Users/admin/GitProjects/msgcode/test/`
- 文件：`/Users/admin/GitProjects/msgcode/AIDOCS/reports/`
- 目标：
  - 形成固定 8~12 条真实能力冒烟脚本（含工具调用与命令调用）
  - 输出标准化验收报告模板（可给 Opus/Codex 共用）
- 验收：
  - 三门：`npx tsc --noEmit` / `npm test` / `npm run docs:check`
  - 冒烟证据可复现且路径固定

## 执行顺序（冻结）

1. `R11-1`
2. `R11-2`
3. `R11-3`
4. `R11-4`
5. `R11-5`
6. `R11-6`

## 风险与决策点

1. `R11-3` 的“先读后改”是否允许自动补一次 `read_file`（默认建议：不自动补，硬失败更可控）。
2. `R11-5` 降级目标优先级：安全模型优先还是纯文本优先（默认建议：先安全模型，二次失败再纯文本）。
3. `R11-6` 冒烟是否纳入 CI（默认建议：先本地 gate，稳定后再入 CI）。

## 验收口径（统一）

1. 必须行为断言，禁止源码字符串强匹配。
2. 必须区分三类失败：`MODEL_PROTOCOL_FAILED` / `TOOL_EXEC_FAILED` / `EMPTY_DISPLAY_OUTPUT`。
3. 必须保证 `actionJournal` 可回放（含 phase、tool、ok、error、duration）。

## 交付物清单

1. 任务单（本文件）
2. 子任务提交记录（每步一提交）
3. 三门 gate 结果
4. 冒烟证据报告（`AIDOCS/reports/`）

## 回链

- Issue: issues/0007-tool-loop-quota-strategy.md
- Plan: docs/design/plan-260306-tool-loop-quota-strategy.md
