# 通用网页事务平台建议

## 结论

未来目标不应定义为：

- “做一个 Gmail 自动化”
- “做一个发小红书工具”
- “做一个下单脚本”

而应定义为：

**在 msgcode 内构建一个通用的 Web Transaction Platform（网页事务平台）**。

这个平台负责：

1. 驱动真实 Chrome
2. 感知网页状态
3. 生成执行计划
4. 执行网页动作
5. 控制副作用风险
6. 沉淀证据与可恢复状态

站点只是其上的 **Domain Pack**。

补充实施口径（2026-03-06 冻结）：

1. **首期只做基础浏览器能力给 agent**
2. **首期不在平台层实现安全阀门**
3. **agent 的具体行为先通过提示词约束**
4. **`prepare / run / archive` 若存在，也仅作为后续可选扩展，不作为当前阻塞项**
5. **设计核心遵循 Unix 哲学：平台给原语，agent 自己管道编排**
6. **主浏览器底座选 PinchTab；`agent-browser` 仅作为参考工具，不进入 msgcode 主链路**
7. **整套 Chrome 视为人机共用的工作浏览器；用户日常主用 Safari，Chrome 全部归自动化工作域**
8. **不再使用 Chrome 官方默认数据根目录；默认改为 msgcode 工作目录下的非默认 Chrome 数据根**

## 为什么不能写死应用

因为你的未来任务有共同本质：

1. 登录并维持会话
2. 打开页面并理解当前状态
3. 读取列表、表单、编辑器、购物车、支付页
4. 填写内容、上传素材、点击下一步
5. 在关键节点暂停确认
6. 输出结果与证据

Gmail、社交媒体后台、电商下单，差别主要在：

1. 页面 schema 不同
2. 风险级别不同
3. 需要的确认点不同
4. 导出/回执形式不同

所以不应该按 App 抽象，而应该按 **事务模型** 抽象。

## 推荐的抽象层级

### L0：Browser Substrate

职责：

1. 启动/连接真实 Chrome
2. 管理 profile / instance / tab / session
3. 提供 `navigate / snapshot / text / action / screenshot / download`
4. 支持 `headed / headless` 双模式运行

建议实现：

1. Chrome 作为真实浏览器
2. PinchTab 作为主控制层
3. Chrome 数据根默认放在 `WORKSPACE_ROOT/.msgcode/chrome-profiles/<name>/`，例如：`$WORKSPACE_ROOT/.msgcode/chrome-profiles/work-default/`

原因：

1. 更贴近“用户自有浏览器身份 / profile / session 管理控制面”
2. 更适合承载长期登录态、多 profile、headed/headless 与人机接力登录
3. 比 `agent-browser` 这种 agent-facing CLI 更适合作为 msgcode 内核侧 substrate
4. 避开 Chrome 136+ 对默认真实数据目录 remote debugging 的限制

### L1：Web Execution Kernel

职责：

1. 把浏览器原语封装成 `msgcode browser` 能力
2. 统一请求 ID、超时、错误码、证据落盘
3. 管理串行队列与恢复

建议能力：

1. `browser.status`
2. `browser.navigate`
3. `browser.snapshot`
4. `browser.text`
5. `browser.action`
6. `browser.screenshot`
7. `browser.download`

补充：

1. `browser.prepare / browser.run / browser.archive` 仅作为后续可选扩展保留
2. 首期不把这些命令做成实施阻塞项

### L2：Transaction Model（概念层，后续实现）

这是最关键的抽象，不要跳过。

把所有网页任务抽象成这几类步骤：

1. `read`
2. `locate`
3. `fill`
4. `upload`
5. `select`
6. `submit`
7. `purchase`
8. `export`
9. `verify`

每个步骤必须声明：

1. `sideEffect`
2. `requiresLogin`
3. `requiresConfirm`
4. `evidence`

### L3：Domain Packs

站点只是业务包，不是底座。

可预期的包：

1. `mail.pack`
2. `social.pack`
3. `commerce.pack`
4. `finance.pack`

每个 pack 只提供：

1. 页面识别规则
2. 数据 schema
3. 字段映射
4. 站点特有选择器策略
5. 业务级确认点

禁止：

1. 绕过底座直接发请求
2. 绕过确认框架直接提交/付款

## 通用能力清单

### 1. 会话与账号能力

你后面要管理多个社交媒体账号，这块必须先抽象。

需要：

1. `profile registry`
2. `account alias`
3. `site -> profile` 映射
4. 登录状态探测
5. 账号切换策略

建议模型：

1. 一个站点可挂多个 profile
2. 一个任务显式指定使用哪个 profile
3. 默认不自动猜账号

补充产品口径：

1. 这里的 `profile` 不是“和用户隔离的另一套 agent 私有身份”
2. 而是 Chrome 工作浏览器中的共享工作上下文
3. 用户和 agent 都在这套工作上下文里接力操作

### 1.1 Profile Control Plane

这块必须单独建模，不要把 profile 当成一个普通字符串参数。

建议区分三个对象：

1. `profile`
2. `account`
3. `instance`

定义：

