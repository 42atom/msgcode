---
name: scrapling
description: This skill should be used when the task needs structured web extraction with Scrapling, including simple fetch, dynamic rendering, or stealthy fetching, and ordinary page reading is not enough.
---

# scrapling skill

## 能力

使用 Scrapling 做结构化网页抓取。

## 何时使用

- 需要提取网页结构化内容
- 页面需要 JS 渲染
- 目标站点存在简单反爬，普通抓取不稳定
- 需要批量抓取而不是只读一页

## 前提

- 已安装：
  - `pip install "scrapling[all]"`
  - `scrapling install`

## 调用合同

优先使用 Scrapling 自身命令和 API，不要先自己造爬虫框架。

最小入口：

- CLI：
  - `scrapling extract get`
  - `scrapling extract stealth-fetch`
- Python：
  - `Fetcher`
  - `StealthyFetcher`
  - `DynamicFetcher`

## 参考命令

```bash
scrapling extract get 'https://example.com' output.md
scrapling extract stealth-fetch 'https://example.com' output.html --solve-cloudflare
```

## 常见错误

- 不要把普通单页读取任务都升级成 Scrapling
- 没安装依赖时不要假装可以直接抓
- 先确认目标只是抓取，不是浏览器交互；交互型任务优先 browser
