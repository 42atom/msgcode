# API backend 下视觉能力冻结为本地模型

## Problem

当前系统已经事实上采用了“API 文本 + 本地视觉”的执行形态，但命令面和状态面没有说真话：

- `runVision()` 只走本地 backend
- `/vision-model` 在 `backend=api` 时仍像是在操作 API 分支模型
- `/model status` 也把 `vision-model` 展示成当前 lane 值

这会误导用户，以为图片会上传到云端 API。

## Occam Check

- 不加这次收口，系统具体坏在哪？
  - 用户对隐私边界和执行路径的理解会错；命令面与运行时继续漂移。
- 用更少的层能不能解决？
  - 能。直接让命令面与状态面忠实映射现有执行链，不新增任何 adapter 或策略层。
- 这个改动让主链数量变多了还是变少了？
  - 变少了。删除“api vision”这层假心智，只保留本地视觉一条主链。

## Decision

选定方案：冻结 `vision` 为 local-only 能力，即使 `backend=api` 也如此；命令与状态显式体现这一点。

核心理由：

1. 当前真实执行链已经是 local-only vision
2. 图片隐私应优先，本地视觉比云端 vision 更符合产品方向
3. 先让命令面说真话，再决定以后是否需要云端 vision

## Alternatives

### 方案 A：保留现状

- 优点：零改动
- 缺点：用户会继续误判图片是否上传云端

### 方案 B：补一个真正的 api vision adapter

- 优点：命令面与运行时对齐
- 缺点：违背当前隐私方向，也会新增 provider 分支

### 方案 C：冻结 local-only vision，并让命令面说真话（推荐）

- 优点：最薄、最直、最符合当前真实能力边界
- 缺点：历史 `model.api.vision` 字段暂时仍留着

## Plan

1. 调整 `src/routes/cmd-model.ts`
   - `backend=api` 时，`/vision-model` 仍读写 local lane
   - `/model status` 显示 `vision-model: local-only (...)`
2. 更新测试
   - `test/p5-7-r24-backend-command-lanes.test.ts`
3. 更新 `docs/CHANGELOG.md`

## Risks

- 旧测试和旧文档会继续假定 `api vision` 存在，需要同步改口径

回滚/降级策略：

- 回退 `src/routes/cmd-model.ts`、相关测试与 `docs/CHANGELOG.md`

评审意见：[留空,用户将给出反馈]
