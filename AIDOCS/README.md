# AIDOCS 目录说明

`AIDOCS/` 是项目的扩展资料区，不是正式 issue/plan 真相源。

## 当前分层

### `reviews/`

- 根层：仍被 issue / plan / task 明确引用的 review 输入，暂不乱搬
- `active/`：当前仍在参与决策、但还没被正式固化的 review
- `archive/`：已消费、已过时、仅保留历史对照价值的 review

### `reports/`

- 根层：仍被脚本、任务单或现役 issue 明确引用的报告
- `active/`：当前阶段仍有继续参考价值的报告
- `archive/`：一次性验收记录、旧阶段集成方案、低引用历史报告

## 整理规则

1. 先看引用，再决定是否搬动
2. 仍被 issue / plan / 脚本直接引用的 tracked 文件，先不乱搬
3. 无外部引用或一次性草稿，优先归档
4. 新增 review / report 不要默认堆在根层，优先放入 `active/`

## 与正式真相源的边界

- 正式真相源：
  - `issues/`
  - `docs/design/`
  - `docs/CHANGELOG.md`
- `AIDOCS/` 是辅助输入、历史沉淀和扩展记录，不承担正式协议职责
