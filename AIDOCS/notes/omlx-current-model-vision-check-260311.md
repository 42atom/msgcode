# OMLX 当前模型视觉能力核验 260311

## 结论

- `omlx` 这个服务本身可以支持视觉模型。
- 但当前这台 `:8000` 上加载的 `Qwen3.5-27B-Claude-4.6-Opus-Distilled-MLX-4bit`，在 `omlx` 里被报告为普通 `llm`，不是 `vlm`。
- 因此，就这台服务的当前加载状态而言，不能把它当可用视觉模型。

## 实测

### 模型状态

请求：

- `GET /v1/models/status`

返回关键信息：

- `id = Qwen3.5-27B-Claude-4.6-Opus-Distilled-MLX-4bit`
- `engine_type = batched`
- `model_type = llm`
- `loaded = true`

判断：

- 当前被 `omlx` 当作文本模型处理，不是视觉模型。

### 带图请求

请求：

- `POST /v1/chat/completions`
- 使用本地图片：`/Users/admin/Desktop/ScreenShot 2026-01-04 at 10.21.36.jpg`
- 输入格式：`messages[].content = [text, image_url(data URL)]`

现象：

- 接口返回 `200`
- 但模型把插画男性头像描述成“橘猫趴在木桌上”

### 带图 / 不带图对照

问题：

- `只回答一个字母：A=猫咪照片，B=卡通人头像插画，C=汽车，D=食物。`

现象：

- 带图与不带图返回几乎一致
- 两次 `prompt_tokens` 都是 `35`
- 返回内容都在说“没有提供具体的……”

判断：

- 这不是单纯“图抽象所以识别错了”
- 更像当前模型根本没走视觉路径，图片输入被忽略

## 对 msgcode 的直接启发

- backend 选择不能只看 `lmstudio` / `omlx` 品牌
- 必须把“provider”和“当前模型能力”分开
- 对图片请求应先检查当前模型是否真的是 `vlm`

## 建议

- `omlx` 走能力探测时，优先读 `/v1/models/status`
- 只有 `model_type=vlm` 或其他明确视觉标记时，才允许 `vision` 主链放行
- 否则对图片请求直接显式报错，不要静默吞图

## Evidence

- Tests：`GET /v1/models/status`
- Tests：`POST /v1/chat/completions` with image
- Tests：`POST /v1/chat/completions` image / no-image 对照
