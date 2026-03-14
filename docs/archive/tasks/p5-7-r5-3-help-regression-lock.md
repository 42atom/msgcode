# 任务单：P5.7-R5-3（help-docs 同步与回归锁）

优先级：P1

## 目标（冻结）

1. `help-docs --json` 完整暴露 `todo/schedule` 命令合同。
2. 增加回归锁，防止合同漂移、错误码漂移。
3. 固化行为断言口径，禁止源码字符串契约。

## 范围

- `/Users/admin/GitProjects/msgcode/src/cli/help.ts`
- `/Users/admin/GitProjects/msgcode/test/*p5-7-r5-3*.test.ts`
- `/Users/admin/GitProjects/msgcode/test/routes.commands*.test.ts`（如需文案同步）
- `/Users/admin/GitProjects/msgcode/docs/tasks/README.md`

## 非范围

1. 不新增业务命令。
2. 不改 todo/schedule 核心执行逻辑（仅合同与测试锁）。

## 执行步骤（单提交）

1. `test(p5.7-r5-3): add help-docs and regression lock for todo-schedule domain`

## 回归锁清单（冻结）

1. 合同可发现锁：`help-docs --json` 必须出现 `todo`/`schedule` 子命令与参数。
2. 错误码枚举锁：失败场景错误码必须是固定集合，不接受自由文本漂移。
3. 行为断言锁：调用真实接口断言结果结构，不读取源码做字符串匹配。

## 硬验收

1. `npx tsc --noEmit`
2. `npm test`（0 fail）
3. `npm run docs:check`
4. `help-docs --json` 证据可贴出
5. 无新增 `.only/.skip`
