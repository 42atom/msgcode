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

- 状态：**失败**
- token：`nl-file-1773297850426`
- 群里文本回复：
  - `已把 smoke-a.txt 发回群里了 nl-file-1773297850426`
- 失败证据：
  - 最近消息回读里**没有新的 `file` 类型消息**
  - 日志显示：
    - `toolCallCount=0`
    - `route=no-tool`
- 结论：
  - 这是典型的“口头完成、没有真实副作用”
  - 当前 `feishu_send_file` 的自然语言触发仍未达标

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

- 状态：**部分通过**
- token：`skill-recover-bash-1773297284818`
- 群里真实回复：
  - `RECOVERED-BASH oc_ecf4af10504190a8fde7a684225430ae skill-recover-bash-1773297284818`
- 说明：
  - 最终结果是对的
  - 用户没有直接看到底层错误
  - 但当前证据还没有明确坐实“先失败再继续恢复”的完整 tool trace
  - 后续需要专门设计更强约束 case 补足这条证据

---

## 当前 v1 验收结论

- 浏览器自然语言主链：**通过**
- 文件发送自然语言主链：**失败**
- 失败后恢复主链：**方向正确，但证据仍需补强**

所以 v1 的最准结论是：

**真实通道 BDD 已经证明浏览器链基本达标，但 `feishu_send_file` 在自然语言场景下仍未达标。**

---

## 后续使用规则

以后凡涉及这些主链能力改动，最终验收至少要重跑：

1. 自然语言网页信息收集
2. 自然语言文件回传

如果文件回传没过，就不能宣布：

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
