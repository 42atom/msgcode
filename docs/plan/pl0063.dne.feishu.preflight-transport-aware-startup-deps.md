# preflight 按 transport 计算真实启动必需依赖

## Problem

静态 manifest 已切成 `Feishu-first`，但 preflight 仍直接读取静态 `requiredForStart`。当默认 transport 回退到 `imsg` 时，preflight 会错误显示 `0/0 启动必需`，与真实启动前提脱节。

## Occam Check

- 不加它，系统具体坏在哪？
  fallback-imsg 场景下，`msgcode preflight --json` 会假绿，用户直到真正启动 transport 才发现缺失 `IMSG_PATH/chat.db`。
- 用更少的层能不能解决？
  能。只在 manifest 加载阶段做一层 transport-aware 提升，不改静态文件口径，不加新控制层。
- 这个改动让主链数量变多了还是变少了？
  变少了。preflight 和 startBot 重新共用同一份“本轮有效 manifest”真相源。

## Decision

采用最小收口方案：

1. 保持静态 `src/deps/manifest.json` 为 Feishu-first 基线
2. 在 `loadManifest()` 中按当前 transport 解析结果，动态把 `imsg/messages_db` 提升为本轮 `requiredForStart`
3. 仅当 transport 实际回退到 `imsg` 单通道时提升；`feishu` 或 `imsg+feishu` 不强行把 iMessage 依赖变成硬门槛

## Plan

1. 修改 [src/deps/load.ts](/Users/admin/GitProjects/msgcode/src/deps/load.ts)
   - 读取 `.env` 中的 `MSGCODE_TRANSPORTS` / `FEISHU_APP_ID` / `FEISHU_APP_SECRET`
   - 生成 transport-aware 有效 manifest
2. 修改 [src/config.ts](/Users/admin/GitProjects/msgcode/src/config.ts)
   - 抽 transport 解析纯函数，避免逻辑漂移
3. 补测试
   - [test/p5-7-r29-feishu-first-transport-default.test.ts](/Users/admin/GitProjects/msgcode/test/p5-7-r29-feishu-first-transport-default.test.ts)
4. 更新 [docs/CHANGELOG.md](/Users/admin/GitProjects/msgcode/docs/CHANGELOG.md)

## Risks

- 风险 1：transport 解析逻辑复制后再次漂移
  - 缓解：收成共享纯函数，两边复用
- 风险 2：`imsg+feishu` 双通道场景仍存在理解分歧
  - 缓解：当前按“有 feishu 即可启动主链”处理，不把 iMessage 再拉回全局硬门槛

## Rollback

- 回退 `src/deps/load.ts`、`src/config.ts`、相关测试与 changelog 即可恢复上一版口径

评审意见：[留空,用户将给出反馈]
