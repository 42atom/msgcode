# Feishu Live Verification Loop 固化方案

Issue: 0098

## Problem

当前仓库已经有大量单测、回归测试和 mock，但真正跨边界的运行时验证仍然容易漂：

- 只看本地函数返回值，不足以证明消息真的进了飞书群
- 只看 bot API 出站，不足以证明真实用户入站主链可用
- 只看 transport 层，不足以证明 workspace/session/thread 等本地状态真的落盘

本轮已经证明，`msgcode` 可以用一条非常薄的真实闭环验证这三件事：

1. 真实飞书用户消息入站
2. workspace/session/thread 落盘
3. 真实飞书消息出站并被群聊查询命中

这套方法足够接近生产，又不需要增加新的控制层，因此应该被固定为后续默认的 live smoke 方法。

## Occam Check

1. 不加它，系统具体坏在哪？
   - 每次做“真实测试”都会临时选择不同入口：有人看日志、有人只发 API、有人想去控桌面客户端。结果是方法漂移，证据口径不统一，难以比较，也难以复用到模型能力测试。
2. 用更少的层能不能解决？
   - 能。直接复用现有 Feishu transport、现有日志、现有 workspace 落盘、现有最近消息查询；不需要新增测试平台，不需要新的编排层。
3. 这个改动让主链数量变多了还是变少了？
   - 变少了。把“真实测试怎么做”的分叉收口成一条默认路径：真实用户消息/真实 bot 回复/真实本地状态三段式验证。

## Decision

采用 **`Feishu live verification loop` 作为默认真实测试方法**。

这套方法的标准闭环是：

1. **真实入站**
   - 由真实飞书用户发送消息
   - 命中 Feishu WS 入站事件
2. **本地状态**
   - 验证 route/workspace/session/thread 的实际落盘
3. **真实出站**
   - 由 bot 真实发回消息或文件
   - 再通过最近消息查询或人工可见确认命中

同时冻结两个边界：

- 不把 **API-only 发送** 误当成完整 live loop
- 不优先做 **Feishu Electron UI 自动化**

推荐顺序是：

- 人工或 Feishu Web 发用户消息
- 日志 + workspace 验证中段
- bot 真实回复 + 最近消息查询确认末段

## Alternatives

### 方案 A：只用 mock / 单测

- 优点：快
- 缺点：不能证明跨边界主链真实可用

### 方案 B：只用 bot API 自发消息

- 优点：实现简单
- 缺点：不能覆盖真实 `sender_type=user` 入站，不是完整 transport 验证

### 方案 C：控制 Feishu Electron 桌面 App

- 优点：更接近用户点击行为
- 缺点：太重、太脆、维护成本高，不符合当前“做薄”原则

### 方案 D：真实飞书 live verification loop（推荐）

- 优点：足够接近生产；复用现有主链；证据清晰；可继续扩展为能力测试
- 缺点：执行比纯 mock 慢，需要真实群和 bot 凭据

## Decision Scope

这套方法默认用于两类场景：

1. **重构后的真实冒烟**
   - 验证 transport、route、workspace、reply 主链没有虚通
2. **大模型能力测试**
   - 在真实通道里验证：
     - 纯问答
     - 文件写入
     - 文件回传
     - 工具调用
     - 浏览器/多模态/调度等能力

## 标准执行顺序

### Phase 1：最小闭环确认

目标：确认真实群、真实 bot、真实 workspace 都通

最小步骤：

1. 在目标群执行 `/bind <workspace>`
2. 发送一条短文本（例如：`就是我`）
3. 确认：
   - `listener` 收到消息
   - `.msgcode/config.json` 已存在
   - session/thread 已落盘
   - bot 有真实回复

### Phase 2：真实出站确认

目标：确认 bot 真实发送进入群聊，而不只是本地返回 `ok`

最小步骤：

1. 用仓库主链发送实现发送一条带唯一 token 的文本
2. 用最近消息查询回读群聊
3. 命中同一 token

### Phase 3：能力冒烟

推荐默认三段式：

1. **纯问答**
   - 例如：`请只回复 TEST-OK`
2. **文件动作**
   - 例如：`在当前工作目录创建 smoke-a.txt，内容是 smoke-file-ok`
3. **文件回传**
   - 例如：`把 smoke-a.txt 发回群里`

若三段都通过，说明：

- 文本链通
- workspace 文件链通
- Feishu 附件链通

## 当前已验证样本

- `chatId`: `oc_ecf4af10504190a8fde7a684225430ae`
- `workspace`: `/Users/admin/msgcode-workspaces/test-real`
- `sender open_id`: `ou_0443f43f6047fd032302ba09cbb374c3`

已验证事件：

1. 用户发送 `"就是我"`
2. `listener` 收到并处理
3. workspace 初始化落盘：
   - `.msgcode/config.json`
   - `.msgcode/sessions/*.jsonl`
   - `.msgcode/threads/*.md`
4. `bash` 真实发送：
   - `[codex-bash] 真实飞书发送测试 live-smoke-20260312-111617`
5. 最近消息查询命中同一 token

## 证据口径

默认同时看三类证据：

1. **Logs**
   - `/Users/admin/.config/msgcode/log/msgcode.log`
2. **Workspace Artifacts**
   - `<workspace>/.msgcode/config.json`
   - `<workspace>/.msgcode/sessions/*.jsonl`
   - `<workspace>/.msgcode/threads/*.md`
3. **Channel Result**
   - 群里可见回复
   - 或最近消息查询命中唯一 token

## 不做的事

- 不为这套测试新增独立控制面
- 不优先控制 Feishu Electron 桌面客户端
- 不把 bot 自己 API 发送当成完整入站验证
- 不在没有真实群上下文时伪造“通过”结论

## Plan

- [x] 冻结 `Feishu live verification loop` 作为默认真实测试方法
- [x] 明确最小三段式闭环与证据口径
- [x] 明确它既服务重构 smoke，也服务模型能力测试
- [ ] 后续按需要再补最薄脚本化入口（可选，不是本轮前置）

## Risks

### 风险 1：把 API-only 发送误判成完整真实测试

回滚/降级：
- 明确区分“真实出站验证”与“完整 live loop”
- 完整验证必须包含真实用户入站

### 风险 2：只看群里肉眼结果，不看本地落盘

回滚/降级：
- 默认同时检查日志和 `.msgcode` 产物

### 风险 3：后续又退回各测各的临时方法

回滚/降级：
- 以后凡讨论“真实测试怎么跑”，统一引用本 Plan

（章节级）评审意见：[留空,用户将给出反馈]
