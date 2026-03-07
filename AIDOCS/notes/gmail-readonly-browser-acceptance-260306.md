# Gmail 只读浏览器验收场景

## 结论

将这条用户话术定义为 **R7 browser 域的首条真实行为验收**：

> 帮我打开 Gmail，查看我今天的新邮件信息。

它应被归类为：

- 能力域：`browser`
- 风险等级：`medium`
- 动作类型：**read-only**
- 是否需要 confirm：**否**

原因：该场景会访问敏感数据，但不应产生发送、删除、归档、标记已读等副作用。

## 用户故事

用户对 msgcode 说：

> 帮我打开 Gmail，查看我今天的新邮件信息。

系统应：

1. 使用共享工作 Chrome 上下文中的 Gmail 工作 profile 打开 Gmail。
2. 检查当前是否已登录 Gmail。
3. 在不执行副作用操作的前提下，读取“今天收到的新邮件”。
4. 返回结构化摘要，而不是只回一张截图。

## 成功标准

满足以下条件，才算“顺利执行”：

1. 成功打开 Gmail 收件箱页面。
2. 若未登录，明确返回 `需要登录 Gmail`，而不是瞎猜页面内容。
3. 能识别今天的新邮件列表，至少提取：
   - 发件人
   - 主题
   - 时间
   - 摘要片段
4. 输出给用户的是中文摘要，附带“共发现 N 封今日新邮件”。
5. 全程不触发发送、回复、归档、删除、标记星标等动作。
6. 落盘最小证据：
   - 页面语义快照
   - 关键截图
   - 本次摘要结果

## 失败标准

出现以下任一情况，视为失败：

1. 浏览器未打开 Gmail 就直接编造邮件内容。
2. 未登录时不报错，反而误读登录页。
3. 通过点击邮件把未读状态改掉，或触发其他副作用。
4. 只返回“我已经打开 Gmail”，但没有邮件结果。
5. 只返回截图，不返回结构化文本摘要。

## 底座能力要求

为了让这条话术跑通，底座至少要有以下能力：

### 1. 浏览器连接能力

1. `msgcode` 能通过 PinchTab 调用浏览器。
2. 至少支持：
   - `navigate`
   - `snapshot`
   - `text`
   - `action`

### 2. 登录态识别

必须能区分：

1. Gmail inbox
2. Google 登录页
3. 二次验证/异常挑战页

如果不是 inbox，必须 fail-closed，不允许继续猜。

### 3. 只读提取策略

优先策略：

1. 先 `snapshot(filter=interactive, format=compact)` 定位页面结构
2. 再 `text` 或局部 snapshot 提取邮件列表信息
3. 仅在必要时进入具体邮件

默认禁止：

1. 发送邮件
2. 回复邮件
3. 删除/归档邮件
4. 修改 Gmail 状态

### 4. 时间判断

“今天”必须按当前运行时区解释，不能模糊。

当前工作区时区：

- `Asia/Singapore`

因此该话术中的“今天”应按 **2026-03-06（Asia/Singapore）** 解释。

## 建议返回格式

建议 msgcode 最终回复用户：

```text
今天（2026-03-06）我在 Gmail 收件箱中发现 4 封新邮件：

1. 发件人：Alice
   主题：Q1 合同修订版
   时间：09:12
   摘要：请确认第 3 条付款条件...

2. 发件人：Google
   主题：Security alert
   时间：08:41
   摘要：A new sign-in on your account...

如需，我可以继续只读展开其中某一封邮件内容。
```

## 冒烟测试定义

### 正向冒烟

前置条件：

1. PinchTab 已启动
2. 共享工作 Chrome 上下文中的 Gmail profile 已登录
3. 收件箱中确有当天邮件

输入：

> 帮我打开 Gmail，查看我今天的新邮件信息。

预期：

1. 返回“今日邮件摘要”
2. 不触发副作用
3. evidence 目录存在

### 失败冒烟 1：未登录

前置条件：

1. profile 未登录 Gmail

预期：

1. 返回 `GMAIL_LOGIN_REQUIRED`
2. 不编造邮件内容
3. 保留登录页证据

### 失败冒烟 2：站点结构变化

前置条件：

1. Gmail 页面结构导致现有定位策略失效

预期：

1. 返回 `BROWSER_SITE_CHANGED` 或等价错误
2. 不继续执行猜测式提取

## 对实现方案的影响

这条场景意味着第一版 browser 域不能只做：

1. `open`
2. `click`
3. `type`

还必须补：

1. `snapshot`
2. `text`
3. 登录态检测
4. 只读结果摘要
5. evidence bundle

## 推荐 MVP 边界

第一版只承诺：

1. Gmail 已登录前提下的“今日新邮件只读摘要”
2. 不支持回复/发送
3. 不支持自动登录
4. 不支持多邮箱自动切换

## Evidence

- Docs: `AIDOCS/msgcode-2.1/browser_automation_spec_v2.1.md`
- Docs: `AIDOCS/skills/browser/SKILL.md`
- Docs: `AIDOCS/notes/pinchtab-agent-integration-260306.md`
- Code: `src/tools/bus.ts`
- Code: `src/tools/types.ts`
- Code: `src/skills/registry.ts`
