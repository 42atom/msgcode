# 任务单：P5.7-R4-1（memory 命令合同收口）

优先级：P1

## 目标（冻结）

1. 落地 `msgcode memory search`。
2. 落地 `msgcode memory add`。
3. 落地 `msgcode memory stats`。
4. 固定失败码与退出码语义，返回结构可稳定断言。

## 范围

- `/Users/admin/GitProjects/msgcode/src/cli/memory.ts`（新增或扩展）
- `/Users/admin/GitProjects/msgcode/src/cli/help.ts`（仅 memory 合同项）
- `/Users/admin/GitProjects/msgcode/test/*p5-7-r4-1*.test.ts`

## 非范围

1. 不改 thread 命令。
2. 不改 ToolLoop 注入策略。
3. 不改路由主链。

## 执行步骤（单提交）

1. `feat(p5.7-r4-1): add memory search add stats commands with fixed contract`

## 合同口径（冻结）

1. `search`：查询词为空必须失败，错误码固定。
2. `add`：必填字段缺失必须失败，错误码固定。
3. `stats`：无数据时也返回成功结构，不允许伪失败。

## 硬验收

1. `npx tsc --noEmit`
2. `npm test`（0 fail）
3. `npm run docs:check`
4. 至少 1 条真实成功证据 + 1 条真实失败证据
5. 无新增 `.only/.skip`
