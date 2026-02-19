# P5.6.8-R4b：短期记忆窗口接入 Pi Tool Loop

## 背景

当前 direct 主链虽然读取了 `windowMessages`，但未进入 `runLmStudioToolLoop` 请求构造，导致“读了不用”。

## 目标

把短期上下文（window + summary）真正注入 Pi loop：

1. 请求前：加载 window 与 summary
2. 请求中：按预算注入历史消息
3. 请求后：保持现有 appendWindow 回写

## 实施范围

- `src/handlers.ts`
- `src/lmstudio.ts`
- `src/session-window.ts`
- `src/summary.ts`
- 相关测试

## 实施项

1. 扩展 `runLmStudioToolLoop` 入参，显式接收历史上下文。
2. 在 loop 构造 messages 时注入：
   - summary（结构化系统上下文）
   - 最近窗口消息（有上限预算）
3. 保持现有 `/clear` 语义不变：
   - 清 `window + summary`
   - 不清 `memory`
4. 回归锁：
   - 历史消息参与模型请求
   - 超预算时只保留最近消息

## 验收

- `npx tsc --noEmit` ✅
- `npm test`（0 fail）✅
- `npm run docs:check` ✅
- 多轮对话可复现短期记忆连续性

## 非范围

- 不改长期记忆检索逻辑
- 不改 tmux 路径
