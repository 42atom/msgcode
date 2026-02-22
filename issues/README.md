# issues 目录规范

## 目录结构

```text
issues/
├── README.md
├── _template.md
└── NNNN-<slug>.md
```

## 架构决策

1. `issues/` 是任务事实真相源，记录状态、计划、证据与链接。
2. `docs/tasks/` 保留派单时间线，`issues/` 负责执行态追踪，两者互链但不互替。

## 开发规范

1. 文件名必须匹配 `NNNN-<slug>.md`（4 位数字前缀）。
2. 每个 issue 必须包含 YAML front matter 与最小章节集（Context/Goal/Plan/Acceptance/Notes/Links）。
3. 状态流转：`open -> doing -> done`（`blocked/wontfix` 需注明原因）。

## 变更日志

1. 2026-02-23：初始化 `issues/` 协议目录。

