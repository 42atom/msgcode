---
id: 0004
title: 通用网页事务平台底座（Browser Core 优先）
status: doing
owner: agent
labels: [feature, refactor, docs]
risk: high
scope: tools/browser/runtime/config/docs/test
plan_doc: docs/design/plan-260306-web-transaction-platform-core.md
links:
  - docs/tasks/p5-7-r7-browser-domain.md
  - docs/tasks/p5-7-r7a-pinchtab-browser-core-substrate.md
  - docs/tasks/p5-7-r7b-gmail-readonly-acceptance.md
  - docs/tasks/p5-7-r7c-nondefault-chrome-root-cdp.md
  - AIDOCS/notes/web-transaction-platform-260306.md
  - AIDOCS/notes/gmail-readonly-browser-acceptance-260306.md
  - AIDOCS/design/p5-7-r7a-pinchtab-browser-core-dispatch-260306.md
created: 2026-03-06
due:
---

## Context
- 产品公理（冻结）：
  - **Chrome 中的每个 profile 都是一个可长期复用的人机共用工作上下文。**
  - **用户日常主浏览器是 Safari；Chrome 全部归工作自动化域。**
- 用户目标已从“单站点浏览器能力”升级为“通用网页事务平台”：未来需要支持 Gmail 只读、社交媒体多账号发文/发视频、电商下单，且不把能力写死到单个应用。
- 当前仓库已有 `browser` 工具位与 skill 索引，但 `src/tools/bus.ts` 尚无真实 browser 执行分支，R7 任务单仍停留在 `open/click/type + Playwright` 的较窄口径。
- 已冻结的产品边界：
  - 真实浏览器使用 Chrome。
  - **主浏览器控制层采用 PinchTab。**
  - `agent-browser` 仅作为参考工具与能力对照，不作为 `msgcode` 主执行通道。
  - **产品口径更新：整套 Chrome 视为人机共用的工作浏览器；用户日常主浏览器是 Safari，Chrome 全部交给这套协作模型。**
  - **技术口径更新：不再使用 Chrome 官方默认数据根目录；默认改为 msgcode 工作目录下的非默认 Chrome 数据根。**
  - 登录/验证码走“有头模式 + 用户手动接管 + agent 恢复执行”。
  - 默认长期复用同一 profile 的 session；失效时只通知一次并进入 `waiting-human-login`。
  - **首期只建设基础浏览器能力给 agent，自主行为主要通过提示词约束；平台级安全阀门与两段式提交延后到完整流程跑通后再评估。**
  - **设计核心遵循 Unix 哲学：msgcode 只提供最小、稳定、可组合的浏览器原语，编排权交给 agent。**

## Goal / Non-Goals
### Goals
- 建立通用 Browser Core：`profiles / instances / mode / navigate / snapshot / text / action / screenshot / download`。
- 支持多 profile 管理、显式切换、headed/headless 双模式、人机接力登录。
- 完成首条真实只读验收：Gmail 今日新邮件摘要（已登录前提）。
- 为后续 `mail/social/commerce/finance` domain packs 提供稳定底座。

### Non-Goals
- 本单不做自动登录、密码管理、验证码绕过。
- 本单不在平台层实现 `prepare / run / archive` 安全闸门，也不做两段式提交。
- 本单不承诺首版支持发文、下单、付款闭环；这些行为暂由 agent 基于基础能力和提示词自行编排。
- 本单不做多站点业务包全量落地；首站只做 Gmail 只读验收。
- 本单不引入第二套 browser substrate（不同时维护 Playwright 与 PinchTab 两套主后端）。

## Plan
- [x] 落盘 Plan 文档：`docs/design/plan-260306-web-transaction-platform-core.md`
- [x] 收口 Browser Core 合同：命令面、配置键、错误码、evidence 目录结构
- [x] 新增 PinchTab 适配层：`src/runners/browser-pinchtab.ts`
- [x] 在 `src/tools/bus.ts` 增加 `case "browser"`，统一 tool policy / telemetry / timeout / artifacts
- [x] 建立 profile / instance / mode 控制面：多 profile、显式选择、headed/headless 启动与停止
- [ ] 建立 `pause / resume / waiting-human-login` 运行态，支持“手动登录后继续”
- [ ] 完成 Gmail 只读 flow：登录态检测、今日邮件摘要、凭证失效单次通知
- [x] 暴露 CLI/help 合同并补文档：`msgcode browser ...`、`help-docs --json`
- [x] 补测试与冒烟：成功路径、未登录、结构变化、session 失效恢复（R7A Browser Core 范围）
- [ ] 将 `prepare / run / archive` 标记为后续阶段，而非首期交付

