# MEMORY（记忆归档与索引）

## 结论
- **记忆真相源**：每个 workspace 的 `<workspace>/memory/*.md`（可读可编辑）。
- **检索索引**：`~/.config/msgcode/memory/index.sqlite`（可丢弃、可重建的派生物）。
- **运行时只读索引**：listener 会在需要时查询 sqlite，把命中的片段以“证据块”形式注入上下文；**不会在运行时自动重建索引**。

## 目录与文件
每个 workspace：
- `<workspace>/memory/YYYY-MM-DD.md`：`msgcode memory add` 追加写入

全局：
- `~/.config/msgcode/memory/index.sqlite`：`msgcode memory index` 构建

## 正常闭环
1. 归档（写文件）
```bash
./bin/msgcode memory add "一句话记忆" --workspace "<workspace-path>"
```

2. 建索引（文件 -> sqlite）
```bash
./bin/msgcode memory index --workspace "<workspace-path>" --json
```

3. 检索/注入（sqlite -> 上下文）
- 运行时在 [`/Users/admin/GitProjects/msgcode/src/listener.ts`](/Users/admin/GitProjects/msgcode/src/listener.ts) 里调用 `createMemoryStore().search(...)`
- 注入开关与额度在 `<workspace>/.msgcode/config.json`（或 ENV）：
  - `memory.inject.enabled`
  - `memory.inject.topK`
  - `memory.inject.maxChars`

## 索引刷新（运维口径）
目标：保证新写入的 `memory/*.md` 能稳定被检索到。

建议：每天定时全量重建索引（01:00 与 13:00 各一次）。

做法（“所有 workspace，依次跑”）：
1. 列出所有 workspacePath：
```bash
./bin/msgcode thread list --json
```
取输出里的 `data.threads[*].workspacePath` 去重。

2. 逐个执行：
```bash
./bin/msgcode memory index --workspace "<path>" --json
```

约束：
- 任一 workspace 索引失败，不应阻塞后续 workspace（继续跑，最后汇总失败列表）。
- `index.sqlite` 损坏时可直接删除后重建（它不是记忆真相源）。

## 已知限制（P0）
- 当前 `workspaceId` 使用 `path.basename(workspacePath)`；不同路径下同名目录可能“撞 ID”（会导致检索串味）。尽量避免重名 workspace 目录。

