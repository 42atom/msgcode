# design 目录规范

## 目录结构

```text
docs/design/
├── README.md
├── plan-template.md
└── plan-YYMMDD-<topic>.md
```

## 架构决策

1. Plan 文档承载“决策 + 实施计划 + 风险回滚”。
2. 重要工作（跨边界或 >=1h）必须有 plan 文件。

## 开发规范

1. 文件名固定：`plan-YYMMDD-<topic>.md`。
2. 必须包含：`Problem`、`Decision`、`Plan`、`Risks`。
3. 每份 Plan 需在章节末尾附：`评审意见：[留空,用户将给出反馈]`。

## 变更日志

1. 2026-02-23：初始化 `docs/design/` 协议目录。

