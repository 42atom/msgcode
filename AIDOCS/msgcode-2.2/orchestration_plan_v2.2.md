# Persona + Skills + Schedules（v2.2）

> 一句话：把“人格/技能/定时”从 prompt 里解耦出来，变成 **workspace 可控、可落盘、可审计** 的编排层；默认可用（egress-allowed），高敏场景再切 local-only。

---

## 0) 单一真相源：Workspace Config

- 路径：`<WORKSPACE>/.msgcode/config.json`
- 原则：群内命令只能修改“当前群绑定的 workspace”；禁止跨群修改
- 默认：人格/skills/定时均为关闭或最小权限（避免自动跑偏）
- 配置更新：先做 **手动 reload**（可预测、可控）；后续再考虑 watch/debounce

建议 schema（v1，最小够用）：
```jsonc
{
  "version": 1,
  "policy": {
    "mode": "egress-allowed",      // local-only | egress-allowed
    "toolConfirm": "required"      // required | none（仅 owner 可改）
  },
  "runner": {
    "default": "lmstudio"          // lmstudio | codex | claude-code（2.2：codex 优先，建议设为默认）
  },
  "persona": {
    "activeId": "doctor-chen"
  },
  "skills": {
    "enabled": []                // 默认全关；按需 /skill enable <skillId>
  },
  "schedule": {
    "enabled": false
  }
}
```

### 0.1 Reload（手动收口）

文件系统是唯一真相源，但“生效”需要一个明确的边界：**reload**。

P0 行为（建议）：
- menubar：提供一个菜单项 `Reload Config`（只做触发，不做编辑器）
- reload 做的事：重新扫描并校验以下目录/文件，然后刷新内存态（不重启也能生效）
  - `<WORKSPACE>/.msgcode/config.json`
  - `~/.config/msgcode/skills/`
  - `~/.config/msgcode/voices/`
  - `<WORKSPACE>/.msgcode/personas/`
  - `<WORKSPACE>/.msgcode/schedules/`
- reload 的输出：只反馈 `valid/invalid + reason` 与“变更摘要”（哪些新增/删除/变更）

给未来 AI 的 hook（P0 只留约定）：
- AI 若写入/修改了 skill/schedule/persona/config 文件，必须在回复里提示用户“已写入，执行 Reload 生效”
- P1 才考虑让 AI 直接触发 reload（走同一条门禁/确认）

---

## 1) Persona（人格）

### 1.1 落盘结构（每 workspace）
```
<WORKSPACE>/
└── .msgcode/
    └── personas/
        ├── index.json                 # 列表（轻量）
        └── <personaId>.json           # persona 定义
```

### 1.2 Persona 定义（最小）
```jsonc
{
  "id": "doctor-chen",
  "name": "陈医生",
  "description": "临床风格、谨慎、先问诊再建议",
  "defaultModelRoute": "chat-main",
  "systemPrompt": "…",
  "generation": { "maxTokens": 800, "temperature": 0.3 },
  "enabledTools": {
    "read-only": true,
    "local-write": false,
    "message-send": true,
    "process-control": false,
    "ui-control": false
  },
  "enabledSkills": [],
  "outputContract": { "text": true, "voice": false }
}
```

### 1.3 群内命令（建议）
- `/persona list`
- `/persona use <personaId>`
- `/persona show`

验收（P0）：
- persona 可落盘、可切换；切换后下一条消息立即生效
- `doctor --json` 能显示当前 workspace active persona（可选 P1）

### 1.4 执行臂（Claude Code / Codex）兼容（P0）

目标：同一套编排层不绑定某一家“代码执行器”，而是把它们当作可替换的 **runner**：
- `claude-code`：Claude Code 作为执行臂（偏代码编辑/测试/仓库任务）
- `codex`：Codex CLI 作为执行臂（偏代码生成/修改/测试）
- `lmstudio`：本地对话/轻推理（可作为默认聊天路由）

核心约束（禅意）：
- workspace 只选择 **路由名**（如 `chat-main` / `coding-arm`）；底层 runner 可替换但路由名稳定
- `policy.mode=local-only` 时：禁止调用需要 egress 的 runner（例如 codex/claude-code），必须显式切到 `egress-allowed`
- runner 的安装/可用性属于“机器配置”，由 `doctor/preflight` 负责提示（不把复杂开关塞进 persona）

优先级（2.2）：
- **Codex 兼容优先**：保证你在手机 iMessage 里也能“远程对话/远程办事”（daemon 常驻 + `/model codex` 可用）

落盘策略（定案）：
- `/model codex` 视为“把 codex 设为该 workspace 的默认执行臂”，写入 `<WORKSPACE>/.msgcode/config.json -> runner.default`
- `policy.mode=local-only` 时不允许把默认 runner 设为 codex/claude-code（必须先切 `egress-allowed`）

---

## 2) Skills（技能）

目标：技能是“可复用能力包”，而不是散落在提示词里的长段规则。

### 2.1 落盘结构（定案：只做全局目录）

我们不做包管理（不绑定 npx），也不在 GUI 里“编辑 skill 内容”。  
Skill 就是一个文件夹；用户要改就自己改；msgcode 只负责：**列出 + 校验有效性 + 选择启用**。

