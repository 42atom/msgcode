# Plan: 通用网页事务平台底座（Browser Core 优先）

Issue: 0004

## Problem
产品公理（冻结）：**Chrome 中的每个 profile 都是一个可长期复用的人机共用工作上下文；用户日常主浏览器是 Safari，Chrome 全部归工作自动化域。**
技术前提（冻结）：**不再使用 Chrome 官方默认数据根目录；默认改为 msgcode 工作目录下的非默认 Chrome 数据根，以恢复可控的 remote debugging / CDP 能力。**

当前 `msgcode` 已有 `browser` 工具名与 skill 索引，但没有真实 browser 执行链路，且既有 R7 任务单仅覆盖 `open/click/type` 这种原子命令视角，无法支撑用户想要的长期目标：多 profile、多账号、headed/headless、人机接力登录、只读读取、社媒发文、视频发布、下单购买等通用网页事务。  
如果继续按单站点脚本推进，最终会堆成“Gmail 脚本 / 社媒脚本 / 电商脚本”的脚本坟场，无法维护。  
同时，用户已明确要求：**首期只做基础能力给 agent，不在平台层实现安全闸门；行为约束先交给提示词。**

## Decision
采用“**Chrome + PinchTab 作为 Browser Substrate，msgcode 先落 Browser Core，Transaction Kernel 延后**”的方案，并明确遵循 Unix 哲学：**只提供最小、稳定、可组合的原语，把编排权交给 agent**。

核心理由：
1. **不写死应用**：把站点差异下沉到后续 Domain Pack，底座只承载 profile、mode、动作原语、事务安全与证据。
2. **人机共驾可持续**：登录/2FA/验证码走 headed 模式的人机接力，避免密码托管与验证码绕过。
3. **先跑通主流程**：当前阶段优先把基础浏览器能力给到 agent，让 agent 自主编排网页任务；安全阀门与两段式提交流程放到后续阶段。
4. **更符合整体构思**：PinchTab 更接近“用户自有浏览器身份 / profile / session 的管理控制面”，比 `agent-browser` 这类 agent-facing CLI 更适合作为 msgcode 内部主底座。

评审意见：[留空,用户将给出反馈]

## Alternatives
1. **Playwright 直连（不推荐）**
   - 优点：实现路径熟悉，社区常见。
   - 缺点：需要自行补 agent 友好的语义快照、profile orchestration、headed/headless 共驾、人机接力登录与低 token 读取策略。
2. **Chrome + PinchTab（推荐）**
   - 优点：已有 HTTP API、profile/instance/headed/headless 语义，贴近 agent substrate。
   - 缺点：需要在 msgcode 内补一层适配与控制面。
3. **agent-browser 作为主执行通道（不推荐）**
   - 优点：CLI 原语直接、非常符合 shell/管道风格，agent 可直接调用。
   - 缺点：更像 agent-facing 工具而非系统控制平面，不利于把浏览器身份、profile、instance、长期会话收口为 msgcode 自身底座。
4. **自研 CDP 控制层（否决）**
   - 优点：完全自定义。
   - 缺点：成本最高，当前阶段不值得。

推荐：2) Chrome + PinchTab。

评审意见：[留空,用户将给出反馈]

## Plan
1. **冻结 Browser Core 合同**
   - 文件：
     - `src/tools/types.ts`
     - `src/tools/bus.ts`
     - `src/cli/browser.ts`（新增）
     - `src/cli/help.ts` 或等价 help 输出位置
   - 目标：
     - 明确 Browser Core 命令面：`profiles list/select/status`、`instances start/stop`、`navigate`、`snapshot`、`text`、`action`、`download`、`screenshot`
     - 增加 `BROWSER_*` 错误码与 evidence 约定
   - 验收：
     - `help-docs --json` 可发现 browser 合同

2. **接入 PinchTab 适配层**
   - 文件：
     - `src/runners/browser-pinchtab.ts`（新增）
     - `src/tools/bus.ts`
     - `src/config/*`（如需新增配置解析）
   - 目标：
     - 通过 PinchTab HTTP API 接管真实 Chrome
     - 支持 profile / instance / mode 显式选择
     - 支持 `PINCHTAB_BASE_URL`、`PINCHTAB_TOKEN` 等配置
   - 验收：
     - `executeTool("browser")` 可成功调用 PinchTab 并返回结构化结果与 artifacts

3. **建立 Profile Control Plane**
   - 文件：
     - `src/runtime/*` 或 `src/browser/*`（新增模块，具体目录按现有分层收口）
     - 相关 docs / help / tests
   - 目标：
     - 抽象 `profile / accountAlias / instance`
     - 支持多 profile 管理、显式切换、同站点默认映射
     - 高风险任务禁止 profile 猜测
   - 验收：
     - 同一站点多 profile 场景下，系统能在无明确映射时阻塞而非乱猜

