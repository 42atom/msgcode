# Subagent List Live Smoke 260312

## 目标

验证 `subagent list` 作为最小观测原语是否成立，并确认：

1. direct CLI 能列出当前 workspace 的任务
2. 真实 Feishu 认知关能正确理解 `subagent list`
3. 真实 Feishu 执行关不会因本轮改动回归

## Direct Smoke

工作区：

- `/Users/admin/msgcode-workspaces/test-real`

结果：

- `msgcode subagent list --workspace /Users/admin/msgcode-workspaces/test-real --json`
  成功返回当前任务清单
- 返回中能看到：
  - `running`
  - `completed`
  - `failed`
  三种历史状态
- 本轮 direct smoke 新任务：
  - `taskId = df8d877e-4647-4d24-a36a-e9e924e87753`
  - `client = codex`
  - `status = running`（list 返回时）

说明：

- `list` 已经能替代“手工记 taskId”这条隐式状态
- direct smoke 里 `codex` 的旧 tmux 会话存在上下文污染，因此本轮不把它当最终执行验收对象

## Feishu 认知关

### 失败基线

第一次问 `subagent list` 时，主脑误解为：

- 列出已安装子代理程序

这说明：

- 程序合同已变
- 但 `subagent` skill 文案还不够直

### 修正

收紧了：

- `src/skills/optional/subagent/SKILL.md`

新增明确说明：

- `subagent list = 列出当前 workspace 下已有的子代理任务`
- 不是执行臂枚举

同步 runtime skills 后重跑认知关，真实日志显示主脑已改口为：

- `用 msgcode subagent list 找回当前 workspace 下的 taskId`
- `查看哪些任务仍在 running / completed / failed / stopped`

日志证据：

- `/Users/admin/.config/msgcode/log/msgcode.log`
- token:
  - `subagent-list-cog-r3-1773330545369`

## Feishu 执行关

任务：

- 让主脑读取 `subagent` skill
- 委派 `claude-code`
- 在当前工作目录创建：
  - `subagent-feishu-r1-1773330596317.txt`
- 内容精确为：
  - `subagent-feishu-r1-1773330596317_OK`

真实结果：

- 文件存在：
  - `/Users/admin/msgcode-workspaces/test-real/subagent-feishu-r1-1773330596317.txt`
- 内容正确
- 群里真实回复：
  - `文件已创建，路径是 /Users/admin/msgcode-workspaces/test-real/subagent-feishu-r1-1773330596317.txt`
  - `subagent-feishu-r1-1773330596317`

日志证据：

- `/Users/admin/.config/msgcode/log/msgcode.log`
- 关键片段：
  - `Tool Bus: SUCCESS read_file`
  - `Tool Bus: SUCCESS bash`
  - `Responder subagent-claude-code-test-real-2d76b4`
  - `消息处理完成 ... subagent-feishu-r1-1773330596317`

## 结论

- `subagent list` 的 direct CLI 主链成立
- 认知关已证明主脑现在能正确理解 `subagent list`
- 执行关已证明本轮薄改没有破坏真实子代理委派主链

所以当前可以认为：

- `subagent run/list/status/stop`
  已形成一套足够薄、足够可观测、足够可验收的最小正式合同
