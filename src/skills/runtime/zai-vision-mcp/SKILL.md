---
name: zai-vision-mcp
description: This skill should be used when the model needs detailed image understanding through ZAI or GLM Vision MCP and needs the actual calling contract.
---

# zai-vision-mcp skill

## 能力

本 skill 是 ZAI / GLM Vision MCP 的详细视觉说明书。

- 先 `list`，再 `call`
- 适合当前环境已有 ZAI / Zhipu 视觉 MCP 能力时的详细读图

## 何时使用

在以下场景读取并使用本 skill：

- 当前环境可用 ZAI / Zhipu Vision MCP
- 需要基于 MCP schema 做图像分析
- 当前模型本身不能直接看图，或你明确要走 MCP

## 调用合同

这项能力的真实实现通常在外部 skill 仓库：

- `~/.agents/skills/zai-vision-mcp/scripts/zai_vision_mcp.mjs`
- `~/.codex/skills/zai-vision-mcp/scripts/zai_vision_mcp.mjs`

不要把 `~/.config/msgcode/skills/zai-vision-mcp/` 当成真实 MCP 脚本目录。

调用合同：

- 先 `list`
- 再 `call <tool-name> '<json-args>'`

## 核心规则

- 先 `list`，再 `call`。
- tool 名必须来自 `list` 的真实返回值，不能猜。
- 图片路径必须使用绝对路径，并放进 JSON 参数里。
- JSON 参数必须是一整个字符串，不要拆坏引号。
- 如果当前模型已经原生支持图片输入，优先原生看图，不必强行走 MCP。
- 不要自己发明 `wrapper`、`main.sh` 子命令或 skill 目录下的伪脚本路径。

## 参考调用

```bash
node ~/.agents/skills/zai-vision-mcp/scripts/zai_vision_mcp.mjs list
node ~/.agents/skills/zai-vision-mcp/scripts/zai_vision_mcp.mjs call <tool-name> '{"image_source":"/abs/path/to/image.png","prompt":"描述图片"}'
node ~/.agents/skills/zai-vision-mcp/scripts/zai_vision_mcp.mjs call <tool-name> '{"image_source":"/abs/path/to/image.png","prompt":"把图里的全部文字尽量忠实提出来，保持原有结构"}'
```

## 常见错误

- ❌ 不先 list，直接猜工具名
- ❌ 用相对路径
- ❌ 把 JSON 参数拆成多段导致引号损坏
- ❌ 把 `~/.config/msgcode/skills/zai-vision-mcp/` 当成真实脚本目录
- ❌ 当前模型已经能原生看图却仍绕远路走 MCP

## 排障

推荐顺序：

1. `list`
2. 看工具 schema
3. 用真实工具名 + 绝对路径 + 明确提示词执行
4. 若失败，先向用户说明是 MCP/tool schema/API key 哪一层异常
