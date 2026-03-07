# 任务单：P5.7-R7B（Gmail 只读验收）

Issue: 0004
Plan: docs/design/plan-260306-web-transaction-platform-core.md

优先级：P1
建议分支：`codex/p5-7-r7b-gmail-readonly`
派发对象：执行线程（实现）
验收对象：当前线程（评审/验收）

## 任务一句话

基于已完成的 PinchTab Browser Core，用**共享工作 Chrome 上下文中的已登录 profile** 跑通 Gmail 收件箱只读摘要，完成首条真实浏览器业务验收。

## 背景与冻结结论

0. 产品公理（继承 0004）：
   - Chrome 中的每个 profile 都是一个可长期复用的人机共用工作上下文
   - 用户日常主浏览器是 Safari；Chrome 全部归工作自动化域
   - 不再使用 Chrome 官方默认数据根目录；默认改为 msgcode 工作目录下的非默认 Chrome 数据根
1. `R7A / PinchTab Browser Core` 已验收通过。
2. 用户已明确：
   - 平时主用 Safari
   - 整套 Chrome 作为人机共用的工作浏览器
   - 用户与 agent 在同一工作 Chrome 上下文中接力
   - 用户可以提前在 headed 模式登录 Gmail，后续交给 agent 复用
3. 本轮目标不是继续抽象平台，而是拿 Gmail 做第一条真实只读业务验证。

参考真相源：
- `issues/0004-web-transaction-platform-core.md`
- `docs/design/plan-260306-web-transaction-platform-core.md`
- `AIDOCS/notes/gmail-readonly-browser-acceptance-260306.md`
- `docs/notes/research-260306-pinchtab-validation.md`

## 目标（冻结）

1. 使用显式 `profileId` 启动共享工作 Chrome 上下文中已登录 Gmail 的 PinchTab instance。
2. 打开 Gmail 收件箱。
3. 在只读前提下提取“今天的新邮件”。
4. 返回中文结构化摘要。
5. 对未登录/登录失效场景返回明确错误，不编造结果。

## 非目标（冻结）

1. 不做自动登录。
2. 不做验证码绕过。
3. 不做发送、回复、归档、删除、标记已读、星标。
4. 不做平台级 `waiting-human-login / pause / resume`。
5. 不做通用 mail.pack 抽象扩张。
6. 不做其他站点（社媒、电商）业务流。

## 核心约束

1. 必须显式 `profileId`
2. 必须显式 `instanceId`
3. 必须显式 `tabId`
4. 必须只读
5. 不得通过“猜页面”编造邮件内容
6. 默认理解为“共享工作 Chrome 上下文”，不是“另起一套与用户割裂的 agent profile”
7. 默认 Chrome 数据根应来自 msgcode 工作目录内的非默认路径，而不是官方默认根目录

## 建议实现口径

允许实现为最小业务模块，但不要做成重平台抽象。推荐：

1. 新增一个最小 Gmail 只读模块
2. 输入：
   - `profileId`
   - 可选 `mode=headless|headed`
   - 日期口径默认 `Asia/Singapore` 的当天
3. 输出：
   - `count`
   - `messages[]`
   - 每条至少包含：
     - `sender`
     - `subject`
     - `time`
     - `snippet`

## 范围

- `/Users/admin/GitProjects/msgcode/src/browser/` 或等价位置（新增 Gmail 只读模块）
- `/Users/admin/GitProjects/msgcode/src/cli/`（若增加最小验收命令）
- `/Users/admin/GitProjects/msgcode/test/*p5-7-r7b*`
- `/Users/admin/GitProjects/msgcode/issues/0004-web-transaction-platform-core.md`（回写证据）
- `/Users/admin/GitProjects/msgcode/README.md`（若需最小同步）

## 实现顺序

1. 先确认 Gmail 收件箱页面识别条件
2. 再补未登录/登录页识别
3. 再实现“今天的新邮件”提取逻辑
4. 最后补只读 smoke 与失败 smoke

## 硬验收（必须全过）

1. `npx tsc --noEmit`
2. `npm test`
3. `npm run docs:check`
4. 真实成功证据：
   - 使用已登录 profile 成功进入 Gmail inbox
   - 成功提取今日邮件摘要
5. 真实失败证据：
   - 未登录或登录失效时返回明确错误（如 `GMAIL_LOGIN_REQUIRED`）
6. 无新增 `.only/.skip`

## 已知坑

1. Gmail DOM/可访问树会变，优先依赖 snapshot/text 真实结构，不要硬编码过多 fragile selector
2. 不能把登录页误当 inbox
3. 不能为了“拿到内容”而点击邮件导致状态变化
4. 不要把这轮实现扩成通用 mail 平台

## 交付后由当前线程验收重点

1. 是否真的只读
2. 是否未登录 fail-closed
3. 是否显式使用 profile/instance/tab
4. 是否没有借机做过度抽象
