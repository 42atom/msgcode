# 可选 runtime skills 按需加载收口

## Problem

repo 里的扩展 skill 目前没有稳定位置：放进 `runtime` 主索引会污染常驻上下文，完全不接运行时又会让它们变成“存在于 repo、但模型不知道”的死文档。

## Occam Check

- 不加它，系统具体坏在哪？
  扩展 skill 只能二选一：要么误进常驻主索引，让默认上下文变厚；要么继续散落在外部目录，不属于 msgcode 内置能力。
- 用更少的层能不能解决？
  能。只加一个 `optional skills` 目录和一个 optional 索引，不做第二套执行平台。
- 这个改动让主链数量变多了还是变少了？
  变少了。把“repo 内置但按需加载”的 skill 收口到单一位置，避免继续混在外部 skill 或 runtime 主索引里。

## Decision

采用最薄方案：

1. repo 内新增 `src/skills/optional/`
2. 每个 optional skill 仍然是标准 `SKILL.md`
3. 运行时同步到 `~/.config/msgcode/skills/optional/`
4. 主索引保持只含基础常驻 skill
5. 模型规则改成：
   - 先读 `~/.config/msgcode/skills/index.json`
   - 主索引无匹配时，再按需读 `~/.config/msgcode/skills/optional/index.json`
   - 不默认把 optional skill 全读入上下文

## Plan

1. 新增：
   - [src/skills/optional/index.json](/Users/admin/GitProjects/msgcode/src/skills/optional/index.json)
   - 5 个 optional skill 目录
2. 修改 [src/skills/runtime-sync.ts](/Users/admin/GitProjects/msgcode/src/skills/runtime-sync.ts)
3. 修改 [src/skills/README.md](/Users/admin/GitProjects/msgcode/src/skills/README.md)
4. 修改 [prompts/agents-prompt.md](/Users/admin/GitProjects/msgcode/prompts/agents-prompt.md)
5. 更新测试：
   - [test/p5-7-r13-runtime-skill-sync.test.ts](/Users/admin/GitProjects/msgcode/test/p5-7-r13-runtime-skill-sync.test.ts)
   - [test/p5-7-r3n-system-prompt-file-ref.test.ts](/Users/admin/GitProjects/msgcode/test/p5-7-r3n-system-prompt-file-ref.test.ts)
6. 更新 [docs/CHANGELOG.md](/Users/admin/GitProjects/msgcode/docs/CHANGELOG.md)

## Risks

- 风险 1：optional 索引同步到了运行时，但模型仍不会按需查看
  - 缓解：在系统提示词中把 `optional/index.json` 作为 fallback discovery 路径明确写死
- 风险 2：把 optional skill 混进主索引
  - 缓解：测试显式锁住“已同步但不并入主索引”
- 风险 3：`reactions` 当前没有正式 runtime 动作通道
  - 缓解：skill 里明确这是环境依赖能力，只在本地 reaction bridge 存在时使用，不把它伪装成 core 能力

## Rollback

- 删除 `src/skills/optional/`
- 回退 `src/skills/runtime-sync.ts`、`src/skills/README.md`、`prompts/agents-prompt.md`、测试与 changelog

评审意见：[留空,用户将给出反馈]
