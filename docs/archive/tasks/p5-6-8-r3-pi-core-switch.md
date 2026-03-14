# P5.6.8-R3：PI 开关语义收敛（off=普通聊天+记忆，on=Pi 核心循环+四基础工具）

## 背景

当前 `pi.enabled` 只在命令层写入/读取，尚未成为运行时主链分叉条件。  
导致 `pi on/off` 与真实行为不一致。

## 目标语义（冻结）

1. `pi off`：普通 direct 聊天转发 + 记忆注入（不暴露工具给模型）。
2. `pi on`：启用 Pi 核心（while tool loop）+ 四基础工具：
   - `read_file`
   - `write_file`
   - `edit_file`（补丁式编辑）
   - `bash`
3. `pi` 仅作用于 direct 管道；tmux 继续忠实转发。
4. `pi on` 下不走专用 skill 执行管线：只在提示词注入 skill 索引与位置，由模型自行决定是否通过 `bash` 使用 skill。

## 参考实现（pi-mono）

- 核心循环：`/Users/admin/GitProjects/GithubDown/pi-mono/packages/agent/src/agent-loop.ts`
- 四基础工具定义：`/Users/admin/GitProjects/GithubDown/pi-mono/packages/coding-agent/src/core/tools/index.ts`
- skill 按需加载：`/Users/admin/GitProjects/GithubDown/pi-mono/packages/coding-agent/src/core/skills.ts`

执行约束：R3 阶段以 `codingTools = [read, bash, edit, write]` 为唯一工具面基线，不保留旧命名工具暴露。

## 当前缺口

1. `pi.enabled` 仅命令层生效（未驱动主链行为）。
2. LLM 工具仍是 `list_directory/read_text_file/append_text_file/run_skill`。
3. `runTool` 在 `lmstudio.ts` 内部硬编码，未与 Tool Bus 能力面收敛。

## 实施项

### R3.1 主链分叉（基于 pi.enabled）

- 在 direct 主链读取 `pi.enabled`。
- `off`：走无工具请求（普通聊天，保留记忆注入）。
- `on`：走 tool loop 并注入四基础工具 schema。

### R3.2 四基础工具落地

- 新增/映射 `read_file`、`write_file`、`edit_file`、`bash` 的 schema 与执行器。
- `edit_file` 必须补丁式（不可整文件覆盖）。
- 旧工具名 `list_directory/read_text_file/append_text_file` 仅可存在兼容层，不得进入 `pi on` 暴露清单。

### R3.3 执行器收敛

- 统一到 Tool Bus（或建立单一适配层），避免 `lmstudio.ts` 与 `tools/bus.ts` 双执行链漂移。

### R3.4 回归锁

- `pi off` 不得向模型传 tools。
- `pi on` 必须传四基础工具且仅这四个（本阶段）。
- `edit_file` 为补丁语义锁。
- tmux 路径不受 `pi.enabled` 影响。

### R3.5 Skill 管线收敛（Pi 风格）

- `pi on` 时移除 `run_skill` 工具暴露与专用分发路径。
- 在 system prompt 注入“可用 skill 索引 + skill 路径”，不自动执行。
- 模型如需 skill，必须通过 `read_file`/`bash` 自主加载与执行。
- 将现有 tts/asr/vision/desktop 能力迁移为 skill 文件（文档+脚本），主链不再保留专用 skill 管线。
- 删除 `/skill run` 命令入口，不保留调试后门。

## 验收

- `npx tsc --noEmit`
- `npm test`（0 fail）
- `npm run docs:check`
- 三工作区冒烟：
  - `/Users/admin/msgcode-workspaces/medicpass`
  - `/Users/admin/msgcode-workspaces/charai`
  - `/Users/admin/msgcode-workspaces/game01`
- `pi on` 冒烟时，模型可见工具仅四基础工具（无 `run_skill`）。
- 自然语言触发 skill 时，日志体现为 `bash/read_file` 路径。
- 代码面无 `/skill run` 命令入口。

## 非范围

- 不改权限策略（tooling.mode 的全局策略本单不重写）
- 不新增命令面
- 不改 tmux 管道协议
