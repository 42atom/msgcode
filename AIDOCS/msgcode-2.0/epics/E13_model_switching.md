# E13: 模型客户端切换（本机可执行）

## Goal
实现 msgcode 中的“模型客户端”切换能力：在不同群组/项目中选择不同的**本机可执行**客户端（例如 `claude`、`codex`、未来更多客户端），并提供最小可用的配置与命令。

## Background
- msgcode 的边界：只做“转发/落盘/路由/权限/能力接口”，**不直接接 API**，不管理 APIKEY。
- 因此这里的“模型”指 **本机模型客户端（可执行文件）**：
  - `claude`：Claude Code CLI
  - `codex`：Codex CLI（如果本机存在）
  - `opencode`：未来可选
  - 其它：未来新增

不同项目/场景可能需要不同客户端：
- 复杂架构设计 → `claude`
- 快速执行/脚本化 → `codex`（若存在）
- 后续再扩展更多客户端

## Scope
- 支持在绑定时指定客户端：`/bind <dir> [client]`（默认 `claude`）
- 支持运行时切换：`/model <name>`，并能查看当前：`/model`
- 支持 `msgcode probe` 报告可用客户端（仅检测本机可执行是否存在/可运行）

## Non-goals
- 不在此 Epic 内实现模型对比/A/B 测试
- 不实现模型负载均衡或自动选择
- 不实现模型配额管理
- 不实现任何云 API 调用（不涉及 APIKEY）
- 不实现“客户端缺失时自动降级”（直接回报未找到即可）

## Data Model

### 扩展 BotType（改为“client”语义）
```typescript
// src/router.ts
export type BotType =
  | "claude"     // Claude Code CLI（默认）
  | "codex"      // Codex CLI（本机可选）
  | "opencode"   // 未来可选
  | "image"      // 图像处理
  | "default";   // 默认处理器
```

### RouteStore 扩展
```typescript
interface RouteEntry {
  chatGuid: string;
  chatId?: string;
  workspacePath: string;
  label?: string;
  botType: BotType;
  status: "active" | "archived" | "paused";
  createdAt: string;
  updatedAt: string;

  // E13 新增
  modelClient?: ModelClient;  // 仅记录“选了哪个本机客户端”
}

type ModelClient = "claude" | "codex" | "opencode";
```

说明：
- 不写 APIKEY、不写 endpoint、不写云模型名（这些属于外部客户端/skill 的职责）
- msgcode 只记录“本项目选哪个客户端”

## User Interface

### 命令扩展

#### 绑定时指定客户端
```bash
/bind acme/ops          # 绑定到 $WORKSPACE_ROOT/acme/ops（默认 claude）
/bind acme/ops claude   # 显式指定 claude
/bind acme/ops codex    # 显式指定 codex（若本机存在）
```

#### 运行时切换客户端
```bash
/model claude           # 切换到 Claude
/model codex            # 切换到 Codex
/model                  # 查看当前客户端
```

#### 查看当前选择
```bash
/where                  # 显示当前绑定与客户端
/model                  # 显示当前客户端
```

### 帮助信息扩展
```bash
/help
```
输出：
```
msgcode 2.0 命令帮助

群组管理:
  /bind <dir> [client]   绑定工作目录（默认 claude；可选 claude/codex/opencode）
  /where                 查看当前绑定与客户端
  /unbind                解除绑定
  /model <name>          切换客户端（claude/codex/opencode）

会话管理:
  /chatlist              列出所有绑定
  /start                 启动会话
  /stop                  停止会话
  /status                查看状态
  /clear                 清空上下文

示例:
  /bind acme/ops          默认 claude
  /bind api/gateway codex 显式指定 codex
  /model claude           切换到 claude
```

## Implementation Phases

### Phase 1: 仅“选择与回显”（最小闭环）
- [ ] 扩展 `BotType` 类型定义
- [ ] 更新 `/bind` 命令支持可选的 `client` 参数（`/bind <dir> [client]`）
- [ ] `/where` 回显当前 client（不存在则默认 claude）
- [ ] `/model` 命令：查看/切换 client
- [ ] 若 client 在本机不存在：直接回报并要求用户安装

**验收**：
```bash
/bind test/claude claude  # ✓ 绑定成功
/bind test/codex codex    # ✓ 绑定成功
/where                    # ✓ 显示正确的模型
```

### Phase 2: 多客户端扩展位（不落地实现）
- [ ] 定义 `ModelClientRegistry`（仅文档）
- [ ] 约定检测方式：`which <bin>` + `<bin> --version`（或 `--help`）
- [ ] `msgcode probe` 报告可用 client 列表

## Technical Design

### 执行策略（2.0 约束）
- msgcode 不直接调用云 API，只负责把“用户消息”转发到当前 workspace 里的 tmux 会话。
- tmux 里跑哪个客户端（claude/codex/其它）由 `/start` 启动命令决定。
- 若选择的 client 在本机不存在：直接回报并要求用户安装。

### 模型配置加载优先级
1. RouteStore 的 `modelClient`（运行时设置）
2. 绑定时指定的 client
3. 全局默认值（claude）

## Guardrails

### 安全性
- 不涉及 APIKEY
- 模型切换需要白名单权限（owner only）

### 兼容性
- `.msgcode.json` 缺失时使用默认配置
- 无效的模型配置回退到 claude
- 保持向后兼容：旧绑定默认使用 claude

### 错误处理
- 客户端不存在：直接提示“未找到”，并给出安装建议（不降级）

## Audit
每次模型切换记录：
```jsonl
{
  "event": "model.switch",
  "chatGuid": "any;+;...",
  "from": "claude",
  "to": "codex",
  "timestamp": "2026-01-29T10:00:00.000Z",
  "trigger": "command"
}
```

## Open Questions
1. **模型切换时的上下文处理**：是否保留之前的对话历史？
   - 选项 A：清空上下文（简单，丢失历史）
   - 选项 B：尝试迁移上下文（复杂，可能不兼容）

2. **多模型并发**：是否允许同时运行多个模型？
   - 建议：Phase 1 不支持，后续可考虑

3. **成本控制**：是否需要记录每个模型的 API 调用成本？
   - 建议：记录调用次数，成本由外部系统计算

## Acceptance Criteria
- [x] 数据模型设计完成
- [ ] Phase 1: 选择与回显（不涉及云 API）
- [ ] 文档更新完整
- [ ] 所有测试通过

## Related Epics
- E08: 控制面（群绑定）
- E02: iMessage Provider 改造
- E11: Capability API Skills
