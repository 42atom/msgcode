---
name: twitter-media
description: This skill should be used when the task involves an x.com or twitter.com post URL and the model needs to extract tweet text, images, videos, or thumbnails without guessing page content.
---

# twitter-media skill

## 能力

从 Twitter/X 链接中提取文本和媒体信息。

## 何时使用

- 用户给出 `x.com` 或 `twitter.com` 链接
- 需要知道这条帖子的文字、图片、视频或缩略图
- 需要把推文媒体下载到本地再分析

## 调用合同

优先使用公开 `fxtwitter` 风格接口，不要直接硬抓 Twitter 页面。

最小流程：

1. 从 URL 中提取 `username` 和 `status id`
2. 请求：
   `https://api.fxtwitter.com/<username>/status/<status-id>`
3. 从返回 JSON 中读取：
   - `tweet.text`
   - `tweet.author`
   - `tweet.media`

## 参考命令

```bash
URL="https://x.com/username/status/123456789?s=20"
CLEAN=$(echo "$URL" | sed 's/[?#].*//' | sed 's:/*$::')
USERNAME=$(echo "$CLEAN" | grep -oE '(twitter\\.com|x\\.com)/[^/]+' | sed 's#.*\\/##')
TWEET_ID=$(echo "$CLEAN" | grep -oE 'status/[0-9]+' | sed 's#status/##')
curl -s "https://api.fxtwitter.com/${USERNAME}/status/${TWEET_ID}"
```

## 常见错误

- 不要直接抓 Twitter 页面 HTML 再猜 DOM
- 不要假设视频链接永远在同一个字段
- 媒体下载前先核对 URL 是否存在
