# Skill Live Run Batch 2

日期：2026-03-12

环境：

- workspace: `/Users/admin/msgcode-workspaces/test-real`
- chatId: `oc_ecf4af10504190a8fde7a684225430ae`
- sender open_id: `ou_0443f43f6047fd032302ba09cbb374c3`
- backend: `api`
- api-provider: `minimax`

执行策略：

- 单聊天串行执行
- 每条 case 唯一 token
- 每条完成后冷却 `4s`
- 继续使用 `listener.handleMessage()` 注入入站，避免 UI 自动化噪音
- 继续使用真实 Feishu sendClient 出站
- 打开 debug 观测：
  - `LOG_LEVEL=debug`
  - `DEBUG_TRACE=1`
  - `MSGCODE_LOG_PLAINTEXT_INPUT=1`

---

## 阶段 A：skill 文案 + runtime index 收紧后复测

### 结果

| Case | 用时 | 结果 | 关键结论 |
|---|---:|---|---|
| `skill-live-03-rerun2` | `12231ms` | 失败 | 仍走 `bash`，stderr 明确是 `/bin/sh: feishu_send_file: command not found` |
| `skill-live-05-rerun2` | `18781ms` | 失败 | 不再乱走 `bash`，但直接 `route=no-tool`，回复“当前无可用浏览器工具” |

### 关键发现

这轮失败没有继续证明“skill 引导一定无效”，而是暴露出一个更硬的测试干扰项：

- `test-real` 的 raw workspace 配置只有：
  - `runtime.current_transport`
  - `runtime.current_chat_id`
  - `runtime.current_chat_guid`
- 运行时实际暴露给 LLM 的工具面只有：
  - `read_file`
  - `bash`

证据：

- Code:
  - `/Users/admin/msgcode-workspaces/test-real/.msgcode/config.json`
  - `/Users/admin/GitProjects/msgcode/src/agent-backend/tool-loop.ts#getToolsForLlm`
- Logs:
  - `skill-live-03-rerun2` 最终错误：
    - `/bin/sh: feishu_send_file: command not found`
  - `skill-live-05-rerun2` 最终回复：
    - `当前无可用浏览器工具，无法执行此操作。`

### 判断

阶段 A 的结论不是“改说明书没用”，而是：

- `skill-live-03` 仍有真实提示纠偏问题
- `skill-live-05` 已经不该继续按“模型乱走 bash”归因，因为这轮浏览器工具根本没暴露

---

## 阶段 B：显式打开测试 workspace 工具面后复测

在 `test-real` 里显式设置：

```json
"tooling.allow": ["read_file", "bash", "feishu_send_file", "browser"]
```

之后继续跑同两条 case。

### 结果

| Case | 用时 | 结果 | 关键结论 |
|---|---:|---|---|
| `skill-live-03-rerun3` | `24494ms` | 通过 | 已真实命中 `feishu_send_file`，文件上传与发送成功 |
| `skill-live-05-rerun3` | `26315ms` | 通过 | 已真实命中 `browser` 两次，最终正确返回 `Example Domain` |

### skill-live-03-rerun3

- Prompt:
  - `把当前工作目录里的 smoke-a.txt 发回群里，并附一句“FILE-SENT skill-live-03-rerun3-1773287311711”。不要解释。`
- 工具轨迹：
  - `Tool Bus: SUCCESS read_file`
  - `Tool Bus: SUCCESS feishu_send_file`
- 关键日志：
  - `Feishu 文件发送开始`
  - `Feishu 文件上传成功`
  - `Feishu 文件消息发送成功`
- 群里最近消息查询：
  - 命中 `FILE-SENT skill-live-03-rerun3-1773287311711`
- 判断：
  - **通过**

### skill-live-05-rerun3

- Prompt:
  - `打开浏览器访问 https://example.com ，只回复页面标题和 skill-live-05-rerun3-1773287311712。`
- 工具轨迹：
  - `Tool Bus: SUCCESS browser`
  - `Tool Bus: SUCCESS browser`
- 群里最近消息查询：
  - `Example Domain skill-live-05-rerun3-1773287311712`
- 判断：
  - **通过**

---

## 结论

### 1. 这轮改动方向是对的

在：

- skill 文案收紧
- runtime index 对齐
- tool-loop 补最小 `[原生工具优先]` 提示

之后，模型已经能在真实群里正确走：

- `feishu_send_file`
- `browser`

### 2. 前一轮 live 失败里混进了“工具面没开”的干扰项

尤其是浏览器 case：

- 阶段 A 失败不是“模型仍乱走 bash”
- 而是测试 workspace 根本没暴露 `browser`

所以后续做 capability live test 时，必须先明确测试 workspace 的 `tooling.allow`。

### 3. 串行和冷却策略仍然必要

这轮继续证明：

- 单聊天串行
- 每条 case 唯一 token
- 每条完成后冷却 `4s`

是必要的。否则：

- 长任务回执会和后续 case 混淆
- 浏览器与文件发送的长耗时会污染归因

---

## 建议下一步

1. 以后跑 `skill-live-03` / `skill-live-05` 前，先确保测试 workspace 已显式开放对应工具面。
2. 把这次结论回写到 `0100`，作为“skill-only 不够时，最小执行核提示是允许的”证据。
3. 后续若继续扩 capability live test，先按能力分组：
   - `fast batch`: 文本 / file / todo / memory
   - `heavy batch`: browser / 多步工具 / 多模态

---

## 证据

- Logs:
  - `/Users/admin/.config/msgcode/log/msgcode.log`
- Workspace:
  - `/Users/admin/msgcode-workspaces/test-real/.msgcode/config.json`
- Code:
  - `/Users/admin/GitProjects/msgcode/src/agent-backend/tool-loop.ts`
  - `/Users/admin/GitProjects/msgcode/src/skills/runtime/feishu-send-file/SKILL.md`
  - `/Users/admin/GitProjects/msgcode/src/skills/runtime/patchright-browser/SKILL.md`
- Corpus:
  - `/Users/admin/GitProjects/msgcode/AIDOCS/prompts/skill-live-prompt-corpus-v1.md`
