# archive 归档索引

## 目录结构

```text
docs/archive/
├── README.md
├── IMESSAGEKIT_BEST_PRACTICES_REPORT.md
├── deep-dive-into-imessage.md
├── review-report.md
├── task-plan-backend-control-plane.md
├── PRD.md
├── retired-imsg-runtime/
│   └── README.md
├── retired-imsg-cli/
│   └── README.md
├── retired-desktop-bridge/
│   └── README.md
└── protocol-migration/
    └── README.md
```

## 用途

1. 存放历史文档、迁移映射与已失效但需追溯的资料。
2. 不承载当前执行规范，当前规范以 `docs/` 根目录和 `docs/tasks/README.md` 为准。

## 根目录清理映射（2026-02）

1. 历史调研文档（根目录）已统一归档到 `docs/archive/`：
   - `IMESSAGEKIT_BEST_PRACTICES_REPORT.md`
   - `deep-dive-into-imessage.md`
   - `review-report.md`
   - `PRD.md`
2. 历史发布说明（根目录）已统一收敛到 `docs/release/`：
   - `docs/release/RELEASE_NOTES_v1.0.0.md`
   - `docs/release/RELEASE_NOTES_v1.0.1.md`
3. 规则：根目录仅保留当前入口文档与运行必需文件，历史资料统一放归档/发布目录。
4. 2026-03-11 起，已退役的 IndexTTS 专项备忘统一归档到：
   - `docs/archive/indextts_optimization_memo_v2.2.md`
5. 2026-03-11 起，剩余的 IndexTTS CLI/worker 脚本不再保留在正式 `scripts/` 入口，统一迁入：
   - `docs/archive/indextts-runtime/`
6. 2026-03-12 起，已退役的 iMessage-only `file send` 任务单统一迁入：
   - `docs/archive/retired-imsg-cli/`
7. 2026-03-12 起，已退役的 legacy `imsg` 运行时最小快照统一版本化归档到：
   - `docs/archive/retired-imsg-runtime/`
8. 2026-03-13 起，已退役的自研 Desktop Bridge 整包迁入：
   - `docs/archive/retired-desktop-bridge/`
9. 2026-03-13 起，根目录遗留的 Desktop Bridge 安全文档与历史任务计划继续迁入：
   - `docs/archive/retired-desktop-bridge/SECURITY.md`
   - `docs/archive/task-plan-backend-control-plane.md`
10. 2026-03-13 起，retired `imsg` 的构建/校验脚本继续迁入：
   - `docs/archive/retired-imsg-runtime/scripts/`

## 变更日志

1. 2026-02-23：新增归档索引，并登记协议迁移映射入口。
2. 2026-02-23：新增根目录历史文档清理映射，完成重复文档收敛。
3. 2026-03-11：收入口径收窄后，将 IndexTTS 专项优化备忘移入归档。
4. 2026-03-11：剩余 IndexTTS CLI/worker 脚本从 `scripts/` 迁入 `docs/archive/indextts-runtime/`。
5. 2026-03-12：iMessage-only `file send` 历史任务单从 `docs/tasks/` 迁入 `docs/archive/retired-imsg-cli/`。
6. 2026-03-12：补录 `retired-imsg-runtime/`，将 `.trash` 中转快照升级为版本化 archive 真相源。
7. 2026-03-13：legacy Desktop Bridge 的源码、协议、脚本、recipe 与发布指南整体迁入 `retired-desktop-bridge/`。
8. 2026-03-13：根目录 `SECURITY.md` 与 `task_plan.md` 继续退出，分别迁入 `retired-desktop-bridge/` 与 `docs/archive/`。
9. 2026-03-13：`scripts/build-imsg.sh` 与 `scripts/verify-imsg.sh` 迁入 `retired-imsg-runtime/scripts/`，空的根 `recipes/` 目录同步退出。
