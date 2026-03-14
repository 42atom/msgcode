# P5.6.8-R4g：PI 核心四工具可用性收口（`bash pwd` 真实执行）

## 背景

当前已完成 `pi.on` 四工具暴露（`read_file/write_file/edit_file/bash`），但运行时出现硬门漂移：

- LLM 侧调用 `bash`
- workspace `tooling.allow` 仍是旧集合（`shell` 等），导致 `TOOL_NOT_ALLOWED`
- 最终表现为“工具幻想执行”（模型文本声称执行了命令，日志却无真实工具调用）

这与 Pi 参考实现（四核心工具直达）不一致，属于阻塞级问题。

## 目标（冻结）

1. `pi.on` 时，四核心工具必须可执行：`read_file/write_file/edit_file/bash`
2. `pi.off` 时，不向模型暴露工具（保持普通 direct 聊天 + 记忆）
3. 消除 `bash/shell` 命名漂移，避免同能力双命名造成门禁误判
4. 三工作区冒烟中，`pwd` 必须走真实工具执行并回传真实路径

## 实施范围

- `src/config/workspace.ts`
- `src/routes/cmd-tooling.ts`
- `src/routes/cmd-model.ts`
- `src/tools/bus.ts`
- `src/lmstudio.ts`
- `test/*`
- `docs/tasks/*`

## 实施项

1. 配置真相源收口
   - 默认 `tooling.allow` 与 Pi 四工具口径一致（至少包含 `bash`）
   - `pi on` 时自动修复 workspace 工具白名单（确保四工具可执行）
2. 命名收口
   - 命令面与校验面统一使用 `bash`（不再对外暴露旧 `shell` 名）
   - Tool Bus 内部保留最小兼容映射仅用于迁移期读取，禁止继续扩散
3. 运行时硬锁
   - 新增回归锁：`pi.on + bash pwd` 必须 `toolCallCount>0` 且 `toolName=bash`
   - 新增回归锁：禁止“无工具调用却返回伪执行文本”
4. 三工作区冒烟
   - `medicpass/charai/game01` 全量复测：`/pi on` 后自然语言触发 `pwd`
   - 证据字段：`toolCallCount`、`toolName`、`stdout`（真实路径）

## 验收

- `npx tsc --noEmit` ✅
- `npm test` ✅（msgcode 0 fail；imessage-kit 失败按白名单）
- `npm run docs:check` ✅
- `node scripts/test-gate.js` ✅
- 三工作区 `pwd` 冒烟：真实执行通过（非文本幻想）✅

## 非范围

- 不改 tmux 管道语义
- 不新增能力命令层
- 不恢复 `/skill run`、`run_skill` 或旧三工具协议
