# 任务单：P5.7-R8（代理域：agent）

优先级：P2（R7 通过后执行，P5.7 收尾）

## 目标（冻结）

1. 落地 `agent run` / `agent status`。
2. 支持同步返回与异步任务返回两种合同。
3. 状态机枚举固定：`pending|running|completed|failed|cancelled`。
4. 保持边界：CLI 只做代理任务派发与状态查询，不做策略编排。

## 依赖

1. 依赖前序域能力成熟（R3-R7）。
2. 依赖统一任务存储与状态跟踪机制。

## 范围

- `/Users/admin/GitProjects/msgcode/src/cli/agent.ts`
- `/Users/admin/GitProjects/msgcode/src/cli/help.ts`
- `/Users/admin/GitProjects/msgcode/test/*p5-7-r8*`
- `/Users/admin/GitProjects/msgcode/docs/tasks/README.md`

## 非范围

1. 不改模型策略层。
2. 不改 skill 提示词注入。

## 执行步骤（每步一提交）

1. `feat(p5.7-r8): add agent run and status commands`
2. `test(p5.7-r8): add agent-domain regression lock`

## 硬验收（必须全过）

1. `npx tsc --noEmit`
2. `npm test`（0 fail）
3. `npm run docs:check`
4. `help-docs --json` 可发现 agent 命令
5. 真实成功证据：同步任务完成或异步任务可追踪
6. 真实失败证据：非法 role / 非法 task id
7. 无新增 `.only/.skip`
