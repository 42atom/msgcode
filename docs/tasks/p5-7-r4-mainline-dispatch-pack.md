# 任务单总整理：P5.7-R4（记忆与线程域派单包）

优先级：P1（`P5.7-R3l` 闭环后立即执行）

## 目标（冻结）

1. 落地 `memory` 命令面：`search/add/stats`。
2. 落地 `thread` 命令面：`list/messages/active/switch`。
3. 完成 `help-docs --json` 合同同步与回归锁。
4. 测试全部使用行为断言，禁止源码字符串匹配。

## 子任务顺序（冻结）

1. `P5.7-R4-1`：memory 命令合同与失败码收口
2. `P5.7-R4-2`：thread 命令与 active snapshot 强确认
3. `P5.7-R4-3`：help-docs 同步 + 回归锁
4. `P5.7-R4-T1`：Memory/Thread 真机冒烟门禁（R5 前置）

## 依赖关系（冻结）

```text
R4-1 -> R4-2 -> R4-3
            \-> R4-T1

R4-3 + R4-T1 -> R5
```

## 子任务索引（可直接派发）

1. `/Users/admin/GitProjects/msgcode/docs/tasks/p5-7-r4-1-memory-contract.md`
2. `/Users/admin/GitProjects/msgcode/docs/tasks/p5-7-r4-2-thread-contract.md`
3. `/Users/admin/GitProjects/msgcode/docs/tasks/p5-7-r4-3-help-regression-lock.md`
4. `/Users/admin/GitProjects/msgcode/docs/tasks/p5-7-r4-t1-smoke-verification-gate.md`

## 统一硬验收（所有子任务必须满足）

1. `npx tsc --noEmit`
2. `npm test`（0 fail）
3. `npm run docs:check`
4. 成功证据：至少 1 条 `memory` 与 1 条 `thread switch` 真实成功链路
5. 失败证据：至少 1 条固定错误码（如 `NOT_FOUND` / `TOOL_BAD_ARGS`）
6. 无新增 `.only/.skip`
7. 禁止源码字符串断言（`readFileSync(...src/*)` + `toContain("phase:")`）

## 提交纪律（统一）

1. 禁止 `git add -A`。
2. 每步隔离提交；每提交只包含当前子任务所需文件。
3. 发现非本单改动，暂停并上报。
