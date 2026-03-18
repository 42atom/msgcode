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

## Cross-Agent 共享边界
- 同一 workspace 下的多个 agent，共享同一份 `<workspace>/memory/*.md` append 真相。
- 共享身份以 `workspacePath` 为准，不以目录 basename 猜。
- `workspaceId` 只是从绝对路径导出的稳定内部键，用于索引隔离；不是新的真相源。
- 不共享：
  - `.msgcode/sessions/<chatId>/summary.md`
  - `.msgcode/dispatch/*.json`
  - sqlite 派生索引内容本身

## 正常闭环
1. 归档（写文件）
```bash
./bin/msgcode memory add "一句话记忆" --workspace "<workspace-path>"
```

2. 建索引（文件 -> sqlite）
```bash
./bin/msgcode memory index --workspace "<workspace-path>" --json
```

开发直跑源码时：
```bash
node --import tsx src/cli.ts memory index --workspace "<workspace-path>" --json
```

约束：
- `./bin/msgcode` 天然走 Node，可直接用。
- `bun test` 只用于不触达 SQLite native addon 的测试。
- 不要把 `memory index` 这类 SQLite 路径直接塞进 Bun 进程。

3. 检索/注入（sqlite -> 上下文）
- 运行时在 [`/Users/admin/GitProjects/msgcode/src/listener.ts`](/Users/admin/GitProjects/msgcode/src/listener.ts) 里调用 `createMemoryStore().search(...)`
- 注入开关与额度在 `<workspace>/.msgcode/config.json`（或 ENV）：
  - `memory.inject.enabled`
  - `memory.inject.topK`
  - `memory.inject.maxChars`
- retrieval 继续只读索引，不直接扫 append 文件。
- 若 workspace 下存在 `memory/*.md` 但索引缺失：
  - `msgcode memory search --json` 返回 `warning`，并给出 `memory index` 重建建议
  - listener 继续 fail-open，但会显式记录“memory 索引缺失”，不再伪装成普通无结果

## Rebuild 合同
- `memory/*.md` 是 append 真相根。
- `index.sqlite` 删除后，不应丢失记忆真相；重新执行 `memory index` 后，应能从 append 文件完整重建检索面。
- `chunks`、`fts`、向量表都只能从文件重切重建；它们不是唯一真相。

## Summary 边界
- `.msgcode/sessions/<chatId>/summary.md` 只是会话派生视图。
- 它服务于上下文压缩和恢复阅读，不是长期 memory 真相源。
- summary 文件必须显式声明自己是 derived view，不得伪装成 append 真相。
- summary 里的内容不能自动升格成长期 memory；若要升格，必须走显式 review / candidate 流程。

最小验证链：
```bash
./bin/msgcode memory add "append truth survives rebuild" --workspace "<workspace-path>"
./bin/msgcode memory index --workspace "<workspace-path>" --json
rm ~/.config/msgcode/memory/index.sqlite
./bin/msgcode memory index --workspace "<workspace-path>" --json
./bin/msgcode memory search "survives" --workspace "<workspace-path>" --json
```

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
- 当前 cross-agent 共享仍只建立在“同一 workspacePath”上；还没有做跨 workspace 的显式共享/授权面。
