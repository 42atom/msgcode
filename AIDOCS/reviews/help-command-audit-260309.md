# /help 命令一致性审计

Issue: 0048

## 结论

- 当前群聊 `/help` 与真实命令面 **不一致**。
- 主要问题不是“命令写错了不能用”，而是 **遗漏了多条真实可执行命令**，以及部分参数写得过窄。
- 最小修复是：只收口 `/help` 文案为真实命令枚举，不改行为。

## 证据

- Docs：`src/routes/cmd-info.ts`
- Code：`src/routes/commands.ts`
- Code：`src/handlers.ts`

## 发现

### 1. `/help` 漏掉了真实存在的路由命令

- `/owner`
- `/owner-only`
- `/pi`
- `/toolstats`
- `/tool allow list|add|remove`
- `/desktop`
- `/task`

### 2. `/help` 对已有命令的参数描述过窄

- `/model`
  - 帮助里只写 `agent-backend/codex/claude-code`
  - 实际还支持 `minimax`、`openai`，并兼容 `lmstudio`、`agent`、`local-openai`
- `/policy`
  - 帮助里写 `[mode]`
  - 实际有更清晰的主口径 `full|limit`，并兼容 `on/off/egress-allowed/local-only`
- `/mem`
  - 帮助里只写 `on|off`
  - 实际还有 `status|force`
- `/schedule`
  - 帮助里只写 `list|enable|disable`
  - 实际还有 `validate|add|remove`
- `/mode`
  - 帮助里写了 `voice on|off`
  - 实际还支持 `both|audio|text`
  - 还支持 `style-reset`

### 3. 命令面存在可简化空间，但不建议本轮直接改

- `/owner` 与 `/owner-only`
  - 可考虑长期收口为 `/owner set`、`/owner mode`
- `/cursor` 与 `/reset-cursor`
  - 可考虑长期收口为 `/cursor`、`/cursor reset`
- `/mode style-reset` 与 `/mode style reset`
  - 应保留一个 canonical 写法，另一个只做兼容别名
- `/schedule add/remove`
  - 在群聊路由已绑定 workspace 的前提下，理论上可评估是否省掉 `--workspace`
  - 但当前实现支持跨 workspace 精确操作，不能未经确认直接删

## 推荐决策

- 本轮推荐：只修 `/help` 文案与测试。
- 下一轮若要做“简化命令”，建议先定 canonical 主命令，再把旧写法降级为兼容别名，避免一次性破坏用户肌肉记忆。
