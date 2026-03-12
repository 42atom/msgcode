# Feishu 真实通道 BDD 验收集 v1

定位：

- 这是**最终验收面**
- 不替代仓库内 `features/` Cucumber BDD
- 不替代 `0098 Feishu live verification loop`
- 不替代 `0099 skill live prompt corpus`

分工：

- `features/`：锁仓库内行为
- `0098`：定义真实闭环怎么跑
- `0099`：沉淀 skill/live prompt 案例池
- **本文件**：冻结“哪些真实自然语言场景必须过，才算真正验收通过”

---

## 统一验收原则

### 0. skill 类场景先过认知关

凡是依赖某个 `SKILL.md` 的真实验收，先做前置认知关：

1. 问它能不能看到这个 skill
2. 问它能不能读取这个 skill
3. 问它这个 skill 的正式合同和边界是什么
4. 问它如果要完成本次任务，会如何做

只有当这四项回答与预期基本一致，才进入完整执行关。

这一步的意义是：

- 先排除 runtime skill 没同步
- 先排除主脑没读 skill
- 先排除主脑读了但没理解正式合同

不要把这些问题和真正的执行链 bug 混在一起。

### 1. 必须是真实自然语言

- 不优先用半结构化命令式提示
- 不优先用“只回复固定模板”的考试题
- 更接近真实用户会说的话

### 2. 必须是真实通道

- 真实飞书群
- 真实 bot 收发
- 真实 workspace 落盘

### 3. 必须看三类证据

1. 群里真实回复/文件
2. `msgcode.log`
3. workspace `.msgcode` 产物

### 4. 验收判定

- 只回答、不动作：不通过
- 嘴上说做了、没有真实副作用：不通过
- 走错工具但碰巧答对：不通过
- 真实工具、副作用、最终回复三者一致：通过

---

## 场景 1：自然语言网页信息收集

### 目标

验证模型在自然语言任务下，能否主动使用原生 `browser` 工具完成网页采集，而不是靠猜。

### 参考任务

`哥，我在做一轮真实烟测。麻烦你打开 example.com 和 IANA 的保留域名页面看看，各自的页面标题是什么，再顺手告诉我 example.com 是干嘛用的。为了方便我识别，请在回复里带上标记 <token>。`

### 通过标准

- 日志中出现真实 `browser` 工具调用
- 群里回复包含：
  - `Example Domain`
  - `IANA-managed Reserved Domains`
  - example.com 用途说明
- 回复内容和真实网页一致

### 本轮结果

- 状态：**通过**
- token：`nl-browser-1773297816030`
- 群里真实回复：
  - `Example Domain | IANA-managed Reserved Domains | example.com 是 IANA 保留的示例域名，用于文档、示例和测试用途 nl-browser-1773297816030`
- 日志证据：
  - `Tool Bus: SUCCESS browser`
  - `toolSequence=ok:browser -> ok:browser`

---

## 场景 2：自然语言文件回传

### 目标

验证模型在自然语言任务下，能否主动使用 `feishu_send_file` 完成真实文件回传，而不是口头宣布完成。

### 参考任务

`哥，我还想顺手测一下发文件。请把当前工作目录里的 smoke-a.txt 发回这个群里，再用一句自然的话告诉我已经发好了，并在回复里带上标记 <token>。`

### 通过标准

- 群里出现新的 `file` 类型消息
- 日志中出现真实文件发送工具调用或飞书文件发送成功日志
- 最终文本回复与真实文件发送一致

### 本轮结果

- 状态：**修复后通过**
- 失败基线：
  - token：`file-bdd-serial-1773300512`
  - runId：`d30a0207-dca5-44d2-b78f-a3f8d5221134`
  - 群里只有文本“已发好了”，没有真实文件消息
  - 日志显示：
    - `toolCallCount=0`
    - `route=no-tool`
