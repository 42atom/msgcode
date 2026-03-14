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
├── tasks/        # 任务单、派单包，执行顺序与签收口径（唯一时间线）
├── product/      # 产品与能力口径文档
├── testing/      # 测试策略与测试计划
├── release/      # 发布流程与发布记录
└── archive/      # 历史归档与失效文档
```

## 文档命名协议

### issues/ (真相源)
- 格式：`tkNNNN.<state>.<board>[.prio].<slug>.md`
- 状态：tdo, doi, rvw, bkd, pss, dne, cand, arvd
- 优先级（仅活跃 task）：p0, p1, p2
- 示例：`tk0003.doi.feishu.p1.feishu-ws-transport-default-workspace.md`

### docs/plan/ (计划/研究/报告)
- 格式：`<kind>NNNN.<state>.<board>[.prio].<slug>.md`
- kind: pl(plan), rs(research), rf(refactor), rp(report)
- 示例：`pl0003.doi.feishu.feishu-ws-transport-default-workspace.md`

## 架构决策

1. `docs/tasks/README.md` 作为任务单唯一索引，不并行维护第二时间线。
2. `issues/ + docs/plan/` 作为执行面真相源，`docs/tasks/` 作为派单与时间线索引。
3. 执行文档与验收证据分离：任务定义在仓库，运行证据落 `AIDOCS/reports`。
4. 文档优先描述"行为契约"，避免绑定实现细节（减少重构噪声）。
5. `docs/` 是正式真相源；`AIDOCS/` 是辅助材料区，默认不等于正式协议。

## 开发规范

1. 新任务单创建后，必须同步 `docs/tasks/README.md`。
2. 重要工作必须同步创建 issue 与 plan 文档。
3. 任务状态变化（待执行/已完成）必须回写对应任务单与主线派单包。
4. 外部可见变更统一写入 `docs/CHANGELOG.md`。
5. 文档命名遵循新协议格式。
6. 文档变更完成后必须执行 `npm run docs:check`。

## 开发必读：飞书真机 Smoke

1. 默认真实测试基座固定为已有 `test-real` 飞书群，不重复新建群。
2. 默认真实凭据位置是 `~/.config/msgcode/.env`，不是仓库 `.env.example`。
3. 默认测试 workspace 是 `/Users/admin/msgcode-workspaces/test-real`。
4. 默认执行口径：`msgcode preflight` → `msgcode start` → 去 `test-real` 群发真实消息。
5. 默认真相源：`docs/plan/pl0098.dne.feishu.feishu-live-verification-loop.md`。
6. 现成实测证据：`AIDOCS/reports/skill-live-run-260312-batch1.md`、`AIDOCS/reports/skill-live-run-260312-batch2.md`。

补充：
- capability live test 前，先核对 `test-real/.msgcode/config.json` 的 `tooling.allow`
- 不把 API-only 发送当成完整 live loop

Legacy Desktop Bridge 现已整体迁入：
- `docs/archive/retired-desktop-bridge/`

补充口径：
- 当前桌面能力面默认是 `ghost_*`
- 最终产品方向统一表述为：`menu App + 单面板 + web系统面板`
- msgcode 不再自研点击/识别逻辑，正式文档应坚持"薄桥接，不做自动化供应"

## 变更日志

1. 2026-02-23：新增本文件，统一 `docs` 目录导航与维护约束。
2. 2026-02-23：补充 `design/notes/adr/CHANGELOG` 协议目录说明。
3. 2026-03-14：设计文档合并到 `docs/plan/`，采用新命名协议。
