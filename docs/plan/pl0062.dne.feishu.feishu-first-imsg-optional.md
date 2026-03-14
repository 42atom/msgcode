# 飞书升为主通道，iMessage 降为可选通道

## Problem

当前系统真实使用重心已经转向飞书，但默认启动与文档叙事仍然是 iMessage-first。这导致：

- 默认 transport 与用户心智不一致
- `messages_db` / `chat.db` 持续污染 daemon 与 launchd 主链
- README/帮助口径继续把用户带向次要通道

## Occam Check

- 不加它，系统具体坏在哪？
  默认主链继续被 iMessage 权限与依赖牵着走，飞书主用场景与启动口径持续失真。
- 用更少的层能不能解决？
  能。直接改默认 transport 与依赖门槛，不加新的适配层。
- 这个改动让主链数量变多了还是变少了？
  变少了。默认主链从“双通道心智”收口成“飞书优先，iMessage 显式可选”。

## Decision

采用最小收口方案：

1. 默认 transport 改为：
   - 有飞书配置：默认 `feishu`
   - 无飞书配置：默认 `imsg`
2. `imsg/messages_db` 退出全局启动硬依赖
3. README 与用户可见口径改成飞书主通道

## Plan

1. 修改 [src/config.ts](/Users/admin/GitProjects/msgcode/src/config.ts)
   - 调整 `parseTransports()` 默认逻辑
2. 修改 [src/deps/manifest.json](/Users/admin/GitProjects/msgcode/src/deps/manifest.json)
   - 将 `imsg/messages_db` 从 `requiredForStart` 移到 `optional`
3. 调整探针与文档
   - [README.md](/Users/admin/GitProjects/msgcode/README.md)
   - [docs/CHANGELOG.md](/Users/admin/GitProjects/msgcode/docs/CHANGELOG.md)
4. 增加回归测试

## Risks

- 风险 1：显式依赖 iMessage 的老用户会误以为默认仍然带 `imsg`
  - 缓解：README 明确 `MSGCODE_TRANSPORTS=imsg,feishu` 或 `imsg`
- 风险 2：探针/状态口径遗漏，继续报假错误
  - 缓解：补配置默认值测试，保持未启用 `imsg` 时不报错

## Rollback

- 回退 `src/config.ts`、`src/deps/manifest.json`、README 和相关测试即可恢复原口径

评审意见：[留空,用户将给出反馈]
