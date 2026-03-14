# Plan: Scheduler skill + bash 主链收口

Issue: 0022

## Problem

当前 msgcode 的自然语言调度请求会让模型编造不存在的 `cron_add` 工具调用，而系统并没有把 cron/schedule 这条能力主链明确暴露给模型。结果是模型理解了意图，但没有真实入口。msgcode 其实已经有 `msgcode schedule add|list|remove` 和 workspace-local schedule 文件协议，只是缺少一份能让模型直接使用的 skill 真相源。

## Occam Check

- 不加它，系统具体坏在哪？
  cron/schedule 请求会继续落到 `route=no-tool`，模型只能编 fake tool，scheduler 永远收不到新任务。
- 用更少的层能不能解决？
  能。直接增加一份 runtime skill，告诉模型用 `bash + msgcode schedule` 或文件协议，不新增专用 LLM tool。
- 这个改动让主链数量变多了还是变少了？
  变少了。把“伪工具幻想路径”收口成一条真实可执行的 `skill -> bash -> schedule` 主链。

## Decision

采用最小方案：

1. 新增 `scheduler` runtime skill。
2. skill 明确正式入口：
   - `msgcode schedule add`
   - `msgcode schedule list`
   - `msgcode schedule remove`
3. 若 CLI 不足以覆盖场景，再把 workspace-local `.msgcode/schedules/*.json` 作为补充协议写入 skill。
4. 本轮只落 skill 真相源与同步测试，不提前改 prompt 主链。

## Alternatives

### 方案 A：新增 `cron_add` 等专用 LLM tool

- 优点：表面上直接
- 缺点：继续加桥，重复已有 CLI/文件协议，违背单一主链

### 方案 B：只改 prompt，不写 skill

- 优点：改动小
- 缺点：没有明确可读合同，模型仍容易自由发挥

### 方案 C：runtime skill + bash（推荐）

- 优点：最贴合现有能力，新增层最少
- 缺点：后续还需要一单去收口 prompt 和真实 smoke

## Plan

1. 落 `scheduler` runtime skill 真相源
- 新增：
  - `src/skills/runtime/scheduler/SKILL.md`
  - `src/skills/runtime/scheduler/main.sh`
- 验收点：
  - 文案明确“先读 skill，再用 bash/CLI 完成”

2. 更新 runtime 索引
- 修改：
  - `src/skills/runtime/index.json`
- 验收点：
  - `scheduler` 出现在托管 skill 索引中

3. 补 runtime-sync 回归锁
- 修改：
  - `test/p5-7-r13-runtime-skill-sync.test.ts`
- 验收点：
  - 同步后用户目录里存在 `scheduler`

4. 后续单继续收口
- 非本轮：
  - prompt 指向 scheduler skill
  - 真实 cron smoke

## Risks

1. 如果 skill 文案直接假设不存在的命令，会把模型带进新死路。
回滚/降级：只写当前仓库里已经存在的 `msgcode schedule` 合同和文件协议。

2. 若后续 prompt 不接上，skill 虽存在但模型未必会主动去读。
回滚/降级：下一单单独收口 prompt，不在本轮混改。

## Test Plan

- `PATH="$HOME/.bun/bin:$PATH" bun test test/p5-7-r13-runtime-skill-sync.test.ts`

## Observability

- 本轮不新增运行时日志；继续使用既有 cron 失败日志作为证据。

（章节级）评审意见：[留空，用户将给出反馈]
