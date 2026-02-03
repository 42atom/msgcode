# LM Studio Prompts（Source of Truth）

> 目的：把 LM Studio 的模型专用 Prompt Template 当成“可版本化资产”管理，避免 LM Studio 配置丢失后无法恢复。

## 目录结构

```
AIDOCS/msgcode-2.1/lmstudio_prompts/
├── README.md
├── glm-4.7_prompt_template_min_v1.jinja2
├── glm-4.6v_prompt_template_v1.jinja2
├── glm-4.6v_prompt_template_min_v1.jinja2
└── paddleocr-vl-1.5_prompt_template_v1.jinja2
```

## 使用方式（手动恢复）

1. 打开 LM Studio → `My Models` → 选中目标模型（例如 `mlx-community/PaddleOCR-VL-1.5-bf16`）。
2. 进入模型设置 → `Prompt Template` → 选择 `Default` 配置。
3. 复制本目录对应的 `*.jinja2` 内容粘贴覆盖 → 保存。
4. 卸载并重新加载模型（或重启 LM Studio local server）。

## 验收（必须）

用 `/v1/chat/completions` 发送包含 `system` 且 `system.content` 为字符串的请求：
- 旧模板会触发 jinja 报错（for loop 遍历 string）。
- 新模板应不报错，并能正常识别图片（支持 `image_url`）。
