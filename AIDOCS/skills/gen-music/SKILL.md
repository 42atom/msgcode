---
name: gen-music
description: 音乐生成能力。触发：生成音乐/BGM/背景音乐。
---

# 音乐生成 (gen-music)

## 触发时机

- 生成音乐
- 生成背景音乐（BGM）
- 生成音频配乐

## 命令列表

| 命令 | 说明 |
|------|------|
| `msgcode gen music --prompt <text> [--duration <sec>] [--out <path>]` | 生成音乐 |

## 参数说明

| 参数 | 必填 | 说明 |
|------|------|------|
| --prompt | 是 | 音乐风格描述 |
| --duration | 否 | 时长（秒） |
| --out | 否 | 输出文件路径 |

## 示例

```bash
# 生成钢琴曲
msgcode gen music --prompt "轻快的钢琴曲，适合办公背景" --duration 30 --out ./music.mp3

# 生成电子音乐
msgcode gen music --prompt "电子舞曲，节奏感强" --duration 60
```

## 依赖

- MiniMax API (music-gen)
