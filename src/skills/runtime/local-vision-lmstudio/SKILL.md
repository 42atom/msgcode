---
name: local-vision-lmstudio
description: This skill should be used when the model needs detailed image understanding through a local LM Studio vision model and needs the actual local calling contract.
---

# local-vision-lmstudio skill

## 能力

本 skill 是 LM Studio 本地详细视觉说明书。

- 适合读截图文字、表格、UI 细节、报错信息
- 不把 LM Studio 协议细节继续写进 msgcode runtime

## 何时使用

在以下场景读取并使用本 skill：

- 当前模型不能原生看图
- 本地 LM Studio 已开启 API server
- 需要本地视觉模型做详细识图
- 需要读图片里的具体文字、表格、错误信息

## 调用合同

这项能力的真实实现不在 `~/.config/msgcode/skills/` 目录里，而在外部 skill 仓库。先确认哪个真实脚本存在：

- `~/.agents/skills/local-vision-lmstudio/scripts/analyze_image.py`
- `~/.codex/skills/local-vision-lmstudio/scripts/analyze_image.py`

不要假设 `~/.config/msgcode/skills/local-vision-lmstudio/` 下面存在 `analyze_image.py`。如果要调用，直接调用真实脚本本身。

参数合同：

- `--print-models`
- `[--model <model-key>] <image-abs-path> "<task prompt>"`
- 可选：`--out <abs-path>`

## 核心规则

- 图片路径必须使用绝对路径。
- 提示词要直接表达任务目标，例如“把表格文字尽量忠实提出来，保持结构”。
- 如果需要结构化结果，可以用 `--out <abs-path>` 落盘，再用 `read_file` 读取。
- 如果脚本或模型失败，先向用户说明限制，再决定是否重试。
- 不要假设 LM Studio 一定稳定；失败不应伪装成成功摘要。
- 不要自己发明 `wrapper`、`main.sh` 子命令或 `~/.config/msgcode/skills/.../analyze_image.py` 路径。

## 参考调用

```bash
python3 ~/.agents/skills/local-vision-lmstudio/scripts/analyze_image.py --print-models
python3 ~/.agents/skills/local-vision-lmstudio/scripts/analyze_image.py /abs/path/to/image.png "把图里的表格文字尽量忠实提出来，保持原有结构"
python3 ~/.agents/skills/local-vision-lmstudio/scripts/analyze_image.py --model <model-key> /abs/path/to/image.png "描述图片"
python3 ~/.agents/skills/local-vision-lmstudio/scripts/analyze_image.py /abs/path/to/image.png "提取全部文字" --out /abs/path/to/output.txt
```

## 常见错误

- ❌ 用相对路径或猜测图片路径
- ❌ 只说“帮我看看”，不说明要抽字、抄表格还是总结 UI
- ❌ 把 `~/.config/msgcode/skills/local-vision-lmstudio/` 当成真实脚本目录
- ❌ 把系统 `[图片摘要]` 当成详细视觉结果

## 排障

推荐顺序：

1. `--print-models`
2. 确认目标图片绝对路径存在
3. 用一条明确提示词执行详细读图
4. 如需保存长结果，带 `--out`
5. 失败时向用户说明是 LM Studio / 模型 / 图片质量哪一层出问题
