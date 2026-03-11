---
name: veo-video
description: This skill should be used when the task is to generate a short video with Google Veo through Gemini-compatible APIs, and the environment has a working GEMINI_API_KEY or GOOGLE_API_KEY.
---

# veo-video skill

## 能力

调用 Google Veo 生成短视频。

## 何时使用

- 用户明确要求生成视频
- 需要文生视频或图生视频
- 当前环境具备 `GEMINI_API_KEY` 或 `GOOGLE_API_KEY`

## 前提

- 本地已安装 `google-genai`
- 环境中存在有效 API key
- 接受异步等待 1 到 5 分钟

## 调用合同

优先使用 Python + `google-genai` 官方 SDK，不要自造 wrapper 协议。

最小流程：

1. 创建 `genai.Client`
2. 调 `models.generate_videos`
3. 轮询 operation 直到完成
4. 把返回视频落盘为 mp4

## 参考代码

```python
from google import genai
from google.genai import types
import os, time

client = genai.Client(api_key=os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY"))

operation = client.models.generate_videos(
    model="veo-3.1-generate-preview",
    prompt="生成一个简短视频",
    config=types.GenerateVideosConfig(
        number_of_videos=1,
        duration_seconds=5,
        enhance_prompt=True,
    ),
)

while not operation.done:
    time.sleep(20)
    operation = client.operations.get(operation)
```

## 常见错误

- 不要把图片生成接口当成视频接口
- 不要假设同步立即返回成品
- 没有 API key 时应直接说明，不能假装已生成
