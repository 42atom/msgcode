# Skills

## 单真相源说明（2026-03-08）

**runtime skills 是唯一正式常驻真相源**：

- 真相源：`src/skills/runtime/` → `~/.config/msgcode/skills/`
- 执行主链：runtime skill -> 真实调用合同（原生工具 / 直接 CLI / 少数桥接脚本）
- 不再保留 repo 内的 builtin registry 主链

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

**自包含分发原则（2026-03-11）**：

- msgcode skill 必须以 repo 为真相源，能随仓库一起分发
- 不允许依赖用户目录中的其他外部 skill 仓库
- 不允许通过 symlink 把 repo skill 指向外部实现
- 若外部 skill 的脚本或资产确有必要，必须复制或 vendor 到 `src/skills/runtime/<skill-id>/` 或 `src/skills/optional/<skill-id>/`
- 允许依赖外部服务、系统命令、环境变量；不允许依赖“另一份本地 skill 仓库”

**repo 侧兼容层说明**：

- `auto.ts` 只保留最小 auto skill：`system-info`
- `types.ts` 只表达这条 repo 侧最小兼容接口
- 历史 `registry.ts` / `runtime/skill-orchestrator.ts` 已退出主链并归档到 `.trash/`

## 目录结构

```
src/skills/
├── README.md               # 本目录说明（含单真相源说明）
├── index.ts                # repo 侧最小兼容导出
├── types.ts                # repo 侧最小兼容类型
├── auto.ts                 # 自然语言触发（仅保留 system-info）
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
│   ├── reactions/
│   │   └── SKILL.md
│   └── subagent/
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
    │   └── SKILL.md
    ├── thread/
    │   └── SKILL.md
    ├── todo/
    │   ├── SKILL.md
    │   └── main.sh
    ├── media/
    │   └── SKILL.md
    ├── gen/
    │   └── SKILL.md
    ├── banana-pro-image-gen/
    │   ├── SKILL.md
    │   ├── main.sh
    │   ├── references/
    │   ├── scripts/
    │   └── templates/
    ├── vision-index/
    │   └── SKILL.md
    ├── local-vision-lmstudio/
    │   ├── SKILL.md
    │   ├── main.sh
    │   └── scripts/
    │       └── analyze_image.py
    └── patchright-browser/
        └── SKILL.md
```

## 职责边界

- `types.ts`：repo 侧最小兼容类型
- `index.ts`：repo 侧导出聚合，不承载技能逻辑
- `auto.ts`：自然语言触发（仅保留 system-info）
- `runtime/`：**正式技能真相源** - 描述真实调用合同，不默认把所有任务导向 bash/CLI
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
- skill 默认主体是 `SKILL.md`
- 实际执行优先走 canonical 入口：
  - 直接工具
  - 直接 CLI 命令合同（如 `msgcode file read`）
  - 少数真实桥接脚本
- 不要为了 CLI 再额外包一层 alias `main.sh`

## 开发规范

### 新增 runtime skill 流程

1. 在 `src/skills/runtime/<skill-id>/` 新增 `SKILL.md`
2. 只有当 skill 的真实 canonical 入口就是稳定脚本 / 跨语言桥接时，才额外提供 `main.sh`
3. 更新 `src/skills/runtime/index.json`
4. 如有安装/同步逻辑变化，更新 `runtime-sync.ts`
5. 通过 `msgcode init` 或 `msgcode start` 触发同步

### 新增 optional skill 流程

1. 在 `src/skills/optional/<skill-id>/` 新增 `SKILL.md`
2. 更新 `src/skills/optional/index.json`
3. 如有安装/同步逻辑变化，更新 `runtime-sync.ts`
4. 不要把 optional skill 加进 `src/skills/runtime/index.json`

### repo 侧 auto skill 扩展

- 如需继续保留 repo 侧自然语言兼容入口，直接在 `auto.ts` 增补
- 不要再恢复一套独立 registry/orchestrator

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
