# Notes: omlx 取代 LM Studio 可行性

## Sources

### Source 1: omlx README
- Path: `/Users/admin/GitProjects/GithubDown/omlx/README.md`
- Commit: `5c8c222`
- Key points:
  - Apple Silicon only
  - `OpenAI-compatible client` 可接到 `http://localhost:8000/v1`
  - 支持 `LLM/VLM/OCR/Embedding/Reranker`
  - 支持 `tool calling`、`structured output`、`MCP`

### Source 2: omlx server
- Path: `/Users/admin/GitProjects/GithubDown/omlx/omlx/server.py`
- Key points:
  - 正式公开 `POST /v1/chat/completions`
  - 正式公开 `POST /v1/embeddings`
  - 正式公开 `POST /v1/messages`
  - 正式公开 `GET /v1/models`
  - 公开 `POST /v1/models/{model_id}/unload`
  - 没有 `LM Studio` 风格的 `/api/v1/chat`、`/api/v1/models`

### Source 3: omlx admin/model management
- Path: `/Users/admin/GitProjects/GithubDown/omlx/omlx/admin/routes.py`
- Key points:
  - 管理后台有 `load/unload`
  - `load` 在 admin API 下，需要 admin 流程
  - 并不是 `LM Studio` 那套公开原生模型 API

### Source 4: msgcode agent-backend
- Path: `/Users/admin/GitProjects/msgcode/src/agent-backend/chat.ts`
- Path: `/Users/admin/GitProjects/msgcode/src/agent-backend/config.ts`
- Key points:
  - 本地默认后端仍带 `nativeApiEnabled: true`
  - 会优先打 `LM Studio` 原生 `/api/v1/chat`
  - 原生失败时才 fallback 到 `/v1/chat/completions`
  - 模型探测会尝试 `/api/v1/models` 再回退 `/v1/models`

### Source 5: msgcode 其他 LM Studio 依赖
- Path: `/Users/admin/GitProjects/msgcode/src/runtime/model-service-lease.ts`
- Path: `/Users/admin/GitProjects/msgcode/src/capabilities.ts`
- Path: `/Users/admin/GitProjects/msgcode/src/runners/vision.ts`
- Path: `/Users/admin/GitProjects/msgcode/src/memory/embedding.ts`
- Key points:
  - 自动 reload helper 依赖 `/api/v1/models/load`
  - 本地能力探测对 `local-openai` 默认走 `/api/v1/models`
  - 视觉走 `/v1/chat/completions`
  - embedding 走 `/v1/embeddings`

## Synthesized Findings

### omlx 已覆盖的
- OpenAI-compatible chat completions
- reasoning_content 分离
- tool calling
- image_url 视觉输入
- embeddings
- Anthropic messages
- 多模型服务与模型管理

### omlx 不兼容的
- `LM Studio` 原生 `/api/v1/chat`
- `LM Studio` 原生 `/api/v1/models`
- `LM Studio` 风格公开 load endpoint

### 对 msgcode 的直接影响
- 基础聊天：有机会工作，因为 `msgcode` 会在原生 404 后 fallback 到 `/v1/chat/completions`
- tool loop：更有机会直接工作，因为主链本来就是 OpenAI-compatible
- 视觉：有机会直接工作，因为当前就是 `/v1/chat/completions + image_url`
- embedding：有机会直接工作，因为当前就是 `/v1/embeddings`
- 自动模型恢复：会退化，因为我们当前 helper 绑定了 `LM Studio` 的 load API
- 动态 context window 探测：会退化，因为 `local-openai` 路径优先读 `/api/v1/models`

### 结论形态
- 不是“完全不能替”
- 不是“现在零代码完整替”
- 更准确是：**可以作为 Mac/Apple Silicon/MLX 场景下的本地 OpenAI-compatible 后端候选，但要么接受部分能力退化，要么做一轮 provider-neutral 适配**
