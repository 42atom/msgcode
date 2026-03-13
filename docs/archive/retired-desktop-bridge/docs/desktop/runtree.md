# RunTree Index（index.ndjson）

> 一句话：把每次 Desktop 执行的关键信息追加到一个索引文件里，方便“最近一次证据”“按时间回溯”“做统计”。

## 位置

推荐索引文件：

```
<WORKSPACE>/artifacts/desktop/index.ndjson
```

## NDJSON 约定

- `index.ndjson` 是 **NDJSON**：每行一个 JSON 对象
- 一次执行追加一行（append-only）

## 最小字段（建议）

```jsonc
{
  "timestamp": "2026-02-10T12:00:01Z",
  "executionId": "uuid",
  "method": "desktop.observe",
  "evidenceDir": "artifacts/desktop/YYYY-MM-DD/<executionId>",
  "workspacePath": "/abs/workspace",
  "status": "ok"
}
```

