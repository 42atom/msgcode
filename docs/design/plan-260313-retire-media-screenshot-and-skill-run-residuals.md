# plan-260313-retire-media-screenshot-and-skill-run-residuals

## Problem

`file/system/web` 已经退出公开主链，但仓库里还残留一批同类旧口径：

- `msgcode media screen` 仍公开存在，本质只是 `screencapture` 的 CLI 包装
- `runtime/media` 与 `optional/screenshot` 仍在给模型灌输这条旧截图主链
- `/skill run ...` 已在运行时删除，但 handlers 测试还把它当现役入口

这三处都在放大同一个问题：明明已经决定“删二手壳”，认知面却还没收干净。

## Occam Check

### 不加它，系统具体坏在哪？

- 模型仍会继续学习一套已不该存在的截图方言与历史入口
- prompt、skill、测试与运行时口径不一致，容易误判仍有隐藏兼容链

### 用更少的层能不能解决？

- 能。直接退役 `media` CLI、移除 `media/screenshot` 索引暴露，并把 `/skill run` 改为明确的历史未知入口

### 这个改动让主链数量变多了还是变少了？

- 变少了。删掉的是截图包装层和历史兼容认知面

## Decision

选定方案：把 `media`、`screenshot` 与 `/skill run` 残余一起收口，不补任何新截图层。

核心理由：

1. `media screen` 没有桥接新能力，继续存在只是在重复 `screencapture`
2. `media/screenshot` skill 索引继续暴露只会增加 token 和误导
3. `/skill run` 既然已经删了，就不该再在测试里保留“它还活着”的叙事

## Plan

1. 更新 `src/cli/media.ts`
   - 改为 retired compat shell
   - direct invoke 只返回迁移提示与原生命令示例

2. 更新 `src/cli.ts` 与 `src/cli/help.ts`
   - root help 不再公开 `media`
   - `help-docs --json` 不再导出 `msgcode media screen`

3. 更新 skill 真相源与同步链
   - 从 `src/skills/runtime/index.json` 移除 `media`
   - 从 `src/skills/optional/index.json` 移除 `screenshot`
   - 在 `src/skills/runtime-sync.ts` 中把这两个 skill 视为 retired，同步时跳过并清理已安装残留目录

4. 更新说明书与提示词
   - `src/skills/runtime/media/SKILL.md` 改为 retired 说明
   - `src/skills/optional/screenshot/SKILL.md` 改为 retired 说明
   - `prompts/agents-prompt.md`、`src/tools/manifest.ts`、`src/skills/README.md` 去掉现役暴露

5. 更新测试
   - `test/p5-7-r6-1-media-contract.test.ts`
   - `test/p5-7-r6-4-media-gen-regression-lock.test.ts`
   - `test/p5-7-r13-runtime-skill-sync.test.ts`
   - `test/p5-7-r1c-hard-gate.test.ts`
   - `test/p5-7-r2-realtime-triad.test.ts`
   - `test/handlers.runtime-kernel.test.ts`

## Risks

1. 历史脚本或用户目录里仍残留 `media` / `screenshot` 安装目录
   回滚/降级：保留 retired compat 提示；如需恢复，只回退本轮索引与同步清理改动
2. 部分回归锁仍沿用旧截图合同
   回滚/降级：将旧合同断言改为“禁止回流”而不是恢复命令

## Test Plan

- `msgcode --help` 不含 `media`
- `msgcode help-docs --json` 不含 `msgcode media screen`
- `msgcode media screen --json` 返回 retired 错误与 shell 迁移提示
- runtime sync 后用户索引不含 `media` / `screenshot`
- `/skill run system-info` handlers 测试返回未知命令提示

（章节级）评审意见：[留空,用户将给出反馈]
