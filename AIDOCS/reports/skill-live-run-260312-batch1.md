# Skill Live Run Batch 1

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
- 每条完成后冷却 4 秒
- 使用真实 Feishu transport 出站
- 用 `listener.handleMessage()` 注入入站，避免 UI 自动化噪音
- 打开 debug 观测：
  - `LOG_LEVEL=debug`
  - `DEBUG_TRACE=1`
  - `MSGCODE_LOG_PLAINTEXT_INPUT=1`

## 结果总览

| Case | 目标 | 用时 | 结果 | 关键结论 |
|---|---:|---:|---|---|
| `skill-live-01` | 纯问答 | `3028ms` | 部分通过 | 主链通，但模型没有严格按 token 回显 |
| `skill-live-02` | 文件创建 | `7089ms` | 通过 | `bash + read_file` 主链有效，真实文件已落盘 |
| `skill-live-03` | 文件回传 | `5537ms` | 失败 | 模型走了 `bash`，没走 `feishu_send_file` |
| `skill-live-05` | 浏览器标题 | `29005ms` | 失败 | 模型先读 skill，但仍走 `bash`，未走 `browser` 工具；且超过回执阈值 |

## 详细结果

### skill-live-01

- Prompt:
  - `请只回复 TEST-OK skill-live-01-135535，不要多说。`
- 日志：
  - 收到消息：`inboundText="请只回复 TEST-OK skill-live-01-135535，不要多说。"`
  - `agent request completed`
  - `消息处理完成`
- 群里真实回复：
  - `TEST-OK synthetic-skill-live-01-135535`
- 判断：
  - **主链通过**
  - **提示词遵循未严格通过**
- 结论：
  - 这是模型遵循问题，不是运行时故障。

### skill-live-02

- Prompt:
  - `在当前工作目录创建 smoke-a.txt，内容是 smoke-file-ok-skill-live-02-143160。完成后只回复 smoke-a.txt skill-live-02-143160。`
- 工具轨迹：
  - `Tool Bus: SUCCESS bash`
  - `Tool Bus: SUCCESS read_file`
- 群里真实回复：
  - `smoke-a.txt skill-live-02-143160`
- 产物：
  - 文件：`/Users/admin/msgcode-workspaces/test-real/smoke-a.txt`
  - 内容：`smoke-file-ok-skill-live-02-143160`
- 判断：
  - **通过**

### skill-live-03

- Prompt:
  - `把当前工作目录里的 smoke-a.txt 发回群里，并附一句“FILE-SENT skill-live-03-154598”。不要解释。`
- 工具轨迹：
  - `Tool Bus: SUCCESS read_file`
  - `Tool Bus: FAILURE bash`
- 群里真实回复：
  - 工具失败错误文本
- 未见：
  - `feishu_send_file` 成功调用
  - 群里文件消息
- 日志错误：
  - `ERR_MODULE_NOT_FOUND`
  - 来源为 `bash` 路径，不是原生 `feishu_send_file`
- 判断：
  - **失败**
- 结论：
  - 当前 skill/提示链仍把模型推向 `bash + CLI`，而不是 `feishu_send_file` 原生工具。

### skill-live-05

- Prompt:
  - `打开浏览器访问 https://example.com ，只回复页面标题和 skill-live-05-164581。`
- 关键现象：
  - 约 `10.5s` 后触发回执：`嗯，等下…`
  - 总耗时：`29005ms`
- 工具轨迹：
  - `Tool Bus: SUCCESS read_file`
  - `Tool Bus: FAILURE bash`
  - `finish supervisor reviewed [reason=浏览器访问工具执行失败（缺少tsx包），需修复环境问题后重试完成 skill-live-05-164581 任务]`
  - 最终仍以 `bash` 失败结束
- 未见：
  - `browser` 工具成功调用
- 判断：
  - **失败**
- 结论：
  - 浏览器 skill 说明书虽然被读到了，但模型仍偏向 `bash` 路线。
  - 这条失败更像“skill 引导不够强 + CLI/bash 路径环境不稳”的组合问题。

## 观察

### 1. 串行与间隔是必要的

本轮采用：

- 单聊天串行
- 每条冷却 4 秒

这是正确的。否则：

- 纯问答、文件、浏览器的时延差异会互相覆盖
- 回执消息可能与后续 case 混淆
- 群里结果难以归因

### 2. 重 case 应单独成组

浏览器 case 耗时显著更长，并触发了回执机制。  
后续建议：

- 纯问答 / 文件动作：可放一组
- 浏览器 / 多步工具 / 多模态：单独一组

### 3. 失败主要不是“系统完全不通”

当前失败分两类：

- `skill-live-01`
  - 主链通
  - 只是回复不够严格
- `skill-live-03` / `skill-live-05`
  - 真实问题是模型仍偏向 `bash + CLI`
  - 没有优先走原生工具 `feishu_send_file` / `browser`

## 建议下一步

1. 收紧相关 skill 文案
   - 尤其是 `feishu-send-file`
   - 明确写“优先直接调用原生工具，不要走 bash 包装 CLI”
2. 为 `browser` skill 增加更强的“先用 browser 工具”的指引
3. 固定两类批次：
   - `fast batch`: 文本 / file / todo / memory
   - `heavy batch`: browser / schedule / multimodal
4. 下轮继续跑：
   - `skill-live-03` 修正文案后重测
   - `skill-live-05` 修正文案后重测

## 证据

- Logs:
  - `/Users/admin/.config/msgcode/log/msgcode.log`
- Workspace:
  - `/Users/admin/msgcode-workspaces/test-real`
- Corpus:
  - `/Users/admin/GitProjects/msgcode/AIDOCS/prompts/skill-live-prompt-corpus-v1.md`
