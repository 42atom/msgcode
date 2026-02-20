---
name: gen-skill
description: 多模态内容生成能力。触发时机：用户需要生成图片、语音、音乐时。
---

# 内容生成技能

## 触发时机

当用户请求涉及内容生成时触发：
- 生成图片（文生图）
- 生成自拍风格图片
- 语音合成（TTS）
- 生成音乐

## 可用命令

### msgcode gen image

生成图片。

```bash
msgcode gen image --prompt "一只在阳光下奔跑的金毛犬" --out ./dog.png
```

| 参数 | 必填 | 说明 |
|------|------|------|
| --prompt | 是 | 生成提示语 |
| --out | 否 | 输出文件路径 |

### msgcode gen selfie

生成自拍风格图片。

```bash
msgcode gen selfie --prompt "穿着白色衬衫的年轻女性，自然光，正面照" --out ./portrait.png
```

### msgcode gen tts

语音合成。

```bash
msgcode gen tts --text "你好，欢迎使用 msgcode" --out ./output.mp3
msgcode gen tts --text "你好" --voice "female-01" --play
```

| 参数 | 必填 | 说明 |
|------|------|------|
| --text | 是 | 文本内容 |
| --voice | 否 | 语音 ID |
| --play | 否 | 直接播放 |
| --out | 否 | 输出文件路径 |

### msgcode gen music

生成音乐。

```bash
msgcode gen music --prompt "轻快的钢琴曲，适合办公背景" --duration 30 --out ./music.mp3
```

| 参数 | 必填 | 说明 |
|------|------|------|
| --prompt | 是 | 生成提示语 |
| --duration | 否 | 时长（秒） |
| --out | 否 | 输出文件路径 |

## 依赖

- MiniMax API (image-gen, music-gen)
- Qwen TTS / IndexTTS (voice)
