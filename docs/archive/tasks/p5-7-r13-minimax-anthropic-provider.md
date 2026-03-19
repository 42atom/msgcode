# 任务单：MiniMax Anthropic Provider 兼容修复

## 回链

- Issue: [0010](/Users/admin/GitProjects/msgcode/issues/tk0010.dne.agent.minimax-anthropic-provider.md)
- Plan: docs/plan/pl0010.dne.agent.minimax-anthropic-provider.md

## 目标

1. 将 `minimax` provider 从 OpenAI-compatible 错误接法切到 Anthropic-compatible 推荐接法。
2. 保持单一主链，不引入 XML / 文本恢复层。
3. 让 MiniMax 多轮 tool use 与 Claude Code / Alma 的推荐路径对齐。

## 范围

1. `src/providers/`
2. `src/agent-backend/chat.ts`
3. `src/agent-backend/tool-loop.ts`
4. `src/agent-backend/config.ts`
5. 相关回归测试

## 非范围

1. 不重构 `openai` / `local-openai`
2. 不做通用 Anthropic provider 平台化
3. 不加 fake recover

## 验收

1. `minimax` 不再走 `chat/completions`
2. 多轮 tool use 正常执行
3. `npm test` 全绿
