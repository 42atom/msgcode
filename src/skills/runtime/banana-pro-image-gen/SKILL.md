---
name: banana-pro-image-gen
description: 用 Banana Pro API 生成、编辑、描述图片，并统一落盘到 AIDOCS 目录
allowed-tools: [shell]
entrance: templates/run.md
budgets:
  maxTurns: 6
  maxToolCalls: 10
  timeoutMs: 180000
capabilities:
  stream: false
  requiresEgress: true
---

# Banana Pro Image Gen Skill

## 用法

生成图片：
```bash
bash ~/.config/msgcode/skills/banana-pro-image-gen/main.sh generate --prompt "描述你想要的图"
```

带参考图：
```bash
bash ~/.config/msgcode/skills/banana-pro-image-gen/main.sh generate --prompt "同款风格" --input /path/to/ref.png
```

编辑图片：
```bash
bash ~/.config/msgcode/skills/banana-pro-image-gen/main.sh edit --prompt "修改描述" --input /path/to/image.png
```

图片描述：
```bash
bash ~/.config/msgcode/skills/banana-pro-image-gen/main.sh describe --input /path/to/image.png
```

## 规则

- 判断 Banana Pro 能不能做某件事之前，先读完整个 `SKILL.md`
- 编辑已有图片时必须用 `edit --input /path/to/image.png`
- 禁止用 Read 工具看生成的图
- 禁止在回复中嵌入 base64 或图片预览
- 返回保存路径 + 使用的提示词

## 输出目录
`<workdir>/AIDOCS/banana-images/banana-pro-{时间戳}-{prompt摘要}.png`

## 参考

- `references/prompt-templates.md`
- `references/style-presets.md`
- `templates/run.md`
