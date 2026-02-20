---
name: gen-img
description: 通用文生图能力。触发：生成图片/画图/文生图。
---

# 图片生成 (gen-img)

## 触发时机

- 根据文本生成图片
- 画图
- 文生图

## 命令列表

| 命令 | 说明 |
|------|------|
| `msgcode gen image --prompt <text> [--out <path>]` | 生成图片 |

## 示例

```bash
# 生成图片
msgcode gen image --prompt "一只在阳光下奔跑的金毛犬" --out ./dog.png

# 生成风景图
msgcode gen image --prompt "日出时的海滩，4K 高清" --out ./beach.png
```

## 依赖

- MiniMax API (image-gen)
