# Skills

## 单真相源说明（2026-03-08）

**runtime skills 是唯一正式常驻真相源**：

- 真相源：`src/skills/runtime/` → `~/.config/msgcode/skills/`
- 执行主链：runtime skill -> bash -> CLI 命令
- builtin registry（`registry.ts`）为历史占位，不再作为技能执行的正式主链

**optional skills 是 repo 内置的按需扩展层**：

- 真相源：`src/skills/optional/` → `~/.config/msgcode/skills/optional/`
- 发现方式：先读 `~/.config/msgcode/skills/index.json`；主索引无匹配时，再按需读 `~/.config/msgcode/skills/optional/index.json`
- 目标：属于 msgcode 自带能力，但不默认塞进模型常驻上下文

**runtime skill 文案格式统一为能力说明书**：

- `YAML frontmatter`：`name` + `description`
- `能力`：这项 skill 解决什么问题
- `何时使用`：触发条件
- `调用合同`：真实 CLI / 脚本 / 接口长什么样
- `参考调用 / 验证 / 常见错误`：让 LLM 读完就能执行，不靠猜参数

补充原则：

- skill 更像 API 文档，不像流程编排器
- 优先告诉模型真实能力、真实参数、真实错误边界
- 不要为了“更贴心”再替模型发明 wrapper、拼装层、隐藏脚本层
- `main.sh` 只是兼容辅助物，不应默认成为所有 skill 的 canonical 入口
- `main.sh` 不是必选项；纯文档型 skill 可以只暴露 `SKILL.md`

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
├── optional/               # repo 内置按需技能（不进默认主索引）
│   ├── index.json
│   ├── twitter-media/
│   │   └── SKILL.md
│   ├── veo-video/
│   │   └── SKILL.md
│   ├── screenshot/
│   │   └── SKILL.md
│   ├── scrapling/
│   │   └── SKILL.md
│   └── reactions/
│       └── SKILL.md
└── runtime/                # 仓库托管的 runtime skill 真相源
    ├── index.json          # 托管 skill 索引（vision-index, local-vision-lmstudio, scheduler, plan-files, character-identity, feishu-send-file, memory, file, thread, todo, media, gen, banana-pro-image-gen, patchright-browser）
    ├── scheduler/
    │   ├── SKILL.md
    │   └── main.sh
    ├── plan-files/
    │   └── SKILL.md
    ├── character-identity/
    │   └── SKILL.md
    ├── memory/
    │   ├── SKILL.md
    │   └── main.sh
    ├── file/
    │   ├── SKILL.md
    │   └── main.sh
    ├── thread/
    │   ├── SKILL.md
    │   └── main.sh
    ├── todo/
    │   ├── SKILL.md
    │   └── main.sh
    ├── media/
    │   ├── SKILL.md
    │   └── main.sh
    ├── gen/
    │   ├── SKILL.md
    │   └── main.sh
    ├── banana-pro-image-gen/
    │   ├── SKILL.md
    │   ├── main.sh
    │   ├── references/
    │   ├── scripts/
    │   └── templates/
    ├── vision-index/
    │   ├── SKILL.md
    │   └── main.sh
    ├── local-vision-lmstudio/
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
- `optional/`：**可选扩展技能真相源** - 运行时会同步，但不并入默认主索引；仅在任务明显匹配或主索引无覆盖时按需读取

## 架构决策

### 技能存储位置

| 位置 | 用途 | 说明 |
|------|------|------|
| `src/skills/runtime/` | 仓库托管 runtime skills | 安装/启动时同步到用户目录 |
| `src/skills/optional/` | 仓库托管 optional skills | 安装/启动时同步到用户目录，但不进入默认主索引 |
| `~/.config/msgcode/skills/` | 用户技能目录 | 运行时加载，用户可自定义 |
| `<workspace>/.msgcode/skills/` | 项目级技能 | 项目特定技能（待实现） |

### 安装时复制逻辑

- `msgcode init` 时自动同步 `src/skills/runtime/` 到 `~/.config/msgcode/skills/`
- `msgcode init/start` 时自动同步 `src/skills/optional/` 到 `~/.config/msgcode/skills/optional/`
- `msgcode start` 时会 best-effort 补齐仓库托管 runtime skills，避免安装目录缺失
- **幂等原则**：仅首次创建，已存在文件不覆盖
- **覆盖开关**：`msgcode init --overwrite-skills` 强制覆盖

### R1c 边界原则

- `builtin/*` 只描述能力，**不含执行副作用**
- 实际执行统一走 CLI 命令合同（如 `msgcode file read`）
- Skill 层只做：检测 → 路由 → CLI 调用 → 结果返回

## 开发规范

### 新增 runtime skill 流程

1. 在 `src/skills/runtime/<skill-id>/` 新增 `SKILL.md`
2. 只有当 skill 的真实 canonical 入口就是稳定脚本 / CLI wrapper 时，才额外提供 `main.sh`
3. 更新 `src/skills/runtime/index.json`
4. 如有安装/同步逻辑变化，更新 `runtime-sync.ts`
5. 通过 `msgcode init` 或 `msgcode start` 触发同步

### 新增 optional skill 流程

1. 在 `src/skills/optional/<skill-id>/` 新增 `SKILL.md`
2. 更新 `src/skills/optional/index.json`
3. 如有安装/同步逻辑变化，更新 `runtime-sync.ts`
4. 不要把 optional skill 加进 `src/skills/runtime/index.json`

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

src/skills/optional/
   ↓
runtime-sync.ts
   ↓
~/.config/msgcode/skills/optional/
   ↓
主索引无匹配时，再按需读取 optional/index.json
```

## 变更日志

- 2026-02-20：重构技能系统，新增 registry.ts + types.ts + builtin/* (R3-R8)
- 2026-02-18：新增 auto skill 最小骨架与 system-info
