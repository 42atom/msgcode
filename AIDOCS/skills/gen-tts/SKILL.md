---
name: gen-tts
description: 语音合成能力。触发：TTS/语音合成/朗读/生成语音。
---

# 语音合成 (gen-tts)

## 触发时机

- 语音合成（TTS）
- 文本转语音
- 朗读文本

## 命令列表

| 命令 | 说明 |
|------|------|
| `msgcode gen tts --text <text> [--voice <id>] [--play] [--out <path>]` | 语音合成 |

## 参数说明

| 参数 | 必填 | 说明 |
|------|------|------|
| --text | 是 | 要合成的文本 |
| --voice | 否 | 语音 ID（如：female-01） |
| --play | 否 | 直接播放 |
| --out | 否 | 输出文件路径 |

## 示例

```bash
# 合成语音
msgcode gen tts --text "你好，欢迎使用 msgcode" --out ./output.mp3

# 合成并播放
msgcode gen tts --text "你好" --play
```

## 依赖

- Qwen TTS / IndexTTS
