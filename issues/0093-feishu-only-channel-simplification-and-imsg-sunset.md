---
id: 0093
title: Feishu-only 通道简化与 iMessage Sunset 执行规划
status: done
owner: agent
labels: [feature, refactor, docs]
risk: high
scope: transport/config/probe/cli/runtime/docs 的 imsg 退场与 channel-neutral 收口
plan_doc: docs/design/plan-260312-feishu-only-channel-simplification-and-imsg-sunset.md
links:
  - issues/0065-post-imessage-channel-strategy.md
  - AIDOCS/reviews/remove-imessage-channel.md
---

## Context

[Issue 0065](/Users/admin/GitProjects/msgcode/issues/0065-post-imessage-channel-strategy.md) 已冻结总方向：

- 当前唯一主通道：Feishu
- iMessage：进入 legacy / sunset 轨道
- 后续目标：为 Telegram、Discord，以及未来用户自己的 app / web 客户端保留更薄的 channel-neutral 主链

现在已有一份具体审查清单：

- [AIDOCS/reviews/remove-imessage-channel.md](/Users/admin/GitProjects/msgcode/AIDOCS/reviews/remove-imessage-channel.md)

这份文档不是新的真相源，更适合作为本 issue 的执行输入。它覆盖了 `src/imsg/`、probe、CLI、文案、测试与文档等多个边界，已经属于一条独立的大迁移线，需要单独挂 issue/plan，而不是散落到零碎清理里。

## Goal / Non-Goals

### Goal

- 把运行时主链进一步收口成 Feishu-only
- 系统性移除 `imsg` / iMessage 的主链依赖、默认假设与对外口径
- 为未来自有 app / web 客户端保留更干净的 channel-neutral seam
- 明确后续真正执行时的阶段顺序，避免大爆炸删除

### Non-Goals

- 本轮不实现自有 app 或 web 客户端
- 本轮不接入 Telegram / Discord
- 本轮不设计新的 transport framework / channel platform
- 本轮不直接删除全部历史文档证据

## Plan

- [x] 把 `remove-imessage-channel.md` 收口成正式迁移步骤与边界清单
- [x] 第一阶段：先做 channel-neutral cleanup，清理配置/命名/CLI/help 中的 iMessage 默认假设
- [x] 第二阶段：清理 runtime/probe 对 imsg 的启动硬依赖与默认探测
- [x] 第三阶段：移除 `src/imsg/` 主链入口，并同步归档 `vendor/imsg` 与历史脚本
- [x] 第四阶段：清理受影响测试，改为 Feishu-only / channel-neutral 真相源
- [x] 更新 README / docs / package metadata，对外口径收口为 Feishu-only，面向未来 app/web client

## Acceptance Criteria

1. `remove-imessage-channel.md` 被明确归类为 `0065` 的执行输入，而不是平行真相源。
2. 有一份正式 plan 文档定义 `channel-neutral cleanup -> imsg runtime removal -> archive` 的阶段顺序。
3. 计划明确：目标不是“只为 Feishu 写死”，而是“先删掉 imsg 历史包袱，再为未来 app/web client 保留更薄的统一主链”。
4. 后续真正执行时，可以按阶段推进，不需要一次性大删除。

## Notes

- 归类判断：
  - 战略层：归属于 [Issue 0065](/Users/admin/GitProjects/msgcode/issues/0065-post-imessage-channel-strategy.md)
  - 执行层：由本 issue 承接，覆盖 `0065` 的 `Phase 2: Channel-Neutral Cleanup` 和 `Phase 5: iMessage Sunset`
