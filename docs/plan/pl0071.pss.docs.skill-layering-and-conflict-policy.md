# plan-260311-skill-layering-and-conflict-policy

## Problem

`msgcode` 当前 skill 系统已经有 `runtime` 和 `optional` 两层，但来源边界仍然不清：

- repo 同步产物与用户目录混在一起
- 还没有正式的 legacy-active 收口与 workspace 层
- workspace skill 还没进主链
- 缺少明确的 conflict policy 与 per-skill enable/gating 规则

如果不在现在定死，后面 skill 越多，系统会越来越像“所有东西都往一个目录里塞”的隐性平台。

## Occam Check

1. 不加它，系统具体坏在哪？
当前已经无法明确回答“这个 skill 从哪来、同名谁赢、哪些是默认携带、哪些只是用户装的”，继续增长会直接失控。

2. 用更少的层能不能解决？
可以。最小方案不是 marketplace，而只是补四层来源与一个生效索引。

3. 这个改动让主链数量变多了还是变少了？
变少了。现在是“同步目录 + 提示词约定 + 人工记忆”的隐性多主链；补完后会收口成一套 explicit precedence。

## Decision

采用“保留现有 runtime/optional，承认 legacy-active，后续再视需要补 workspace 层”的最小方案。

核心理由：

1. 兼容当前已有结构，不大爆炸重命名。
2. 只补分层与冲突规则，不引入 registry/platform/marketplace。
3. 明确 skill 与 plugin/arm 边界，继续保持薄 core。

## Plan

1. 冻结 skill 分层模型
   - `runtime` = bundled core
   - `optional` = bundled system optional
   - `legacy-active` = 当前仍在使用、但尚未纳入 repo 真相源的本地 skill
   - `workspace` = future local override（暂不实现）
   - 验收：文档里有清晰层级定义

2. 冻结 conflict policy
   - `workspace > optional`
   - `core` 保留区默认不可覆盖
   - alias/command 冲突 fail-closed
   - 验收：文档里有 precedence 与冲突语义

3. 冻结最小运行时结构
   - 当前继续使用单一主索引
   - legacy-active 先显式承认存在，不再假装它们已被 repo 托管
   - 验收：文档里有清晰来源说明，不制造第二套安装层

4. 冻结后续实施顺序
   - 先理顺 runtime/optional/legacy-active 的口径
   - 再评估 workspace 层是否真有必要
   - 最后做 per-skill gating
   - 验收：有清晰 phase 顺序，不直接开做平台

## Risks

1. 风险：把 skill 系统做成第二个插件平台；回滚/降级：只保留 provenance + effective index，不做安装市场与远程 registry。
2. 风险：core skill 覆盖规则不清导致主链漂移；回滚/降级：保留区默认不可覆盖，必要时显式开 dev override。
3. 风险：workspace 层过早复杂化；回滚/降级：先只支持目录发现，不做 workspace skill 管理 UI。

## Alternatives

### 方案 A：继续维持现状

优点：
- 零实现成本

缺点：
- 以后 skill 越多越乱
- 来源与 precedence 继续靠口头约定

不推荐。

### 方案 B：直接照搬 OpenClaw

优点：
- 模型成熟

缺点：
- 对 `msgcode` 来说太重
- 会把我们拖向 registry/platform 化

不推荐。

### 方案 C：最小四层 + effective index

优点：
- 足够清晰
- 仍然很薄
- 可逐步演进

推荐。

## Migration / Rollout

建议分三步：

1. 文档冻结层级与冲突语义
2. 引入 `managed` 与 `workspace` 发现
3. 生成 `effective-index.json` 并让提示词只认它

## Test Plan

若进入实现，至少补这些测试：

1. 同名 skill precedence：
   - workspace 胜过 managed
   - managed 胜过 optional
   - core 不允许被覆盖

2. disabled/gating：
   - 缺 env/bin/config 时不进入生效索引

3. prompt discovery：
   - 只读 effective index，不再分散猜来源

## Observability

若进入实现，建议最小日志包含：

- skillResolve.id
- skillResolve.layer
- skillResolve.source
- skillResolve.enabled
- skillResolve.reason

（章节级）评审意见：[留空,用户将给出反馈]