1. `profile`：Chrome 持久身份，保存 cookie / storage / 扩展 / 登录态
2. `account`：业务语义身份，例如 `x@brand-a`、`gmail@founder`、`shopper@personal`
3. `instance`：某个 profile 以 headed 或 headless 方式启动后的运行态

建议最小数据模型：

1. `profileId`
2. `profileName`
3. `accountAlias`
4. `siteScopes[]`
5. `defaultMode`
6. `lastKnownLoginState`
7. `riskTier`

### 1.2 Profile 选择策略

“智能管理”不应该等于“让模型自己猜”。

正确做法是 **策略驱动 + 显式覆盖**：

1. 优先使用任务显式指定的 `profileId/accountAlias`
2. 若未指定，则查 `site -> default profile` 映射
3. 若一个站点存在多个 profile 且无明确映射，则直接阻塞并要求选择
4. 高风险任务禁止自动在多个 profile 之间猜测切换

建议规则：

1. 只读任务可允许受控默认映射
2. 发文/下单/付款必须显式 profile
3. profile 切换必须写入执行日志

### 1.3 多 Profile 并发

未来要支持：

1. 同时运行 `work`、`personal`、`brand-a`、`brand-b` 等多个 profile
2. 每个 profile 拥有独立 instance
3. 不同 instance 之间 session 完全隔离

但执行策略建议：

1. 同一 profile 内默认串行
2. 不同 profile 可并行，但高风险事务仍建议串行
3. 同一任务链路内禁止中途无理由换 profile

### 2. 页面理解能力

需要：

1. 页面类型识别
2. 登录页/首页/编辑页/确认页/支付页识别
3. 关键元素定位
4. 结构变化检测

否则系统会把“登录页、编辑页、支付页”混成一团。

### 3. 草稿与素材能力

社媒发文/发视频不是一次点击，它本质上是“草稿事务”。

需要：

1. 文案草稿
2. 素材文件集合
3. 元数据
4. 发布参数
5. 平台映射

建议：

1. 先生成草稿对象
2. 再把草稿对象映射到具体站点表单

### 4. 两段式提交能力（后续阶段）

发文、下单、付款都不能直接一步到位。

统一模型：

1. `prepare`
2. `review`
3. `confirm`
4. `run`

其中：

1. 发文属于 `submit`
2. 下单属于 `purchase`
3. 付款属于 `purchase` 的更高风险子类

### 5. 证据与回执能力

无论是发帖成功还是购买成功，都必须落盘：

1. before/after screenshot
2. semantic snapshot
3. response summary
4. exported receipt/order id/post url

### 6. 恢复与重试能力

网页事务会经常中断：

1. 登录失效
2. 弹窗打断
3. 上传失败
4. 页面改版
5. 网络波动

所以需要：

1. requestId
2. step journal
3. resumable plan
4. fail-closed

### 7. 执行模式能力（Headed / Headless）

这也是平台一级能力，不应散落在各站点脚本里。

需要：

1. 任务可声明 `executionMode`
2. 平台可根据风险和页面状态推荐 `headed/headless`
3. 支持从同一 profile 派生 headed 或 headless instance

建议模型：

1. `headed`：可见 Chrome，适合登录、2FA、人工核验、敏感提交
2. `headless`：后台运行，适合只读抓取、日常巡检、批量低风险任务
3. `auto`：平台根据策略选择，但选择结果必须可观测

### 7.1 模式选择策略

推荐策略：

1. 首次登录、验证码、2FA、人工审核：强制 `headed`
2. 只读任务：默认 `headless`
3. 草稿填写：默认 `headless`，必要时可升到 `headed`
4. 发帖发布、下单确认、付款确认：默认 `headed`
5. 调试和回放：优先 `headed`

### 7.2 模式切换原则

要支持：

1. 人先用 `headed` 登录
2. 后续 agent 用同一 profile `headless` 跑日常任务
3. 一旦遇到登录失效、验证码、风险确认，再切回 `headed`

这才是真正可持续的“人机共驾”。

### 7.4 人机接力登录（必须）

这是未来平台的关键工作模式，应明确支持：

1. agent 启动 `headed` 实例并打开目标站点
2. agent 识别当前进入登录页 / 2FA / 验证码挑战页
3. agent 返回 `WAITING_FOR_HUMAN_LOGIN`
4. 用户接管可见 Chrome，手动登录或手动完成验证码
5. 用户通知“继续”
6. agent 基于同一 `profile + requestId` 恢复原任务

这条机制的价值：

1. 不需要保存账号密码
2. 不需要做自动验证码绕过
3. 保留真实浏览器会话
4. 适合 Gmail、社媒后台、电商、支付前校验等通用网页事务
5. 符合“用户和 agent 在同一工作浏览器里接力”的真实场景

平台要求：

1. 必须有 `pause / resume` 语义
2. 必须记录暂停原因（登录页、2FA、captcha、人工确认）
3. 恢复时必须回到同一 profile，禁止偷偷换号
4. 恢复后先重新校验页面状态，再继续后续步骤

### 7.5 凭证失效通知策略（必须）

