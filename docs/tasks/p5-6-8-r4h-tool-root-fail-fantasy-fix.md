# P5.6.8-R4h：Tool Root 单一真相 + 失败防幻想 + PI Agent 对齐

## 背景

当前工具执行存在三大阻塞级问题：

1. **根路径错误**：`runTool(..., root)` 传递了错误的根路径，导致工具在工作目录外执行
2. **失败幻想执行**：工具返回 error 后，模型仍生成"伪执行文本"，误导用户以为命令成功
3. **shell 残留**：类型、配置、测试仍有 `shell` 引用，与已完成的 `bash` 收口冲突

这导致 `pi.on + bash pwd` 返回错误路径或直接失败。

## 目标（冻结）

1. 工具执行根路径正确传递（workspacePath）
2. 工具失败时直接返回结构化错误，禁止伪执行文本
3. 彻底清除 `shell` 残留，统一使用 `bash`
4. 日志观测完整（toolErrorCode/toolErrorMessage/exitCode）
5. direct/PI on 下 `bash pwd` 必须返回真实工作区路径

## 实施范围

- `src/lmstudio.ts`
- `src/tools/bus.ts`
- `src/config/workspace.ts`
- `src/routes/cmd-tooling.ts`
- `test/*`
- `docs/tasks/*`

## 实施项

### R4h-1: 修根路径

- `src/lmstudio.ts`: 把 `runTool(..., root)` 改为 `runTool(..., workspacePath)`
- 确保 Tool Bus 的 `ctx.workspacePath` 是唯一真相源

### R4h-2: 失败短路

- `src/lmstudio.ts`: 工具返回 `error` 时不再走第二轮"总结"
- 直接返回结构化失败文案：
  ```
  工具执行失败
  - 工具: {toolName}
  - 错误码: {toolErrorCode}
  - 错误: {toolErrorMessage}
  ```
- 禁止模型生成"伪执行文本"（如"已执行 pwd 命令"）

### R4h-3: 命名收口（验证）

- 验证 `shell` 已在 R4g 中完全清除
- 验证类型、配置、测试口径统一为 `bash`
- 如发现残留，立即清理

### R4h-4: 观测补全

- `src/lmstudio.ts`: 日志追加字段
  - `toolErrorCode`: 工具错误码（如 TOOL_NOT_ALLOWED）
  - `toolErrorMessage`: 工具错误消息
  - `exitCode`: bash 命令退出码

### R4h-5: 回归锁

- `test/p5-6-8-r4h-root-path.test.ts`: 根路径一致性测试
- `test/p5-6-8-r4h-fail-short-circuit.test.ts`: 失败防幻想测试
- `test/p5-6-8-r4h-bash-only.test.ts`: bash 唯一命名锁测试

## 验收

- `npx tsc --noEmit` ✅
- `npm test` ✅（msgcode 核心 0 fail）
- `npm run docs:check` ✅
- 三工作区冒烟：`pwd` 必须返回真实工作区绝对路径，且日志无"伪执行"文本 ✅

## 非范围

- 不改 tmux 管道语义
- 不新增工具能力
- 不恢复 `/skill run`/`run_skill`