```
~/.config/msgcode/skills/<skillId>/
  ├── manifest.json
  └── SKILL.md
```

workspace 里只记录“启用哪些”：
- `<WORKSPACE>/.msgcode/config.json` → `skills.enabled[]`

### 2.2 Two-phase loading（省 token、稳行为）
- catalog phase：只给 `id/name/description/sideEffects`
- selection：模型选择要用哪些
- execution：只加载被选中的 `SKILL.md`

### 2.3 有效性校验（P0 必做）
`manifest.json`（最小）：
- 必须字段：`id/name/description/sideEffects`
- `sideEffects` 必须落在：`read-only | local-write | message-send | process-control | ui-control`
- 任何缺失/非法 → 标记 `invalid`，且默认不可启用

`SKILL.md`：
- 文件必须存在且非空
- 只做基本长度与编码检查（避免 0 字节/乱码）

### 2.3 命令面（建议）
- `/skill list`
- `/skill enable <skillId>`
- `/skill disable <skillId>`
- `/skill status`

验收（P0）：
- persona 切换会影响 skills enablement
- skills 的副作用等级必须显式声明（read-only/local-write/...），否则默认拒绝执行

### 2.4 GUI 原则（禅意版）
- 只显示：已发现的 skills + valid/invalid + sideEffects + 本 workspace 是否启用
- 只提供一个入口：**在 Finder 打开 `~/.config/msgcode/skills/`**
- 编辑与创建：由用户在文件系统内完成（msgcode 不接管）

---

## 2.5 TTS 音色库（全局目录，P0 约定）

目标：用户/AI 都能通过“写文件 + reload”来管理音色；msgcode 只负责 **扫描 + 校验 + 切换**。

目录结构（定案）：
```
~/.config/msgcode/voices/
  └── <voiceId>/
      ├── voice.json         # 元数据（必需）
      ├── <stem>.<m4a|wav|mp3|caf>   # 参考音频（clone 必需）
      └── <stem>.txt                 # 参考台词（clone 必需）
```

`voice.json`（最小 schema）：
```jsonc
{
  "id": "ymvoice",
  "name": "我的默认音色",
  "engine": "qwen3-tts",
  "kind": "builtin",          // builtin | clone | voicedesign
  "builtin": { "voice": "Serena" },
  "voicedesign": { "instruct": "温柔女声，语速稍慢" },
  "defaults": { "speed": 1.05, "temperature": 0.4, "gainDb": 9 }
}
```

校验口径（P0）：
- `kind=builtin`：必须有 `builtin.voice`
- `kind=clone`：
  - 必须存在 **且仅存在 1 组** “同名配对文件”（同一个 `<stem>`）：
    - `<stem>.<m4a|wav|mp3|caf>`
    - `<stem>.txt`
  -（P0 不支持多组参考；P1 才考虑通过 voice.json 指定 stem）
- `kind=voicedesign`：必须有 `voicedesign.instruct`
- 任一非法 → 标记 invalid，且不可选为默认

切换策略（P0）：
- workspace 可选一个默认音色（可选字段）：`<WORKSPACE>/.msgcode/config.json -> tts.voiceId`
- 即时切换优先走 slash（P0 先约定命令名即可）：`/voice use <voiceId>`（写文件 + 提示 reload）

---

## 3) Schedules（定时任务）

结论：v2.2 不新造轮子：**调度引擎复用 msgcode Jobs**；但为了“禅意管理”，**Schedule 定义用文件做真相源**（用户/AI 都能写文件，系统只做校验与执行）。

### 3.0 定义即文件（禅意：你写文件，我负责跑）

每个 workspace 一组 schedules，用户在 Finder 里编辑即可：
```
<WORKSPACE>/
└── .msgcode/
    └── schedules/
        ├── README.md          # 样例与约定（可选）
        └── <scheduleId>.json  # 一条 schedule（建议与 jobId 同名）
```

行为约定（P0）：
- daemon 启动/运行中会扫描并校验该目录；发现新增/修改后自动纳入（invalid 则拒绝执行）
- menu app 只提供一个入口：**打开当前 workspace 的 `.msgcode/schedules/`**
- schedule 文件只包含“定义”，运行态（nextRun/lastRun/runs）仍由 Jobs 体系落盘维护（避免你手滑改坏 state）

### 3.1 统一表达：Schedule = Job（payload 扩展）
新增 payload kinds（建议）：
- `payload.kind = "capabilityRun"`：定时跑某个能力（如 `memory.index`）
- `payload.kind = "skillRun"`：定时跑某个 skill（按 persona 的工具权限执行）

建议字段：
```jsonc
{
  "personaId": "doctor-chen",
  "payload": {
    "kind": "skillRun",
    "skillId": "daily-review",
    "inputs": { "days": 1 }
  }
}
```

### 3.2 规则（必须）
- `policy.mode=local-only` 时：禁止 egress（web/remote api），只允许本地能力
- 高风险副作用（process-control/ui-control）：必须走 msgcode 手机端确认（/approve）
- 证据落盘：每次 schedule run 必须写 run 记录（inputs/outputs/evidence）

验收（P0）：
- 能创建一个“每日总结/索引维护”类 schedule（job）
- daemon 重启后能恢复 nextRun/nextWake（不靠内存态）
