---
name: gen
description: 多模态内容生成。触发时机：生成图片/语音/音乐。
---

# 内容生成 (gen)

## 触发时机

- 生成图片（文生图）
- 生成自拍
- 语音合成
- 生成音乐

## 命令列表

| 命令 | 说明 |
|------|------|
| `msgcode gen image --prompt <text> [--out <path>]` | 生成图片 |
| `msgcode gen selfie --prompt <text> [--out <path>]` | 生成自拍 |
| `msgcode gen tts --text <text> [--voice <id>] [--play] [--out <path>]` | 语音合成 |
| `msgcode gen music --prompt <text> [--duration <sec>] [--out <path>]` | 生成音乐 |

## 示例

```bash
# 生成图片
msgcode gen image --prompt "一只在阳光下奔跑的金毛犬" --out ./dog.png

# 语音合成
msgcode gen tts --text "你好，欢迎使用 msgcode" --out ./output.mp3
```
