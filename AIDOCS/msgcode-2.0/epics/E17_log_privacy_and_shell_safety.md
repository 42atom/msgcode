# E17：日志隐私与 Shell 安全（不落用户内容）

## 目标
1) 默认日志不记录用户消息正文（避免测试内容/敏感内容落盘）
2) 修复 `tmux` 会话内 `cd <projectDir>` 的潜在 Shell 注入与空格路径问题

## 非目标
- 不做内容理解/清洗增强（保持 E16 边界）
- 不引入新配置系统；只加必要的 env 开关

## 背景（问题）
### A) 日志落盘泄露风险
当前 `src/listener.ts` / `src/commands.ts` 的 debug trace 会记录 `textPreview`，若用户用“角色扮演”做压力测试，内容会进入 `~/.config/msgcode/log/msgcode.log`。

### B) tmux `cd` 注入风险
`src/tmux/session.ts` 在会话已存在时会发送 `cd ${projectDir}`：
- 路径包含空格时可能失败
- 若路径包含 `;|&` 等字符，可能被 Shell 解释（尽管当前有一定校验，但不够严谨）

## 方案
### 1) 日志：只记录摘要，不记录正文
默认：
- 记录 `textLength` + `textDigest`（sha256 前 10~12 位）
- 不记录 `textPreview`

可选调试（显式开启）：
- `DEBUG_TRACE=1`：开启链路追踪（队列/路由/handler 边界）
- `DEBUG_TRACE_TEXT=1`：允许写入 `textPreview`（仅临时排障用；默认关闭）

### 2) tmux：cd 命令用单引号安全包裹
- 统一使用 `cd -- '<escaped>'`
- 严禁换行/控制字符
- 保留现有 `tmux new-session -c '<dir>'` 的安全做法

## 验收
- 默认运行：日志中不出现用户消息正文（仅 digest/长度）
- `DEBUG_TRACE=1`：链路可观测但仍不落正文
- `DEBUG_TRACE=1 DEBUG_TRACE_TEXT=1`：允许预览落盘（仅用于临时排障）
- `/start` resume 时，包含空格的 `projectDir` 能正确 `cd`

