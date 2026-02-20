# 任务单总整理：P5.7-R3 ~ R8（可直接派单）

优先级：P0（主线派发总控）

## 统一前置（必须已满足）

1. `P5.7-R1b` 已合并（file send 真发送闭环）。
2. `P5.7-R1c` 已合并（CLI 基座硬门冻结）。
3. 基座边界冻结：`msgcode` 只做 CLI 能力，不做 skill 编排策略。

## 派单顺序（冻结）

1. `P5.7-R3`：文件与环境域（file + system env）
2. `P5.7-R4`：记忆与线程域（memory + thread）
3. `P5.7-R5`：编排与调度域（todo + schedule）
4. `P5.7-R6`：多模态域（media + gen）
5. `P5.7-R7`：浏览器域（browser）
6. `P5.7-R8`：代理域（agent）

## 依赖关系（冻结）

```text
R3 -> R4 -> R5 -> R6 -> R7 -> R8
```

说明：
- `R3` 先落地基础文件与环境能力，作为后续域的通用底座。
- `R4` 依赖已有记忆与线程基础设施，优先补齐可观测 CLI 访问面。
- `R5` 在状态与记忆域稳定后再加编排，避免多层状态混叠。
- `R6` 引入多模态与外部后端，风险高于前序域。
- `R7` 依赖浏览器执行器，属于高成本能力。
- `R8` 最后收尾，依赖前序域能力作为代理可调用积木。

## 子任务单索引（直接转发）

1. `/Users/admin/GitProjects/msgcode/docs/tasks/p5-7-r3-file-system-domain.md`
2. `/Users/admin/GitProjects/msgcode/docs/tasks/p5-7-r4-memory-thread-domain.md`
3. `/Users/admin/GitProjects/msgcode/docs/tasks/p5-7-r5-todo-schedule-domain.md`
4. `/Users/admin/GitProjects/msgcode/docs/tasks/p5-7-r6-media-gen-domain.md`
5. `/Users/admin/GitProjects/msgcode/docs/tasks/p5-7-r7-browser-domain.md`
6. `/Users/admin/GitProjects/msgcode/docs/tasks/p5-7-r8-agent-domain.md`

## 统一硬验收（所有子任务必须满足）

1. `npx tsc --noEmit`
2. `npm test`（0 fail）
3. `npm run docs:check`
4. `msgcode help-docs --json` 可发现新增命令合同
5. 至少 1 条真实成功证据（非 mock）
6. 至少 1 条真实失败证据（非 mock）
7. 无新增 `.only/.skip`

## 提交纪律（统一）

1. 禁止 `git add -A`。
2. 每步隔离提交；单提交改动文件数 > 20 回滚拆分。
3. 仅提交本单范围文件。
