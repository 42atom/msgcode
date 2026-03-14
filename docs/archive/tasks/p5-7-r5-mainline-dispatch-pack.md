# 任务单总整理：P5.7-R5（Todo/Schedule 域派单包）

优先级：P1（`P5.7-R4` 闭环后执行）

## 目标（冻结）

1. 落地 `todo` 命令面：`add/list/done`。
2. 落地 `schedule` 命令面：`add/list/remove`。
3. 完成 `help-docs --json` 合同同步与回归锁。
4. 测试全部使用行为断言，禁止源码字符串匹配。

## 子任务顺序（冻结）

1. `P5.7-R5-1`：todo 命令合同与状态流收口
2. `P5.7-R5-2`：schedule 命令合同与 cron 错误码收口
3. `P5.7-R5-3`：help-docs 同步 + 回归锁 + 冒烟证据

## 依赖关系（冻结）

```text
R5-1 -> R5-2 -> R5-3
```

## 子任务索引（可直接派发）

1. `/Users/admin/GitProjects/msgcode/docs/tasks/p5-7-r5-1-todo-contract.md`
2. `/Users/admin/GitProjects/msgcode/docs/tasks/p5-7-r5-2-schedule-contract.md`
3. `/Users/admin/GitProjects/msgcode/docs/tasks/p5-7-r5-3-help-regression-lock.md`

## 统一硬验收（所有子任务必须满足）

1. `npx tsc --noEmit`
2. `npm test`（0 fail）
3. `npm run docs:check`
4. 成功证据：至少 1 条 todo 状态翻转 + 1 条 schedule 新增后可列出
5. 失败证据：至少 1 条非法 cron + 1 条非法 task/schedule id
6. 无新增 `.only/.skip`
7. 禁止源码字符串断言（`readFileSync(...src/*)` + `toContain("phase:")`）

## 提交纪律（统一）

1. 禁止 `git add -A`。
2. 每步隔离提交；每提交只包含当前子任务所需文件。
3. 发现非本单改动，暂停并上报。
