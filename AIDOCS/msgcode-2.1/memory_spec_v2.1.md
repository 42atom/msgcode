# msgcode Memory 设计草案（v2.1，方案 A：Markdown + FTS5）

## 一句话目标
把“记忆”从 Claude Code/Codex 的 session 中剥离出来，变成用户本地可控资产：**每个项目(workspace/iMessage 群)独立记忆**；bot owner 具备跨项目只读检索能力（“记忆管家视图”）。

## 设计结论（你要的架构）

### 1) Project Memory（强隔离）
- 每个 workspace（= 每个 iMessage 群绑定的工作目录）拥有自己的记忆文件树。
- 该 workspace 的 CC/Codex/任何 client 都只读取它自己的记忆。
- 默认不跨群共享，避免隐私泄露与“记忆污染”。

### 2) Personal Memory（管家视图，只读聚合）
- bot owner 可以跨 workspace 检索所有记忆（只读）。
- “聚合”通过索引实现，不需要把正文合并成一份全局 MEMORY.md（避免跨项目污染）。
- 群内命令永远只允许访问本群 workspace 的记忆；跨群只读查询仅 CLI（owner）可用。

---

## 约束（v2.1 总原则）
- **用户掌控**：记忆的 Source of Truth 是可编辑的本地文件（Markdown），不依赖厂商。
- **默认隔离**：不同 chatGuid/workspace 的记忆彼此不可见。
- **可恢复**：daemon 重启后可从本地文件重建索引并恢复检索。
- **JSON-first**：memory CLI 输出必须可机器解析（遵循 `AIDOCS/msgcode-2.1/cli_contract_v2.1.md:1`）。
- **隐私基线**：
  - 诊断/日志默认不落正文，只存 `textDigest/textLength/path/lineRange` 等元数据；
  - FTS5 索引库为“本机检索数据库”，允许存储可检索文本（`chunks_fts.content`）以实现全文搜索；但不应把该内容写入 `msgcode.log`/probe/status 输出。
  - 正文的 Source of Truth 仍然是 workspace 的 `memory/*.md`（用户可读可编辑）。

---

## 存储层：Markdown = Source of Truth

### 目录结构（每个 workspace）
```
<WORKSPACE>/
└── memory/
    ├── YYYY-MM-DD.md          # 追加写日志（每日）
    └── MEMORY.md              # 可选：该项目长期记忆（仅该项目加载/索引）
```

说明：
- `memory/YYYY-MM-DD.md`：append-only，记录“发生了什么/做了什么/决策是什么/关键结论是什么”。
- `memory/MEMORY.md`：项目级长期记忆（非全局）。只在该项目检索/注入。

### 写入策略（v2.1）
两种写入来源：
1) **显式**：用户发 `/remember ...`（或 CLI `msgcode memory remember ...`）写入。
2) **半自动**（可选，默认关闭）：在特定事件写入摘要（例如 `/bind`、jobs 运行完成后写结论）。

### 每日文件自动创建（建议）
- 写入时若 `memory/YYYY-MM-DD.md` 不存在：自动创建，并写入头部（只写一次）：
```md
## YYYY-MM-DD
```

严禁：
- 默认自动写入用户/模型的完整对话正文（避免把隐私和噪声塞进记忆）。

建议的写入格式模板（简洁、可读、可 diff）

#### 模板 1：决策（decision）
```md
## 2026-02-01 09:30 — 决策
- 结论：jobs store 放到 ~/.config/msgcode/cron/jobs.json
- 原因：daemon 可恢复；与 routes/state 并列
- 后续：实现 msgcode job status --json
```

#### 模板 2：事件（event）
```md
## 2026-02-01 14:20 — 事件
- 发生：imsg rpc send 临时不可用（Connection refused）
- 处理：重启 imsg 进程后恢复
- 备注：记录错误码与复现条件，便于下次排障
```

#### 模板 3：总结（summary）
```md
## 2026-02-01 18:00 — 总结
- 今日完成：jobs spec v2.1、memory spec v2.1 初稿
- 明日计划：开始 CLI Contract 收口
```

---

## 检索层：FTS5/BM25（方案 A）

### 为什么先做 BM25
- 记忆里大量是“精确 token”信息：错误码、配置键、路径、项目名、命令名。
- BM25/FTS5 对这些非常稳；实现成本低；可完全本地离线。

