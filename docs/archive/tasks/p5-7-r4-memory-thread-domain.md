# 任务单：P5.7-R4（记忆与线程域：memory + thread）

优先级：P1（R3 通过后执行）

## 目标（冻结）

1. 落地 `memory` 域命令：
   - `msgcode memory search`
   - `msgcode memory add`
   - `msgcode memory stats`
2. 落地 `thread` 域命令：
   - `msgcode thread list`
   - `msgcode thread messages`
   - `msgcode thread active`
   - `msgcode thread switch`
3. `thread switch` 必须回传强确认（active thread snapshot）。
4. 全部命令进入 `help-docs --json` 合同。

## 依赖

1. 依赖已有 memory 存储与索引能力。
2. 依赖已有 thread 持久化（`.msgcode/threads`）能力。
3. 不改现有注入策略，仅提供 CLI 访问面。

## 范围

- `/Users/admin/GitProjects/msgcode/src/cli/memory.ts`
- `/Users/admin/GitProjects/msgcode/src/cli/thread.ts`（如新增）
- `/Users/admin/GitProjects/msgcode/src/cli/help.ts`
- `/Users/admin/GitProjects/msgcode/test/*p5-7-r4*`
- `/Users/admin/GitProjects/msgcode/docs/tasks/README.md`

## 非范围

1. 不改 ToolLoop 记忆注入策略。
2. 不改会话路由主链。
3. 不改 schedule/todo。

## 执行步骤（每步一提交）

### R4-1：memory 命令面

提交建议：`feat(p5.7-r4): add memory search add stats commands`

### R4-2：thread 命令面

提交建议：`feat(p5.7-r4): add thread list messages active switch commands`

### R4-3：合同同步 + 回归锁

提交建议：`test(p5.7-r4): add memory-thread regression lock`

## 硬验收（必须全过）

1. `npx tsc --noEmit`
2. `npm test`（0 fail）
3. `npm run docs:check`
4. `help-docs --json` 可发现 memory/thread 命令
5. 真实成功证据：`memory search` + `thread switch`
6. 真实失败证据：无效 thread id / 无效 memory 参数
7. 无新增 `.only/.skip`
