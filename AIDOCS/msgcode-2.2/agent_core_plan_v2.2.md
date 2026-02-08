# Agent Core Plan（v2.2）

> 目标：用最小内核统一 msgcode 的工具调用、上下文记忆与可控执行。

---

## 1. 设计原则

一句话：**极简内核 + 可插拔能力 + 文件即真相源。**

- 内核只做三件事：消息循环、工具执行、上下文压缩。
- 复杂能力（TTS/ASR/OCR/GUI）通过 Tool Bus 和 Skills 组合，不侵入内核。
- 配置、技能、会话状态全部落盘，支持审计和回放。

---

## 2. 五点收口（最终口径）

### 2.1 主循环（Tool Loop）

标准流程：
1. 组装上下文（system + summary + recent turns + current user）
2. 调用模型（允许 tools）
3. 若有 tool_calls：执行工具并回灌 role=tool
4. 二次调用生成最终答复
5. 写入会话日志并更新统计

约束：
- 所有工具调用必须经过 `src/tools/bus.ts`
- 第二轮只允许总结，不再次扩散工具调用

### 2.2 最小工具集（内核）

内核级工具固定为：
- `read_text_file`
- `bash`
- `edit_text_file`
- `write_text_file`

说明：
- 媒体能力（tts/asr/vision）保留在 Tool Bus 侧，作为业务工具，不污染内核抽象。
- 任何新增工具先评估能否由 `bash` 组合实现，避免重复造轮子。

### 2.3 会话记忆层（短期 + 压缩）

采用双层：
- 短期窗口：最近多轮原始消息（user/assistant/tool）
- 压缩摘要：旧消息结构化摘要（目标/约束/关键决策/待办）

存储：
- `<WORKSPACE>/.msgcode/sessions/<chatId>.jsonl`（原始轮次）
- `<WORKSPACE>/.msgcode/sessions/<chatId>.summary.md`（压缩摘要）

规则：
- 超预算优先压缩旧聊天，不先删工具结果。
- 工具结果必须保留可追溯字段（tool、requestId、artifact path）。

### 2.4 Skills（按需加载）

索引进入系统提示，详情按需加载：
- 系统提示仅放 `name + description + path`
- 命中后再 `read SKILL.md`

目录：
- `~/.config/msgcode/skills/<skillId>/SKILL.md`

执行规则：
- skill 只描述流程，不直接绕过 Tool Bus。
- skill 副作用等级必须声明（read-only/local-write/message-send/process-control/ui-control）。

### 2.5 干预机制（Steer / FollowUp）

在现有 `/esc` 基础上补齐两类队列：
- `steer`：紧急转向（当前工具结束后立即注入，跳过剩余工具计划）
- `followUp`：轮后消息（当前轮完整结束后再处理）

命令建议（规划态）：
- `/steer <msg>`
- `/next <msg>`

---

## 3. 分层抽象（准备落地）

### L1 Input Layer
- 统一输入为 `Evidence[]`（text/image/audio）。

### L2 Capability Registry
- 声明模型能力矩阵（chat/tool_calls/vision/audio）。

### L3 Provider Layer
- 接口统一：`chat()`、`toolLoop()`、`multimodalChat()`。
- 当前 provider：lmstudio / mlx（后续 llmcpp）。

### L4 Orchestrator Layer
- 负责路由和策略，不直接执行副作用。

### L5 Tool Bus & Telemetry
- 唯一副作用闸门 + 结构化观测（成功率/耗时/错误码）。

---

## 4. 实施顺序（建议）

### 第 1 批：会话窗口记忆 ✅ 已落地

**目标**：解决 MLX provider 多轮记忆缺失

**交付物**：
- `src/session-window.ts` - 窗口内存模块
  - `loadWindow()` - 从 jsonl 加载历史
  - `appendWindow()` - 追加消息到 jsonl
  - `buildWindowContext()` - 构建带裁剪的上下文
  - `pruneWindow()` - 按条数裁剪（默认 20）
- `src/providers/mlx.ts` - 集成窗口内存
  - `runMlxChat` 和 `runMlxToolLoop` 都使用同一窗口
  - 每轮后写回 assistant/tool 消息
  - 存储：`<workspace>/.msgcode/sessions/<chatId>.jsonl`
- `test/context.session-window.test.ts` - BDD 测试覆盖

**验收**：
- ✅ 连续两轮问答，第二轮能引用第一轮信息
- ✅ Tool loop 后，下一轮可读到工具结果摘要
- ✅ 超过 maxMessages (20) 时会裁剪，不报错
- ✅ 回归测试：`npm run docs:check && npm test && npm run bdd` 全部通过

**限制**：
- 仅支持 MLX 路径（lmstudio 未接入）
- 不含 token 预算与摘要压缩（第 2 批）
- 不改默认 runner/mode

### 第 2 批：预算层 ✅ 已落地

**目标**：引入按模型能力分配上下文预算的基础设施

**交付物**：
- `src/capabilities.ts` - 预算目标分类（BudgetTarget）
  - `getCapabilities(target)` - 获取模型能力
  - `getInputBudget(target)` - 计算输入预算（contextWindow - reservedOutput）
  - MLX 默认：contextWindow=16384, reservedOutput=2048
