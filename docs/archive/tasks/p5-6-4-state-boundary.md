# P5.6.4：状态域边界化

## 背景

当前状态存储边界不清：
- `/clear` 可能误删长期记忆
- window/pending/memory 概念混淆
- 临时会话与持久记忆缺乏隔离

## 目标

1. `/clear` 只清短期窗口（session window），不影响长期记忆。
2. 明确边界：window（短期）、pending（待处理）、memory（长期）。
3. 防止误删：长期记忆需要有保护机制。

## 前置债务门禁

在进入 P5.6.4 实施前，必须完成：

### 清洗 Gate 1：MLX 残留扫描
- 检查 `src/` 下是否还有 mlx 相关代码路径
- 确认 `providers/mlx.ts` 是否需要保留
- 临时桥接（mlx budget -> lmstudio）必须在此阶段或之前彻底拔掉

### 清洗 Gate 2：Persona 残留扫描
- 检查是否还有 persona 相关导入
- 确认 handlers.ts 不引用 personas.js
- 静态扫描确认无残留

### 清洗 Gate 3：三门全绿
- tsc --noEmit
- npm test (0 fail)
- npm run docs:check

## 范围

- `src/session-window.ts`（短期窗口）
- `src/state/`（状态存储）
- `src/handlers.ts`（/clear 命令）
- `test/*`（边界回归锁）

## 非范围

- 不改 Skill 执行逻辑
- 不改 Tool Bus
- 不改 SOUL 加载

## 实施项

### R1 状态边界定义
- 明确 window（短期会话窗口）
- 明确 memory（长期记忆存储）
- 明确 pending（待处理队列）

### R2 /clear 边界化
- `/clear` 只清空 session-window
- 不影响 ~/.config/msgcode/memory/
- 日志记录边界保护

### R3 回归锁
- 测试锁 1：/clear 不删除长期记忆
- 测试锁 2：session-window 清空后可恢复
- 测试锁 3：边界静态扫描

## 硬验收

| 验收项 | 命令/检查 | 结果 |
|---|---|---|
| TypeScript 编译 | `npx tsc --noEmit` | ✅ |
| 单元/集成测试 | `npm test`（0 fail） | ✅ |
| 文档同步检查 | `npm run docs:check` | ✅ |
| /clear 边界 | 不删除长期记忆 | ✅ |
| MLX 残留 | 无残留或已彻底移除 | ✅ |
| Persona 残留 | 无残留 | ✅ |

## 风险

- 需要确认所有状态存储的边界
- 可能需要迁移现有数据

## 回滚

```bash
git checkout -- src/session-window.ts src/state/ src/handlers.ts test
```
