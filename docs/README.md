# docs 文档导航

## 目录结构

```text
docs/
├── CHANGELOG.md # 外部可见变更日志（主路径）
├── design/      # Plan 文档（决策 + 实施计划）
├── notes/       # research/实验记录
├── adr/         # 架构决策记录（可选）
├── tasks/     # 任务单、派单包、执行顺序与签收口径（唯一时间线）
├── product/   # 产品与能力口径文档
├── testing/   # 测试策略与测试计划
├── release/   # 发布流程与发布记录
└── archive/   # 历史归档与失效文档
```

## 架构决策

1. `docs/tasks/README.md` 作为任务单唯一索引，不并行维护第二时间线。
2. `issues/ + docs/design/` 作为执行面真相源，`docs/tasks/` 作为派单与时间线索引。
3. 执行文档与验收证据分离：任务定义在仓库，运行证据落 `AIDOCS/reports`。
4. 文档优先描述“行为契约”，避免绑定实现细节（减少重构噪声）。

## 开发规范

1. 新任务单创建后，必须同步 `docs/tasks/README.md`。
2. 重要工作必须同步创建 issue 与 plan 文档。
3. 任务状态变化（待执行/已完成）必须回写对应任务单与主线派单包。
4. 外部可见变更统一写入 `docs/CHANGELOG.md`。
5. 文档命名统一：`p5-7-rX-...`，保持可按阶段检索。
6. 文档变更完成后必须执行 `npm run docs:check`。

Legacy Desktop Bridge 现已整体迁入：
- `docs/archive/retired-desktop-bridge/`

## 变更日志

1. 2026-02-23：新增本文件，统一 `docs` 目录导航与维护约束。
2. 2026-02-23：补充 `design/notes/adr/CHANGELOG` 协议目录说明。
