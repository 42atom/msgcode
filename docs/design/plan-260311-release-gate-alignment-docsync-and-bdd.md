# release-gate-alignment-docsync-and-bdd

## Problem

合并完成后，代码主链已经可编译、主回归也基本通过，但仓库自己的发布门槛 `npm run test:all` 仍被两类问题卡住：一类是已经退役的 `/persona` BDD 场景仍在跑，另一类是 `docs:check` 的脚本约束比当前 AGENTS 协议更严，导致大量历史 issue 被误判为阻断。

Issue: 0089

## Occam Check

1. 不加这次收口，系统具体坏在哪？
   - `test:all` 无法通过，仓库没有一个可信的发布门槛；后续每次合并都会被 persona 残留和 docs checker 假阳性卡住。
2. 用更少的层能不能解决？
   - 能。直接删掉退役 persona 场景，直接收紧 docs checker 到当前协议，不加任何新层。
3. 这个改动让主链数量变多了还是变少了？
   - 变少了。BDD 只覆盖活功能，docs checker 只验证当前真实协议。

## Decision

采用最小可删方案：

1. 将两个已退役的 persona feature 从 `features/` 主链移出并归档到 `.trash`
2. 保留 `policy_runner_gate.feature`，因为它仍覆盖活的 tmux/local-only 边界
3. 调整 `src/routes/cmd-model.ts` 的拒绝提示，同时包含 `/policy on` 与 `/policy egress-allowed`
4. 修改 `scripts/check-doc-sync.ts`
   - `plan_doc` 与 `links` 改为可选
   - issue 章节匹配接受 `#` 或 `##`
   - 移除 `docs/tasks` 回链和 plan issue backlink 的硬性校验
   - 保留命名、front matter、显式存在的 `plan_doc` 路径校验

## Alternatives

### 方案 A：恢复 persona 功能以满足 BDD

- 缺点：明显违背当前 persona 已退役的主线，会把已删除能力重新带回。

### 方案 B：批量补写所有历史 issue/task 文档，适配当前 docs checker

- 缺点：工作量大，而且是让历史材料迁就脚本，而不是让脚本对齐真实协议。

### 方案 C：清理陈旧场景 + 收口 checker 到当前协议（推荐）

- 优点：最符合现状，改动面最小，发布门槛重新可信。

## Plan

1. 归档 persona BDD 场景
   - `features/orchestration_persona.feature`
   - `features/persona_boundary.feature`
2. 修正 tmux policy hint
   - `src/routes/cmd-model.ts`
3. 收口 docs checker
   - `scripts/check-doc-sync.ts`
4. 验证
   - `npm run docs:check`
   - `npm run bdd`
   - `npm run test:all`
5. 文档
   - `issues/0089-release-gate-alignment-docsync-and-bdd.md`
   - `docs/CHANGELOG.md`

## Risks

1. 如果 `features/` 里仍有其他隐性 persona 场景，BDD 可能继续失败。
   - 回滚/降级：继续按“退役能力不进主链”原则清退，不恢复 persona。
2. 如果 docs checker 收得太松，可能放过本应校验的当前 issue。
   - 回滚/降级：只放开 AGENTS 明确未要求的项，保留文件命名、front matter、章节、显式 `plan_doc` 路径等核心校验。
3. `test:all` 还可能暴露新的历史断点。
   - 回滚/降级：逐个按“活功能 vs 陈旧残影”做裁决，不用补丁层掩盖。

## Test Plan

1. `npm run docs:check`
2. `npm run bdd`
3. `npm run test:all`

## Observability

- `docs/CHANGELOG.md` 记录：
  - 发布门槛对齐当前命令协议与文档协议
  - persona 退役场景从 BDD 主链移出

（章节级）评审意见：[留空,用户将给出反馈]
