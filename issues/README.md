# issues 目录规范

## 目录结构

```text
issues/
├── README.md
├── _template.md
└── tkNNNN.<state>.<board>[.prio].<slug>.md
```

## 文档命名协议

- 格式：`tkNNNN.<state>.<board>[.prio].<slug>.md`
- 状态（state）：tdo, doi, rvw, bkd, pss, dne, cand, arvd
- 模块（board）：runtime, agent, feishu, browser, ghost, tools, schedule, docs, product, model, release 等
- 优先级（prio，仅活跃 task）：p0, p1, p2

### 示例

```text
tk0003.doi.feishu.p1.feishu-ws-transport-default-workspace.md
tk0184.dne.docs.p0.doc-filename-protocol-migration.md
```

## 架构决策

1. `issues/` 是任务事实真相源，记录状态、计划、证据与链接。
2. `docs/tasks/` 保留派单时间线，`issues/` 负责执行态追踪，两者互链但不互替。

## 开发规范

1. 文件名必须匹配 `tkNNNN.<state>.<board>[.prio].<slug>.md`。
2. 每个 issue 必须包含 YAML front matter 与最小章节集（Context/Goal/Plan/Acceptance/Notes/Links）。
3. 状态流转通过文件名 state 槽位表达：tdo -> doi -> rvw -> pss -> dne（或 bkd -> 回退，或 cand）。

## 变更日志

1. 2026-02-23：初始化 `issues/` 协议目录。
2. 2026-03-14：迁移到新命名协议 `tkNNNN.state.board[.prio].slug.md`。