### 索引存储（全局索引，仅元数据）
- 路径：`~/.config/msgcode/memory/index.sqlite`
- 内容：只存可检索文本（来自 memory md），并附带 workspaceId/chatGuid/path/lineRange/digest 等字段。

### Schema（建议）
最小表：

1) `documents`（文件级）
- `doc_id` INTEGER PK
- `workspace_id` TEXT  （建议用 RouteStore 的 workspaceId；无则 fallback chatGuid）
- `chat_guid` TEXT
- `path` TEXT
- `mtime_ms` INTEGER
- `sha256` TEXT

2) `chunks`（分块元数据）
- `chunk_id` TEXT（uuid）
- `doc_id` INTEGER FK
- `start_line` INTEGER
- `end_line` INTEGER
- `heading` TEXT  （最近的 `## ...` 标题，用于快速定位）
- `text_digest` TEXT
- `text_length` INTEGER

3) `chunks_fts`（FTS5 虚表）
- `chunk_id`
- `workspace_id`
- `path`
- `content`

备注：
- `chunks_fts.content` 是可检索文本（来自 memory md）。这是"索引副本"，不等于日志/诊断；不写到 `msgcode.log`。
- 索引中不存 iMessage sender/handle 等敏感身份字段（除非用户明确写进 memory 文件）。

### workspaceId 生成策略（分阶段）
- **P0（当前 v2.1）**：使用 workspace 目录名作为 `workspace_id`（如 `msgcode-test-workspace`）
  - 简化实现，快速验证核心闭环
  - **已知局限**：不同路径下同名目录会产生相同的 `workspaceId`（理论上可撞名，但 P0 可接受）
- **P1（未来升级）**：使用稳定的 hash 策略（如 `sha256(realpath)[:12]`）
  - 保证全局唯一性，支持 workspace 移动后仍保持相同 ID
  - 需要配合数据迁移脚本（重命名已索引的 `workspace_id`）

### Chunk 策略（简单可用）
- 优先按 `## ...` 标题分段（一段=一个标题块）。
- fallback：按行分段（例如每 20~60 行一个 chunk，可配）。
- overlap：不必强做 token overlap（v2.1 先简单，后续向量阶段再优化）。

---

## 工具层：Two-tool Pattern

> 目标：让 agent “先搜定位，再拉细节”，避免一次把大文件喂进上下文。

### 1) memory_search（必须先用）
输入：
- `scope`: `workspace` | `all`
- `query`: string
- `workspaceId?` / `chatGuid?`: scope=workspace 时必须提供其一
- `limit`: number（默认 8）

输出（每条结果都必须可定位到文件与行号）：
```jsonc
{
  "results": [
    {
      "workspaceId": "uuid",
      "chatGuid": "any;+;...",
      "path": "/Users/you/msgcode-workspaces/acme/ops/memory/2026-02-01.md",
      "startLine": 120,
      "lines": 20,
      "heading": "## 2026-02-01 09:30 — 决策",
      "snippet": "....(<= 700 chars)...",
      "score": 0.42
    }
  ]
}
```

约束：
- `snippet` 必须截断（例如 700 chars），只用于预览定位。
- `snippetMaxChars` 建议可配置（默认 700）。
- `scope=all` 仅 CLI/owner 可用；群内命令禁止。

### 2) memory_get（按需拉取）
输入：
- `path`
- `fromLine`（1-based）
- `lines`（默认 40，上限例如 200）

输出：
```jsonc
{ "path": "...", "fromLine": 120, "lines": 40, "text": "..." }
```

安全约束：
- 必须验证 `path` 属于指定 workspace 的目录树（防路径穿越/越权读取）。

---

## 隔离与权限（非常重要）

### 默认隔离规则
- 项目内（iMessage 群内）只能访问本群绑定 workspace 的 `memory/`。
- 禁止跨群检索/读取（即使 owner 在群里也不行，防误操作/泄露）。

### 管家视图（跨项目只读）
- 仅 CLI 提供：`msgcode memory search --scope all --json`
- 只读：不允许在 `--scope all` 下执行写入/remember。
- 建议增加 `--owner-confirm` 或要求 `--force`，避免误把隐私搜索当成常规命令运行。

---

## 索引更新策略（可恢复）

### 1) index（显式）
- `msgcode memory index --workspace <id> --json`：全量或增量索引某 workspace
- `msgcode memory index --all --json`：索引所有 workspace（owner-only）

