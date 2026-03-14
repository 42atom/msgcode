# P5.6.8-R4c：长期记忆注入稳态化与可观测收口

## 背景

长期记忆注入链路已存在（listener 注入），但仍需统一观测与行为锁，避免“注入生效但不可解释”。

## 目标

形成可控、可诊断的长期记忆注入：

- workspace 隔离严格生效
- 触发策略明确（关键词 / force / disabled）
- 日志字段稳定可追踪

## 实施范围

- `src/listener.ts`
- `src/config/workspace.ts`
- `src/memory/*`
- 相关测试

## 实施项

1. 固化注入策略：
   - `enabled=false` 默认不注入
   - 命中关键词或 force 才触发
2. 固化 workspace 隔离：
   - 检索键与 workspace 一致
   - 禁止跨 workspace 泄露
3. 统一日志字段：
   - `injected/hitCount/injectedChars/usedPaths/skippedReason/forced`
4. 回归锁：
   - 三种场景（开启、关闭、force）
   - 注入长度上限守卫

## 验收

- `npx tsc --noEmit` ✅
- `npm test`（0 fail）✅
- `npm run docs:check` ✅
- 三类注入场景日志字段完整且断言通过

## 非范围

- 不改 memory schema 设计
- 不引入外部向量库