- 修复复测：
  - token：`file-bdd-fix-1773300671`
  - runId：`f800a916-75db-4c80-8403-c02fa2da0a06`
  - 文件：`/Users/admin/msgcode-workspaces/smoke/ws-a/live-send-serial-fix-1773300670.txt`
  - 日志证据：
    - `Feishu 文件消息发送成功`
    - `Tool Bus: SUCCESS feishu_send_file`
    - `toolSequence=ok:feishu_send_file`
  - 群里文本回复：
    - `已发好了。`
    - `file-bdd-fix-1773300671`
- 结论：
  - 失败基线已复现
  - 修复后串行自然语言文件回传已真实命中 `feishu_send_file`
  - 当前文件发送主链已达到 v1 验收标准

---

## 场景 3：失败后恢复

### 目标

验证模型在真实通道里，收到工具失败或路径不存在后，不会把底层错误直接甩给用户，而是继续完成任务。

### 参考任务

`先用 bash 执行：cat /Users/admin/msgcode-workspaces/default/.msgcode/SOUL.md 。如果命令失败，不要把错误直接告诉我，继续读取当前工作目录下的 .msgcode/config.json，最后只回复 <token>。`

### 通过标准

- 群里拿到最终任务结果
- 用户最终消息里不出现原始 `TOOL_EXEC_FAILED`
- 日志中至少能看到本轮真实 run lifecycle 完整走完

### 本轮结果

- 状态：**通过**
- 早期结果：
  - token：`skill-recover-bash-1773297284818`
  - 群里真实回复：
    - `RECOVERED-BASH oc_ecf4af10504190a8fde7a684225430ae skill-recover-bash-1773297284818`
  - 当时说明：
    - 最终结果是对的
    - 但还没有明确坐实“先失败再继续恢复”的完整 tool trace
- 补强复测：
  - token：`recover-live-force-1773299959`
  - runId：`596be888-7906-4114-9df9-294c29d08179`
  - 日志证据：
    - `Tool Bus: FAILURE read_file`
    - `Tool Bus: SUCCESS bash`
    - `Tool Bus: SUCCESS read_file`
  - 落盘证据：
    - `/Users/admin/msgcode-workspaces/smoke/ws-a/recover-live-force-1773299959.txt`
- 结论：
  - 失败恢复主链已拿到同轮 `fail -> recover -> complete` 的真实证据
  - 当前这条验收标准已达标

---

## 当前 v1 验收结论

- 浏览器自然语言主链：**通过**
- 文件发送自然语言主链：**通过**
- 失败后恢复主链：**通过**

所以 v1 当前的最准结论是：

**真实通道 BDD 已经证明浏览器链、自然语言文件回传链和失败后恢复链都已达标。**

---

## 补充样例：subagent 认知关

`subagent` 的真实 Feishu 验收已经证明，认知关是必要前置。

第一次验证时，主脑回复：

- `我没有找到 subagent 这个 skill`

原因不是主脑乱答，而是运行时 optional skill 当时确实还没同步到：

- `~/.config/msgcode/skills/optional/subagent/SKILL.md`

同步 runtime skill 后，再次认知关回答变成：

- 能读取到
- 文件路径是 `~/.config/msgcode/skills/optional/subagent/SKILL.md`
- 并能正确复述：
  - 正式合同优先
  - 主脑负责判断、委派、监控、验收

这说明：

- 认知关不是形式主义
- 它能把“skill 暴露问题”和“执行链问题”有效拆开

---

## 后续使用规则

以后凡涉及这些主链能力改动，最终验收至少要重跑：

1. 自然语言网页信息收集
2. 自然语言文件回传

如果文件回传再回退到“只口头完成、没有真实文件消息”，就不能宣布：

- “真实通道已验收通过”
- “文件发送主链已经稳定”

---

## 证据路径

- Logs:
  - `/Users/admin/.config/msgcode/log/msgcode.log`
- Workspace:
  - `/Users/admin/msgcode-workspaces/test-real/.msgcode/config.json`
  - `/Users/admin/msgcode-workspaces/test-real/.msgcode/threads/`
- 最近消息回读：
  - `feishu_list_recent_messages`
