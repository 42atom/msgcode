# P5.6.2-R1：后置回归修复（Direct ToolLoop + /reload SOUL + 记忆链路）

## 触发背景

P5.6.2 执行期间发现两处回归：

1. 聊天主链部分路径回退到 `runLmStudioChat`，导致思考输出变长、工具闭环缺失、偶发“无可展示内容”。
2. `/reload` 输出缺少 SOUL 状态，无法确认工作区 SOUL 是否被正确加载。
3. direct 聊天链路未稳定接入短期会话窗口读写，造成“记不住上下文”体感。

本单排在 `P5.6.2` 完成后执行，作为后置收口。

## 目标

1. 非 slash 聊天主链统一走 `runLmStudioToolLoop`。
2. `/reload` 恢复 SOUL 可观测输出（workspace + global）。
3. 恢复短期会话窗口读写（`loadWindow/appendWindow`）并补回归锁。
4. 增加回归锁，防止再次回退。

## 范围

- `src/handlers.ts`
- `src/routes/commands.ts`
- `src/session-window.ts`（只复用，不改模型）
- `test/*`（新增/更新回归测试）

## 非范围

- 不改 SOUL 数据模型
- 不改 Skill 协议
- 不改 provider 架构

## 实施项

### R1 主链收口
- 将聊天主链中 `runLmStudioChat(...)` 回退点改为 `runLmStudioToolLoop(...)`。
- 保持 `tool_calls` 主路径与日志字段不变。

### R2 会话窗口链路恢复
- 非 slash direct 聊天前读取 `loadWindow(...)`，作为短期上下文输入。
- 成功回复后写回 `appendWindow(...)`（user + assistant 双向写回）。
- 失败路径不写回 assistant，避免脏上下文。

### R3 /reload SOUL 可观测
- 在 `/reload` 输出中补回：
  - `SOUL: workspace=已发现/未发现 (...)`
  - `SOUL Entries: N (sources=...)`

### R4 回归锁
- 测试锁 1：非 slash 聊天路径必须调用 tool loop。
- 测试锁 2：短期窗口必须发生 `loadWindow/appendWindow`。
- 测试锁 3：`/reload` 输出必须包含 SOUL 行。

## 回滚节点盘点（并入 R1 执行）

> 说明：以下为基于当前仓库历史与分支状态的推测清单，用于指导恢复顺序。

1. **P4.10-B/C/E 主链能力未并入当前主线**
   - 现象：`src/handlers.ts` 主链仍走 `runLmStudioChat(...)`，`runLmStudioToolLoop(...)` 未接入。
   - 影响：工具闭环、短期窗口、继续语义无法稳定生效。
2. **P0 SOUL 过滤修复疑似丢失**
   - 现象：`p0-fix` 位于未并入分支（`codex/p5-3-r2b-rebuild`）。
   - 影响：存在 SOUL 注入被错误过滤风险。
3. **/reload SOUL 可观测曾被回退**
   - 现象：`/reload` 输出仅见 `Skills`，缺少 `SOUL:` 与 `SOUL Entries:`。
   - 影响：现场排障缺失关键观测锚点。

## 最小恢复顺序（R1 执行顺序）

1. **先收主链执行器**：`handlers` 非 slash 聊天统一切到 `runLmStudioToolLoop(...)`。
2. **再接短期窗口**：在 direct 聊天路径恢复 `loadWindow/appendWindow` 双向读写。
3. **补可观测**：恢复 `/reload` 的 SOUL 输出两行。
4. **最后补锁**：新增/更新三类回归测试（tool loop、window、reload SOUL）。

## 硬验收

| 验收项 | 命令/检查 | 结果 |
|---|---|---|
| TypeScript 编译 | `npx tsc --noEmit` | ✅ |
| 单元/集成测试 | `npm test`（0 fail） | ✅ |
| 文档同步检查 | `npm run docs:check` | ✅ |
| 主链一致性 | `rg -n "runLmStudioChat\\(" src/handlers.ts` 仅保留允许位置 | ✅ |
| 记忆链路 | `rg -n "loadWindow|appendWindow" src/handlers.ts` 命中主链 | ✅ |
| 可观测性 | `/reload` 输出含 `SOUL:` | ✅ |

## 回滚

```bash
git checkout -- src/handlers.ts src/routes/commands.ts test
```