## Acceptance Criteria
1. `browser` 工具在 `src/tools/bus.ts` 中可真实执行，不再落到 `unsupported tool in P0`。
2. `msgcode` 能显式列出/选择 profile，并以 `headed` 或 `headless` 模式启动同一 profile 的 instance。
3. 遇到登录页/验证码/2FA 时，系统进入 `waiting-human-login`，只通知一次；用户完成后可在同一 `profile + requestId` 上恢复执行。
4. Gmail 已登录前提下，话术“帮我打开 Gmail，查看我今天的新邮件信息”能返回中文结构化摘要，并落证据包。
5. Gmail 未登录前提下，返回明确的登录态错误（如 `GMAIL_LOGIN_REQUIRED`），不编造结果。
6. agent 可基于 Browser Core 自主完成多步骤网页任务，不依赖平台内置 `prepare / run / archive` 闸门。
7. `help-docs --json` 可发现 browser 合同；`npx tsc --noEmit`、`npm test`、`npm run docs:check` 通过。

## Notes
- Evidence 模板：
  - Docs：`AIDOCS/msgcode-2.1/browser_automation_spec_v2.1.md`、`AIDOCS/notes/web-transaction-platform-260306.md`
  - Code：`src/tools/bus.ts`、`src/tools/types.ts`、未来新增 `src/runners/browser-pinchtab.ts`
  - Tests：`npx tsc --noEmit`、`npm test`、`npm run docs:check`、browser smoke
  - Logs：browser requestId / profileId / mode / state / evidenceDir
- 待替换旧口径：`docs/tasks/p5-7-r7-browser-domain.md` 当前仍是 `open/click/type + Playwright` 范围，后续需改成 Browser Core + Transaction Kernel。
- 2026-03-06 决策更新：首期先做 Browser Core，安全阀门与两段式提交延后；依赖提示词约束 agent 行为。
- 2026-03-06 决策更新：PinchTab 作为主浏览器底座，更符合“用户自有浏览器身份 / profile / session 管理控制面”的整体构思；`agent-browser` 保留为参考工具，不接入主链路。
- 2026-03-09 决策更新：Gmail 不再作为独立产品任务或独立 smoke 批次维护。Browser Core 已跑通后，Gmail 只是普通网页之一；本单剩余重点收口为 `waiting-human-login / pause / resume` 人机接力状态机，而不是继续维护单站点 Gmail 专项验收。
- 2026-03-06 验证计划：先安装 `pinchtab` 并写入项目依赖，再用公开网站跑一条“像 agent 一样使用浏览器”的真实链路，记录实际坑点后再调整文档与构建计划。
- 2026-03-06 验证结果：
  - 已通过 `npm install pinchtab@0.7.7` 将依赖写入 `package.json`
  - `pinchtab` 二进制成功下载到 `~/.pinchtab/bin/0.7.7/pinchtab-darwin-arm64`
  - headless/headed 实例均可拉起
  - 公开站点真实链路已跑通：显式 `tabs/open -> snapshot -> action(click) -> evaluate`
  - 当前版本集成建议：优先对接 HTTP API，不包 CLI 作为主执行层（原因：实例默认 tab 语义与 CLI 返回的 tabId 存在不稳现象）
- 2026-03-06 检查结果：
  - `npx tsc --noEmit` 通过
  - `npm run docs:check` 通过
  - `npm test` 通过（1395 pass / 0 fail）
- 2026-03-06 派单口径确认：
  - 用户确认本轮实现切口为 `R7A / PinchTab Browser Core Substrate`
  - 执行线程只需交付最小 Browser Core 原语，不进入 Gmail / login-resume / transaction kernel
  - 当前线程已生成派单包：`AIDOCS/design/p5-7-r7a-pinchtab-browser-core-dispatch-260306.md`
  - 用户口头证据：`npm run docs:check` 已再次通过；执行线程落代码后仍需重新跑三门
- 2026-03-06 R7A 实现完成记录：
  - 新增 `src/runners/browser-pinchtab.ts`，接入 PinchTab HTTP API：`health / profiles / instances / instances/launch / instances/{id}/stop / instances/{id}/tabs / instances/{id}/tabs/open / tabs/{id}/snapshot / tabs/{id}/text / tabs/{id}/action / tabs/{id}/evaluate`
  - `src/tools/bus.ts` 已新增 `case "browser"`，不再落到 `unsupported tool in P0`
  - 新增 `src/cli/browser.ts` 并接入 `src/cli.ts`、`src/cli/help.ts`
  - 新增测试：
    - `test/p5-7-r7a-browser-runner.test.ts`
    - `test/p5-7-r7a-browser-contract.test.ts`
    - `test/p5-7-r7a-browser-tool-bus.test.ts`
