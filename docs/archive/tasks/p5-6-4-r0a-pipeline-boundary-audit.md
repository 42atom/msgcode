# P5.6.4-R0A：双管道边界审计检查单（tmux vs direct）

## 目的

确认系统是否已清晰区分两条管道，并识别语义混淆点：

- **tmux 管道（codex/claude-code）**：忠实转发，不承载 SOUL/记忆业务。
- **direct 管道（lmstudio/openclaw）**：承载 SOUL/记忆/tool loop 智能体能力。

## 审计范围

- `src/handlers.ts`
- `src/tmux/*`
- `src/lmstudio.ts`
- `src/listener.ts`
- `src/config/souls.ts`
- `src/session-window.ts`
- `src/routes/commands.ts`
- `README.md`

## 检查项（逐条打勾）

### A. 语义边界

- [ ] tmux 路径不注入 SOUL/记忆上下文（仅收发与读取模式切换）。
- [ ] direct 路径承担 SOUL/记忆/tool loop，行为与 README 一致。
- [ ] `/clear` 语义已对齐：只清短期 window，不误清长期 memory。

### B. 配置边界

- [ ] tmux 与 direct 的 runner 选择逻辑清晰，无隐式分支穿透。
- [ ] `policy.mode` 对 tmux/direct 的约束语义一致且可解释。
- [ ] `/model`、`/help`、`/reload` 输出不混淆两条管道职责。

### C. 可观测性边界

- [ ] 日志能区分当前命中管道（module/runner/readMode）。
- [ ] 工具调用统计仅出现在 direct tool loop 路径。
- [ ] tmux 失败信息不误导为“智能体业务失败”。

### D. 回归锁

- [ ] 测试锁 1：tmux 路径不得触发 SOUL/memory 注入函数。
- [ ] 测试锁 2：direct 路径必须可观察到 tool loop / memory 链路。
- [ ] 测试锁 3：README 中双管道定义与实现一致（docs lock）。

## 输出要求

审计报告必须包含：

1. **现状结论**：是否“边界清晰/部分混淆/明显混淆”。
2. **问题清单**：按 P0/P1/P2 分级。
3. **最小修复建议**：只提必要改动，避免跨任务扩散。
4. **是否需要语义优化**：给出“必要/可选/暂不需要”判定。

## 验收

| 验收项 | 检查方式 | 结果 |
|---|---|---|
| 边界审计完成 | 形成书面审计结论 | ✅ |
| 风险分级完成 | P0/P1/P2 列表完整 | ✅ |
| 修复建议可执行 | 每条建议可映射到文件与测试 | ✅ |
| 主线不偏移 | 不改变 P5.6.4 主线顺序 | ✅ |
