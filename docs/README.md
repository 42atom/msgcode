# docs 文档导航

## 目录结构

```text
docs/
├── CHANGELOG.md # 外部可见变更日志（主路径）
├── plan/         # Plan/Research/Refactor 文档（新协议）
│   ├── plXXXX.*  # 实施计划
│   ├── rsXXXX.*  # 研究记录
│   ├── rfXXXX.*  # 重构记录
│   └── rpXXXX.*  # 报告
├── adr/          # 架构决策记录（可选）
├── tasks/        # 历史任务归档目录
├── product/      # 产品与能力口径文档
├── testing/      # 测试策略、真实通道 smoke 入口
├── release/      # 发布流程与发布记录
└── archive/      # 历史归档与失效文档
```

## 文档命名协议

### issues/ (真相源)

- 格式：`tkNNNN.<state>.<board>[.prio].<slug>.md`
- 状态：tdo, doi, rvw, bkd, pss, dne, cand, arvd
- 优先级（仅活跃 task）：p0, p1, p2
- 示例：`tk0003.pss.feishu.p1.feishu-ws-transport-default-workspace.md`

### docs/plan/ (计划/研究/报告)

- 格式：`<kind>NNNN.<state>.<board>.<slug>.md`
- kind: pl(plan), rs(research), rf(refactor), rp(report)
- 示例：`pl0003.pss.feishu.feishu-ws-transport-default-workspace.md`

## 架构决策

1. `issues/ + docs/plan/` 是执行面真相源。
2. `docs/tasks/` 已归档，不再承接新任务。
3. 执行文档与验收证据分离：任务定义在仓库，运行证据落 `AIDOCS/reports`。
4. 文档优先描述行为契约，避免绑定实现细节。
5. `docs/` 是正式真相源；`AIDOCS/` 是辅助材料区，默认不等于正式协议。

## 开发规范

1. 重要工作必须同步创建 issue 与 plan 文档。
2. 任务状态变化必须回写对应任务单。
3. 外部可见变更统一写入 `docs/CHANGELOG.md`。
4. 文档命名遵循新协议格式。
5. 文档变更完成后必须执行 `npm run docs:check`。

## 真实通道 Smoke

默认飞书真机 smoke 基座见：

- `docs/testing/feishu-live-smoke.md`

这份文档承接：

- `test-real` 默认基座
- 默认 workspace / 凭据来源
- live verification 执行步骤
- 真实通道 smoke 的额外约束

## 现役边界

- 当前产品定位：面向小微机构本地部署使用的私有 Agent 系统
- 当前现役交付形态：Mac mini 上的 Feishu-first 运行时
- 当前桌面能力面默认是 `ghost_*`
- msgcode 不再自研点击/识别逻辑，正式文档应坚持“薄桥接，不做自动化供应”

协议入口：

- `docs/protocol/COGNITION.md`
- `docs/protocol/MEMORY.md`
- `docs/protocol/WORKSTATE.md`

Legacy Desktop Bridge 现已整体迁入：

- `docs/archive/retired-desktop-bridge/`

## 变更日志

1. 2026-02-23：新增本文件，统一 `docs` 目录导航与维护约束。
2. 2026-02-23：补充 `design/notes/adr/CHANGELOG` 协议目录说明。
3. 2026-03-14：设计文档合并到 `docs/plan/`，采用新命名协议。
4. 2026-03-19：真实通道 smoke 基座拆到 `docs/testing/feishu-live-smoke.md`，避免入口文档重复背同一套维护细节。
