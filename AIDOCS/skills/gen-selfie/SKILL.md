---
name: gen-selfie
description: 自拍风格图片生成。触发：生成自拍/自拍/人像照片。
---

# 自拍生成 (gen-selfie)

## 触发时机

- 生成自拍风格图片
- 生成人像照片
- 虚拟自拍

## 命令列表

| 命令 | 说明 |
|------|------|
| `msgcode gen selfie --prompt <text> [--out <path>]` | 生成自拍 |

## 示例

```bash
# 生成自拍
msgcode gen selfie --prompt "穿着白色衬衫的年轻女性，自然光，正面照" --out ./portrait.png

# 生成职业照
msgcode gen selfie --prompt "商务男性，西装革履，专业摄影棚灯光" --out ./headshot.png
```

## 依赖

- MiniMax API (selfie)
