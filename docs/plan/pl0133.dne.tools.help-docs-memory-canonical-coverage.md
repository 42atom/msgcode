# plan-260312-help-docs-memory-canonical-coverage

## Problem

`help-docs --json` 已被定义为 agent-facing 操作命令真相源，但 `memory` 目前仍有一处口径分叉：

- `msgcode memory --help` 公开 `index/get/add/search/stats`
- `help-docs --json` 只导出 `add/search/stats`

这会直接削弱“程序是真合同”的主线，让 LLM 通过 `help_docs` 自发现命令时看到的是残缺面。

## Occam Check

### 1. 不加它，系统具体坏在哪？

- LLM 通过 `help_docs` 探索 `memory` 时无法发现 `index/get`
- 程序公开面与机器可读合同重新分叉

### 2. 用更少的层能不能解决？

- 能。只需补齐 `memory index/get` 合同导出，并接入现有 `help-docs`
- 不需要新增层，也不需要重写 CLI

### 3. 这个改动让主链数量变多了还是变少了？

- 变少了。它消灭的是 `memory --help` 与 `help-docs` 双口径

## Decision

推荐方案：**让 `help-docs` 覆盖 `memory` 的全部 canonical 子命令。**

核心理由：

1. `memory index/get` 已经是公开 canonical 子命令
2. 它们不属于 alias、retired、internal
3. 因此应该进入 `help-docs --json` 的正式合同

## Plan

1. 在 `src/cli/memory.ts` 中新增：
   - `getMemoryIndexContract()`
   - `getMemoryGetContract()`
2. 在 `src/cli/help.ts` 中把两者接入 `getAllHelpCommandContracts()`
3. 补测试：
   - `memory` 合同导出测试
   - `help-docs` 集成测试
4. 更新 issue 与 changelog

## Risks

- 风险低
- 回滚：移除新增合同导出和测试即可

## 评审意见

[留空,用户将给出反馈]