4. **建立 Execution Mode 与人机接力登录**
   - 文件：
     - Browser runtime state 管理模块（新增）
     - `src/routes/*` 或 agent/runtime 恢复链路
   - 目标：
     - 支持 `headed | headless | auto`
     - 实现 `waiting-human-login`、`pause`、`resume`
     - 同一 `requestId + profileId` 登录后恢复原任务
     - session 失效只通知一次
   - 验收：
     - 登录页 / 2FA / captcha 下进入 `waiting-human-login`
     - 用户手动登录后可继续原任务

5. **实现 Gmail 只读验收流**
   - 文件：
     - Gmail flow 相关 browser/domain 逻辑（目录按落地方案决定）
     - `AIDOCS/notes/gmail-readonly-browser-acceptance-260306.md`（已存在）
   - 目标：
     - 登录态探测
     - “今天的新邮件”提取与摘要
     - 未登录 fail-closed
   - 验收：
     - 成功路径：返回中文结构化摘要
     - 失败路径：返回登录态错误或站点变化错误

6. **记录后续阶段占位，不在首期实现**
   - 文件：
     - docs 即可，代码暂不落
   - 目标：
     - 仅在设计层保留 `prepare / run / archive` 作为未来可选扩展
     - 不把它们做成当前实现阻塞项
   - 验收：
     - 当前代码交付不依赖这套闸门也能跑通 Gmail 只读与通用 Browser Core

评审意见：[留空,用户将给出反馈]

## Risks
1. **范围过大，容易一次性做成大爆炸**
   - 回滚/降级：先只交付 Browser Core + Gmail 只读，不在首轮做 social/commerce 提交动作。
2. **profile 选择策略若做成“自动猜测”，会造成串号与误操作**
   - 回滚/降级：高风险任务强制显式 profile；无映射时阻塞。
3. **session/login 恢复链路若状态管理不稳，会出现重复催促、重复新开实例**
   - 回滚/降级：同一 `requestId + profileId + site` 只允许一个等待态。
4. **若完全无平台护栏，后续高风险动作可能缺少统一边界**
   - 回滚/降级：本阶段接受该决策，仅在文档保留后续扩展点，不阻塞当前实现。
5. **若后续又把 `agent-browser` 并入主链路，会形成双执行通道**
   - 回滚/降级：保持单一主底座原则；`agent-browser` 仅用于参考、验证或临时对照，不进入正式运行链路。

评审意见：[留空,用户将给出反馈]

## Migration / Rollout
1. 第一阶段：浏览器底座以 feature branch 落地，仅跑本地开发与手工冒烟。
2. 第二阶段：启用单一站点只读验收（Gmail）。
3. 第三阶段：若基础能力稳定，再评估是否需要 `prepare/run` 等统一闸门。
4. 若集成失败，可临时回退到“保留 browser 工具名但不在运行时暴露”的状态，不影响现有 iMessage / tmux 主链路。

评审意见：[留空,用户将给出反馈]

## Test Plan
1. 静态与单测
   - `npx tsc --noEmit`
   - `npm test`
   - `npm run docs:check`
2. Browser Core 冒烟
   - profile 列表/选择
   - headed/headless 启动
   - navigate / snapshot / text / screenshot
3. 人机接力冒烟
   - 打开 Gmail 登录页
   - 进入 `waiting-human-login`
   - 用户手动登录
   - 回复“继续”后恢复读取
4. Gmail 只读验收
   - 成功：返回今日新邮件摘要
   - 失败：未登录时返回 `GMAIL_LOGIN_REQUIRED`
   - 失败：页面结构变化时返回 `BROWSER_SITE_CHANGED`
5. 回归锁
   - 不允许新增 `.only/.skip`
   - 不破坏现有 tmux/desktop/tooling 主链路
6. Agent 自主编排验证
   - 在无 `prepare/run/archive` 闸门前提下，agent 仍能调用 Browser Core 完成只读多步任务

评审意见：[留空,用户将给出反馈]

## Observability
需要新增最小可观测字段：
1. `requestId`
2. `profileId`
3. `accountAlias`
4. `instanceId`
5. `mode`
6. `browserState`（`ready | session-expired | waiting-human-login | resuming`）
7. `site`
8. `evidenceDir`

产物目录建议：
`<workspace>/artifacts/browser/YYYY-MM-DD/<requestId>/`

评审意见：[留空,用户将给出反馈]
