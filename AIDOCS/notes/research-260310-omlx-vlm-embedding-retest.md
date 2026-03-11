# omlx 补测记录：4.6V 与 embedding/rerank

## 结论

用户开启 `Huihui-GLM-4.6V-Flash-abliterated-q4-mlx` 和 `jina-reranker-v3-mlx` 后，`omlx` 现在已经可以实测：

- 视觉：可用
- Embedding：可用
- Rerank：当前这只 `jina-reranker-v3-mlx` 在 `omlx` 里的实际行为不是可用 reranker

对 `msgcode` 的直接意义：

- 视觉链现在有继续试接的价值
- 向量链现在也有继续试接的价值
- 但“reranker 已经就绪”这个结论目前不能下

## 当前模型状态

`GET /v1/models` 返回 4 个模型：

- `Huihui-GLM-4.6V-Flash-abliterated-q4-mlx`
- `current-glm47`
- `jina-reranker-v3-mlx`
- `whisper-large-v3-turbo-mlx`

`GET /v1/models/status` 显示：

- `Huihui-GLM-4.6V-Flash-abliterated-q4-mlx`
  - `engine_type = vlm`
  - `model_type = vlm`
- `jina-reranker-v3-mlx`
  - `engine_type = embedding`
  - `model_type = embedding`

这已经说明，`omlx` 当前把这只 `jina-reranker-v3-mlx` 当成 embedding model 在处理。

## 视觉实测

### 测试样本

文件：

- `aidocs/artifacts/omlx-vision-red-blue.png`

内容：

- 左半红色
- 右半蓝色

### 请求

- `POST /v1/chat/completions`
- `model = Huihui-GLM-4.6V-Flash-abliterated-q4-mlx`

问题：

- `这张图左边和右边分别是什么颜色？`

### 返回

- `这张图左边是红色，右边是蓝色。`

补充观察：

- 返回里同时给出了 `content` 和 `reasoning_content`
- 这和 `msgcode` 现有对 `reasoning_content` 的兼容方向一致

判断：

- 这轮最小视觉真伪测试通过
- 至少可以认定 `4.6V` 真在看图，不是像上一轮那样“接口接收成功但答案像猜”

## Embedding 实测

### 请求

- `POST /v1/embeddings`
- `model = jina-reranker-v3-mlx`
- `input = ["苹果手机", "安卓手机"]`

### 返回

- 成功返回 embedding 向量
- 向量维度：`1024`

日志证据：

- `Embedding engine started: /Users/admin/Models/lmstudio/jinaai/jina-reranker-v3-mlx`
- `Embedding model loaded successfully ... (hidden_size=1024)`
- `Embedding: 2 texts, 1024 dims, 4 tokens in 0.362s`

判断：

- 从 API 行为看，这只模型当前可用于 `embedding`
- 因此 `msgcode` 的 memory/embedding 链现在具备补测条件

## Rerank 实测

### 请求

- `POST /v1/rerank`
- `model = jina-reranker-v3-mlx`

### 返回

- `400`
- `Model 'jina-reranker-v3-mlx' is not a reranker model. Use a SequenceClassification model for reranking.`

### 模型配置证据

模型路径：

- `/Users/admin/Models/lmstudio/jinaai/jina-reranker-v3-mlx`

配置文件：

- `config.json`

可见字段：

- `architectures = ["JinaForRanking"]`
- `hidden_size = 1024`
- `model_type = "qwen3"`

判断：

- 从模型命名和架构看，它像 reranker
- 但从 `omlx` 的实际加载方式和 API 行为看，它被当成 embedding model
- 对外口径应以“实测行为”为准，而不是以目录名为准

## 对 msgcode 的最新判断

### 已新增具备条件

- `vision`：值得继续补测真实截图
- `embeddings`：值得补测接入 `src/memory/embedding.ts`

### 仍未解决

- `msgcode` 里 LM Studio 原生接口耦合仍然存在
- 当前 rerank 还不能作为现成能力承诺
- 还没有做 `msgcode -> omlx` 的端到端代码接入验证

## 推荐下一步

最小可删版本：

1. 用 `4.6V` 跑一张真实 `msgcode` 截图，验证视觉主链
2. 用 `jina-reranker-v3-mlx` 接一次 `src/memory/embedding.ts` 的最小请求
3. 不做 rerank 承诺，先把它当 embedding 处理

## 证据

- Docs：`/Users/admin/GitProjects/GithubDown/omlx/README.md`
- Code：
  - `/Users/admin/GitProjects/GithubDown/omlx/omlx/server.py`
  - `/Users/admin/GitProjects/msgcode/src/memory/embedding.ts`
- Config：
  - `/Users/admin/Models/lmstudio/jinaai/jina-reranker-v3-mlx/config.json`
- Logs：
  - `~/.omlx/logs/server.log`
