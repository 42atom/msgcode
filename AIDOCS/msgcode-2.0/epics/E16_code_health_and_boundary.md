# E16：代码健康与边界收口（不引入“内容”）

## 目标
把 msgcode 的职责重新收口成“转发/路由/会话控制/可观测性”，确保：
1) 测试用的角色扮演内容不会被固化进产品逻辑/默认提示词/清洗规则
2) LM Studio 返回的“思考/脚手架/控制字符”等非用户内容不会泄露到 iMessage
3) 关键模块可维护：单一真相源、无临时调试落盘、错误可定位

## 非目标（明确不做）
- 不做任何“内容理解/风格塑形/角色设定/提示词工程默认化”
- 不引入任何 API Key 管理
- 不在 msgcode 内实现特定文本格式（例如三段式/特定口癖），这些属于 agent 的 skill 层

## 现状问题（证据点）
### 1) 临时调试落盘（安全/噪声）
- `src/listener.ts` 多处写入 `/tmp/msgcode-debug.log`（含用户文本片段），属于敏感落盘与不可控噪声源。

### 2) “内容清洗”越界（测试污染风险）
- `src/lmstudio.ts` 的 `sanitizeLmStudioOutput()` 当前包含：
  - 丢弃 `<think>...</think>`（合理：避免泄露思考）
  - 但也包含 `stripRoleplayScaffolding()`、`stripMarkdown()` 等“可改变用户可见内容形态”的规则（风险：把测试场景写进产品）。

### 3) 单一真相源不一致（配置/路径）
- `src/config.ts` 已有 `workspaceRoot`，但 `src/routes/store.ts` 仍直接读 `process.env.WORKSPACE_ROOT`。
- `src/routes/store.ts` 的路径校验用 `resolved.startsWith(workspaceRoot)`，存在边界误判（例如 `/root` vs `/root2`）。

### 4) 重复逻辑（维护成本）
- `normalizeChatId()` 在 `src/routes/store.ts` 与 `src/router.ts` 重复。

### 5) 类型与日志风格不一致
- `src/listener.ts` 有 `catch (handlerError: any)`；以及局部 `import("node:fs") + appendFileSync` 的调试实现。
- `src/config.ts` 存在 `console.warn`，应统一走 `logger`。

## 设计原则（收口）
### A) “线协议卫生” ≠ “内容处理”
允许 msgcode 做以下“线协议卫生（wire hygiene）”：
- 去除 ANSI 控制码、不可见控制字符（避免污染 iMessage）
- 明确丢弃 `reasoning_content` 字段与 `<think>...</think>` 区块（避免思考泄露）
- 保留用户可见内容原样（不做 markdown 展开、不做三段式重排、不做角色扮演字段过滤）

禁止 msgcode 做以下“内容处理”：
- 为了某类测试内容而重写/删减回复语义
- 任何“格式化成固定模板”的行为
- 隐式注入系统提示词来管理模型行为（除非用户显式配置）

### B) 单一真相源
- `workspaceRoot` 必须只来自 `config.workspaceRoot`
- `chatId` 归一化逻辑必须只在一个位置实现并复用

### C) 观测先于修复
每个改动必须能通过日志/探针定位：
- 发生在哪个 chatId（脱敏）
- 走了哪条 handler（botType）
- LM Studio 走的是 native 还是 openai-compat
- 错误属于：配置/连接/模型崩溃/超时/解析

## 执行计划（按顺序做，逐项可验收）
### Step 1：移除 `/tmp/msgcode-debug.log`（必做）
改动：
- 删除 `src/listener.ts` 对 `/tmp/msgcode-debug.log` 的写入
- 用 `logger.debug(...)` 替代；并加一个总开关（例如 `DEBUG_TRACE=1`）控制是否输出“链路追踪”日志

验收：
- 默认运行不产生任何 `/tmp/msgcode-debug.log`
- `LOG_LEVEL=debug DEBUG_TRACE=1` 时能看到 route lookup / handler start / handler end 的结构化日志

### Step 2：把 LM Studio 清洗收口为“线协议卫生”（必做）
改动：
- 将 `sanitizeLmStudioOutput()` 拆成两层：
  - `sanitizeWireOnly()`：ANSI + `<think>` + `reasoning_content` + JSON 包裹行（仅做可见性/安全修正）
  - `sanitizeExtra()`：任何可能改变用户可见语义的规则（默认关闭）
- 默认只启用 `sanitizeWireOnly()`
- 通过环境变量显式开启扩展清洗（例如 `LMSTUDIO_SANITIZE=extra`），并在 README 标记“非默认/仅用于特殊模型输出”

验收：
- 模型输出包含 `<think>` 时：iMessage 只收到 think 之后的最终内容
- 模型输出不包含 `<think>` 时：内容不被重排/不去掉列表/不改 markdown（保持原样）

### Step 3：路径校验与配置统一（必做）
改动：
- `src/routes/store.ts`：
  - `getWorkspaceRoot()` 改为读取 `config.workspaceRoot`
  - 路径校验改为 `path.relative(root, resolved)` 判定是否越界

验收：
- `/bind acme/ops` 正常创建目录
- `/bind /abs/path`、`/bind ../x` 被拒绝
- `/bind root2` 不会误判为在 `root` 下

### Step 4：消除重复的 `normalizeChatId()`（必做）
改动：
- 新增一个小模块（例如 `src/imsg/chat-id.ts` 或 `src/ids/chat.ts`）导出 `normalizeChatId()`
- `src/router.ts` 与 `src/routes/store.ts` 改为复用

验收：
- 现有测试全部通过
- 不再存在重复实现

### Step 5：类型与错误处理收口（应做）
改动：
- `catch (handlerError: any)` → `unknown`，只在缩小类型后取 `message/stack`
- `src/config.ts` 把 `console.warn` 改为 `logger.warn`（避免混用）

验收：
- `pnpm test`/`bun test` 通过
- 日志一致

### Step 6：顺序性问题的定位与修复（可选，但高收益）
现象：
- 用户侧观察到“回复滞后一条”

策略（先定位再修）：
- 为每个 `chatId` 加一个串行队列（Promise chain），确保同一群内消息处理严格按顺序执行
- 在 debug trace 中记录 messageId/rowid 与 handler 调用边界，确认是否存在“上一条响应被当成当前条”的读取错误（通常来自 tmux 读取边界）

验收：
- 同一群内连续发送 N 条消息，回复顺序严格对应

### Step 7：会话默认语义（/start=resume，/clear=new）（与 E12/E08 相关）
需求：
- `msgcode stop`：只停 msgcode 进程（tmux 会话保留）
- 群内 `/start`：默认 resume（若不存在会话才创建）
- 群内 `/clear`：强制新线程（kill+start）

验收：
- 重启 msgcode 后 `/start` 不丢上下文（仍使用旧 tmux session）
- `/clear` 后启动新会话且旧上下文不可见

## 交付物
- 本文档：`AIDOCS/msgcode-2.0/epics/E16_code_health_and_boundary.md`
- 对应代码改动 + 测试（按 Step 1~7 分 PR/分提交，不做大爆炸式重构）

