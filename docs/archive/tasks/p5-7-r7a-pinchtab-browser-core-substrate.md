# 任务单：P5.7-R7A（PinchTab Browser Core Substrate）

Issue: 0004
Plan: docs/plan/pl0004.cand.browser.web-transaction-platform-core.md

优先级：P1
建议分支：`codex/p5-7-r7a-pinchtab-browser-core`
派发对象：执行线程（实现）
验收对象：当前线程（评审/验收）

## 任务一句话

把 `msgcode` 的 `browser` 能力接到 PinchTab HTTP API 上，落地最小 Browser Core 原语，不做 Gmail 业务流、不做站点编排、不做平台级安全阀门。

## 背景与冻结结论

1. 主浏览器底座已冻结为 **PinchTab**，不是 `agent-browser`。
2. 已完成真实验证，结论是：
   - `pinchtab` 可通过 npm 安装并自动下载二进制
   - headed/headless 双模式可拉起
   - 真实链路 `tabs/open -> snapshot -> action -> evaluate` 可跑通
3. 已确认的集成坑点：
   - 不要把 `pinchtab` CLI 当主执行层
   - 优先对接 **HTTP API**
   - 不要依赖默认实例/默认 tab
   - 必须显式使用 `instanceId` / `tabId`

参考验证记录：
- `docs/plan/rs0013.dne.browser.pinchtab-validation.md`

## 目标（冻结）

1. 落地 PinchTab HTTP API 适配层。
2. 暴露最小 Browser Core 原语，供 agent 自主编排。
3. 支持 profile / instance / headed-headless / tab / snapshot / text / action。
4. 输出必须结构化，便于 agent 和后续管道消费。

## 非目标（冻结）

1. 不做 Gmail 只读业务流。
2. 不做登录态识别。
3. 不做 `waiting-human-login / pause / resume`。
4. 不做 `prepare / run / archive`。
5. 不做站点 pack（mail/social/commerce/finance）。
6. 不做 prompt 策略和 agent 行为约束。

## 核心设计要求

### 1. Unix 哲学

必须坚持：

1. 提供最小、稳定、可组合原语
2. 不内置复杂工作流
3. 不替 agent 做任务编排
4. 不做隐式状态猜测

### 2. 单一执行通道

必须坚持：

1. 主链路只接 PinchTab HTTP API
2. 不透传 `pinchtab nav/snap/click` CLI 作为正式实现
3. 不引入 Playwright 第二套主后端

### 3. 显式 ID

这一条是硬约束：

1. 实例相关操作显式传 `instanceId`
2. tab 相关操作显式传 `tabId`
3. 本任务禁止实现“默认当前实例/默认当前 tab 猜测”

原因：

1. 已实测发现 CLI 隐式 tab 语义不稳
2. 显式 ID 更符合 agent 管道式编排

## 范围

- `/Users/admin/GitProjects/msgcode/src/runners/browser-pinchtab.ts`（新增）
- `/Users/admin/GitProjects/msgcode/src/tools/bus.ts`
- `/Users/admin/GitProjects/msgcode/src/tools/types.ts`
- `/Users/admin/GitProjects/msgcode/src/cli/browser.ts`（新增）
- `/Users/admin/GitProjects/msgcode/src/cli/help.ts` 或 help-docs 对应出口
- `/Users/admin/GitProjects/msgcode/test/*p5-7-r7a*`
- `/Users/admin/GitProjects/msgcode/README.md`（若需补命令面）

## 建议命令面（冻结）

注意：是 **建议冻结口径**，实现时可按现有 CLI 风格微调，但不得偏离“显式 ID + 原语化”。

1. `msgcode browser profiles list`
2. `msgcode browser instances launch --mode headed|headless [--profile-id <id>]`
3. `msgcode browser instances stop --instance-id <id>`
4. `msgcode browser tabs open --instance-id <id> --url <url>`
5. `msgcode browser tabs list --instance-id <id>`
6. `msgcode browser snapshot --tab-id <id> [--interactive] [--compact]`
7. `msgcode browser text --tab-id <id>`
8. `msgcode browser action --tab-id <id> --kind <kind> [--ref <ref>] [--text <text>] [--key <key>]`
9. `msgcode browser eval --tab-id <id> --expression <js>`

## 实现要求

### Step 1：适配层

实现 `src/runners/browser-pinchtab.ts`，至少包含：

1. `health`
2. `listProfiles`
3. `launchInstance`
4. `stopInstance`
5. `listInstances`（可选但建议）
6. `openTab`
7. `listTabs`
8. `snapshotTab`
9. `textTab`
10. `actionTab`
11. `evaluateTab`

要求：

1. 统一使用 PinchTab HTTP API
2. 支持 token/base URL 配置
3. 失败返回结构化错误

### Step 2：Tool Bus 接入

在 `src/tools/bus.ts` 中补 `case "browser"`。

要求：

1. 不再落到 `unsupported tool in P0`
2. 保持 tool policy / telemetry / timeout / artifact 口径一致
3. browser 工具参数必须做最小校验

### Step 3：CLI 合同

新增 `src/cli/browser.ts` 并接到 help-docs。

要求：

1. help-docs 可发现 browser 合同
2. JSON 输出稳定
3. 参数名与返回字段尽量薄封装，不做业务语义增强

### Step 4：测试

至少补三类：

1. 合同测试
2. 参数校验测试
3. PinchTab 适配层最小行为测试（可 mock HTTP）

## 硬验收（必须全过）

1. `npx tsc --noEmit`
2. `npm test`
3. `npm run docs:check`
4. `help-docs --json` 可发现 browser 命令合同
5. 真实成功证据：
   - 启动 headless 实例
   - 显式 `tabs/open`
   - `snapshot` 拿到交互 ref
   - `action(click)` 成功
   - `eval(location.href)` 证明跳转成功
6. 真实成功证据：
   - headed 实例可正常拉起
7. 真实失败证据：
   - 无效 `tabId`
   - 无效 `instanceId`
   - PinchTab 未启动/鉴权失败
8. 无新增 `.only/.skip`

## 已知坑（实现时必须避开）

1. 不要直接包 `pinchtab nav/snap/click`
2. 不要依赖 orchestrator 的默认实例
3. 不要依赖默认 tab
4. 不要把 CLI 返回的 tab 语义当成唯一真相源
5. 优先使用 HTTP API + 显式 `instanceId/tabId`

## 证据要求

实现线程提交时必须附：

### Docs

- `docs/plan/rs0013.dne.browser.pinchtab-validation.md`
- `docs/plan/pl0004.cand.browser.web-transaction-platform-core.md`

### Code

- `src/runners/browser-pinchtab.ts`
- `src/tools/bus.ts`
- `src/tools/types.ts`
- `src/cli/browser.ts`

### Tests

- `npx tsc --noEmit`
- `npm test`
- `npm run docs:check`

### Logs / Real Smoke

- PinchTab 实例启动日志
- 实际成功命令与关键输出
- 至少一条失败命令与关键输出

## 交付后由当前线程验收重点

1. 是否真的走 HTTP API，而不是偷偷包 CLI
2. 是否坚持显式 `instanceId/tabId`
3. 是否把原语做得足够薄，没有偷塞业务流程
4. 是否已经为后续 Gmail / profile / resume 留出自然接口
