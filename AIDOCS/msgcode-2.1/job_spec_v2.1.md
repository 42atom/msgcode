# msgcode Jobs 设计草案（v2.1）

## 一句话目标
让 msgcode 支持“到点自动推进工作”的定时/周期任务：**写入 tmux（驱动 agent）→ 可选回发到 iMessage 群**，并且全程 **JSON-first、可诊断、可恢复**。

## 定位与边界

### 做什么
- 在 Gateway/daemon 进程里内置一个 **轻量调度器**，对本机 jobs 持久化管理。
- Job 到期时执行：
  1) 找到绑定群（RouteStore）对应的 workspace/tmux 会话
  2) 向 tmux 会话发送一条消息（像用户在群里发了一句一样）
  3) 读取响应（复用现有 reader/streamer 能力）
  4) 按策略回发到该群（或静默不回）
- 产生可机器读取的状态：job 列表、下次唤醒、运行历史、错误码。

### 不做什么（2.1 明确不做）
- 不执行任意 shell 命令（除非未来做 allowlist + workspace 内脚本白名单）。
- 不做跨机器/多机同步。
- 不做复杂 RBAC；2.1 仅提供“本机 owner 控制”（CLI 操作即 owner）。

## 核心原则（从优秀作品里学到的）
1) **Job 是数据，不是脚本**：可持久化、可审计、可迁移。
2) **调度器极简但硬**：一个 timer + nextWakeAt + 防卡死。
3) **执行语义分层**：主会话注入 vs 隔离执行；回传/投递是可选项且 best-effort。

---

## 文件与路径（建议）

### 默认路径（与现有 configDir 并列）
- Job Store：`~/.config/msgcode/cron/jobs.json`
- Run Log（追加写）：`~/.config/msgcode/cron/runs.jsonl`

### 原子写策略
- `jobs.json`：写入临时文件再 `rename`（原子替换）。
- `runs.jsonl`：追加写（每行一个 JSON），失败不应影响主链路。

---

## 数据模型（v1）

### CronStoreFile
```jsonc
{
  "version": 1,
  "jobs": [ /* CronJob[] */ ]
}
```

### CronJob
```jsonc
{
  "id": "uuid",
  "enabled": true,
  "name": "morning-brief",
  "description": "optional",

  /* 路由：永远对齐 RouteStore 的 chatGuid（单一真相源） */
  "route": {
    "chatGuid": "any;+;e110497bfed546efadff305352f7aec2"
  },

  /* 何时运行 */
  "schedule": { "kind": "cron", "expr": "0 7 * * *", "tz": "Asia/Shanghai" },

  /* 在哪运行 */
  "sessionTarget": "main",

  /* 做什么：2.1 仅允许“向 tmux 送消息” */
  "payload": { "kind": "tmuxMessage", "text": "生成今天简报：..." },

  /* 回发策略（iMessage only） */
  "delivery": {
    "mode": "reply-to-same-chat",
    "bestEffort": true
  },

  /* 运行状态（可诊断、可恢复） */
  "state": {
    "nextRunAtMs": 1738262400000,
    "runningAtMs": null,
    "lastRunAtMs": 1738262400000,
    "lastStatus": "ok",
    "lastError": null,
    "lastDurationMs": 800
  },

  "createdAtMs": 1738262400000,
  "updatedAtMs": 1738262400000
}
```

### 类型约束（建议）
- `route.chatGuid`：必须存在于 `routes.json`，否则 job 状态为 `warning`（不自动运行，除非 `--force`）。
- `payload.text`：非空、trim 后长度 > 0。
- `name`：trim 后非空，建议限制 1~64 字符，作为 UI/日志可读名。

---

## Schedule（时间语义）

支持三种 schedule（与优秀实践一致）：

### 1) at（一次性）
```jsonc
{ "kind": "at", "atMs": 1738262400000 }
```

语义：
- 到点后变为 due，**成功运行一次**后默认禁用（或可选 deleteAfterRun）。

### 2) every（固定间隔）
```jsonc
{ "kind": "every", "everyMs": 3600000, "anchorMs": 1738262400000 }
```

语义：
- `anchorMs` 作为对齐锚点，避免漂移。

### 3) cron（表达式 + 时区）
```jsonc
{ "kind": "cron", "expr": "0 7 * * *", "tz": "Asia/Shanghai" }
```

