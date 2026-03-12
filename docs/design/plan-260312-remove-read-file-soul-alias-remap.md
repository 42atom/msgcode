# 移除 read_file 的 SOUL 别名静默改参

## Problem

`read_file` 在 `tools bus` 里还保留一个历史补丁：当模型传入 `soul` / `soul.md` 这类相对路径且主路径不存在时，系统会偷偷改成 `<workspace>/.msgcode/SOUL.md`。这会掩盖真实路径错误，也让系统替模型做了路径决策。

## Occam Check

- 不加这次改动，系统具体坏在哪？
  - 模型和用户看不到真实路径错误，系统继续在输入层静默改参，主链纯度被破坏。
- 用更少的层能不能解决？
  - 能。直接删掉 remap，保留原生 `read_file` 失败与 guidance 即可。
- 这个改动让主链数量变多了还是变少了？
  - 变少了。去掉一条专门补 SOUL 路径的旁路。

## Decision

选定方案：直接删除 `read_file` 的 SOUL alias remap，不做替代恢复层。

关键理由：

1. SOUL 正式路径已经固定为 `<workspace>/.msgcode/SOUL.md`
2. 如果模型传错了路径，就应该拿到原生失败，再自己修正
3. 继续保留这条 remap 只会让系统替模型决定路径

## Plan

1. 删除 `/Users/admin/GitProjects/msgcode/src/tools/bus.ts`
   - `isSoulAliasPath`
   - `pathExists`
   - read_file case 中的 soul remap 逻辑
2. 更新测试
   - `/Users/admin/GitProjects/msgcode/test/tools.bus.test.ts`
   - `/Users/admin/GitProjects/msgcode/test/p5-7-r3l-7-tool-protocol-retry-and-soul-normalize.test.ts`
3. 更新：
   - `/Users/admin/GitProjects/msgcode/docs/CHANGELOG.md`

## Risks

- 风险：个别旧提示仍会让模型尝试 `soul` 这类错误路径
  - 应对：让它真实失败并回灌；现有 prompt 已明确 SOUL 固定路径

回滚/降级策略：

- 本轮只删一条补丁路径；如发现误伤，可直接回滚该 commit

评审意见：[留空,用户将给出反馈]
