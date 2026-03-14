# P5.6.8-R4g-R1：`bash/shell` 类型与门禁硬收口

## 背景

当前存在阻塞级漂移：

- 工具面主口径已是 `bash`
- 配置/历史代码仍残留 `shell`
- 触发结果：`npx tsc --noEmit` 在 `src/tools/bus.ts` 报类型冲突，且运行时可能出现 `TOOL_NOT_ALLOWED`

这会直接导致“模型声称执行了命令，但实际上没过 Tool Bus”。

## 目标（冻结）

1. 单一真相源统一为 `bash`（不再对外暴露 `shell`）
2. TypeScript 绿灯（清零 `ToolName` 与 `switch case` 口径冲突）
3. `pi.on` 下 `pwd` 必须真实走 `bash` 工具执行链

## 实施范围

- `src/tools/types.ts`
- `src/tools/bus.ts`
- `src/config/workspace.ts`
- `src/routes/cmd-tooling.ts`
- `src/routes/cmd-model.ts`
- `test/*`（工具门禁与路径回归）

## 实施项

1. 类型收口
   - `ToolName` 仅保留 `bash`，去除外显 `shell`
   - `TOOL_META`、`executeTool` 分支与类型定义完全对齐
2. 配置收口
   - 默认 `tooling.allow` 从 `shell` 迁移为 `bash`
   - 对旧 workspace 配置做一次性映射（读到 `shell` 自动折算为 `bash`）
3. 命令面收口
   - `/tool allow` 可见工具列表统一显示 `bash`
   - 拒绝新增 `shell` 配置写入
4. 回归锁
   - `pi.on + pwd`：断言 `toolCallCount>0` 且 `toolName=bash`
   - 静态扫描：主链关键路径不再出现 `tool: shell`（允许历史文档）

## 验收

- `npx tsc --noEmit` ✅
- `npm test` ✅（msgcode 0 fail；imessage-kit 按白名单）
- `npm run docs:check` ✅
- 三工作区冒烟：`pwd` 真执行证据完整 ✅

## 非范围

- 不改 tmux 管道
- 不恢复 `/skill run`/`run_skill`
- 不扩展新工具能力