你给出的产品口径应冻结为：

1. 平台默认长期复用同一 profile 的已登录会话
2. 每次任务开始前先做 `session/login probe`
3. 一旦发现凭证失效、登录态过期、需要重新验证，只主动通知用户一次
4. 在用户未处理前，任务进入 `waiting-human-login`
5. 用户完成登录后回复“继续”，agent 在原任务上恢复执行

必须满足：

1. **同一 `requestId + profileId + site` 的失效事件只通知一次**
2. 未恢复前禁止循环催促、禁止重复新建实例刷屏
3. 平台应记录最近一次失效原因与通知时间
4. 恢复成功后清除等待态

建议最小状态机：

1. `logged-in`
2. `session-expired`
3. `waiting-human-login`
4. `resuming`
5. `ready`

这条规则的目标不是“自动登录”，而是：

1. 正常情况下长期复用 session
2. 失效时低打扰通知一次
3. 人工接管后无缝恢复

### 7.3 不要做的“智能”

禁止：

1. 遇到 profile 冲突时自动乱切
2. 遇到高风险动作时偷偷从 headless 直接提交
3. 遇到登录失败时自动尝试未知账号

“智能”应该体现在策略选择和异常升级，而不是黑箱猜测。

## 风险分层

必须从一开始就把任务按风险分层：

### R1：只读

示例：

1. 看 Gmail 新邮件
2. 查看订单状态
3. 读取后台数据

要求：

1. 默认允许
2. 不需要 confirm

### R2：可逆写入

示例：

1. 填草稿
2. 上传素材但未发布
3. 加购物车

要求：

1. 建议 confirm
2. 强制落证据

### R3：不可逆业务提交

示例：

1. 发布帖子/视频
2. 提交表单
3. 下单

要求：

1. 必须 `prepare + confirm + run`
2. 必须 before/after 证据

### R4：资金动作

示例：

1. 支付
2. 购买订阅
3. 付款确认

要求：

1. 必须 owner-only
2. 必须固定确认短语
3. 必须显式回执校验

## 推荐的能力边界

第一阶段不要承诺：

1. 自动登录
2. 自动绕过验证码
3. 多账号自动猜测
4. 无确认自动下单/自动付款

第一阶段应该承诺：

1. 真实 Chrome
2. 共享工作浏览器 / 工作上下文
3. 只读任务稳定
4. 可逆写入有证据
5. 不可逆动作两段式提交

## 对 msgcode 的实际影响

这意味着 `browser` 不能只是一个简单命令，而应拆成两层：

### Browser Core

1. `status`
2. `profiles list|select|status`
3. `instances start|stop`
4. `mode headed|headless`
5. `navigate`
6. `snapshot`
7. `text`
8. `action`
9. `download`
10. `screenshot`

### Browser Transaction（后续阶段）

1. `prepare`
2. `review`
3. `run --confirm`
4. `resume`
5. `archive`

建议额外补一个运行态：

1. `waiting-human`：等待用户在 headed 模式完成登录/验证码/人工确认

## 建议的 MVP 路线

### MVP-1：只读事务

支持：

1. Gmail 今日邮件摘要
2. 社媒后台列表读取
3. 订单状态查询

### MVP-2：草稿事务

支持：

1. 社媒发文草稿填充
2. 视频上传到待发布
3. 购物车预览

### MVP-3：高敏提交事务

支持：

1. 发文发布
2. 下单确认

但必须：

1. `prepare`
2. 人工确认
3. `run`

### MVP-4：资金事务

最后再做：

1. 付款
2. 订阅购买
3. 高风险商业动作

## 最终建议

你的目标应该写成：

**让 msgcode 拥有可审计、可恢复、可扩展的网页事务能力；Gmail、社媒发文、视频发布、购物下单只是基于同一底座的不同业务包。**

补充当前冻结的底座要求：

1. **平台必须原生支持多 profile 管理与显式切换**
2. **平台必须原生支持 headed/headless 双模式，并有可审计的模式选择策略**
3. **平台必须原生支持“打开 headed 浏览器 -> 用户手动登录/过验证码 -> agent 恢复执行”的人机接力链路**
4. **首期不把 `prepare / run / archive` 作为强制实施项**

不要把路线写成：

1. 先做 Gmail
2. 再做小红书
3. 再做淘宝

那样最后一定变成脚本坟场。

## Evidence

- Docs: `AIDOCS/msgcode-2.1/browser_automation_spec_v2.1.md`
- Docs: `AIDOCS/msgcode-2.1/capability_map_v2.1.md`
- Docs: `AIDOCS/msgcode-2.1/tax_browser_workflow_spec_v2.1.md`
- Docs: `AIDOCS/notes/gmail-readonly-browser-acceptance-260306.md`
- Docs: `AIDOCS/notes/pinchtab-agent-integration-260306.md`
- Docs: `/Users/admin/GitProjects/GithubDown/pinchtab/skill/pinchtab/references/profiles.md`
- Docs: `/Users/admin/GitProjects/GithubDown/pinchtab/docs/guides/headed-mode-guide.md`