- `src/budget.ts` - 预算分配与裁剪
  - `computeInputBudget(caps)` - 计算输入预算
  - `allocateSections(inputBudget)` - 分区预算（system 10%, summary 20%, recent 50%, current 20%）
  - `trimMessagesByBudget(messages, budget)` - 按预算裁剪消息
  - `estimateMessageTokens(msg)` - 字符数近似 token 估算
- `src/providers/mlx.ts` - 集成预算层
  - `applyBudgetTrim()` - 应用预算裁剪（回退到 count-based）
  - 超预算时优先裁剪旧 assistant/user，保留最近 user 与 tool 结果
- `test/context.budget.test.ts` - BDD 测试覆盖

**验收**：
- ✅ 预算计算正确（16384 - 2048 = 14336）
- ✅ 分区比例正确（system 10%, summary 20%, recent 50%, current 20%）
- ✅ 超预算裁剪顺序符合预期（优先保留 recent user + tool results）
- ✅ 回退路径可用（预算模块异常时回退到 count-based）
- ✅ 回归测试：`npm run docs:check && npm test && npm run bdd` 全部通过

**限制**：
- 仅支持 MLX 路径（lmstudio 未接入）
- 不做 summary 生成（第 3 批）
- 字符数近似 token（2 chars/token）

### 第 3 批：摘要压缩层 ✅ 已落地

**目标**：在现有"窗口记忆 + 预算裁剪"上补齐旧消息压缩摘要

**交付物**：
- `src/summary.ts` - 摘要压缩模块
  - `loadSummary()` / `saveSummary()` - 摘要存储加载
  - `extractSummary()` - 规则式提取（约束/决策/工具事实）
  - `shouldGenerateSummary()` - 触发条件判断
  - `buildContextWithSummary()` - 上下文拼装
- `src/session-window.ts` - 新增 `trimWindowWithResult()` 返回裁剪消息
- `src/providers/mlx.ts` - 集成摘要层
  - `applyBudgetTrimWithSummary()` - 裁剪时生成/加载摘要
  - 上下文顺序：system + summary + recentWindow + currentUser
- `test/context.summary.test.ts` - BDD 测试覆盖（7 场景，16 测试）

**验收**：
- ✅ 历史被裁剪后，summary 文件会生成
- ✅ 下一轮可读入 summary 并影响回答
- ✅ summary 区块格式稳定（Goal/Constraints/Decisions/Open Items/Tool Facts）
- ✅ 无 summary 时兼容老流程
- ✅ 回归测试：`npm run docs:check && npm test && npm run bdd` 全部通过

**摘要结构**（Markdown）:
```markdown
# Chat Summary
## Goal
## Constraints
## Decisions
## Open Items
## Tool Facts
```

**提取规则**（规则式，不调模型）:
- **约束**: 用户消息中的 "必须/不要/仅/只"
- **决策**: 助手消息中的 "决定/采用/改为"
- **待办**: 用户消息中的 "如何/怎么/什么/是否"
- **工具事实**: tool 结果中的 path/file/directory/status

**触发条件**: 窗口消息超过 20 条且预算裁剪发生时

**限制**：
- 仅支持 MLX 路径
- 规则式提取（不引入额外 LLM 调用）
- 字符数近似 token

### 第 4 批：干预机制 ✅ 已落地

**目标**：steer/followUp 最小落地

**交付物**：
- `src/steering-queue.ts` - 干预队列模块
  - `pushSteer()` / `drainSteer()` - 紧急转向队列
  - `pushFollowUp()` / `consumeOneFollowUp()` - 轮后消息队列（一次消费一条）
  - `hasSteer()` / `hasFollowUp()` - 队列状态检查
  - `getQueueStatus()` / `clearQueues()` - 队列管理
- `src/providers/mlx.ts` - 集成干预机制
  - 工具执行后检查 `drainSteer()`，命中则注入干预并跳过剩余工具
  - 轮结束后消费 `consumeOneFollowUp()`，只落盘一条
- `src/routes/commands.ts` - 命令处理器
  - `/steer <msg>` - 紧急转向命令
  - `/next <msg>` - 轮后消息命令
- `test/context.steering.test.ts` - BDD 测试覆盖（5 场景，19 测试）

**验收**：
- ✅ /next 入队后，当前轮不生效、下一轮生效
- ✅ drainFollowUp 消费后队列清空（consumeOneFollowUp 每次只消费一条）
- ✅ /steer 与 /next 同时存在时优先级正确
- ✅ 回归测试：`npm run docs:check && npm test && npm run bdd` 全部通过

**限制**：
- 仅支持 MLX 路径
- 队列存储在内存（不持久化）
- 一次只消费一条 followUp 消息

### 第 5 批：多轮工具闭环 ✅ 已落地

**目标**：把 mlx.ts 的固定两轮流程改为可迭代工具循环，直到"无 tool_calls 或达到上限"

