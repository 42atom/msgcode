# scheduler skill

本 skill 是参考实现，不是唯一方式。周期任务可用 cron；一次性任务（如"明早10点"）请根据环境自行选择实现（at/launchd/定时脚本等）。

触发：定时提醒、周期任务、cron、schedule、每隔一段时间执行、每天/每周固定时间提醒。

调度主链：`scheduler skill -> bash -> msgcode schedule ...`（仅周期任务适用）

一次性任务执行链：LLM 根据环境自行选择实现方式（at/launchd/bash 定时脚本等）

本 skill 作用：
- 告诉模型不要发明 `cron_add` 之类不存在的工具。
- 先读当前 workspace 绝对路径，再用 `bash` 调 `msgcode schedule` 正式命令。
- 如需手工排查，可直接查看 `<workspace>/.msgcode/schedules/*.json`。

优先入口：`~/.config/msgcode/skills/scheduler/main.sh`

规则：
- 不要发明 `cron_add`、`schedule_add` 之类不存在的 LLM tool。
- 涉及定时任务时，优先使用 `bash ~/.config/msgcode/skills/scheduler/main.sh ...`。
- `--workspace` 必须使用系统已经提供的当前 workspace 绝对路径，不要猜路径。
- 添加后可用 `list` 确认，再由 scheduler 在后台执行。

周期任务示例：
- `bash ~/.config/msgcode/skills/scheduler/main.sh add morning-digest --workspace <workspace-abs-path> --cron '0 9 * * *' --tz Asia/Shanghai --message '每天早上 9 点提醒我看日报' --json`
- `bash ~/.config/msgcode/skills/scheduler/main.sh list --workspace <workspace-abs-path> --json`
- `bash ~/.config/msgcode/skills/scheduler/main.sh remove morning-digest --workspace <workspace-abs-path> --json`

文件协议：
- schedules 存储在：
  - `<workspace>/.msgcode/schedules/<scheduleId>.json`
- 最小文件结构：
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

工作流程：
1. 先确认当前 workspace 绝对路径
2. 用 `add` 创建 schedule
3. 用 `list` 确认已写入
4. 如需删除，用 `remove`
5. 如果是排障，再看 `.msgcode/schedules/` 与 scheduler 日志

参数速查：
- `add <scheduleId>`：创建一个新的 schedule
- `--workspace <abs-path>`：当前工作区绝对路径
- `--cron '<expr>'`：cron 表达式，例如 `*/5 * * * *`
- `--tz <iana>`：IANA 时区，例如 `Asia/Shanghai`
- `--message '<text>'`：到点发送的内容
- `--json`：返回结构化结果，便于后续处理
