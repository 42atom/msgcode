# omlx 本地安装冒烟测试记录

## 结论

`omlx` 在用户这台 Mac 上已经具备“文本 agent 后端候选”条件，但还不具备“直接完整替代 LM Studio”的条件。

本轮实测结论：

- 文本 `chat` 可用，返回格式兼容 OpenAI `chat.completions`
- `tool_calls` 可用，最小函数调用链路已跑通
- 模型卸载后，可按 `model` 参数自动重载，不一定需要额外显式 load 控制面
- 当前安装没有可用 embedding model
- 当前视觉测试不可靠，不能把现有 `current-glm47` 当成稳定 VLM

对 `msgcode` 的直接判断：

- 适合做 `text/tool-loop` 的试接候选
- 不适合今天就宣称“零代码替代 LM Studio”
- 如果目标是先不走 Linux，可以优先考虑 `Mac + omlx + 文本主链试运行`

## 测试环境

- 时间：2026-03-10
- 服务地址：`http://127.0.0.1:8000`
- 配置文件：`~/.omlx/settings.json`
- 模型目录：
  - `~/.omlx/models`
  - `/Users/admin/models`

## 服务与模型状态

### 1. 服务健康检查

`GET /health` 返回：

- `status = healthy`
- `model_count = 2`
- `loaded_count = 1`

### 2. 模型清单

`GET /v1/models` 返回 2 个模型：

- `current-glm47`
- `whisper-large-v3-turbo-mlx`

`GET /v1/models/status` 显示：

- `current-glm47` 已加载
- `whisper-large-v3-turbo-mlx` 未加载

### 3. 当前主模型来源

`/Users/admin/models/current-glm47` 是一个符号链接，指向：

- `/Users/admin/Models/lmstudio/huihui-ai/Huihui-GLM-4.7-Flash-abliterated-mlx-4bit`

这说明当前 `omlx` 实际复用了已有的本地 MLX 模型目录。

## 接口实测

### 1. 基础聊天

请求：

- `POST /v1/chat/completions`
- `model = current-glm47`

结果：

- 正常返回 `choices[0].message.content`
- `reasoning_content = null`
- 返回结构与 OpenAI 兼容

样例输出：

- `我是由Z.ai训练的GLM大语言模型。`

日志记录的速度：

- `12 tokens in 1.58s (7.6 tok/s)`
- `12 tokens in 3.06s (3.9 tok/s)`

补充说明：

- 这只能说明“当前模型在这台机器上的实际速度范围”
- 不能直接得出“比 LM Studio 快很多”，因为这轮没有做同模型同参数 A/B

### 2. 工具调用

请求内容要求模型在回答前调用 `get_weather`

结果：

- `finish_reason = tool_calls`
- 返回了 `tool_calls[0].function.name = get_weather`
- 参数为 `{"city":"北京"}`

这说明 `msgcode` 最核心的 `tool loop` 契约在当前安装上是可行的。

### 3. 自动重载

先执行：

- `POST /v1/models/current-glm47/unload`

确认模型卸载后，再直接请求：

- `POST /v1/chat/completions`

结果：

- 请求成功
- 模型被按 `model = current-glm47` 自动拉起
- 本轮 `TIME_STARTTRANSFER = 4.716s`

判断：

- `omlx` 现有行为支持“按需自动加载”
- 对 `msgcode` 来说，后续不一定必须保留显式 `/models/load` 依赖

### 4. Embeddings

请求：

- `POST /v1/embeddings`
- `model = current-glm47`

结果：

- 返回 `400`
- 错误为：当前模型不是 embedding model

判断：

- 不是 `omlx` 不支持 embeddings
- 而是用户当前安装里没有可用于 embedding 的模型

### 5. 视觉真伪测试

先构造了一个可判定样本：

- 文件：`aidocs/artifacts/omlx-vision-red-blue.png`
- 图像内容：左半红色，右半蓝色

然后以 `image_url` 方式请求：

- `POST /v1/chat/completions`

问题：

- `这张图左边和右边分别是什么颜色？`

模型回答：

- `左边是深蓝色，右边是浅蓝色。`

判断：

- 回答明显错误
- 说明“接口接受了图片”不等于“当前模型具备可靠视觉能力”
- 当前这套安装不能被视为稳定 VLM 后端

## 对 msgcode 的影响

### 已具备条件

- 文本聊天主链可接
- OpenAI 风格 `chat.completions` 可接
- 工具调用可接
- 模型可按需自动重载

### 当前阻塞点

- `msgcode` 仍有多处 LM Studio 原生接口假设
- 当前安装没有 embedding model
- 当前安装下视觉能力不可靠

关键代码耦合点：

- `src/agent-backend/chat.ts`
  - 仍显式访问 `/api/v1/chat`
  - 仍显式访问 `/api/v1/models`
- `src/capabilities.ts`
  - `local-openai` 仍探测 `/api/v1/models`
- `src/runtime/model-service-lease.ts`
  - 仍依赖 `/api/v1/models/load`
- `src/agent-backend/config.ts`
  - `local-openai` 当前 `nativeApiEnabled: true`

因此，今天的准确口径应是：

- `omlx` 可以接管一部分 `msgcode` 本地文本后端能力
- 但还不是当前代码下的“无改动替换件”

## 推荐决策

### 最小可删版本

先把 `omlx` 当成：

- `Mac 本地文本 agent 后端`

只验证这两条：

- `tool-loop`
- `plain chat`

先不承诺：

- 视觉
- embedding
- LM Studio 原生控制面兼容

### 扩展版本

如果后面要认真支持 `omlx`，优先改这 3 处：

1. 让 `local-openai` 可关闭 `nativeApiEnabled`
2. 让能力探测从 `/api/v1/models` 收口到 `/v1/models`
3. 让模型装载逻辑允许“依赖按需自动加载”，而不是强绑 `/api/v1/models/load`

## 证据

- Docs：`/Users/admin/GitProjects/GithubDown/omlx/README.md`
- Code：
  - `/Users/admin/GitProjects/GithubDown/omlx/omlx/server.py`
  - `/Users/admin/GitProjects/GithubDown/omlx/omlx/admin/routes.py`
  - `/Users/admin/GitProjects/msgcode/src/agent-backend/chat.ts`
  - `/Users/admin/GitProjects/msgcode/src/capabilities.ts`
  - `/Users/admin/GitProjects/msgcode/src/runtime/model-service-lease.ts`
- Logs：
  - `~/.omlx/logs/server.log`
- Test Commands：
  - `curl http://127.0.0.1:8000/health`
  - `curl -H 'Authorization: Bearer <key>' http://127.0.0.1:8000/v1/models`
  - `curl -H 'Authorization: Bearer <key>' http://127.0.0.1:8000/v1/models/status`
  - `curl -H 'Authorization: Bearer <key>' -d ... /v1/chat/completions`
  - `curl -H 'Authorization: Bearer <key>' -d ... /v1/embeddings`
