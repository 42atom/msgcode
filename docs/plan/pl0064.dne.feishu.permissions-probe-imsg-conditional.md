# permissions probe 仅在启用 imsg 时检查 chat.db

## Problem

`Feishu-first` 之后，`msgcode status` 的权限探针仍无条件要求读取 `~/Library/Messages/chat.db`。这会让一个完全不启用 iMessage 的部署，仅因为没给 Full Disk Access 就被误判为 `error`。

## Occam Check

- 不加它，系统具体坏在哪？
  Feishu-only 部署的 `status` 会持续被 iMessage 权限误伤，用户无法分辨“飞书主链可用”和“本地 iMessage 权限没给”。
- 用更少的层能不能解决？
  能。直接在 `permissions.ts` 里按 `config.transports.includes("imsg")` 条件化检查，不加新 probe 层。
- 这个改动让主链数量变多了还是变少了？
  变少了。权限判定重新和当前 transport 主链对齐，不再平行维护一套 iMessage-only 假前提。

## Decision

采用最小方案：

1. `imsg` 启用时，继续检查 `~/Library/Messages` 与 `chat.db`
2. `imsg` 未启用时，跳过这两项检查，并在 details 中显式标记为 `null`
3. 其余 `config_writable` / `workspace_root_accessible` 权限检查保持不变

## Plan

1. 修改 [src/probe/probes/permissions.ts](/Users/admin/GitProjects/msgcode/src/probe/probes/permissions.ts)
2. 新增 [test/p5-7-r30-permissions-probe-transport-aware.test.ts](/Users/admin/GitProjects/msgcode/test/p5-7-r30-permissions-probe-transport-aware.test.ts)
3. 更新 [docs/CHANGELOG.md](/Users/admin/GitProjects/msgcode/docs/CHANGELOG.md)

## Risks

- 风险 1：Feishu-only 场景被放松后，用户误以为本机已经具备 iMessage 权限
  - 缓解：details 明确写 `messages_readable=null`、`full_disk_access=null`
- 风险 2：`imsg` 场景被误放松
  - 缓解：补 imsg 严格行为回归锁

## Rollback

- 回退 `src/probe/probes/permissions.ts`、新测试与 changelog 即可恢复旧行为

评审意见：[留空,用户将给出反馈]