- 2026-03-06 R7A 真机 smoke：
  - `npx tsx src/cli.ts browser instances launch --mode headless --json`
    - `id=inst_d90f542a`
  - `npx tsx src/cli.ts browser tabs open --instance-id inst_d90f542a --url https://example.com --json`
    - `tabId=tab_3994bde8`
  - `npx tsx src/cli.ts browser snapshot --tab-id tab_3994bde8 --interactive --compact --json`
    - 返回 `e0:link "Learn more"`
  - `npx tsx src/cli.ts browser action --tab-id tab_3994bde8 --kind click --ref e0 --json`
    - 返回 `success=true`
  - `npx tsx src/cli.ts browser eval --tab-id tab_3994bde8 --expression 'location.href' --json`
    - 返回 `https://www.iana.org/help/example-domains`
  - `npx tsx src/cli.ts browser instances launch --mode headed --json`
    - `id=inst_dda9fcaa`
  - 失败证据：
    - `npx tsx src/cli.ts browser text --tab-id tab_missing --json`
      - `BROWSER_TAB_NOT_FOUND`
    - `npx tsx src/cli.ts browser tabs open --instance-id inst_missing --url https://example.com --json`
      - `BROWSER_INSTANCE_NOT_FOUND`
    - `PINCHTAB_BASE_URL=http://127.0.0.1:9999 npx tsx src/cli.ts browser instances list --json`
      - `BROWSER_PINCHTAB_UNAVAILABLE`
  - 清理证据：
    - `npx tsx src/cli.ts browser instances stop --instance-id inst_d90f542a --json`
    - `npx tsx src/cli.ts browser instances stop --instance-id inst_dda9fcaa --json`
- 2026-03-06 R7A 验证结果：
  - `npx tsc --noEmit` 通过
  - `npm run docs:check` 通过
  - `npm test` 通过（`1409 pass / 0 fail`）
- 2026-03-06 R7A P2 修复完成记录：
  - `src/runners/browser-pinchtab.ts`
    - 新增 `BROWSER_TIMEOUT`，`AbortError` 不再误报为 `BROWSER_PINCHTAB_UNAVAILABLE`
    - 新增 `BROWSER_ORCHESTRATOR_URL_REQUIRED`，对 orchestrator-only 操作先用 `/health` 校验 `mode=dashboard`
  - `src/tools/bus.ts`
    - browser timeout 现在向上返回 `TOOL_TIMEOUT`
    - browser 非 timeout 失败仍返回 `TOOL_EXEC_FAILED`，保留 browser 原始错误码到 message
  - `src/cli/browser.ts`
    - `help-docs` browser 错误码合同已同步新增 `BROWSER_TIMEOUT` / `BROWSER_ORCHESTRATOR_URL_REQUIRED`
  - `README.md`
    - 已明确 `PINCHTAB_BASE_URL` / `PINCHTAB_URL` 只支持 orchestrator/dashboard URL
    - 已明确不要填 `pinchtab connect` 返回的实例 URL
- 2026-03-06 R7A P2 验证结果：
  - 定向测试：
    - `PATH="$HOME/.bun/bin:$PATH" bun test test/p5-7-r7a-browser-runner.test.ts test/p5-7-r7a-browser-tool-bus.test.ts`
    - 结果：`13 pass / 0 fail`
  - 全量验证：
    - `npx tsc --noEmit` 通过
    - `npm run docs:check` 通过
    - `npm test` 通过（`1413 pass / 0 fail`）
  - 新增覆盖：
    - runner: `AbortError -> BROWSER_TIMEOUT`
    - tool bus: `BROWSER_TIMEOUT -> TOOL_TIMEOUT`
    - baseUrl 误配实例 URL 时：management operation -> `BROWSER_ORCHESTRATOR_URL_REQUIRED`
- 2026-03-06 现有真实 Chrome / Gmail 会话验证：
  - 已确认当前 Chrome 前台页为 `https://mail.google.com/mail/u/0/#inbox`
  - 已尝试用 `--remote-debugging-port=9222` + 真实默认数据目录启动 Chrome
  - `http://127.0.0.1:9222/json/version` 仍返回 `Connection refused`
  - 结合 Chrome 官方 2025-03-17 口径：Chrome 136+ 不再尊重默认真实数据目录上的 remote debugging
  - 结论：当前已登录的真实 Chrome 不能直接作为 PinchTab/CDP 控制目标；若不想重新登录，应改走桌面自动化路线验证 Gmail
