# adr 目录规范

## 目录结构

```text
docs/adr/
├── README.md
├── ADR-template.md
└── ADR-YYYYMMDD-<topic>.md
```

## 架构决策

1. ADR 用于记录长期有效、跨阶段的架构决策。
2. 非长期决策优先写到 `docs/design/plan-*.md`。

## 开发规范

1. ADR 必须包含：背景、决策、影响、替代方案、状态。
2. ADR 状态建议：`proposed` / `accepted` / `superseded`。

## 变更日志

1. 2026-02-23：初始化 `docs/adr/` 协议目录。