语义：
- 使用 `croner`（或同类库）计算 `nextRunAtMs`。
- `tz` 为空时：默认使用主机时区（或强制 UTC，需在实现时固定一条规则并写进 README）。

---

## 执行语义（sessionTarget）

### A) main（推荐默认）
目的：用“主会话上下文”做定时推进（像人每天早上敲一句）。

实现建议：
- 复用该 chat 绑定的 workspace 与 tmux session（`stableGroupNameForChatId(chatGuid)`）。
- 调用现有 `handleTmuxSend(...)` 完成“送入 + 读出”。

### B) isolated（2.1 可选但建议设计进协议）
目的：后台任务不污染主会话历史；跑完只回传摘要/结果。

实现建议：
- 临时 tmux session：`job:<jobId>`（或 `cron:<jobId>`）。
- 执行完成后：按策略销毁该 session，避免长驻资源占用。
- 回传策略：
  - `reply-to-same-chat`：把最终输出（可截断）发回群里
  - `none`：只写 runs log，不回发

---

## 调度器（daemon 内部实现建议）

### 核心状态
- 内存中持有：store（jobs[]）+ 单个 timer
- 每次 store 变更后：
  1) 重算每个 job 的 `nextRunAtMs`
  2) 计算 `nextWakeAtMs = min(nextRunAtMs)`
  3) armTimer(nextWakeAtMs)

### 单 timer 约束（避免多个 setInterval 失控）
- 始终只保留 1 个 `setTimeout`
- 使用 `unref()`（允许进程正常退出/重启策略由 launchd 决定）
- 对超远 future 的 delay 做 clamp（避免 TimeoutOverflow）

### 防卡死（stuck 清理）
- 若 `runningAtMs` 超过阈值（建议 2h）：
  - 清掉 running 标记
  - 写入 runs.jsonl：`status="error", error="stuck cleared"`
  - 继续调度其他 job（不让一个 job 挂死整个 scheduler）

---

## Run Log（runs.jsonl）

每次运行追加一行：
```jsonc
{
  "ts": "2026-01-31T12:00:00.000Z",
  "jobId": "uuid",
  "chatGuid": "any;+;...",
  "sessionTarget": "main",
  "status": "ok",
  "durationMs": 800,
  "error": null,
  "textDigest": "sha256:abcd1234" /* 可选：只存摘要，不存正文 */
}
```

隐私原则：
- 默认不落用户/模型正文；只落 `textLength/textDigest`（与 E17 一致）。

---

## CLI 设计（v2.1）

> 2.1 优先 CLI（owner-only），群内命令后置。

### 命令面（建议）
- `msgcode job status --json`
- `msgcode job list --json [--all]`
- `msgcode job add --json <file>`（或 `--name/--at/--cron/...` 逐步补）
- `msgcode job edit <id> --json <patchFile>`
- `msgcode job enable <id>` / `msgcode job disable <id>`
- `msgcode job remove <id>`
- `msgcode job run <id> [--force]`
- `msgcode job runs [--id <id>] --json`

### status JSON（建议）
```jsonc
{
  "version": 1,
  "enabled": true,
  "storePath": "~/.config/msgcode/cron/jobs.json",
  "jobs": 3,
  "running": 0,
  "nextWakeAtMs": 1738262400000,
  "warnings": [],
  "errors": []
}
```

---

## 与现有系统的集成点（msgcode 侧）

### 依赖
- RouteStore：`~/.config/msgcode/routes.json`
- iMessage：`imsg rpc send`（用于回发）
- tmux：现有 session/sender/streamer（用于驱动 agent）

### 与 probe/doctor 的关系
把 job scheduler 作为 probe 类别之一（JSON-first）：
- store 可读/可解析
- jobs 数量、enabled 数量
- nextWakeAt 是否存在
- 是否存在 stuck/running 超时的 job

---

## 验收清单（2.1）

### 最小闭环（必须）
1) `msgcode job add` 能写入 `jobs.json`
2) daemon 启动后能按 `at` schedule 触发一次
3) 能向目标群绑定的 tmux session 发送消息，并得到输出
4) `runs.jsonl` 有记录；`msgcode job status --json` 可读

### 稳定性（必须）
1) 重启 daemon 不丢 schedule（从 jobs.json 恢复）
2) timer 不会因为远未来 schedule 溢出
3) 单个 job 卡死不会拖垮整个 scheduler

### 隐私（必须）
1) runs/log 不落正文（默认）

