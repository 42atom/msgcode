# msgcode 2.2（规划文档）

> 目标：把"跨 App 的 GUI 自动化"做成系统级能力，并解决 macOS TCC（屏幕录制/辅助功能）对后台 daemon 的限制。

---

**命令真相源：运行时 `/help`**

本文档仅做架构导读和规划参考。所有命令的权威行为以 iMessage 群组中发送 `/help` 的输出为准。

---

## 入口演进愿景（长期）

一句话：**传输层可替换，编排层不变。**

- 未来方向：支持“自有客户端”作为新的消息入口（Web/Desktop/Mobile 均可）。
- 架构原则：入口适配层（Channel Adapter）可插拔，路由/编排/工具总线保持稳定。
- 当前策略：**v2.2 继续聚焦 iMessage 主链路**，优先保证稳定性、可控性和可观测性。

---

## 快速导航

### 按角色导航

| 角色 | 导航目标 |
|------|----------|
| **运维** | [Slash Commands](#slash-commands-v22) • [TTS 配置](#tts-v22) • [常见排障](../../README.md#常见排障) |
| **开发** | [文件系统约定](#文件系统即真相源目录约定) • [Persona/Schedules](#persona-v22) • [BDD 测试](#bdd--发布门槛-v22) |
| **排障** | [Control Lane](./control_lane_spec_v2.2.md) • [会话注册](./session_registry_spec_v2.2.md) • [Doctor 诊断](../../README.md#常见排障) |
| **发布** | [路线图](./roadmap_v2.2.md) • [BDD 检查清单](#发布检查清单) • [测试套件](#运行测试) • [MLX 冒烟测试](#mlx-冒烟测试-v22) |

### 按主题导航

| 主题 | 规格文档 | 实现入口 |
|------|----------|----------|
| **Commands** | [Control Lane](./control_lane_spec_v2.2.md) | [src/routes/](../../src/routes/) |
| **Tool Bus** | [工具化策略](./glm47_tooling_strategy_v2.2.md) | [src/tools/bus.ts](../../src/tools/bus.ts) |
| **TTS** | [IndexTTS 优化](./indextts_optimization_memo.md) | [src/runners/tts/](../../src/runners/tts/) |
| **Persona** | [编排层规划](./orchestration_plan_v2.2.md) | [src/config/](../../src/config/) |
| **Schedules** | [编排层规划](./orchestration_plan_v2.2.md) | [src/config/](../../src/config/) |
| **BDD** | [本节 → BDD](#bdd--发布门槛-v22) | [test/](../../test/) |
| **Bridge** | [Desktop Bridge](./desktop_bridge_contract_v2.2.md) | - |
| **Telegram 切换** | [Telegram 迁移计划](./telegram_migration_plan_v2.2.md) | [src/channels/](../../src/channels/) |
| **Roadmap** | [2.2 路线图](./roadmap_v2.2.md) | - |
| **Agent Core** | [Agent Core Plan](./agent_core_plan_v2.2.md) | [src/providers/](../../src/providers/) |

### 按任务导航

| 我想... | 快速入口 |
|---------|----------|
| 切换执行臂 | [`/model`](#slash-commands-v22) • [编排层规划](./orchestration_plan_v2.2.md) |
| 查慢回复原因 | [`/status`](#slash-commands-v22) • [Control Lane](./control_lane_spec_v2.2.md) |
| 使用工具命令 | [`/tts`](#slash-commands-v22) • [工具化策略](./glm47_tooling_strategy_v2.2.md) |
| 修改 schedule | [`/schedule`](#slash-commands-v22) • [Schedules → 使用](#schedules-v22) |
| 验收发布 | [BDD → 发布检查清单](#发布检查清单) |
| 配置 TTS | [TTS → 环境变量](#tts-v22) • [IndexTTS 优化](./indextts_optimization_memo.md) |

---

## 目录

```
AIDOCS/msgcode-2.2/
├── README.md                          # 本目录索引
├── agent_core_plan_v2.2.md            # Agent 核心计划（主循环/工具/记忆/skills/干预）
├── roadmap_v2.2.md                    # 2.2 总路线图（控盘版：里程碑/验收/风险）
├── session_registry_spec_v2.2.md       # P0：tmux 会话元数据落盘（重启不丢 /status 口径）
├── control_lane_spec_v2.2.md           # P0：只读命令快车道（/status /where /help /loglevel 秒回）
├── orchestration_plan_v2.2.md         # Persona/Skills/Schedules 编排层规划 v2.2
├── glm47_tooling_strategy_v2.2.md     # GLM-4.7 Flash 工具化策略（P0 显式命令 → P1 tool_calls）
├── indextts_optimization_memo.md       # IndexTTS 优化备忘（本机模型分支 + 调用侧策略）
├── osaurus_integration_plan_v2.2.md   # osaurus 参考笔记（对照用，不纳入交付）
├── desktop_bridge_contract_v2.2.md    # Desktop Host/Bridge 的 JSON-RPC 契约（P0）
├── telegram_migration_plan_v2.2.md    # 从 iMessage 切换到 Telegram Bot 的迁移计划（P0/P1）
├── m5_codex_execution_plan_v2.2.md    # M5：Codex 兼容执行计划（P0）
└── desktop_automation_plan_v2.2.md    # Desktop GUI Automation（Host + Bridge）规划 v2.2
```

---

## 核心叙事（v2.2）

一句话：**msgcode 是 iMessage 入口 + 工作区路由 + 风控闸门 + 证据落盘 + 交付；编辑配置/技能/日程全部走文件系统。**

数据流：
```
iMessage → route(chatGuid→workspace) → orchestration(.msgcode) → runner(lmstudio/tmux) → evidence(artifacts/ + logs) → iMessage reply
```

---

## 文件系统即真相源（目录约定）

### Workspace 目录结构

```
<WORKSPACE>/
├── .msgcode/
│   ├── config.json           # 配置：policy.mode / runner.default / persona.active
│   ├── personas/             # Persona（Markdown，即 system prompt）
│   │   ├── default.md
│   │   └── coder.md
│   ├── schedules/            # Schedules（JSON，定时消息）
│   │   ├── morning.json
│   │   └── weekly_review.json
│   └── skills/               # Skills（启用清单链接，不做编辑器）
│       └── README.md
├── attachments/              # 接收的附件
├── artifacts/                # 生成的产物
│   ├── asr/
│   ├── vision/
│   └── tts/
└── ...
```

### config.json（最小配置）

```json
{
  "policy.mode": "egress-allowed",     // local-only | egress-allowed
  "runner.default": "lmstudio",         // lmstudio | codex | claude-code
  "persona.active": "coder",            // 当前激活 persona
  "memory.inject.enabled": false,       // 记忆注入（默认关闭）
  "skills.enabled": ["skill-id"]        // 启用的技能列表
}
```

---

## Slash Commands（v2.2）

> **边界声明**
> - **行为真相源**：运行时 `/help`（本文档仅做分类导览）
> - **本节职责**：命令分类与索引，不承诺逐字返回文案
> - **变更流程**：先改代码 `/help`，再回填本导读分类

### 一级命令（常用）

| 命令 | 说明 |
|------|------|
| `/bind <dir> [client]` | 绑定群组到工作目录 |
| `/where` | 查看当前群组绑定 |
| `/model [runner]` | 查看或切换执行臂 |
| `/policy [mode]` | 查看或切换策略模式（建议用 `full/limit`） |
| `/help` | 显示命令帮助 |
| `/start /stop /esc /clear` | 会话管理 |
| `/persona list\|use <id>\|current` | Persona 管理 |
| `/schedule list\|validate\|enable <id>\|disable <id>` | Schedule 管理 |
| `/reload` | 重新扫描加载配置 |
| `/tts <text>` | 语音生成（LM Studio 专用） |

### 二级命令（诊断）

| 命令 | 说明 |
|------|------|
| `/status` | 查看会话状态（秒回，不抢占） |
| `/loglevel [debug\|info\|warn\|error\|reset]` | 查看/设置日志级别（秒回，不抢占） |
| `/info /chatlist` | 查看处理状态/群组列表 |
| `/mem on\|off\|force\|status` | 记忆注入控制 |

### 关键特性

- **Control Lane**: `/status /where /help /loglevel` 秒回，不抢占，不重复回复
- **抢占中断**: `/esc /stop /clear` 允许中断长任务
- **回执**: 非 slash 消息超过 15s 发送"嗯，等下…"（可用 `MSGCODE_ACK_DELAY_MS` 覆盖）
- **群聊信任收口**: 群聊只允许你本人触发执行（`MSGCODE_OWNER_ONLY_IN_GROUP=1` + `MSGCODE_OWNER=<你的邮箱/电话>`）
- **执行臂权限（重要）**: Codex 以 `danger-full-access` + `approval=never` 启动（完全能力、强副作用）。仅建议绑定到自用 chat，避免把“远程 root”暴露给外部联系人。

---

## TTS（v2.2）

默认后端：IndexTTS（常驻 worker，避免每次冷启动）。  
默认会做文本清洗（省略号/换行/`~` 等），减少“长静音”。

建议环境变量（`~/.config/msgcode/.env`）：

```
# 后端选择
TTS_BACKEND=indextts

# IndexTTS 路径
INDEX_TTS_ROOT=~/Models/index-tts
INDEX_TTS_PYTHON=$INDEX_TTS_ROOT/.venv/bin/python
INDEX_TTS_MODEL_DIR=$INDEX_TTS_ROOT/checkpoints
INDEX_TTS_CONFIG=$INDEX_TTS_ROOT/checkpoints/config.yaml
INDEX_TTS_DEVICE=mps

# 常驻 worker（默认开启；关闭：0）
INDEX_TTS_USE_WORKER=1
INDEX_TTS_WORKER_START_TIMEOUT_MS=180000

# Worker 软回收（稳定优先；默认 4500MB）
# 说明：macOS/MPS 下 Activity Monitor 往往“越跑越大”，回收可避免最终 SIGKILL。
# 设为 0 可关闭。
INDEX_TTS_WORKER_RECYCLE_RSS_MB=4500

# MPS 内存上限（可选）
# 说明：macOS unified memory 下，PyTorch/MPS 往往会 cache/预留，Activity Monitor 看起来“越跑越大”。
# 设置该值可限制单进程可用的 MPS 内存比例（0~1），更稳但可能更容易触发 OOM/降速。
# INDEX_TTS_MPS_MEMORY_FRACTION=0.6

# 清理阀门（默认开启；追求极致速度可关）
# - gc.collect()
# - torch.mps.empty_cache()
INDEX_TTS_GC_COLLECT=1
INDEX_TTS_EMPTY_CACHE=1

# 语速（预留字段：当前不生效）
# 说明：上游 IndexTTS2 `infer()` 不保证支持 speed 参数；msgcode 不会向其透传该字段。
# 如需“语速控制”，建议后续在输出 wav 上做后处理（time-stretch/atempo）。
# INDEX_TTS_SPEED=1

# 段间静音（ms）
INDEX_TTS_INTERVAL_SILENCE_MS=200

# 长文本稳态（默认关闭）
# 当文本长度超过阈值且非 emoAuto 时：按句切段 → 合成 → concat
# TTS_LONG_TEXT_SEGMENT_CHARS=400

# TTS 超时（毫秒；长文/慢速建议调大）
TTS_TIMEOUT_MS=300000

# 自动语音回复专用超时（毫秒；默认 120000）
# 说明：自动语音回复不应无限等待，否则会堆积导致体验不可用。
# TTS_AUTO_TIMEOUT_MS=120000

# IndexTTS worker 长文本策略（默认 480）
# 说明：超过阈值时，不走常驻 worker，改用一次性 Python 子进程（避免 MPS driver 缓存一路抬升直到爆）。
# INDEX_TTS_WORKER_MAX_TEXT_CHARS=480

# Worker MPS 回收阈值（ratio）
# 说明：RSS 不包含 MPS driver cache，msgcode 会在每次任务后 ping worker，若 driver/recommended 达到阈值则回收。
# INDEX_TTS_WORKER_RECYCLE_MPS_RATIO=0.72

# 情绪平滑（戏剧急转可 hardcut）
TTS_EMO_HARDCUT=0
TTS_EMO_SMOOTH_FACTOR=0.7

# per-segment 合成阈值（字符数；默认 700）
# 超过阈值：仍会做情绪分析，但改用 averageVector 单次合成（更稳更快）。
# TTS_EMO_SEGMENT_SYNTH_MAX_CHARS=700

# IndexTTS 推理旋钮（可选，谨慎调）
# P0: 稳定优先默认值（msgcode 会在启动 worker 时自动注入，除非你显式覆盖）
# INDEX_TTS_MAX_SEQ_LENGTH=4096
# INDEX_TTS_DIFFUSION_STEPS=20
# INDEX_TTS_NUM_BEAMS=2
# 分段合成的单段超时下限（默认 120000ms）
# 说明：默认值已提升到 180000ms（更稳，避免长句频繁超时）
# INDEX_TTS_SEGMENT_TIMEOUT_MS_MIN=180000

# 分段“硬切兜底”（可选）
# 说明：避免没有标点时单段过长导致推理抖动/内存暴涨。
# TTS_EMO_SEGMENT_MAX_CHARS=120
# TTS_LONG_TEXT_CHUNK_MAX_CHARS=120

```

---

**继续阅读**

| 类型 | 链接 |
|------|------|
| 详细规格 | [IndexTTS 优化备忘](./indextts_optimization_memo.md) |
| 实现入口 | [src/runners/tts/](../../src/runners/tts/) |
| 相关配置 | [环境变量参考](#文件系统即真相源目录约定) |

---

## Persona（v2.2）

### 文件格式

```
<WORKSPACE>/.msgcode/personas/<personaId>.md
```

内容为纯 Markdown 文本，作为 system prompt 直接注入。

### 使用

```bash
/persona list              # 列出所有 personas
/persona use coder         # 切换到 coder persona
/persona current           # 查看当前 persona
```

### 生效边界

- **LM Studio**: 立即生效（persona 作为 `system_prompt` 注入，可控且稳定）
- **Tmux (Codex/Claude)**: 只能做到“风格建议”，不保证“身份切换/越权”
  - 原因：Codex/Claude 会优先遵循更高优先级的 system/developer 指令，用户消息里塞 persona 只是 user 级提示
  - 建议：把“长期人格/项目规范”写进执行臂原生会读取的项目指令文件（如 `CLAUDE.md` / `AGENTS.md` / rules），msgcode 的 persona 仅负责 workspace 层开关与落盘
  - 仍建议在切换后执行 `/clear`：减少旧上下文对风格的干扰（避免用户误解）

---

**继续阅读**

| 类型 | 链接 |
|------|------|
| 详细规格 | [编排层规划 → Persona](./orchestration_plan_v2.2.md) |
| 实现入口 | [src/config/](../../src/config/) |
| 命令参考 | [`/persona`](#slash-commands-v22) |

---

## Schedules（v2.2）

### 文件格式（v1）

```json
{
  "version": 1,
  "enabled": false,
  "tz": "Asia/Shanghai",
  "cron": "0 9 * * 1-5",
  "message": "早上好！今天有什么计划？",
  "delivery": {
    "mode": "reply-to-same-chat",
    "maxChars": 2000
  }
}
```

### 关键设计

- `scheduleId = filename`（如 `morning.json` → `morning`）
- `enable/disable` 修改文件内 `enabled` 字段
- 映射到 jobs.json 使用稳定 `jobId = schedule:<workspaceId>:<scheduleId>`
- Schedule 不含 `chatGuid`，由当前群绑定 workspace 的 route 补齐

### 使用

```bash
/schedule list             # 列出所有 schedules
/schedule validate         # 验证所有 schedules
/schedule enable morning   # 启用指定 schedule
/schedule disable morning  # 禁用指定 schedule
/reload                    # 重新加载并映射到 jobs
```

---

**继续阅读**

| 类型 | 链接 |
|------|------|
| 详细规格 | [编排层规划 → Schedules](./orchestration_plan_v2.2.md) |
| 实现入口 | [src/config/](../../src/config/) |
| 命令参考 | [`/schedule`](#slash-commands-v22) |

---

## BDD = 发布门槛（v2.2）

所有功能必须通过 BDD 场景验收才能发布。

### 运行测试

```bash
# 单元测试（226 个测试）
npm test

# BDD 场景（Cucumber）
npm run bdd

# 完整测试套件
npm run test:all
```

### 关键 BDD 场景

**Orchestration - Schedule Merge Strategy**
- 验证 `/reload` 合并策略不误删非 schedule jobs
- 场景：先手工写入 `jobs.json` 含 `id="manual:1"`，再启用 schedule + `/reload`，验证 `manual:1` 仍存在

**Policy & Runner Gate**
- 验证 `/policy local-only` 必须拒绝 `/model codex`
- 场景：`/policy local-only` → `/model codex` 返回"拒绝 + 提示 /policy full（或 /policy egress-allowed）"

**Persona Boundary**
- 验证 persona 注入口径（lmstudio 立即生效；tmux runner 提示边界）
- 场景：当 workspace runner=codex 时，`/persona use coder` 回复里必须包含"/clear 后完全生效"提示

### 发布检查清单

- [ ] `npm test` 全绿（226/226 pass）
- [ ] `npm run bdd` 全绿
- [ ] `npm run test:all` 全绿

---

**继续阅读**

| 类型 | 链接 |
|------|------|
| 测试文件 | [test/](../../test/) • [test/features/](../../test/features/) |
| 场景示例 | [loglevel.feature](../../test/features/loglevel.feature) |
| 发布流程 | [路线图 → 里程碑](./roadmap_v2.2.md) |

---

## 人工检查清单（维护规范）

### 新增命令后

1. **先看 `/help` 输出**：在 iMessage 群组中发送 `/help`，确认新命令已生效
2. **更新导读分类**：
   - 在 [Slash Commands](#slash-commands-v22) 节添加命令条目
   - 分类：一级命令（常用）或二级命令（诊断）
   - 只需分类导览，**不承诺逐字返回文案**
3. **运行 `npm run docs:check`**：确保文档同步检查通过

> 原则：代码 `/help` 为真相源，导读仅做分类索引。

### 新增专题后

1. **必须加入"快速导航层"**：
   - 在 [按主题导航](#快速导航) 表格中添加行
   - 填写：专题名称、规格文档、实现入口（优先指向目录）
2. **必须加入对应章节"继续阅读"块**：
   - 在相关章节末尾添加"继续阅读"块
   - 链接格式：详细规格、实现入口、命令参考（如适用）
3. **更新本文件**：`AIDOCS/msgcode-2.2/README.md`

### 新增文件/目录后

1. **优先指向稳定目录**而非具体文件名
   - ✅ 推荐：`src/config/`（目录）
   - ❌ 避免：`src/config/personas.ts`（文件名可能变更）
2. **验证链接可达性**：点击测试链接确保 404 不发生

> 原则：目录更稳定，减少"文档链接脆弱性"问题。

### Tool Bus 灰度发布

1. **灰度前**：
   - `/toolstats` 查看当前工具执行统计
   - `/tool allow list` 查看当前允许的工具列表
2. **修改灰度配置**：
   - `/tool allow add <tool>` 添加工具到允许列表
   - `/tool allow remove <tool>` 从允许列表移除工具
3. **生效配置**：
   - `/reload` 重新加载配置
4. **灰度后**：
   - `npm run test:all` 全量回归测试
   - `/toolstats` 复核工具执行统计

### 会话清理规范

**/clear 统一入口原则**：
- `/clear` 命令的 session window + summary 清理逻辑统一由 `src/session-artifacts.ts` 提供
- 不允许在各个 handler 中复制实现清理逻辑
- 所有 handler 必须调用 `clearSessionArtifacts()` 函数

**修改 /clear 行为时**：
1. **只修改** `src/session-artifacts.ts`
2. **不修改** 各个 handler 的 /clear 分支（仅调用统一入口）
3. **验证**：`npm test -- test/session-artifacts.test.ts` 通过

**新增 session 清理能力时**：
- 优先在 `clearSessionArtifacts()` 中添加
- 如需特殊逻辑，先评估是否应该成为通用能力
- 保持单一真相源原则

---

## MLX 冒烟测试（v2.2）

> 快速验证 MLX LM Server 可用性和基础功能的自动化测试套件

### 一键执行

```bash
npm run mlx:smoke
```

### 测试流程

测试脚本按以下顺序执行：

| 步骤 | 脚本 | 说明 | 失败策略 |
|------|------|------|----------|
| 1 | `stop-server.sh` | 停止现有 MLX server | 忽略失败 |
| 2 | `start-server.sh` | 启动 MLX server | 失败则中止 |
| 3 | `check-health.sh` | 健康检查（/v1/models） | 失败则中止 |
| 4 | `probe-basic.sh` | 基础响应测试（5 轮） | 记录失败 |
| 5 | `probe-tool-role.sh` | Tool role 测试（10 轮） | 记录失败 |
| 6 | `probe-tool-loop.sh` | Tool loop 测试（10 轮） | 记录失败 |

### 输出报告

测试结果自动保存到：
```
AIDOCS/msgcode-2.2/mlx-lab/results/smoke-run-YYYYMMDD-HHMM.md
```

报告包含：
- 执行摘要（总数/通过/失败/通过率）
- 每个测试的详细结果
- 失败日志（如有）
- 执行信息（日期/时长/版本）

### 环境要求

**必需环境变量**（可选，有默认值）：
```bash
# MLX 模型路径
export MLX_MODEL_PATH=~/Models/your-model

# MLX server 配置
export MLX_BASE_URL=http://127.0.0.1:18000
export MLX_MAX_TOKENS=512
```

**前置条件**：
- macOS（Apple Silicon）
- MLX LM Server 已安装
- Python 3.10+

### 单独执行测试

如需单独运行某个测试：

```bash
# 健康检查
bash scripts/mlx-lab/check-health.sh

# 基础测试
bash scripts/mlx-lab/probe-basic.sh

# Tool role 测试
bash scripts/mlx-lab/probe-tool-role.sh

# Tool loop 测试
bash scripts/mlx-lab/probe-tool-loop.sh
```

---

**继续阅读**

| 类型 | 链接 |
|------|------|
| 测试脚本 | [scripts/mlx-lab/](../../scripts/mlx-lab/) |
| 测试报告 | [AIDOCS/msgcode-2.2/mlx-lab/results/](./mlx-lab/results/) |
| MLX Provider | [src/providers/mlx.ts](../../src/providers/mlx.ts) |