**交付物**：
- `src/providers/mlx.ts` - 多轮工具循环重构
  - 常量：`MAX_TOOL_ROUNDS = 6`、`MAX_TOOLS_PER_ROUND = 3`
  - `executeSingleToolCall()` - 单工具执行辅助函数
  - 主循环：迭代直到无 tool_calls、达到 MAX_TOOL_ROUNDS、或不可恢复错误
  - 删除"只执行 toolCalls[0]"路径
  - 删除"第二轮 tools: [] 强制禁用工具"硬编码
  - 每个工具后检查 `drainSteer()`，命中则注入干预并 break
  - 轮结束后 `consumeOneFollowUp()` 单条消费策略保持
- `test/providers.mlx.test.ts` - 新增测试（Scenario F）
  - 常量验证、多步任务、多轮收敛、上限保护、steer 中断、followUp 单条消费

**验收**：
- ✅ 多步任务场景：先 pwd 再 cat <<EOF > file，最终文件存在
- ✅ 多轮工具调用直到收敛：至少 2 轮 tool_calls
- ✅ 上限保护：超过 MAX_TOOL_ROUNDS 时安全退出并给出提示
- ✅ steer 中断：工具执行后收到 steer，后续工具跳过
- ✅ followUp 单条消费：3 条队列经过 3 轮依次落盘，不丢
- ✅ 回归测试：`npm run docs:check && npm test && npm run bdd` 全部通过

**限制**：
- 仅支持 MLX 路径
- 保留并复用现有 Tool Bus 策略校验
- 最多执行 MAX_TOOL_ROUNDS 轮，超出后强制终止

### 第 6 批：404 降级重试 + /clear 清理 ✅ 已落地

**目标**：解决 /clear 后仍被脏上下文污染 + 偶发 HTTP 404 导致无回复

**交付物**：
- `src/summary.ts` - 新增 `clearSummary()` 函数
  - 清理 `<workspace>/.msgcode/sessions/<chatId>/summary.md`
- `src/providers/mlx.ts` - 404 降级重试逻辑
  - `isHttp404Error()` - 识别 HTTP 404 错误
  - `buildMinimalContext()` - 构建最小上下文（system + 当前 user）
  - `runMlxChat()` - 主请求 404 时自动重试，只重试 1 次
  - `runMlxToolLoop()` - 工具循环首轮 404 时自动重试
  - 结构化日志：`{reason: "mlx_404_fallback", retry: 1}`
- `src/handlers.ts` - /clear 命令增强
  - TmuxHandler 和 LocalHandler 都支持 MLX runner
  - MLX runner 执行 `clearWindow()` + `clearSummary()`
  - 返回 "已清理 session + summary"
- `test/providers.mlx.test.ts` - BDD 测试覆盖（Scenario G）
  - clearSummary 功能测试
  - clearWindow 功能测试
  - /clear 后不影响下一轮测试

**验收**：
- ✅ clearSummary 函数正确清理 summary.md 文件
- ✅ clearWindow 函数正确清理 jsonl 文件
- ✅ /clear 后同一 chatId 再提问，不再出现"卡住 + 404 无回复"
- ✅ 404 降级重试只重试 1 次（避免无限循环）
- ✅ 降级重试上下文仅包含 system + 当前 user（不带历史/summary）
- ✅ 回归测试：`npm run docs:check && npm test && npm run bdd` 全部通过

**降级重试规则**：
- 触发条件：捕获到 `MLX_HTTP_ERROR: HTTP 404`
- 重试上下文：仅 system + 当前 user（不含历史 window / summary）
- 只重试 1 次，避免无限循环
- 日志字段：chatId、reason=mlx_404_fallback、retry=1

**限制**：
- 仅支持 MLX 路径
- 降级重试仅在首轮 404 时触发（runMlxToolLoop）
- 不自动回退到 LM Studio（保持 MLX 失败直返）

### 第 7 批：最小工具集收敛（待规划）

目标：内核工具映射到 Tool Bus

### 第 8 批：多模态输入（待规划）

目标：Input Layer + Capability Registry

---

1. 完成 Provider 接口统一（不改行为） ✅
2. 引入会话记忆层（先 jsonl + summary） ✅
3. 补 steer/followUp 队列 ✅
4. 多轮工具闭环（替换固定两轮） ✅
5. 404 降级重试 + /clear 清理 ✅
6. 收敛最小工具集并映射到 Tool Bus
7. 完成多模态输入编排（Input Layer）

---

## 5. 验收门槛

### 功能门槛
- 多轮追问可保持上下文一致
- 工具闭环可稳定执行并回灌
- steer 可中断并转向，followUp 可排队执行
- 404 错误自动降级重试（system + user）
- /clear 完全清理 session + summary

### 工程门槛
- `npm run docs:check` 通过
- `npm test` 通过
- `npm run bdd` 通过

### 文档门槛
- 本文档与 `README.md` 索引可达
- 命令行为仍以运行时 `/help` 为准

---

## 6. 非目标（v2.2）

- 不引入向量数据库
- 不把技能执行器做成复杂工作流引擎
- 不默认开放 autonomous 给所有 workspace

