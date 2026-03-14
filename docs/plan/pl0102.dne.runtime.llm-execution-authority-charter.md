# AI 主执行权仓库级宪章

## Problem

仓库里已经有“服务 LLM、skill 是说明书、系统要做薄”这些原则，但仍缺少一条可执行的硬约束：默认由 AI 决策和执行，系统只做能力暴露、状态记录和硬边界阻断。缺少这条宪章时，代码与文档很容易回滑到前置裁判、猜测式纠偏、系统代答和过度 wrapper。

## Occam Check

- 不加它，系统具体坏在哪？
  - 后续实现会继续重复“工具一失败系统就结案”“路径被系统擅自改写”“wrapper 套 wrapper 抢掉二进制价值”这类已复现的结构性错误。
- 用更少的层能不能解决？
  - 能。只把仓库级原则写清楚，不新建任何运行时控制层或治理子系统。
- 这个改动让主链数量变多了还是变少了？
  - 变少了。它明确拒绝隐藏旁路、二次裁判和系统代答，把主链收口为“用户/通道 -> 模型 -> 工具 -> 结果 -> 模型 -> 用户”。

## Decision

选定方案：通过 `issue + plan + CLAUDE.md + README.md` 四处同步，冻结“AI 主执行权”作为仓库级硬约束；本地 `AGENTS.md` 只作为同口径镜像。

关键理由：

1. 不改运行时也能立刻改变后续代码评审和实现方向
2. 直接复用现有仓库真相源，不引入新的宣言层或控制面
3. 让内部协作口径与外部产品叙事一致，避免继续一边说“放权”一边在实现里抢权

## Alternatives

### 方案 A：只在聊天里记住这条理念

- 优点：最快
- 缺点：不可审查、不可版本化、后续很快失效

### 方案 B：新增独立 manifesto 系统或治理子目录

- 优点：看起来正式
- 缺点：会再长一层文档控制面，和“做薄”冲突

### 方案 C：直接写进现有仓库守则与公开 README

- 优点：最少层、最可审查、最贴近日常开发
- 缺点：需要收紧现有措辞，不能只写空话

推荐：方案 C

## Plan

1. 更新 [issues/0102-llm-execution-authority-charter.md](/Users/admin/GitProjects/msgcode/issues/0102-llm-execution-authority-charter.md)
   - 明确目标、非目标、验收口径

2. 更新 [CLAUDE.md](/Users/admin/GitProjects/msgcode/CLAUDE.md)
   - 新增“AI 主执行权”硬约束
   - 明确只允许三类硬边界：安全、预算、物理
   - 明确默认工具结果忠实回给模型，默认不改写用户显式输入
   - 明确 `skill`、`wrapper`、`msgcode` 二进制三者边界

3. 同步本地 [AGENTS.md](/Users/admin/GitProjects/msgcode/AGENTS.md) 与 [README.md](/Users/admin/GitProjects/msgcode/README.md)
   - 把外部产品叙事收口为“薄 runtime、真实能力、默认放权给 AI”
   - 删除任何容易读成“平台替 AI 做主”的表达

4. 更新 [docs/CHANGELOG.md](/Users/admin/GitProjects/msgcode/docs/CHANGELOG.md)
   - 记录仓库级协议收口

5. 验证
   - `npm run docs:check`

## Risks

- 文案如果写得过重，容易被误读成“完全不要边界”
- 文案如果写得过轻，又不足以约束后续实现
- README 若只强调放权，不强调日志和证据，容易被误读成放任式黑盒

回滚策略：

- 若表述引起误解，可只回滚文档改动，不影响运行时
- 但不得回滚到“原则模糊、实现自由漂移”的状态

## Test Plan

- `docs:check` 通过
- 自查 `CLAUDE.md` 与 `README.md` 是否同时覆盖：
  - AI 主执行权
  - 三类硬边界
  - skill / wrapper / CLI 边界
  - 日志与证据优先

评审意见：[留空,用户将给出反馈]