### 2) watch（可选，后续）
v2.1 先不强制 watch；优先实现：
- daemon 启动时：发现索引缺失/过旧 → 提示或自动 reindex（可配置）
- 手动触发：`status --index` 或 `memory status --index`

增量策略（v2.1 可做简化版）：
- 以文件 `mtime+sha256` 为依据，未变文件跳过
- chunk digest 不变则不更新该 chunk（避免反复重建）

reindex 触发条件（建议至少支持一种）：
- memory schemaVersion 变更（例如 chunks 表字段变化）
- chunking 参数变更（例如按标题/按行、每 chunk 行数阈值）
- FTS5 结构变化（tokenizer/权重策略）

---

## CLI 命令面（v2.1，JSON-first）

### 1) status
`msgcode memory status --json [--workspace <id>|--all] [--index]`

data 建议字段：
- `store`: `{ indexPath, indexedWorkspaces, indexedFiles, indexedChunks }`
- `dirty`: `{ workspaces: [], files: [] }`
- `probes`: `{ sqliteOk, ftsOk }`
- `actions`: `{ recommended, reason }`（给出下一步建议命令）

### 2) search
`msgcode memory search "<query>" --json [--workspace <id>|--scope all] [--limit N]`

### 3) get
`msgcode memory get --path <file> --from <line> --lines <n> --json`

### 4) remember（写入，仅 workspace 内）
`msgcode memory remember "<text>" --json --workspace <id>`

建议扩展参数（便于结构化写入）：
- `--type decision|event|summary`
- `--reason "<...>"`（可选）
- `--followup "<...>"`（可选）

约束：
- 默认追加写入 `<WORKSPACE>/memory/YYYY-MM-DD.md`
- 严禁写入全局文件
- `--dry-run` 必须支持（输出 planned writes，不落盘）

### 5) validate（建议）
`msgcode memory validate --json [--workspace <id>|--all]`

检查项建议：
- memory/ 目录是否存在（可自动创建）
- Markdown 头部/标题格式（`## YYYY-MM-DD`、`## YYYY-MM-DD HH:MM — <type>`）
- 文件路径是否越界

### 6) compact（可选，后续）
`msgcode memory compact --json --workspace <id>`

用途：
- 合并旧日志、去重复、把“日记”提炼为项目 MEMORY.md（默认关闭，需要显式执行）

---

## 与 msgcode 现有模块的集成点（建议）

### 1) RouteStore 是单一真相源
- 通过 `routes.json` 把 `chatGuid → workspacePath/workspaceId` 对齐
- Memory 的隔离边界是 workspace（不是 model client / 不是 tmux session）

### 2) 与 Jobs 的联动（后续）
- job 完成后可写一条“摘要”到该 workspace 的 memory（默认关闭）
- 或 job 定时触发 `memory index`（轻量维护）

建议显式字段（默认关闭）：
- `job.onComplete.remember.enabled: false`
- `job.payload.kind="memoryIndex"`（jobs 触发索引维护）

---

## 验收清单（v2.1）

P0（必须）：
1) 每个 workspace 可以独立写 `memory/YYYY-MM-DD.md`
2) FTS5 索引可重建：删除 index.sqlite 后仍可恢复
3) `memory_search` + `memory_get` 能定位到 path+行号
4) `scope=all` 仅 CLI 可用；群内永远隔离

P1（可选）：
- `--index` 自动维护、增量索引、基础可观测指标完善

---

## MEMORY 错误码（对齐 CLI Contract）

### 参数与路径错误
- `MEMORY_WORKSPACE_NOT_FOUND`：workspaceId 不存在/无法解析
- `MEMORY_FILE_NOT_FOUND`：指定的 memory 文件不存在
- `MEMORY_PATH_TRAVERSAL`：path 包含 `..` 或越界

### 索引与搜索错误
- `MEMORY_INDEX_CORRUPTED`：index.sqlite 损坏，需 reindex
- `MEMORY_FTS_DISABLED`：FTS5 不可用

### 运行时错误
- `MEMORY_WRITE_FAILED`：写入 memory 文件失败
- `MEMORY_INDEX_FAILED`：索引操作失败
- `MEMORY_SEARCH_FAILED`：搜索操作失败
- `MEMORY_READ_FAILED`：读取 memory 文件片段失败
- `MEMORY_STATUS_FAILED`：获取索引状态失败
