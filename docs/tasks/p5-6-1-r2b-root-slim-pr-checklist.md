# P5.6.1-R2B：根目录瘦身 PR 清单（文档/资料收口）

## 背景

仓库根目录存在历史文档与分析产物混放，增加认知负担。  
本任务只做“文档与资料位置收口”，不改业务代码。

## 目标

1. 清理临时分析产物，避免根目录继续堆积。
2. 将历史/研究文档迁移到 `docs/archive/`（或等价目录）。
3. 保持入口文档最小集合：`README`、`SECURITY`、`RELEASING`、`CHANGELOG`。

## 范围

- 根目录文档/资料文件
- `.gitignore`
- `docs/` 下归档目录与索引说明

## 非范围

- 不改 `src/` 代码
- 不改运行时配置与命令行为
- 不改测试逻辑

## PR 清单（执行顺序）

### R2B.1 立即清理（临时产物）

- 删除未纳管分析文件：
  - `duplication_report_detailed_raw.md`
  - `duplication_report_strict.md`
  - `duplication_report_strict_clean.txt`
- 确认 `.gitignore` 包含 `report/`（已补则跳过）。

### R2B.2 归档历史文档

- 迁移到 `docs/archive/`（保持 git 历史）：
  - `IMESSAGEKIT_BEST_PRACTICES_REPORT.md`
  - `deep-dive-into-imessage.md`
  - `PRD.md`
  - `review-report.md`

### R2B.3 发布文档收口

- 评估并执行其一：
  - 方案 A（推荐）：将 `RELEASE_NOTES_v1.0.0.md`、`RELEASE_NOTES_v1.0.1.md` 迁移到 `docs/release/`
  - 方案 B：保留根目录，但在 `README` 明确“历史 release notes 位置”

### R2B.4 索引同步

- 更新 `README` 或 `docs/tasks/README.md` 的文档索引，确保归档可发现。
- 扫描并修复迁移后断链。

## 硬验收

| 验收项 | 命令/检查 | 结果 |
|---|---|---|
| TypeScript 编译 | `npx tsc --noEmit` | ✅ |
| 单元/集成测试 | `npm test`（0 fail） | ✅ |
| 文档同步检查 | `npm run docs:check` | ✅ |
| 根目录收口 | 根目录无 duplication_report* 文件 | ✅ |
| 链接有效性 | `rg` 检查迁移文档路径无断链 | ✅ |

## 回滚

```bash
git checkout -- .gitignore README.md docs
git checkout -- IMESSAGEKIT_BEST_PRACTICES_REPORT.md deep-dive-into-imessage.md PRD.md review-report.md
git checkout -- RELEASE_NOTES_v1.0.0.md RELEASE_NOTES_v1.0.1.md
```
