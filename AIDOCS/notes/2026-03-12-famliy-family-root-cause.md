# 结论

不是系统创建了两个“同名”目录，而是同一轮操作里出现了两次不同拼写：

- 用户原话是 `/famliy`
- 智能体回复里擅自写成了 `family`
- 后续 `/bind famliy` 又被系统按原样绑定并自动创建了 `famliy`

最终结果是：

- `/Users/admin/msgcode-workspaces/family` 承载了被迁移过去的定时任务
- `/Users/admin/msgcode-workspaces/famliy` 承载了当前群绑定、会话与配置

## 证据链

### 1. 用户原始输入是 `famliy`

日志：

- `/Users/admin/.config/msgcode/log/msgcode.log`
  - `2026-03-12 03:49:43.236`
  - `inboundText="你帮我把本群绑定到/famliy文件夹,然后把定时都迁移过去,你知道该怎么做吗,或者你先建立好文件夹内容,我再手动绑定一下"`

线程记录：

- `/Users/admin/msgcode-workspaces/default/.msgcode/threads/2026-03-12_以后所有定时提醒文字内容前面加一个‘⏰’,这样.md`

### 2. 智能体回复里把 `famliy` 改成了 `family`

日志：

- `/Users/admin/.config/msgcode/log/msgcode.log`
  - `2026-03-12 03:50:30.916`
  - 回复内容明确写了：
    - 创建了 `/Users/admin/msgcode-workspaces/family`
    - 手动绑定到 `/family`

线程记录：

- `/Users/admin/msgcode-workspaces/default/.msgcode/sessions/feishu:oc_5b5918d4ef1672557e06234998a844de.jsonl`
- `/Users/admin/msgcode-workspaces/default/.msgcode/threads/2026-03-12_以后所有定时提醒文字内容前面加一个‘⏰’,这样.md`

### 3. 用户随后显式执行了 `/bind famliy`

日志：

- `/Users/admin/.config/msgcode/log/msgcode.log`
  - `2026-03-12 03:50:46.896`
  - `inboundText="/bind famliy"`

### 4. 绑定后运行上下文已经切到 `famliy`

日志：

- `/Users/admin/.config/msgcode/log/msgcode.log`
  - `2026-03-12 03:50:57.773`
  - `projectDir=/Users/admin/msgcode-workspaces/famliy`
  - 后续回答也写了：`我现在的工作目录是 /Users/admin/msgcode-workspaces/famliy`

路由持久化：

- `~/.config/msgcode/routes.json`
  - `feishu:oc_5b5918d4ef1672557e06234998a844de`
  - `workspacePath: /Users/admin/msgcode-workspaces/famliy`
  - `label: famliy`

### 5. `/bind` 会原样吃参数，并在不存在时直接建目录

代码：

- `/Users/admin/GitProjects/msgcode/src/routes/cmd-bind.ts`
  - `handleBindCommand()` 直接取 `args[0]` 作为 `relativePath`
- `/Users/admin/GitProjects/msgcode/src/routes/store.ts`
  - `createRoute()` 先 `resolveWorkspacePath(relativePath)`
  - 如果目录不存在就 `fs.mkdirSync(workspacePath, { recursive: true })`

这说明 `/bind famliy` 不会自动纠错成 `family`，而是会忠实创建并绑定 `famliy`。

## 当前现场

目录内容也印证了“分裂”状态：

- `/Users/admin/msgcode-workspaces/family/.msgcode/schedules/`
  - 有 3 个 schedule 文件
- `/Users/admin/msgcode-workspaces/famliy/.msgcode/`
  - 有 `config.json`
  - 有当前群会话 `sessions/feishu:oc_5b5918d4ef1672557e06234998a844de.jsonl`

## 根因判断

根因不是 `/bind` 重复创建了同一路径。

根因是：

1. 智能体在处理自然语言请求时，把用户显式输入的 `/famliy` 擅自“纠正”为 `/family`
2. 之后用户执行 `/bind famliy`，系统又按字面值绑定到了另一个目录
3. 于是调度文件和会话/绑定信息分散到两个不同路径

## 对照项目约束

这个行为和仓库约束冲突：

- 项目文档明确要求：默认不改写用户显式输入
- 当前实际行为是：智能体在主链里把 workspace 名从 `famliy` 改成了 `family`

## 最小修复方向

先做薄修复，不加新层：

1. 先补提示词/合同约束
   - 明确禁止智能体擅自纠正用户给出的 workspace 路径、文件名、命令参数
2. 再考虑代码兜底
   - 对涉及 workspace 的自然语言执行结果，加最小校验或证据输出
   - 重点不是“猜对用户想要什么”，而是禁止把显式输入偷偷改写

## 2026-03-12 现场处理结果

已按“保留正确目录 `family`，把错误目录 `famliy` 内容并回去”的方式手动收口：

1. 把 `famliy/.msgcode/config.json` 合并到 `family/.msgcode/config.json`
2. 把 `famliy/.msgcode/sessions/feishu:oc_5b5918d4ef1672557e06234998a844de.jsonl` 合并到 `family/.msgcode/sessions/`
3. 把 `~/.config/msgcode/routes.json` 中该群路由改为：
   - `workspacePath: /Users/admin/msgcode-workspaces/family`
   - `label: family`
4. 将错误目录整体移到备份区，而不是直接删除：
   - `/Users/admin/msgcode-workspaces/.trash/famliy-20260312-153201`

处理后活跃目录结构为：

- `/Users/admin/msgcode-workspaces/family/.msgcode/config.json`
- `/Users/admin/msgcode-workspaces/family/.msgcode/schedules/*`
- `/Users/admin/msgcode-workspaces/family/.msgcode/sessions/feishu:oc_5b5918d4ef1672557e06234998a844de.jsonl`

原路径 `/Users/admin/msgcode-workspaces/famliy` 已不再作为活跃目录存在。
