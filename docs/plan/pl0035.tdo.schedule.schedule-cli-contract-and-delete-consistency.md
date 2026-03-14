# Plan: 修复 schedule CLI 命令合同与删除一致性

## Problem

1. **删除一致性**：历史问题，当前代码已实现（`schedule.ts:622` + `cmd-schedule.ts:387` 调用 `removeScheduleFromJobs`）
2. **CLI 参数合同不稳定**：LLM 进入工具链后生成的命令仍漏 `--workspace` 或 `--cron`

## Occam Check

### 1. 不加这次改动，系统具体坏在哪？

- 删除 schedule 后，jobs 投影和 cron 运行不再自动停止（虽然代码已实现，但需验证）
- LLM 生成 schedule 命令时反复漏参数，导致执行失败

### 2. 用更少的层能不能解决？

能。正确方向：
- 删除一致性：代码已实现，只需验证 + 测试
- CLI 合同：强化 skill 示例的 explicit 程度，让 LLM 更容易一次写对

### 3. 这个改动让主链数量变多了还是变少了？

目标：让 add/remove/list 都回到 skill -> bash -> msgcode schedule 单一主链。

## Decision

### 删除一致性（已实现）

代码检查：
- `schedule.ts:617-622`：删除文件后调用 `removeScheduleFromJobs`
- `cmd-schedule.ts:382-387`：删除文件后调用 `removeScheduleFromJobs`

无需代码修改，只需验证 + 补测试。

### CLI 合同强化

修改 `scheduler/SKILL.md`：
1. 把示例中的 `<workspace-abs-path>` 替换为"使用 buildWorkspacePathHint 提供的绝对路径"
2. add 示例明确标注必填参数
3. remove 示例明确标注必填参数

## Plan

### 步骤 1: 强化 scheduler SKILL.md

修改 `src/skills/runtime/scheduler/SKILL.md`：
- 示例从：
  ```
  bash ~/.config/msgcode/skills/scheduler/main.sh add morning-digest --workspace <workspace-abs-path> --cron '0 9 * * *'
  ```
- 改为更 explicit 的形式：
  ```
  # add（必须带 --workspace 和 --cron）
  bash ~/.config/msgcode/skills/scheduler/main.sh add <schedule-id> --workspace <从 system hint 获取的绝对路径> --cron '<cron-expr>' --tz <iana-tz> --message '<text>'

  # list（必须带 --workspace）
  bash ~/.config/msgcode/skills/scheduler/main.sh list --workspace <从 system hint 获取的绝对路径>

  # remove（必须带 --workspace）
  bash ~/.config/msgcode/skills/scheduler/main.sh remove <schedule-id> --workspace <从 system hint 获取的绝对路径>
  ```

### 步骤 2: 验证删除一致性

确认代码路径：
1. `schedule remove` CLI 命令：`schedule.ts:622` 调用 `removeScheduleFromJobs`
2. `/schedule remove` 聊天命令：`cmd-schedule.ts:387` 调用 `removeScheduleFromJobs`

### 步骤 3: 补测试

添加测试用例：
- `schedule remove` 后验证 jobs.json 中对应 job 消失
- `schedule remove` 后验证 runs.jsonl 不再新增

### 步骤 4: 真机 smoke

1. 创建新的 `cron-live`
2. 等待一次成功触发
3. 发送"停止 cron live"
4. 验证：
   - `toolCallCount > 0`
   - `route=tool`, `toolName=bash`
   - 命令带 `--workspace`
   - `schedules/cron-live.json` 消失
   - `jobs.json` 中 `cron-live` 消失
   - 下一分钟 `runs.jsonl` 不再新增

## Risks

1. LLM 可能仍不遵循 skill 示例：需要多轮调优
2. 真机验证耗时：需要等待 cron 触发

---

**评审意见**：[留空，用户将给出反馈]
