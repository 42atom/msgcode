# Plan: 修复 scheduler add 的 --tz 合同缺口

## Problem

当前系统已经能把自然语言 schedule 请求送进真实工具链，但 `msgcode schedule add` 的 skill 合同仍不稳：`SKILL.md` 把 `--tz` 写成选填，而 CLI 真合同把 `--tz` 定义为必填，导致模型在第二次 `bash` 调用时仍会漏参并失败。日志已经明确证明失败点就是缺 `--tz`。

## Occam Check

1. 不加这次改动，系统具体坏在哪？
   自然语言创建 schedule 时会漏 `--tz`，导致 `bash -> msgcode schedule add` 在真实执行阶段失败。
2. 用更少的层能不能解决？
   可以。先收 skill 合同和示例；再仅在 skill wrapper 层做透明 `--tz` 兜底，不改 CLI 真相源。
3. 这个改动让主链数量变多了还是变少了？
   变少。目标是把 `scheduler skill -> bash -> msgcode schedule add` 这条单一主链写稳，而不是再加新的判断层。

## Decision

采用“两步最小修复”：

1. `SKILL.md` 纠正合同：
   - `--tz` 明确为 add 必填
   - 增加漏 `--tz` 的错误示例
   - 增加完整正确示例和参数速查
2. `main.sh` 增加透明兜底：
   - 仅 `add` 且缺 `--tz` 时生效
   - 优先使用 `MSGCODE_SCHEDULER_DEFAULT_TZ`
   - 否则使用当前会话 `TZ`
   - 再否则使用系统/Node `Intl` 解析出的 IANA 时区
   - dry-run 可见、可测试、不改 CLI 真相源

## Alternatives

### 方案 A：只改 skill 文案，不加 wrapper 兜底

不选。虽然方向更纯，但本轮硬验收要求自然语言创建不再因缺 `--tz` 失败，只靠提示词很难给出稳定保证。

### 方案 B：直接在 CLI 里给 `--tz` 设默认值

不选。会改变 CLI 真相源与正式合同，不符合“只在 skill 层最小兜底”的边界。

## Plan

1. 修改 `src/skills/runtime/scheduler/SKILL.md`
   - add 参数列表改为：
     - `<schedule-id>`
     - `--workspace`
     - `--cron`
     - `--tz`
     - `--message`
   - 删除“`--tz` 选填，默认 UTC”
   - 增加“漏 `--tz`”错误示例
   - 明确若 wrapper 代补默认时区，该行为仅是透明兜底，模型仍应优先显式带 `--tz`
2. 修改 `src/skills/runtime/scheduler/main.sh`
   - 检测 `add` 命令是否缺 `--tz`
   - 解析默认时区并追加 `--tz <iana>`
   - 保持 `MSGCODE_SCHEDULER_DRY_RUN=1` 时可见
3. 更新测试
   - `test/p5-7-r17-scheduler-pointer-only.test.ts`
   - `test/p5-7-r21-scheduler-main-wrapper.test.ts`
4. 同步 runtime skill
   - `syncManagedRuntimeSkills()`
5. 真机验证
   - 再次发：`定一个每分钟发送的任务 发：live cron`
   - 验证 schedule 文件、jobs.json、runs.jsonl

## Risks

1. 透明兜底若拿不到 IANA 时区，会再次掉回缺参失败。
   - 处理：多级来源解析；若仍拿不到则不做隐式猜测，保留原始失败。
2. wrapper 补 `--tz` 可能掩盖模型漏参。
   - 处理：在 skill 文档中显式声明该兜底，只作为 fallback，不改变“`--tz` 必填”合同。
3. 真机自然语言 add 可能仍因别的参数缺口失败，例如漏 `--cron`。
   - 处理：本单聚焦 `--tz`；若再暴露新缺口，按日志证据单独记录。

## Test Plan

1. skill 合同测试：
   - `--tz` 为必填
   - skill 文档包含漏 `--tz` 错误示例
2. wrapper 回归：
   - 缺 `--tz` 时自动追加默认时区
   - 已显式给 `--tz` 时不重复追加
   - `--scheduleId` 位置参数归一化不回退
3. 真机：
   - 自然语言创建 schedule 成功

## Observability

重点看：

1. `msgcode.log` 中不再出现 `required option '--tz <iana>' not specified`
2. `Tool Bus: SUCCESS bash`
3. `<workspace>/.msgcode/schedules/live-cron.json`
4. `~/.config/msgcode/cron/jobs.json`
5. `~/.config/msgcode/cron/runs.jsonl`

评审意见：[留空,用户将给出反馈]
