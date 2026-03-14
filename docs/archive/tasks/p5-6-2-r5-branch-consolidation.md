# P5.6.2-R5：分支收口与主线归并计划

## 背景

当前分支存在并行开发与历史救援分支，已出现“修复在侧分支、主线缺失”的风险。  
本单只处理分支治理，不改业务代码。

## 目标

1. 把 `codex/p5-6-2` 稳定合并到 `main`。
2. 清理无增量陈旧分支，降低误用概率。
3. 保留必要“摘取源分支”，禁止整包回灌。

## 范围

- Git 分支治理（本地 + 远端）
- PR 合并与删除策略

## 非范围

- 不修改 `src/*` 业务逻辑
- 不处理 P0 SOUL 修复代码本体（另见 `p5-6-2-p0-soul-minimal-extract.md`）

## 执行步骤

### R1 合并主线

1. 提交/推送 `codex/p5-6-2`（含 checkpoint tag `p5.6.2-checkpoint`）。
2. 创建 PR：`codex/p5-6-2 -> main`。
3. PR 门禁必须全绿：`tsc` / `test` / `docs:check`。
4. 合并后，本地 `main` fast-forward 到最新。

### R2 清理无增量分支

目标分支（相对 `main` 无独有提交）：

- `codex/p5-3-r2-rebuild`
- `codex/p5-4-r2`
- `codex/p5-5-merge`
- `msgcode-2.0`

操作：本地删除 + 远端删除（若存在）。

### R3 保留与约束

保留分支：

- `codex/p5-3-r2b-rebuild`（仅作最小摘取源）
- `p5-3-r2a-rescue`（可先打 tag 后删除分支）

约束：

- 禁止整包 cherry-pick `codex/p5-3-r2b-rebuild`
- 只允许按任务单做“最小摘取”

## 验收

| 验收项 | 检查方式 | 结果 |
|---|---|---|
| 主线归并 | `codex/p5-6-2` 已合并到 `main` | ✅ |
| 分支清理 | 无增量陈旧分支已删除 | ✅ |
| 保留策略 | `codex/p5-3-r2b-rebuild` 仍保留且标注“仅摘取” | ✅ |
| 主线一致性 | 新任务从 `main` 创建 `codex/p5-6-3` | ✅ |

## 回滚

若误删分支，可用 reflog/远端恢复：

```bash
git reflog
git checkout -b <branch> <commit>
git push -u origin <branch>
```
