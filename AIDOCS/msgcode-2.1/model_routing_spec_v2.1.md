# Model Routing Spec（v2.1）

> 目标：让“模型可插拔”与“调用方稳定”同时成立。
>
> 设计：**稳定路由名** = msgcode 内部接口；**具体模型** = 可替换实现（LM Studio / 其他 provider）。

## 1) 概念

- **Route Name（稳定）**：msgcode 代码与 jobs/runner/工具链只引用路由名，不引用具体模型 key。
- **Provider Binding（可变）**：把路由名绑定到某个 provider + modelKey/identifier，可随时切换。
- **Load Policy（可变）**：同一路由名可配置 TTL/常驻策略，避免占满内存。

## 2) v2.1 约定的稳定路由名（推荐最小集合）

| routeName | 语义 | 默认绑定（当前本机） |
|---|---|---|
| `chat-main` | 主对话（纯文本为主） | `huihui-glm-4.7-flash-abliterated-mlx` |
| `vision` | 视觉理解（图文/截图） | `huihui-glm-4.6v-flash-abliterated-mlx` |
| `ocr-vl` | OCR（票据/网页截图提字） | `paddleocr-vl-1.5` |
| `mem-embed` | 记忆 embedding | `qwen3-embedding-8b-dwq` |
| `mem-rerank` | 记忆 reranker | `jina-reranker-v3-mlx` |

备注：
- 这 5 个路由名应该被视为“接口”，未来升级不应改名（只换绑定）。
- `ocr-vl` 与 `vision` 是两条不同链路：OCR 追求“字准”，vision 追求“理解+结构化”。

## 3) LM Studio 侧绑定方法（建议）

用 LM Studio 的 `--identifier` 把“模型加载实例”绑定到路由名：

```bash
# 主对话
lms load huihui-glm-4.7-flash-abliterated-mlx --identifier chat-main --ttl 300 -y

# 视觉理解
lms load huihui-glm-4.6v-flash-abliterated-mlx --identifier vision --ttl 300 -y

# OCR
lms load "mlx-community/PaddleOCR-VL-1.5-bf16" --identifier ocr-vl --ttl 120 -y

# 记忆 embedding / rerank（按需加载，TTL 短）
lms load qwen3-embedding-8b-dwq --identifier mem-embed --ttl 120 -y
lms load jina-reranker-v3-mlx --identifier mem-rerank --ttl 120 -y
```

调用方只使用 `model: "<identifier>"`：

```jsonc
{ "model": "vision", "messages": [ ... ] }
```

## 4) 运行策略（建议默认）

- 常驻（TTL 长）：`chat-main`、`vision`（交互频率高）
- 按需（TTL 短）：`ocr-vl`、`mem-embed`、`mem-rerank`（只在触发时需要）

原则：
- 默认不让 embedding/rerank 常驻，避免挤压主对话模型的可用内存。
- 让“能力调用”通过 TTL 自然回收，减少运维复杂度。

## 5) Prompt Template 资产化（强烈建议）

理由：
- 多模态模型的 Prompt Template 可能对 `system`/`image_url` 等输入格式敏感。
- LM Studio 配置丢失会导致线上行为漂移。

做法：
- 把模型专用 Prompt Template 以文件形式放入：
  - `AIDOCS/msgcode-2.1/lmstudio_prompts/`
- 每次改动先改文件，再复制粘贴到 LM Studio 的 Model Default Config。

