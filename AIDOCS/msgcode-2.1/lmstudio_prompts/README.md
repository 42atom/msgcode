# LM Studio Prompts（Source of Truth）

> 目的：把 LM Studio 的模型专用 Prompt Template 当成“可版本化资产”管理，避免 LM Studio 配置丢失后无法恢复。

## 目录结构

```
AIDOCS/msgcode-2.1/lmstudio_prompts/
├── README.md
├── glm-4.7_prompt_template_min_v1.jinja2
├── glm-4.7_prompt_template_tools_v1.jinja2
├── glm-4.6v_prompt_template_v1.jinja2
└── glm-4.6v_prompt_template_min_v1.jinja2
```

## 模式与模板映射（v2.2）

- `tooling.mode = explicit`：使用 `glm-4.7_prompt_template_min_v1.jinja2`
  - 场景：只走显式命令（如 `/tts`），不依赖模型自主工具调用。
- `tooling.mode = autonomous`：使用 `glm-4.7_prompt_template_tools_v1.jinja2`
  - 场景：允许模型自主编排工具，必须支持 `role=tool` 回灌。

## 使用方式（手动恢复）

1. 打开 LM Studio → `My Models` → 选中目标模型（例如你的 `huihui-glm-4.6v-flash-abliterated-mlx` 模型）。
2. 进入模型设置 → `Prompt Template` → 选择 `Default` 配置。
3. 复制本目录对应的 `*.jinja2` 内容粘贴覆盖 → 保存。
4. 卸载并重新加载模型（或重启 LM Studio local server）。

> **注意**: GLM-4.6V 现在统一处理 Vision/OCR 任务，不再使用单独的 glm-ocr 模型。

## 验收（GLM-4.7，必须）

1. 基础回答（无元结构）：
   - 发送“只回复 OK”，预期返回 `OK`（不含 `<think>`/`<tool_call>`）
2. 工具回灌（autonomous 必测）：
   - 发送含 `role:"tool"` 的消息（例如 `TOOL=42`），预期模型能读到并按要求返回 `42`

示例命令：

```bash
curl -sS -m 40 http://127.0.0.1:1234/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{
    "model":"huihui-glm-4.7-flash-abliterated-mlx",
    "messages":[
      {"role":"system","content":"你只能回答 TOOL= 后面的值，不能猜。"},
      {"role":"tool","content":"TOOL=42"},
      {"role":"user","content":"值是多少？只输出数字"}
    ],
    "temperature":0
  }'
```

## 验收（必须）

用 `/v1/chat/completions` 发送包含 `system` 且 `system.content` 为字符串的请求：
- 旧模板会触发 jinja 报错（for loop 遍历 string）。
- 新模板应不报错，并能正常识别图片（支持 `image_url`）。
