# Event Stream（events.ndjson）

> 一句话：每次 Desktop 调用都会把“开始/结束/错误/观察结果”写入 `events.ndjson`，用于审计与复盘。

## 位置

证据目录结构（简化）：

```
<WORKSPACE>/
└── artifacts/desktop/YYYY-MM-DD/<executionId>/
    ├── env.json
    ├── events.ndjson
    ├── observe.png
    └── ax.json
```

## NDJSON 约定

- `events.ndjson` 是 **NDJSON**：每行一个 JSON 对象
- 行与行之间互不依赖，便于追加写入与流式读取

## 最小事件类型（P0）

### desktop.start

调用开始。

```jsonc
{"type":"desktop.start","timestamp":"...","executionId":"...","method":"desktop.observe"}
```

### desktop.stop

调用结束（成功）。

```jsonc
{"type":"desktop.stop","timestamp":"...","executionId":"...","method":"desktop.observe"}
```

### desktop.error

调用出错。

```jsonc
{"type":"desktop.error","timestamp":"...","executionId":"...","method":"desktop.observe","error":{"code":"...","message":"..."}}
```

### desktop.observe

`desktop.observe` 的结构化摘要（可选但推荐）。

```jsonc
{"type":"desktop.observe","timestamp":"...","executionId":"...","permissionsMissing":["accessibility"],"screenshotPath":"observe.png","axPath":"ax.json"}
```

