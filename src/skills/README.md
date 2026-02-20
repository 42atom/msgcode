# Skills

## 目录结构

```
src/skills/
├── README.md               # 本目录说明
├── index.ts                # 导出聚合（仅聚合，不承载逻辑）
├── types.ts                # 类型定义（SkillId, SkillContext, SkillResult 等）
├── registry.ts             # 技能注册表（注册、发现、检测、路由）
├── auto.ts                 # 自然语言触发（向后兼容）
└── builtin/                # 内置技能实现（R3-R8）
    ├── file-manager.ts     # R3: 文件管理（find/read/write/move/delete/copy/zip）
    ├── memory-skill.ts     # R4: 记忆管理（search/add/stats）
    ├── thread-skill.ts     # R4: 线程管理（list/messages/switch/active）
    ├── todo-skill.ts       # R5: 任务管理（add/list/done）
    ├── schedule-skill.ts   # R5: 调度管理（add/list/remove）
    ├── media-skill.ts      # R6: 媒体感知（screen）
    ├── gen-skill.ts        # R6: 内容生成（image/selfie/tts/music）
    ├── browser-skill.ts    # R7: 浏览器自动化（open/click/type）
    └── agent-skill.ts      # R8: 代理任务（run/status）
```

## 职责边界

- `types.ts`：纯类型定义，不承载逻辑
- `registry.ts`：技能注册、发现、检测、路由分发
- `index.ts`：导出聚合，方便外部引用
- `auto.ts`：自然语言触发（向后兼容，保留 system-info）
- `builtin/*`：技能能力描述，**不含执行副作用**（实际执行走 CLI 命令合同）

## 架构决策

### 技能存储位置

| 位置 | 用途 | 说明 |
|------|------|------|
| `src/skills/builtin/` | 内置技能骨架 | 编译后随包分发 |
| `~/.config/msgcode/skills/` | 用户技能目录 | 运行时加载，用户可自定义 |
| `<workspace>/.msgcode/skills/` | 项目级技能 | 项目特定技能（待实现） |

### 安装时复制逻辑

- `msgcode init` 时自动复制 `builtin/` 到 `~/.config/msgcode/skills/`
- **幂等原则**：仅首次创建，已存在文件不覆盖
- **覆盖开关**：`msgcode init --overwrite-skills` 强制覆盖

### R1c 边界原则

- `builtin/*` 只描述能力，**不含执行副作用**
- 实际执行统一走 CLI 命令合同（如 `msgcode file read`）
- Skill 层只做：检测 → 路由 → CLI 调用 → 结果返回

## 开发规范

### 新增技能流程

1. 在 `types.ts` 扩展 `BuiltinSkillId` 枚举
2. 在 `registry.ts` 注册技能元信息（`initSkillRegistry`）
3. 在 `builtin/` 创建技能实现文件
4. 在 `index.ts` 添加导出

### 技能检测扩展

- 关键词匹配：在 `registry.ts` 的 `detectSkillMatch` 中扩展
- 意图识别：后续可接入 LLM 意图识别模型

### 输出规范

- 保持结构化输出（JSON）
- 错误码固定枚举（参考 R1c 硬门）
- 退出码非 0 表示失败

## 运行时序

```
用户消息
   ↓
detectSkillMatch() → 技能检测
   ↓
runSkill() → 路由分发
   ↓
builtin/*.ts → 能力描述
   ↓
CLI 命令合同 → 实际执行
   ↓
返回结果
```

## 变更日志

- 2026-02-20：重构技能系统，新增 registry.ts + types.ts + builtin/* (R3-R8)
- 2026-02-18：新增 auto skill 最小骨架与 system-info
