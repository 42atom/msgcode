# 任务单：P5.7-R7（浏览器域：browser）

Issue: 0004
Plan: docs/plan/pl0004.doi.browser.web-transaction-platform-core.md

优先级：P2（R6 通过后执行）

## 目标（冻结）

1. 落地 Browser Core 最小原语：`profiles/instances/mode/navigate/snapshot/text/action/screenshot/download`。
2. 以 PinchTab 作为主浏览器底座，优先对接 HTTP API，不包 CLI 作为主执行层。
3. CLI 层只暴露能力合同，不引入站点级工作流编排。
4. 全部命令可被 `help-docs --json` 发现。

## 依赖

1. 依赖 `pinchtab@0.7.7`（已验证 npm 安装与本机运行）。
2. 依赖真实 Chrome/Chromium。
3. 依赖 R1c 硬门（真实成功/失败证据）。

## 范围

- `/Users/admin/GitProjects/msgcode/src/cli/browser.ts`
- `/Users/admin/GitProjects/msgcode/src/runners/browser-pinchtab.ts`
- `/Users/admin/GitProjects/msgcode/src/tools/bus.ts`
- `/Users/admin/GitProjects/msgcode/src/cli/help.ts`
- `/Users/admin/GitProjects/msgcode/test/*p5-7-r7*`
- `/Users/admin/GitProjects/msgcode/docs/tasks/README.md`

## 非范围

1. 不实现站点级工作流编排（Gmail/社媒/电商 pack 后置）。
2. 不在平台层实现 `prepare/run/archive` 闸门。
3. 不改 agent run/status。

## 执行步骤（每步一提交）

1. `feat(p5.7-r7): add pinchtab browser core substrate`
2. `test(p5.7-r7): add browser-domain regression lock`
3. `docs(p5.7-r7): align browser task and install docs`

## 硬验收（必须全过）

1. `npx tsc --noEmit`
2. `npm test`（0 fail）
3. `npm run docs:check`
4. `help-docs --json` 可发现 browser
5. 真实成功证据：显式 `instances/launch -> tabs/open -> snapshot -> action -> evaluate/text`
6. 真实失败证据：无实例时访问失败、默认 tab/CLI tabId 语义不稳等异常路径已记录
7. headed/headless 双模式至少各有一条真实证据
8. 无新增 `.only/.skip`
