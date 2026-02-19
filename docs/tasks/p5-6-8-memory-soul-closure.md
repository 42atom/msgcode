# P5.6.8：记忆与 SOUL 主链闭环

## 目标

在 `P5.6.7-R9` 基础上完成两条闭环：

- `R1`：短期记忆窗口闭环（读取 -> 注入 -> 回写一致）。
- `R2`：长期记忆注入闭环（自动化路径，不依赖纯 CLI 手工）。

## R1：短期窗口闭环

### 范围

- `src/handlers.ts`
- `src/lmstudio.ts`
- `src/session-window.ts`

### 要求

1. direct 主链请求显式接收窗口消息输入。
2. ToolLoop 构造 messages 时包含窗口历史（有预算上限）。
3. 保留现有 `appendWindow` 回写。

### 验收

- 回归测试验证窗口读取已进入模型请求构造。
- `/clear` 仅清短期窗口与摘要，不影响长期记忆。

## R2：长期记忆注入闭环

### 范围

- `src/listener.ts`
- `src/memory/*`
- `src/config/workspace.ts`

### 要求

1. 自动链路可触发长期记忆检索（非仅 CLI 手工执行）。
2. workspace 级隔离生效（避免跨工作区泄露）。
3. 注入可观测（命中数、注入字符、来源路径摘要）。

### 验收

- 三工作区（`medicpass` / `charai` / `game01`）各一条长期记忆注入用例通过。
- 关闭开关后不注入，开启后可注入（含 force 场景）。

## 三门 Gate

- `npx tsc --noEmit`
- `npm test`（0 fail）
- `npm run docs:check`

## 风险

- 记忆注入过量导致模型输出抖动：需 token/字符预算守卫。
- 注入路径混淆：必须固定 workspace 隔离策略并加测试锁。
