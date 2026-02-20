# 任务单：P5.6.13-R2（Workspace 对话落盘：`.msgcode/threads`）

优先级：P0（运行时可追溯性与调试基线）

## 目标（冻结）

1. 每个工作目录在 `.msgcode/threads/` 下保存对话 Markdown。
2. 存储口径以 workspace 为边界，禁止写到全局目录。
3. 文件名可读、可检索、可回放，接近 Alma 线程文件体验。
4. 不改模型语义，不改 tool loop，不改 tmux 透传语义。

示例目标路径：

- `/Users/admin/msgcode-workspaces/<workspace>/.msgcode/threads/2026-02-19_我的名字叫jerry.md`

## 背景（问题本质）

当前对话与运行日志分离，导致：

1. 复盘难：只能看日志，缺失“用户说了什么 + 系统回了什么”的线程视角。
2. 排障慢：SOUL/Memory 注入是否影响回答，无法在单一文档内直观关联。
3. 工作区隔离不完整：历史对话未落在 workspace 数据域内，不利于迁移和归档。

## 设计口径（单一真相）

### 1) 存储目录（固定）

- `<workspaceRoot>/.msgcode/threads/`
- 目录不存在则自动创建（递归创建）。

### 2) 文件粒度（固定）

- 以“线程”为单位，一个线程一个 `.md` 文件。
- 线程定义：同一 `chatId` 的连续会话窗口。
- 新线程触发条件（最小集）：
  1. 首次收到该 `chatId` 消息；
  2. 用户执行 `/clear`；
  3. 进程重启后无活动线程映射（按新线程创建，避免误拼接）。

### 3) 命名规则（固定）

- `<YYYY-MM-DD>_<title>.md`
- `title` 来源：首条用户消息前 24 个可见字符，清洗非法文件名字符并裁剪空白。
- 若清洗后为空，回退为 `untitled`。
- 同日重名自动追加 `-2/-3` 后缀。

### 4) 文件结构（固定）

首屏元信息（front matter）：

```md
---
threadId: <uuid>
chatId: <chatId>
workspace: <workspaceName>
workspacePath: <abs_path>
createdAt: <iso>
runtimeKind: <agent|tmux>
agentProvider: <lmstudio|minimax|openai|none>
tmuxClient: <codex|claude-code|none>
---
```

正文按轮次追加：

```md
## Turn 1 - 2026-02-19T13:20:11.123Z
### User
...

### Assistant
...
```

### 5) 注入与敏感信息规则（固定）

1. 默认保存用户文本和助手文本。
2. 工具原始 stdout/stderr 不写入线程正文（避免噪音和敏感泄露），仅在必要时写摘要。
3. 若开启调试，允许追加“调试尾注块”，但必须受开关控制且默认关闭。

## 范围

- `/Users/admin/GitProjects/msgcode/src/handlers.ts`（接线点，仅必要改动）
- `/Users/admin/GitProjects/msgcode/src/runtime/*`（新增线程存储模块）
- `/Users/admin/GitProjects/msgcode/src/config/workspace.ts`（必要开关）
- `/Users/admin/GitProjects/msgcode/src/routes/cmd-clear.ts`（清理触发新线程）
- `/Users/admin/GitProjects/msgcode/test/*thread*`
- `/Users/admin/GitProjects/msgcode/test/*handlers*`
- `/Users/admin/GitProjects/msgcode/docs/tasks/README.md`

## 非范围

- 不新增 `/thread` 命令族（list/open/export）。
- 不做历史日志反向迁移。
- 不改记忆召回策略（sqlite-vec 现状保持）。
- 不改 provider/tool 协议。

## 实施步骤

### R1：线程存储基础层（P0）

1. 新增 `thread-store` 模块（创建目录、命名、append、轮转）。
2. 将文件 IO 封装为最小 API：
   - `ensureThread(chatId, workspacePath, firstUserText, runtimeMeta)`
   - `appendTurn(threadId, userText, assistantText, timestamp)`
   - `resetThread(chatId)`（供 `/clear` 调用）

### R2：运行时接线（P0）

1. 在消息主链路回答成功后追加 turn。
2. 回答失败时仅写入用户消息 + 错误占位，不中断主链路。
3. `tmux` 与 `agent` 均可落盘，但元信息标明 `runtimeKind`。

### R3：命名与冲突处理（P0）

1. 标题清洗规则落地（非法字符、空白、长度）。
2. 重名后缀策略落地。
3. 编码统一 UTF-8，换行统一 `\n`。

### R4：可观测与回归锁（P0）

新增日志字段：

- `threadPersisted`（boolean）
- `threadPath`（abs path）
- `threadTurn`（number）
- `threadPersistMs`（number）
- `threadPersistError`（optional）

回归锁（至少）：

1. 首轮消息自动创建线程文件。
2. 连续两轮写入同一线程文件并 turn 递增。
3. `/clear` 后新建线程文件。
4. 同名标题自动后缀去重。
5. workspace 切换后写入各自 `.msgcode/threads`。
6. 不新增 `.only/.skip`。

## 硬验收（必须全过）

1. `npx tsc --noEmit`
2. `npm test`（0 fail）
3. `npm run docs:check`
4. 人工冒烟：
   - 在 `charai/medicpass/game01` 各发送 1 轮，均生成线程文件；
   - `/clear` 后继续发消息，生成新线程；
   - 线程文件含 front matter 与 turn 结构。

## 提交纪律

1. 禁止 `git add -A`。
2. 至少 4 提交：
   - `thread-store-foundation`
   - `runtime-thread-wireup`
   - `clear-rotation-and-naming`
   - `thread-regression-lock`
3. 单次提交变更文件数 > 20 直接拆分重做。

## 验收回传模板（固定口径）

```md
# P5.6.13-R2 验收报告（workspace threads）

## 提交
- <sha> <message>

## 变更文件
- <path>

## Gate
- npx tsc --noEmit:
- npm test:
- npm run docs:check:

## 关键证据
- 线程文件创建:
- turn 递增:
- /clear 后轮转:
- 多工作区隔离:

## 样例路径
- <workspace>/.msgcode/threads/<filename>.md

## 风险与遗留
- 风险:
- 遗留:
```