- 当前进展：
  - 已新增 `src/channels/types.ts` 与 `src/channels/chat-id.ts`
  - 核心主链模块已改为依赖 `src/channels/*`，不再从 `src/imsg/*` 借通用消息类型和 chatId 工具
  - transport 默认面已进一步收口：
    - 未显式配置 `MSGCODE_TRANSPORTS` 时默认只启 `feishu`
    - `parseRuntimeTransports()` 现在只接受 `feishu`
    - legacy `MSGCODE_TRANSPORTS=imsg` 只会在 `MSGCODE_ENV_BOOTSTRAPPED=1` 的真实运行入口显式报 sunset 错误
    - 维护脚本 / 普通源码分析不会被开发机残留 shell env 直接拖垮
    - 不再因缺少飞书凭据在 `config.ts` import/load 阶段直接炸整仓
    - 缺失 `FEISHU_APP_ID / FEISHU_APP_SECRET` 改为在 `preflight` / `start` 边界显式报错
    - `loadManifest()` 已收口为 Feishu-only：启动必需只剩 `feishu_app_id` / `feishu_app_secret`
  - 默认上手入口已收口为 Feishu-first：
    - `msgcode init` 不再检查 `chat.db`、不再引导 Full Disk Access、也不再提示 iMessage 建群
    - `.env.example` 已显式暴露 `FEISHU_APP_ID` / `FEISHU_APP_SECRET`
    - `.env.example` 不再公开 `IMSG_PATH`
  - 公开脚本入口已纠偏：
    - `package.json` 的 `npm run dev` / `npm start` 不再指向 `src/index.ts`
    - 对外脚本现统一落到 `tsx src/cli.ts start debug`
    - 黑盒测试已锁定：公开脚本必须命中当前 Feishu 主链，不允许再落回 `index.ts` 的 imsg-only 壳
  - 直接入口已收口为单一主链：
    - `src/index.ts` 不再维护第二套 imsg-only runtime
    - `src/index.ts` / `src/daemon.ts` 都会先设置 `MSGCODE_ENV_BOOTSTRAPPED=1`，再动态导入 `commands.js`
  - 直接运行 `src/index.ts` 时已统一转发到当前 `startBot()` 主链
  - 黑盒测试已锁定：`src/index.ts` 不得再返回旧的“仅支持 imsg”错误
  - 公开 legacy CLI 面已继续收口：
    - `msgcode file send` 已退役为显式错误壳，不再进入 `help-docs --json`
    - `docs/tasks/p5-7-r1*.md` 已迁入 `docs/archive/retired-imsg-cli/`
    - `msgcode job run --help` 不再暴露 `--no-delivery`
    - README 与 `.env.example` 不再继续公开 `IMSG_PATH` / `file send` 主叙事
  - probe / runtime 默认面已进一步收口：
    - `doctor/status/about` 不再把 `IMSG_PATH`、`imsg executable`、`chat.db`、Full Disk Access 作为当前正式输出字段
    - `probe config/environment/connections/permissions` 已移除 legacy imsg 默认探测字段
    - `listener` / `commands` / `jobs` 的发送接口命名已收口为 channel-neutral，避免 `imsgSend` 继续扩散到现役主链
    - `listener` 写入的 `runtime.current_transport` 已固定为 `feishu`
    - 黑盒测试已锁定：即使显式配置 legacy imsg，probe 和 `about --json` 也不得再回显这些字段
  - 用户面文案已开始同步：
    - `src/cli.ts` 默认描述改为中性 runtime 口径
    - `src/tmux/remote_hint.ts` 默认提示词不再写死 iMessage
    - `README.md` / `.env.example` 已清掉过时的 IndexTTS 主叙事，并把 iMessage 标成 legacy
  - Phase B 已完成：
    - `src/imsg/` 已迁入 `.trash/2026-03-12-imsg-sunset/src/imsg/`
    - `vendor/imsg/` 已迁入 `.trash/2026-03-12-imsg-sunset/vendor/imsg/`
    - `test/imsg.adapter.test.ts` 与 `test/commands.startup-guard.test.ts` 已迁入同一归档目录
    - `.trash/2026-03-12-imsg-sunset/README.md` 已记录 sunset 原因与归档边界
  - 最终验证：
    - `PATH="$HOME/.bun/bin:$PATH" bun test` -> `1492 pass / 0 fail`
    - `npx tsc --noEmit` -> 通过
    - `npm run docs:check` -> 通过
    - 直接 CLI 黑盒测试已统一改为走 `test/helpers/cli-process.ts`，隔离宿主 shell 遗留的 `MSGCODE_TRANSPORTS=imsg` 污染
- 执行输入：
  - [AIDOCS/reviews/remove-imessage-channel.md](/Users/admin/GitProjects/msgcode/AIDOCS/reviews/remove-imessage-channel.md)
- 受影响边界（初始）：
  - `src/channels/*`
  - `src/imsg/`
  - `src/config.ts`
  - `src/config/workspace.ts`
  - `src/probe/probes/*`
  - `src/cli*`
  - `src/jobs/*`
  - `src/output/*`
  - `src/attachments/vault.ts`
  - `README.md`
  - `vendor/imsg`

## Links

- [Parent Issue](/Users/admin/GitProjects/msgcode/issues/0065-post-imessage-channel-strategy.md)
- [Plan](/Users/admin/GitProjects/msgcode/docs/design/plan-260312-feishu-only-channel-simplification-and-imsg-sunset.md)
- [Review Input](/Users/admin/GitProjects/msgcode/AIDOCS/reviews/remove-imessage-channel.md)
