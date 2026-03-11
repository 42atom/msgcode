# Notes: 本地 backend 控制层 MVP

## 当前事实

- 全局主后端配置来源是 `~/.config/msgcode/.env` 的 `AGENT_BACKEND`
- 当前值：`AGENT_BACKEND=minimax`
- MiniMax 已配置：
  - `MINIMAX_API_KEY`
  - `MINIMAX_BASE_URL=https://api.minimax.chat/v1`
  - `MINIMAX_MODEL=MiniMax-M2.5`
- `minimax` 适配器会把 `https://api.minimax.chat/v1` 归一化为 Anthropic 路径

## 代码入口

- `/model` 命令：`src/routes/cmd-model.ts`
- Agent Backend 解析：`src/agent-backend/config.ts`
- Chat 主链：`src/agent-backend/chat.ts`
- Tool loop 主链：`src/agent-backend/tool-loop.ts`
- 运行时 budget/capability：`src/capabilities.ts`
- 视觉 runner：`src/runners/vision.ts`
- Embedding：`src/memory/embedding.ts`

## 关键判断

- 现在的“本地 backend”仍然被写死成一条 `local-openai/lmstudio` 语义线。
- `vision`、`embedding` 还没有跟随统一的本地 backend 配置源。
- 如果直接把 `omlx` 做成顶层新 provider，会把“本地后端选择”和“云端 provider 选择”混成一层。
- 更薄的做法是：
  - 顶层 `AGENT_BACKEND` 继续表达主后端（如 `minimax` / `openai` / 本地）
  - 新增单独的本地 backend 选择真相源，供 `chat/vision/embedding/capability` 共用

## 本轮边界

- 要做：
  - 切回 `minimax`
  - 本地 backend 注册表
  - 手动切换 `lmstudio/omlx`
  - `chat/vision/embedding/capability` 统一读本地 backend 真相源
- 不做：
  - 自动故障切换到云端
  - rerank 接入
  - 多层编排/控制台

## 本轮结果

- 已新增 `src/local-backend/registry.ts`
- 已新增 `LOCAL_AGENT_BACKEND=lmstudio|omlx` 语义
- `/model lmstudio` 与 `/model omlx` 现会写入本地 backend 预设
- `/model minimax` 继续只切全局主 provider
- `chat / tool-loop / capabilities / vision / embedding` 已统一从本地 backend 注册表取配置
- `omlx` 本地聊天支持 `/v1/models` 自动发现模型，并禁用 LM Studio 风格 lifecycle reload
- `tool-loop` 现支持在未显式配置 `OMLX_MODEL` 时自动发现本地模型，且只使用当前 backend 的 API key

## 验证

- `npm test -- test/p5-7-r8c-agent-backend-single-source.test.ts`
- `npm test -- test/p5-7-r9-t2-runtime-capabilities.test.ts`
- `npm test -- test/p5-7-r9-t7-step4-compatibility-lock.test.ts`

## 剩余风险

- 全量 `npx tsc --noEmit` 仍被仓库既存问题阻塞：
  - `src/feishu/transport.ts`
  - `src/routes/cmd-schedule.ts`
- `embedding` 仍维持 768 维假设；若后续改用 1024 维模型，需要同步调整 `src/memory/store.ts`
