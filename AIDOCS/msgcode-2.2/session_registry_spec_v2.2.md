# Session Registry Spec（v2.2 / P0）

> 目的：让 msgcode 重启后依然“知道”每个 tmux 会话的 **执行臂/工作目录/状态口径**，确保手机端 `/status` 可控盘，不再依赖内存 Map 猜测。

---

## 1) 背景与问题

现状（v2.1）：
- `TmuxSession.sessions` 是内存态；daemon 重启后丢失。
- tmux 会话可能仍在运行（Claude/Codex 都可能），但 `/status` 会因为缺失元信息而误报（常见：runner 回退成 Claude）。

结果：
- 远程控盘失败：你明明在跑 Codex，会话却显示 Claude/“正在启动”。
- 误操作风险：用户以为没起来，重复 `/start` 或 `/clear` 造成上下文丢失。

---

## 2) 目标（P0）

- **重启可恢复**：msgcode 重启后 `/status` 仍能准确显示：
  - 执行臂：`claude` / `codex`
  - 工作目录：`projectDir`
  - 会话状态：`stopped/starting/ready`
- **口径一致**：`/start /stop /clear /status` 对同一会话的认知一致。
- **不引入复杂度**：不做“自动推断 runner”，以“落盘真相源”为准（必要时提示用户重建）。

---

## 3) 非目标（P0 不做）

- 不把 Codex/Claude 的对话历史另存一份（tmux/Codex 自己负责）。
- 不做跨机器同步。
- 不做 GUI 管理（未来 menubar app 可消费该 registry）。

---

## 4) 落盘位置与原子性

### 4.1 文件路径

默认：
- `~/.config/msgcode/sessions.json`

（与现有 `~/.config/msgcode/log/`、`~/.config/msgcode/cron/` 同一根目录，便于发现与备份。）

### 4.2 写入规则（必须原子）

- `write tmp -> fsync -> rename`（或同等原子策略）
- 禁止部分写入导致 JSON 损坏（损坏时应 fail-soft：视为“无 registry”，提示用户 `/start`）

---

## 5) Schema（v1）

```json
{
  "version": 1,
  "updatedAtMs": 0,
  "sessions": [
    {
      "sessionName": "msgcode-default",
      "groupName": "default",
      "projectDir": "/Users/admin/GitProjects",
      "runner": "codex",
      "createdAtMs": 0,
      "updatedAtMs": 0,
      "lastStartAtMs": 0,
      "lastStopAtMs": 0
    }
  ]
}
```

字段约束：
- `sessionName`：`TmuxSession.getSessionName(groupName)` 的结果；作为主键（唯一）
- `runner`：`"claude" | "codex"`（P0 不允许 unknown；如果无法确定，直接不写入并提示用户重建）
- `projectDir`：允许为空（未绑定时），但 `/start` 成功后必须补齐

隐私基线：
- 只存元信息（sessionName/projectDir/runner/time），不存消息正文，不存附件路径列表。

---

## 6) 生命周期（行为契约）

### 6.1 `/start`

- 成功启动 tmux 会话后：
  - upsert registry：写入 `sessionName/groupName/projectDir/runner`
  - 更新 `lastStartAtMs/updatedAtMs`

### 6.2 `/stop`

- stop 成功后：
  - 保留记录（不删除），仅更新 `lastStopAtMs/updatedAtMs`
  - 理由：停止后用户仍可能希望看到“最后一次是谁/在哪启动的”（P0 只做时间，不做 owner）

### 6.3 `/clear`

- `kill+start` 语义不变：
  - 先 stop（更新 lastStopAt）
  - 再 start（更新 runner/projectDir/lastStartAt）

### 6.4 `/status`

输出口径（推荐）：
- runner：优先来自 registry（真相源）
- running：来自 tmux 实况（`tmux has-session`）

若出现冲突（P0 处理方式）：
- tmux 存在，但 registry 无记录：提示用户发送 `/start` 重新登记（不自动推断 runner）
- registry 有记录，但 tmux 不存在：显示 stopped（并保留历史 runner/dir 供用户判断）

---

## 7) 验收（P0）

### 7.1 重启不丢 runner

1. `/model codex` → `/start`
2. `/status` 显示：执行臂=Codex + 正确 `projectDir`
3. 重启 msgcode daemon
4. `/status` 仍显示：执行臂=Codex + 正确 `projectDir`

### 7.2 stopped 口径一致

1. `/stop`
2. `/status` 显示：会话未运行（但可附带“上次执行臂/目录”的历史信息）

### 7.3 冲突提示（fail-soft）

1. 手工 kill tmux session（模拟外部干预）
2. `/status` 不崩溃，给出可执行 fixHint（如 `/start`）

---

## 8) 与 v2.2 编排层/menubar app 的关系

- 编排层（persona/skills/schedules）不依赖它，但可读取它做“活跃绿点”。
- menubar app 只做：
  - 打开 `~/.config/msgcode/` 和 workspace 目录
  - 展示 sessions.json（只读）+ 一键 reload（未来）

