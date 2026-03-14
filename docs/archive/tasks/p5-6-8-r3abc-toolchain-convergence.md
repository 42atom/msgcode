# P5.6.8-R3ABC：Tool 链路收敛与 PI 四工具落地（派发版）

## 任务目标

把当前三条执行链：

- `run_skill`
- `Tool Bus`
- `lmstudio` 内置 `runTool`

收敛为单一真相源：**Tool Bus**。  
并落实 `pi on/off` 的最终语义：

- `pi off`：普通 direct 聊天 + 记忆注入（不暴露 tools）
- `pi on`：仅四基础工具 `read_file/write_file/edit_file/bash`

四基础工具的能力基线直接对齐 `pi-mono`：

- `/Users/admin/GitProjects/GithubDown/pi-mono/packages/coding-agent/src/core/tools/index.ts`
- 默认能力模型：`read + bash + edit + write`

## 执行顺序（必须按序）

1. `P5.6.8-R3a`：执行链单一化
2. `P5.6.8-R3b`：PI on 四工具收敛
3. `P5.6.8-R3c`：Skill 专用管线硬删除
4. `P5.6.8-R3d`：兼容层清零（旧工具名/旧入口）
5. `P5.6.8-R3e`：遗留硬切（命令面与静态锁）

---

## P5.6.8-R3a：执行链单一化

### 目标

`lmstudio` 不再本地执行工具；统一走 Tool Bus。

### 实施范围

- `src/lmstudio.ts`
- `src/tools/bus.ts`（仅适配，不扩语义）
- 相关测试

### 实施要点

1. 替换 `lmstudio.ts` 内置 `runTool` 分支为 `executeTool` 适配调用。
2. 保留 `lmstudio` 的职责：协议适配 + tool loop 编排 + 输出清洗。
3. 禁止新增第二条工具执行链。

### 验收

- `npx tsc --noEmit` ✅
- `npm test`（0 fail）✅
- `npm run docs:check` ✅
- 工具执行日志统一由 `tools-bus` 输出

---

## P5.6.8-R3b：PI on 四工具收敛

### 目标

`pi on` 只暴露四基础工具；`pi off` 不暴露 tools。

### 实施范围

- `src/lmstudio.ts`（tools schema / tool loop 入参）
- `src/handlers.ts`（根据 `pi.enabled` 分叉）
- `src/config/workspace.ts`（只读配置，不改策略语义）
- 相关测试

### 工具清单（冻结）

- `read_file`
- `write_file`
- `edit_file`（补丁式编辑，禁止整文件覆盖）
- `bash`

### 验收

- `pi on` 工具清单仅四项
- `pi off` 工具清单为空
- `edit_file` 补丁语义回归锁通过
- 静态锁：`rg "list_directory|read_text_file|append_text_file|run_skill" src/lmstudio.ts` 无 `pi on` 主链暴露命中
- 三门 gate 全绿

---

## P5.6.8-R3c：Skill 专用管线硬删除

### 目标

`pi on` 下彻底移除 `run_skill` 与 `/skill run`，只保留 skill 索引提示，让模型通过四工具自主调用。

### 实施范围

- `src/lmstudio.ts`
- `src/runtime/skill-orchestrator.ts`
- `src/routes/*`
- `docs/tasks/*`、`README.md`（口径同步）

### 实施要点

1. 移除 `run_skill` 工具暴露与主链分发。
2. 在 system prompt 注入 skill 索引路径（全局 + workspace）。
3. `tts/asr/vision/desktop` 转 skill 文件范式（主链不再专用调度）。
4. 删除 `/skill run` 命令入口及其调用链（无调试保留口）。

### 验收

- `rg "run_skill" src/lmstudio.ts` 无主链命中
- `rg "/skill run|handleSkillRunCommand|skill-orchestrator" src` 无运行时入口命中
- 运行日志显示 skill 触发路径为 `bash/read_file`
- 三工作区冒烟通过：
  - `/Users/admin/msgcode-workspaces/medicpass`
  - `/Users/admin/msgcode-workspaces/charai`
  - `/Users/admin/msgcode-workspaces/game01`

---

## P5.6.8-R3d：兼容层清零（旧工具名/旧入口）

### 目标

移除旧工具命名与兼容壳，避免双语义长期并存。

### 实施范围

- `src/lmstudio.ts`
- `src/tools/*`
- `src/routes/*`
- `test/*`（回归锁）

### 实施要点

1. 主链完全不依赖 `run_skill` 与专用 skill orchestrator。
2. 删除旧工具名对模型暴露：`list_directory/read_text_file/append_text_file`。
3. 删除或隔离无主线价值的兼容入口，防止双入口漂移。
4. 增加静态锁：禁止在主链文件中重新引入 `run_skill`、旧工具名。

### 验收

- `rg "run_skill|list_directory|read_text_file|append_text_file" src/lmstudio.ts src/handlers.ts` 无主链命中
- 三门 gate 全绿

---

## P5.6.8-R3e：遗留硬切（命令面与静态锁）

### 目标

一次性与历史包袱切割，避免“先留着以后再删”。

### 实施范围

- `src/routes/cmd-info.ts`
- `src/routes/commands.ts`
- `test/*`
- `docs/*`

### 实施要点

1. 从 `/help` 与命令解析层移除 `/skill run` 所有提及。
2. 增加禁回流测试：禁止出现 `/skill run`、`run_skill`、旧三工具名。
3. 文档口径统一：技能使用路径仅为 “模型通过 bash/read_file 自主执行”。

### 验收

- `rg "/skill run|run_skill|list_directory|read_text_file|append_text_file" src docs` 无主线命中
- 三门 gate 全绿

---

## 非范围（本单不做）

- 不改 tmux 忠实转发语义
- 不改 `/clear` 状态边界（window/summary/memory）
- 不新增命令面

## 提交与回传格式

每个子阶段独立提交并回传：

1. 变更文件清单
2. 三门 gate 结果
3. 回归锁新增项
4. 是否存在延后项（如有必须写入 docs/tasks）
