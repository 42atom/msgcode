# plan-260311-typecheck-merge-prep-existing-errors

## Problem

当前 branch 的行为回归已经通过，但 `npx tsc --noEmit` 仍被两处既存错误卡住：`feishu/transport.ts` 的上传结果 union 没有类型收窄，`cmd-schedule.ts` 引错了 `getWorkspaceRootForDisplay` 的来源模块。这两处都属于实现层小洞，不需要上新层。

## Occam Check

1. 不加这次修正，系统具体坏在哪？
   - 分支仍无法 typecheck 全绿，合并前会一直背着“这轮改动是否引入新 TS 红”的噪音。
2. 用更少的层能不能解决？
   - 能。直接在原地修类型收窄与错误 import，不新增 wrapper 或 helper 层。
3. 这个改动让主链数量变多了还是变少了？
   - 不变。只是把现有主链的类型和引用补齐。

## Decision

采用最小修复：

1. `feishu/transport.ts` 按 `treatAsImage` 分支分别读取 `image_key / file_key`
2. `cmd-schedule.ts` 改回从 `routes/store.ts` 读取 `getWorkspaceRootForDisplay`
3. 跑 `npx tsc --noEmit` 和一条相关命令测试确认

## Plan

1. 修复 Feishu 上传结果分支
   - `src/feishu/transport.ts`
2. 修复 schedule workspace root 引用
   - `src/routes/cmd-schedule.ts`
3. 验证
   - `npx tsc --noEmit`
   - 相关路由/命令测试

## Risks

1. Feishu 分支重排如果不谨慎，可能改到发送逻辑。
   - 回滚/降级：只做类型收窄，不改日志字段和发送顺序。
2. schedule 引用修正如果指错模块，会影响 `/schedule add` 的路径解析。
   - 回滚/降级：直接复用 `routes/store.ts` 现有真相源，不新增中间函数。

## Test Plan

1. `npx tsc --noEmit`
2. 一条 `schedule` 路由测试
3. 如有必要，补一条 Feishu 发送链静态/行为测试

（章节级）评审意见：[留空,用户将给出反馈]
