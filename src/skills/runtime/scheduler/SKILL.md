---
name: scheduler
description: This skill should be used when the model needs to create, inspect, enable, disable, or remove recurring schedules in msgcode, or when diagnosing schedule state in the current workspace.
---

# scheduler skill

## 能力

本 skill 是定时任务能力说明书，不是系统内建编排器。

- 提供 msgcode 周期任务的唯一推荐入口。
- 约束 `add/list/remove/enable/disable` 的正确命令模板。
- 提供 schedule 文件、jobs 投影、runs 日志的排障路径。
- 告诉模型不要发明 `cron_add`、`schedule_add` 之类不存在的工具。

本 skill 是参考实现，不是唯一方式。周期任务可用 cron；一次性任务（如“明早 10 点”）请根据环境自行选择实现（at、launchd、定时脚本等）。

## 何时使用

在以下场景读取并使用本 skill：

- 定时提醒
- 周期任务
- cron / schedule
- 每隔一段时间执行
- 每天 / 每周固定时间提醒
- 排查 schedule 文件、jobs 投影或 scheduler 触发状态

## 唯一入口

优先入口：`~/.config/msgcode/skills/scheduler/main.sh`

先读 `~/.config/msgcode/skills/index.json`，再读本 skill，再用 `bash` 调入口脚本。禁止跳过本 skill 直接猜 `msgcode schedule` 参数。

不要直接把原始 `msgcode schedule ...` 当成首选入口。先走 wrapper，再由 wrapper 调正式 CLI。

## 核心规则

- 不要发明 `cron_add`、`schedule_add` 之类不存在的 LLM tool。
- 涉及定时任务时，优先使用 `bash ~/.config/msgcode/skills/scheduler/main.sh ...`。
- `--workspace` 必须使用 system prompt 中 `[当前工作区]` 提示提供的绝对路径，禁止猜测或虚构。
- add/remove/list/enable/disable 都按下面的最短正确模板执行。
- 添加后先 `list` 或查看 schedule 文件，再等待 scheduler 在后台执行。
- 如需排障，再看 `<workspace>/.msgcode/schedules/*.json`、`~/.config/msgcode/cron/jobs.json`、`~/.config/msgcode/cron/runs.jsonl`。

## 命令模板

### add（创建周期任务）

```bash
bash ~/.config/msgcode/skills/scheduler/main.sh add <schedule-id> --workspace <workspace-abs-path> --cron '<expr>' --tz <iana> --message '<text>'
```

关键提醒：

- `<schedule-id>` 是位置参数，不是 `--scheduleId`
- add 的必填参数只有这 5 个：`<schedule-id>`、`--workspace`、`--cron`、`--tz`、`--message`
- `--workspace` 必须使用 system hint 提供的绝对路径
- 禁止省略 `--cron` / `--tz` / `--message`

### list（列出定时任务）

```bash
bash ~/.config/msgcode/skills/scheduler/main.sh list --workspace <workspace-abs-path>
```

### remove（删除定时任务）

```bash
bash ~/.config/msgcode/skills/scheduler/main.sh remove <schedule-id> --workspace <workspace-abs-path>
```

### enable（启用定时任务）

```bash
bash ~/.config/msgcode/skills/scheduler/main.sh enable <schedule-id> --workspace <workspace-abs-path>
```

### disable（禁用定时任务）

```bash
bash ~/.config/msgcode/skills/scheduler/main.sh disable <schedule-id> --workspace <workspace-abs-path>
```

## 正确与错误示例

```bash
# 错误：不要发明 --scheduleId
bash ~/.config/msgcode/skills/scheduler/main.sh add --scheduleId live-cron --workspace <workspace-abs-path> --cron '*/1 * * * *' --tz <iana> --message 'live cron'

# 错误：漏 --tz，会触发 add 合同失败
bash ~/.config/msgcode/skills/scheduler/main.sh add live-cron --workspace <workspace-abs-path> --cron '*/1 * * * *' --message 'live cron'

# 错误：漏 --cron 或漏 --message，都会触发 add 合同失败
bash ~/.config/msgcode/skills/scheduler/main.sh add live-cron --workspace <workspace-abs-path> --tz <iana> --message 'live cron'
bash ~/.config/msgcode/skills/scheduler/main.sh add live-cron --workspace <workspace-abs-path> --cron '*/1 * * * *' --tz <iana>

# 正确：使用完整 add 合同
bash ~/.config/msgcode/skills/scheduler/main.sh add live-cron --workspace <workspace-abs-path> --cron '*/1 * * * *' --tz Asia/Singapore --message 'live cron'
```

## 验证与排障

推荐验证顺序：

1. 先读 `~/.config/msgcode/skills/index.json`
2. 再读本 skill
3. 确认当前 workspace 绝对路径
4. 按模板执行 `add` / `list` / `remove` / `enable` / `disable`
5. 查看 schedule 文件：
   - `<workspace>/.msgcode/schedules/<scheduleId>.json`
6. 查看 jobs 投影：
   - `~/.config/msgcode/cron/jobs.json`
7. 查看 runs：
   - `~/.config/msgcode/cron/runs.jsonl`

## 常见错误

- ❌ 把 `scheduleId` 写成 `--scheduleId`
- ❌ 漏 `--workspace`
- ❌ 漏 `--cron`
- ❌ 漏 `--tz`
- ❌ 漏 `--message`
- ❌ 抄示例路径而不是使用当前 system hint 提供的绝对路径
- ❌ 跳过本 skill，直接猜 `msgcode schedule` 参数

## 文件与参数速查

schedule 文件：

- `<workspace>/.msgcode/schedules/<scheduleId>.json`

最小文件结构：

```json
{
  "version": 1,
  "enabled": true,
  "tz": "Asia/Shanghai",
  "cron": "0 9 * * *",
  "message": "每天早上 9 点提醒我看日报",
  "delivery": {
    "mode": "reply-to-same-chat",
    "maxChars": 2000
  }
}
```

参数速查：

- `add <scheduleId>`：创建 schedule
- `remove <scheduleId>`：删除 schedule
- `enable <scheduleId>`：启用 schedule
- `disable <scheduleId>`：禁用 schedule
- `--workspace <abs-path>`：当前工作区绝对路径
- `--cron '<expr>'`：cron 表达式，例如 `*/5 * * * *`
- `--tz <iana>`：IANA 时区，例如 `Asia/Singapore`
- `--message '<text>'`：到点发送的内容
- `--json`：返回结构化结果，便于后续处理

## 透明兼容说明

wrapper 已经兼容部分常见模型漂移，但不要依赖这些兼容层替代正确命令：

- `--scheduleId` / `--schedule-id` / `--id`
- `delete` / `stop` / `rm` / `del`
- add 漏 `--tz` 时的透明补时区
