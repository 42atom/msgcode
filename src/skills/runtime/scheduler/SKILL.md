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
- `--workspace` 必须使用 system prompt 中的 `[当前工作区]` 提示提供的绝对路径，禁止猜测或虚构。
- 添加后可用 `list` 确认，再由 scheduler 在后台执行。

## 命令模板（必读）

### add（创建定时任务）
```bash
# <必填> 位置参数 <schedule-id> - 用户给的名称，如 "live cron"
# <必填> --workspace <从 system hint 获取的绝对路径>
# <必填> --cron <cron 表达式>
# <必填> --tz <IANA 时区>
# <必填> --message <任务内容>

# 示例：用户说"定一个每分钟发送的任务 发：live cron"
# schedule-id = "live-cron"（把空格改成连字符）
# workspace = 从 system hint 获取（如 /Users/admin/xxx/workspace）
# cron = "*/1 * * * *"

bash ~/.config/msgcode/skills/scheduler/main.sh add live-cron \
  --workspace <workspace-abs-path> \
  --cron '*/1 * * * *' \
  --tz Asia/Singapore \
  --message 'live cron' \
  --json
```

**关键提醒**：
- `add` 后面的 `<schedule-id>` 是**位置参数**，不是 `--schedule-id`
- 用户说"发：live cron"，schedule-id 就是 `live-cron`
- `--workspace` 必须用 system hint 提供的**绝对路径**，不要抄示例！
- `--tz` 是 **add 必填参数**。模型应优先显式写出 `--tz <iana>`，不要省略。
- skill wrapper 仅在模型漏掉 `--tz` 时，透明补当前会话/系统时区作为兜底；这不是主合同，不能依赖它代替正确命令生成。

**错误示例 vs 正确示例**：
```bash
# 错误：不要发明 --scheduleId
bash ~/.config/msgcode/skills/scheduler/main.sh add \
  --scheduleId live-cron \
  --workspace <workspace-abs-path> \
  --cron '*/1 * * * *' \
  --message 'live cron' \
  --json

# 错误：漏 --tz，会触发 add 合同失败
bash ~/.config/msgcode/skills/scheduler/main.sh add live-cron \
  --workspace <workspace-abs-path> \
  --cron '*/1 * * * *' \
  --message 'live cron' \
  --json

# 正确：schedule-id 只能放在 add 后面作为位置参数，且必须显式带 --tz
bash ~/.config/msgcode/skills/scheduler/main.sh add live-cron \
  --workspace <workspace-abs-path> \
  --cron '*/1 * * * *' \
  --tz Asia/Singapore \
  --message 'live cron' \
  --json
```

### list（列出所有定时任务）
```bash
# <必填> --workspace（从 system hint 获取绝对路径）

bash ~/.config/msgcode/skills/scheduler/main.sh list \
  --workspace <workspace-abs-path> \
  --json
```

### remove（删除定时任务）
```bash
# <必填> --workspace（从 system hint 获取绝对路径）

bash ~/.config/msgcode/skills/scheduler/main.sh remove <schedule-id> \
  --workspace <workspace-abs-path> \
  --json
```

### 常见错误
- ❌ 把 `scheduleId` 写成 `--scheduleId`：错误，`scheduleId` 只能是位置参数
- ❌ 漏 `--workspace`：会报 `required option '--workspace <id|path>' not specified`
- ❌ 漏 `--cron`：会报 `required option '--cron <expr>' not specified`
- ❌ 漏 `--tz`：会报 `required option '--tz <iana>' not specified`
- ❌ 抄示例路径：必须用 system hint 提供的绝对路径，禁止抄下面示例里的路径

## 历史示例

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
- `--tz <iana>`：IANA 时区，例如 `Asia/Singapore`
- `--message '<text>'`：到点发送的内容
- `--json`：返回结构化结果，便于后续处理
