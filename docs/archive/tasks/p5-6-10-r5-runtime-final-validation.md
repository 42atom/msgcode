# P5.6.10-R5：终态运行时检验（三工作区 + 双管道）

## 背景

`P5.6.8-R4h` 与 `P5.6.10` 完成后，需要一次“只看运行时行为”的终态验收，避免静态绿灯掩盖真实链路问题。

## 目标（冻结）

1. 验证 direct/tmux 双管道语义边界不混淆
2. 验证 `pi.off/pi.on` 与工具能力开关一致
3. 验证 SOUL/短期记忆/长期记忆注入与 `/clear` 边界一致
4. 验证工具执行可信（无假执行）

## 验收工作区

- `/Users/admin/msgcode-workspaces/medicpass`
- `/Users/admin/msgcode-workspaces/charai`
- `/Users/admin/msgcode-workspaces/game01`

## 执行清单（逐工作区）

1. 基线
   - `/bind`（如已绑定可跳过）
   - `/reload`（记录 `SOUL source/path/chars`）
2. `pi.off` 验证
   - 自然语言提问（确认无工具调用）
   - 校验 `toolCallCount=0`
3. `pi.on` + 工具可信验证
   - 提问：`执行 pwd 并返回完整路径`
   - 通过条件：返回真实 workspace 绝对路径，且日志 `toolCallCount>0 toolName=bash`
4. 记忆链路
   - 先投喂一条事实，再提问复述
   - 校验日志 `memory injected/hitCount/injectedChars`
5. `/clear` 边界
   - 执行 `/clear`
   - 校验仅清 `window+summary`，不清长期记忆
6. tmux 对照
   - 切换 `codex` 或 `claude-code`
   - 校验 tmux 仅忠实转发，不注入 SOUL/memory/tool-loop 语义

## 证据要求

- 日志片段（每工作区至少 1 组）：
  - `LM Studio 请求开始/完成`
  - `toolCallCount/toolName`
  - `soulInjected/soulSource/soulPath/soulChars`
  - `memory injected/hitCount/injectedChars`
- 失败样例必须附 `errorCode/errorMessage/exitCode`

## 通过标准

1. 三工作区 direct 验证全部通过
2. tmux 对照语义通过
3. 无“未真实工具调用却声称已执行”的回复
4. 输出签收单（含失败清单与修复回路）

## 非范围

- 不新增功能
- 不改任务主线顺序
- 不替代自动化测试，只做运行时终验

