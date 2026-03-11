# P5.7-R7A 派单包：PinchTab Browser Core Substrate

## 结论

本轮实现只做 `R7A`，不做 `0004` 的全量 Browser Transaction 平台。

执行线程按以下冻结口径直接实现：

1. 主链路只接 **PinchTab HTTP API**
2. 不包 `pinchtab` CLI 做正式实现
3. 必须显式使用 `instanceId` / `tabId`
4. 只交付最小 Browser Core 原语

## 唯一真相源

- Issue：`issues/0004-web-transaction-platform-core.md`
- Plan：`docs/design/plan-260306-web-transaction-platform-core.md`
- Task：`docs/tasks/p5-7-r7a-pinchtab-browser-core-substrate.md`
- Validation Notes：`docs/notes/research-260306-pinchtab-validation.md`

若派单包与上述文件有冲突，以 task + issue 当前内容为准。

## 本轮范围

必须实现：

1. `src/runners/browser-pinchtab.ts`
2. `src/tools/bus.ts` 中的 `case "browser"`
3. `src/tools/types.ts` 的 browser 结果结构补齐
4. `src/cli/browser.ts`
5. `src/cli/help.ts` 中 browser 合同导出
6. `test/*p5-7-r7a*` 最小合同/参数/runner 测试

允许顺带修改：

1. `src/cli.ts`，用于挂载 browser 命令
2. `README.md`，若命令面需要最小同步
3. `issues/0004-web-transaction-platform-core.md`，回写执行证据

## 严禁扩 scope

本轮禁止实现：

1. Gmail 只读业务流
2. 登录态识别
3. `waiting-human-login / pause / resume`
4. `prepare / run / archive`
5. 站点 pack（mail/social/commerce/finance）
6. Playwright 第二套主后端
7. “默认实例 / 默认 tab / 自动猜测 profile”

## 冻结命令面

实现时可按现有 CLI 风格微调，但不能偏离“薄原语 + 显式 ID”：

1. `msgcode browser profiles list`
2. `msgcode browser instances launch --mode headed|headless [--profile-id <id>]`
3. `msgcode browser instances stop --instance-id <id>`
4. `msgcode browser tabs open --instance-id <id> --url <url>`
5. `msgcode browser tabs list --instance-id <id>`
6. `msgcode browser snapshot --tab-id <id> [--interactive] [--compact]`
7. `msgcode browser text --tab-id <id>`
8. `msgcode browser action --tab-id <id> --kind <kind> [--ref <ref>] [--text <text>] [--key <key>]`
9. `msgcode browser eval --tab-id <id> --expression <js>`

## 实现顺序

### Step 1：Runner

先实现 `src/runners/browser-pinchtab.ts`，至少覆盖：

1. `health`
2. `listProfiles`
3. `launchInstance`
4. `stopInstance`
5. `listInstances`
6. `openTab`
7. `listTabs`
8. `snapshotTab`
9. `textTab`
10. `actionTab`
11. `evaluateTab`

要求：

1. 只用 HTTP API
2. 支持 `PINCHTAB_BASE_URL` / `PINCHTAB_TOKEN`
3. 失败返回结构化错误
4. 中文注释只写在关键不变量和边界条件处

### Step 2：Tool Bus

在 `src/tools/bus.ts` 接入 `case "browser"`。

要求：

1. 不再返回 `unsupported tool in P0`
2. 参数最小校验先做硬收口
3. 保持现有 timeout / telemetry / artifacts 口径
4. 不在 bus 内偷塞站点业务流程

### Step 3：CLI + Help

新增 `src/cli/browser.ts` 并接到 `src/cli.ts` / `src/cli/help.ts`。

要求：

1. `help-docs --json` 可发现 browser 合同
2. 输出稳定、字段薄封装
3. 不引入默认实例/默认 tab 猜测

### Step 4：测试

至少补齐：

1. 合同测试
2. 参数校验测试
3. PinchTab runner 最小行为测试（mock HTTP）

## 硬验收

实现线程交付时必须同时给出：

1. `npx tsc --noEmit`
2. `npm test`
3. `npm run docs:check`
4. `help-docs --json` 中 browser 合同可见
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
   - PinchTab 未启动或鉴权失败
8. 无新增 `.only/.skip`

## 已知坑

实现线程必须避开：

1. 不能把 `pinchtab nav/snap/click` CLI 包一层就交差
2. 不能依赖 orchestrator 的默认实例
3. 不能依赖默认 tab
4. 不能把 CLI 返回的 tab 语义当唯一真相源
5. 必须优先走 `docs/notes/research-260306-pinchtab-validation.md` 中已验证的 HTTP 路径

## 建议交付格式

执行完成后，回写 issue 时用下面结构：

任务：P5.7-R7A PinchTab Browser Core Substrate
原因：
- browser 工具目前仍未接入真实执行链路
- 0004 已冻结 R7A 作为首个可交付切口
过程：
- 新增 runner，并按 HTTP API 对接 PinchTab
- 在 tool bus 接入 browser 分支并补 CLI/help 合同
- 增加 runner/合同/参数校验测试并跑三门
结果：
- browser 工具已可真实执行，不再落到 unsupported
- help-docs 可发现 browser 合同
- 提供真实成功/失败 smoke 证据
后续：
- Gmail 只读流、waiting-human-login、transaction kernel 继续留在 0004 后续阶段

## 给执行线程的一句话

只做最小 Browser Core，把原语接通，把合同补齐，把证据打全；不要帮平台“脑补下一阶段”。
