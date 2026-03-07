# Skills

## 单真相源说明（2026-03-08）

**runtime skills 是唯一正式真相源**：

- 真相源：`src/skills/runtime/` → `~/.config/msgcode/skills/`
- 执行主链：runtime skill -> bash -> CLI 命令
- builtin registry（`registry.ts`）为历史占位，不再作为技能执行的正式主链

**builtin registry 退役说明**：

- `registry.ts` 保留仅为向后兼容
- `runSkill()` 为占位实现，已退役
- `schedule-skill` / `browser-skill` 已被 runtime skills (`scheduler` / `patchright-browser`) 取代

## 目录结构

```
src/skills/
├── README.md               # 本目录说明（含单真相源说明）
├── index.ts                # 导出聚合（仅聚合，不承载逻辑）
├── types.ts                # 类型定义（SkillId, SkillContext, SkillResult 等）
├── registry.ts             # ⚠️ 历史占位 - 不再作为执行主链
├── auto.ts                 # 自然语言触发（向后兼容）
├── runtime-sync.ts         # runtime skill 安装/同步
└── runtime/                # 仓库托管的 runtime skill 真相源
    ├── index.json          # 托管 skill 索引（scheduler, patchright-browser）
    ├── scheduler/
    │   ├── SKILL.md
    │   └── main.sh
    └── patchright-browser/
        ├── SKILL.md
        └── main.sh
```

## 职责边界

- `types.ts`：纯类型定义，不承载逻辑
- `registry.ts`：⚠️ 历史占位 - 保留向后兼容，不再作为执行主链
- `index.ts`：导出聚合，方便外部引用
- `auto.ts`：自然语言触发（向后兼容，保留 system-info）
- `runtime/`：**正式技能真相源** - 执行主链：runtime skill -> bash -> CLI 命令

## 架构决策

### 技能存储位置

| 位置 | 用途 | 说明 |
|------|------|------|
| `src/skills/runtime/` | 仓库托管 runtime skills | 安装/启动时同步到用户目录 |
| `~/.config/msgcode/skills/` | 用户技能目录 | 运行时加载，用户可自定义 |
| `<workspace>/.msgcode/skills/` | 项目级技能 | 项目特定技能（待实现） |

### 安装时复制逻辑

- `msgcode init` 时自动同步 `src/skills/runtime/` 到 `~/.config/msgcode/skills/`
- `msgcode start` 时会 best-effort 补齐仓库托管 runtime skills，避免安装目录缺失
- **幂等原则**：仅首次创建，已存在文件不覆盖
- **覆盖开关**：`msgcode init --overwrite-skills` 强制覆盖

### R1c 边界原则

- `builtin/*` 只描述能力，**不含执行副作用**
- 实际执行统一走 CLI 命令合同（如 `msgcode file read`）
- Skill 层只做：检测 → 路由 → CLI 调用 → 结果返回

## 开发规范

### 新增 runtime skill 流程

1. 在 `src/skills/runtime/<skill-id>/` 新增 `SKILL.md` 与 `main.sh`
2. 更新 `src/skills/runtime/index.json`
3. 如有安装/同步逻辑变化，更新 `runtime-sync.ts`
4. 通过 `msgcode init` 或 `msgcode start` 触发同步

### 技能检测扩展

- 关键词匹配：在 `registry.ts` 的 `detectSkillMatch` 中扩展
- 意图识别：后续可接入 LLM 意图识别模型

### 输出规范

- 保持结构化输出（JSON）
- 错误码固定枚举（参考 R1c 硬门）
- 退出码非 0 表示失败

## Runtime Skill 安装时序

```
src/skills/runtime/
   ↓
runtime-sync.ts
   ↓
~/.config/msgcode/skills/
   ↓
Tool Loop / prompt 只读取用户目录 index.json
```

## 变更日志

- 2026-02-20：重构技能系统，新增 registry.ts + types.ts + builtin/* (R3-R8)
- 2026-02-18：新增 auto skill 最小骨架与 system-info
