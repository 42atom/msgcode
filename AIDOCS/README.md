# AIDOCS 目录说明

`AIDOCS/` 是项目的辅助资料区，不是正式 issue/plan 真相源。

## 当前分层

### `reports/`

- `active/`：当前阶段仍有参考价值的报告
- `archive/`：一次性验收记录、旧阶段集成方案
  - `historical/`：已归档的历史评估数据（imessage-compare, p5-7-r3c-data 等）

### `reviews/`

- `active/`：当前仍在参与决策的 review
- `archive/`：已消费、已过时的 review

### 其他目录

- `notes/`：工作笔记、临时研究（**非正式真相源**）
- `design/`：历史设计文档（**非正式真相源**）
- `refs/`：参考资料（已合并原 references/）
- `prompts/`：提示词模板
- `architecture/`：架构资料
- `artifacts/`：一次性产物与验收附件
- `reports/` / `reviews/`：当前阶段仍需参考的报告与评审
- `audio/` / `media/`：音频与多媒体辅助材料
- `msgcode-2.0/2.1/2.2`：历史阶段资料包，保留作追溯参考

## 整理规则

1. 先看引用，再决定是否搬动
2. 仍被现役 issue/plan 明确引用的文件，先不乱搬
3. 无外部引用或一次性草稿，优先归档
4. 新增 review/report 不要默认堆在根层，优先放入 `active/`

## 与正式真相源的边界

- 正式真相源：
  - `issues/`
  - `docs/plan/`
  - `docs/CHANGELOG.md`
- `AIDOCS/` 是辅助输入、历史沉淀和扩展记录，不承担正式协议职责
