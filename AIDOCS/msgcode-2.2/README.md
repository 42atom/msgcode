# msgcode 2.2（规划文档）

> 目标：把"跨 App 的 GUI 自动化"做成系统级能力，并解决 macOS TCC（屏幕录制/辅助功能）对后台 daemon 的限制。

## 目录

```
AIDOCS/msgcode-2.2/
├── README.md                          # 本目录索引
├── roadmap_v2.2.md                    # 2.2 总路线图（控盘版：里程碑/验收/风险）
├── session_registry_spec_v2.2.md       # P0：tmux 会话元数据落盘（重启不丢 /status 口径）
├── control_lane_spec_v2.2.md           # P0：只读命令快车道（/status /where /help 秒回）
├── orchestration_plan_v2.2.md         # Persona/Skills/Schedules 编排层规划 v2.2
├── osaurus_integration_plan_v2.2.md   # osaurus 参考笔记（对照用，不纳入交付）
├── desktop_bridge_contract_v2.2.md    # Desktop Host/Bridge 的 JSON-RPC 契约（P0）
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
  "runner.default": "lmstudio",         // lmstudio | codex | claude
  "persona.active": "coder",            // 当前激活 persona
  "memory.inject.enabled": false,       // 记忆注入（默认关闭）
  "skills.enabled": ["skill-id"]        // 启用的技能列表
}
```

---

## Slash Commands（v2.2）

### 一级命令（常用）

| 命令 | 说明 |
|------|------|
| `/bind <dir> [client]` | 绑定群组到工作目录 |
| `/where` | 查看当前群组绑定 |
| `/model [runner]` | 查看或切换执行臂 |
| `/policy [mode]` | 查看或切换策略模式 |
| `/start /stop /esc /clear` | 会话管理 |
| `/persona list\|use <id>\|current` | Persona 管理 |
| `/schedule list\|validate\|enable <id>\|disable <id>` | Schedule 管理 |
| `/reload` | 重新扫描加载配置 |
| `/tts <text>` | 语音生成（LM Studio 专用） |

### 二级命令（诊断）

| 命令 | 说明 |
|------|------|
| `/status` | 查看会话状态（秒回，不抢占） |
| `/info /chatlist` | 查看处理状态/群组列表 |
| `/mem on\|off\|force\|status` | 记忆注入控制 |

### 关键特性

- **Control Lane**: `/status /where /help` 秒回，不抢占，不重复回复
- **抢占中断**: `/esc /stop /clear` 允许中断长任务
- **回执**: 非 slash 消息超过 8s 发送"收到，执行中…请等我回复。"

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

- **LM Studio**: 立即生效（system_prompt 拼接）
- **Tmux (Codex/Claude)**: 需要 `/clear` 才完全切换（避免用户误解）

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
- 场景：`/policy local-only` → `/model codex` 返回"拒绝 + 提示 /policy egress-allowed"

**Persona Boundary**
- 验证 persona 注入口径（lmstudio 立即生效；tmux runner 提示边界）
- 场景：当 workspace runner=codex 时，`/persona use coder` 回复里必须包含"/clear 后完全生效"提示

### 发布检查清单

- [ ] `npm test` 全绿（226/226 pass）
- [ ] `npm run bdd` 全绿
- [ ] `npm run test:all` 全绿
