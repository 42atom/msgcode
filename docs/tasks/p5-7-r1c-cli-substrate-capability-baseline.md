# 任务单：P5.7-R1c（CLI 基座能力硬门）

优先级：P0（后续所有能力单的前置门禁）

## 目标（冻结）

1. 固化 `msgcode` 基座边界：只提供能力，不替模型决策，不承载 skill 策略。
2. 建立统一硬门：命令语义必须等于真实行为，禁止“合同壳验收”。
3. 建立统一观测与错误码口径：所有新增命令都能被稳定验收、稳定回归。
4. 形成可复用模板，供 `P5.7-R3+` 直接套用。

## 背景（问题本质）

`P5.7-R1` 暴露出“命令名与真实行为不一致”的风险。  
如果不先收紧基座硬门，后续能力扩展会出现“看起来可用、实际不可用”的漂移，最终影响模型调用稳定性。

## 设计口径（单一真相）

### 1) 基座边界

1. `msgcode` 只负责本地 CLI 能力实现与合同输出。
2. 不在 `msgcode` 内实现 skill 编排策略、任务分配策略、模型提示策略。
3. 命令接口以 Unix 风格为优先（短语义命令 + 明确参数 + 明确 exit code）。

### 2) 能力硬门（新增命令必须满足）

1. 命令语义与行为一致（例如 `send` 必须真发送）。
2. 至少 1 条真实成功证据（非 mock）。
3. 至少 1 条真实失败证据（非 mock，错误码可断言）。
4. `help-docs --json` 必须能发现命令合同。
5. 错误码必须固定枚举，不允许仅文本提示。

### 3) 安全底线（本地信任边界下的最小约束）

1. 禁止静默副作用：关键操作必须显式参数触发。
2. 禁止“伪成功”：失败必须返回错误码与非 0 退出码。
3. 破坏性操作必须要求显式确认参数（如 `--force`），不得隐式执行。

## 范围

- `/Users/admin/GitProjects/msgcode/docs/tasks/p5-7-cli-first-skill-expansion-master-plan.md`
- `/Users/admin/GitProjects/msgcode/docs/tasks/README.md`
- `/Users/admin/GitProjects/msgcode/docs/tasks/p5-7-r1c-cli-substrate-capability-baseline.md`
- 必要时补充：
  - `/Users/admin/GitProjects/msgcode/test/*p5-7*.test.ts`（新增门禁类测试）
  - `/Users/admin/GitProjects/msgcode/src/cli/help.ts`（合同字段增强）

## 非范围

1. 不新增业务能力命令（如 file/web/system 以外新能力）。
2. 不改 tmux/agent 主链路架构。
3. 不实现 skill 调度与提示词策略。

## 执行步骤（每步一提交）

### R1：硬门清单落文档

提交建议：`p5-7-r1c-hard-gate-doc-freeze`

1. 将“基座边界 + 能力硬门 + 安全底线”写入总纲与索引。
2. 明确后续任务必须引用本单口径。

### R2：合同模板升级

提交建议：`p5-7-r1c-contract-template-upgrade`

1. 在任务模板中新增“真实成功/失败证据”字段。
2. 在验收模板中新增“退出码 + 错误码 + 日志字段”核验项。

### R3：门禁回归锁（可选但推荐）

提交建议：`p5-7-r1c-gate-regression-lock`

1. 新增静态测试，检查新增命令任务是否包含真实链路项。
2. 新增静态测试，阻止 `.only/.skip` 漏网。

## 硬验收（必须全过）

1. `npx tsc --noEmit`
2. `npm test`（0 fail）
3. `npm run docs:check`
4. `P5.7` 总纲与索引均可见 `R1c` 条目
5. 后续任务模板已包含“真实成功/真实失败”验收项

## 提交纪律

1. 禁止 `git add -A`
2. 单提交变更文件数 > 20 回滚重做
3. 仅提交本单范围文件

## 验收回传模板（固定口径）

```md
# P5.7-R1c 验收报告（CLI 基座能力硬门）

## 提交
- <sha> <message>

## 变更文件
- <path>

## Gate
- npx tsc --noEmit:
- npm test:
- npm run docs:check:

## 口径冻结证据
- 基座边界:
- 能力硬门:
- 安全底线:

## 风险与遗留
- 风险:
- 遗留:
```