- 2026-03-06 当前阶段结论：
  - `R7A / PinchTab Browser Core` 已验收通过
  - 下一子任务切到 `R7B / Gmail 只读验收`
  - `waiting-human-login / pause-resume` 继续保留在 0004 后续阶段
- 2026-03-06 共享工作浏览器口径冻结：
  - 不是“agent 维护另一套专用 profile 池”
  - 而是“整套 Chrome 作为人机共用工作浏览器，用户与 agent 在同一工作上下文中接力”
  - Safari 保持用户日常主浏览器；Chrome 归浏览器自动化工作域
- 2026-03-06 非默认 Chrome 数据根口径冻结：
  - 不再尝试复用 `~/Library/Application Support/Google/Chrome`
  - 默认使用 `WORKSPACE_ROOT/.msgcode/chrome-profiles/<name>/`，例如：`$WORKSPACE_ROOT/.msgcode/chrome-profiles/work-default/`
  - 原因：Chrome 136+ 不再尊重默认真实数据目录上的 remote debugging 开关
- 2026-03-06 R7B 共享工作浏览器口径收紧：
  - `docs/tasks/p5-7-r7b-gmail-readonly-acceptance.md` 与 `AIDOCS/notes/gmail-readonly-browser-acceptance-260306.md` 已统一到“共享工作浏览器 / 共享工作上下文”口径
  - `src/browser/gmail-readonly.ts` 与 `src/cli/browser.ts` 未再引入“agent 专用 profile / 另一套 profile 池”假设
  - `test/p5-7-r7b-gmail-readonly.test.ts`、`test/p5-7-r7b-gmail-contract.test.ts` 已覆盖 Gmail 只读成功/未登录/空结果/结构变化四类行为与命令合同
  - 当前阻塞仍然存在：PinchTab 导入 Chrome user data 后使用的是受其管理的 profile 副本，不能直接接管用户当前正在使用的真实 Chrome 会话；因此 R7B 的真实成功 smoke 仍缺“可由 PinchTab 直接复用的已登录 Gmail 上下文”前置条件
- 2026-03-06 R7C 最小实现完成记录：
  - 新增 `src/browser/chrome-root.ts`，统一 Chrome 工作数据根解析
  - 新增 `msgcode browser root` 命令，可输出/创建默认 Chrome 工作数据根并返回启动命令
  - 默认路径已统一为：`$WORKSPACE_ROOT/.msgcode/chrome-profiles/<name>`
  - 真实命令验证：
    - `NODE_OPTIONS='--import tsx' node src/cli.ts browser root --json`
    - `WORKSPACE_ROOT=<tmp> NODE_OPTIONS='--import tsx' node src/cli.ts browser root --ensure --name social --port 9333 --json`
  - 新增测试：
    - `test/p5-7-r7c-browser-root.test.ts`
    - `test/p5-7-r7a-browser-contract.test.ts` 已补 `browser root` 合同覆盖
- 2026-03-06 R7C 验证结果：
  - `npx tsc --noEmit` 通过
  - 定向测试通过：
    - `PATH="$HOME/.bun/bin:$PATH" bun test test/p5-7-r7a-browser-contract.test.ts test/p5-7-r7c-browser-root.test.ts`
    - 结果：`8 pass / 0 fail`
  - `npm run docs:check` 通过
  - `npm test` 在当前环境结果为 `1415 pass / 7 fail`
    - 失败集中在既有 SOUL / agent-backend 相关测试
    - 未观察到本轮 `browser root` 相关新增失败

## Links
- Plan: `docs/design/plan-260306-web-transaction-platform-core.md`
- Task: `docs/tasks/p5-7-r7-browser-domain.md`
- Task: `docs/tasks/p5-7-r7a-pinchtab-browser-core-substrate.md`
- Task: `docs/tasks/p5-7-r7b-gmail-readonly-acceptance.md`
- Task: `docs/tasks/p5-7-r7c-nondefault-chrome-root-cdp.md`
- Notes: `AIDOCS/notes/web-transaction-platform-260306.md`
- Notes: `AIDOCS/notes/gmail-readonly-browser-acceptance-260306.md`
- Dispatch: `AIDOCS/design/p5-7-r7a-pinchtab-browser-core-dispatch-260306.md`
