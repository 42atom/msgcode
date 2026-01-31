# E15: 可观测性探针

## Goal
提供统一的健康检查与状态探针功能，一次性看清 msgcode 的权限/路径/路由/tmux/Claude 等核心状态，便于运维与调试。

## Background

### 现状问题
- **排障困难**：出问题时需要逐个检查各组件状态
- **状态分散**：权限、路径、路由、tmux、Claude 状态散落各处
- **缺少汇总视图**：没有统一的健康状态报告
- **调试成本高**：新手用户难以自行诊断问题

### 解决思路
- 实现 `msgcode status` 命令，输出结构化的健康报告
- 实现 `msgcode probe` 命令，运行诊断探针
- 各模块提供统一的健康检查接口
- 输出格式：人类可读 + 机器可解析

## Scope
- 实现 `msgcode status` CLI 命令
- 实现 `msgcode probe` CLI 命令
- 各模块健康检查接口
- 支持输出格式：text（默认）| json

## Non-goals
- 不实现实时监控仪表盘（可用外部工具）
- 不实现告警通知（可后续扩展）
- 不实现性能指标采集（如延迟、吞吐）

## Probe 分类

### 1. 环境探针
- 检查 macOS 版本
- 检查 Node.js 版本
- 检查 imsg 二进制存在性与版本
- 检查 Claude CLI 存在性与版本

### 2. 权限探针
- 检查 `~/Library/Messages` 访问权限
- 检查 `~/.config/msgcode` 写权限
- 检查 tmux 可用性
- 检查完全磁盘访问权限

### 3. 配置探针
- 检查 `.env` 文件存在性
- 验证必需环境变量（`IMSG_PATH`, `MY_EMAIL`）
- 检查 `WORKSPACE_ROOT` 可访问性
- 验证配置文件格式

### 4. 路由探针
- 列出所有活跃绑定
- 验证工作目录存在性
- 检查 tmux 会话状态
- 显示最后活动时间

### 5. 连接探针
- 检查 imsg RPC 连接状态
- 检查 tmux 会话连接状态
- 检查 Claude CLI 可用性

### 6. 资源探针
- 检查磁盘空间
- 检查内存使用
- 检查日志文件大小

## Output Format

### text 格式（默认）
```
msgcode 2.0 状态报告
====================

环境: ✅ 通过
  macOS: 15.2
  Node.js: v20.x
  imsg: v0.4.0 (✓ 可执行)
  Claude CLI: ✓ 可用

权限: ⚠️  警告
  ~/Library/Messages: ✅ 可读
  ~/.config/msgcode: ✅ 可写
  完全磁盘访问: ❌ 未授权

配置: ✅ 通过
  .env 文件: ✅ 存在
  IMSG_PATH: ✅ 已设置
  MY_EMAIL: ✅ 已设置
  WORKSPACE_ROOT: ✅ 可访问

路由: ✅ 2 个活跃绑定
  [1] acme/ops
      目录: ~/msgcode-workspaces/acme/ops
      Tmux: ✅ 运行中
      最后活动: 5 分钟前

  [2] clientA
      目录: ~/msgcode-workspaces/clientA
      Tmux: ⚠️  未运行
      最后活动: 2 小时前

连接: ⚠️  部分异常
  imsg RPC: ✅ 已连接
  tmux: ⚠️  1/2 会话未运行

资源: ✅ 正常
  磁盘剩余: 128 GB
  内存使用: 512 MB / 16 GB
  日志大小: 2.3 MB

====================
总结: 2 警告，1 错误
```

### json 格式
```json
{
  "version": "1.0",
  "timestamp": "2026-01-29T10:00:00.000Z",
  "summary": {
    "status": "warning",
    "environment": "pass",
    "permissions": "warning",
    "config": "pass",
    "routes": "pass",
    "connections": "warning",
    "resources": "pass",
    "warnings": 2,
    "errors": 1
  },
  "probes": {
    "environment": {
      "status": "pass",
      "details": {
        "macos_version": "15.2",
        "node_version": "v20.x",
        "imsg_version": "0.4.0",
        "imsg_executable": true,
        "claude_cli": true
      }
    },
    "permissions": {
      "status": "warning",
      "details": {
        "messages_read": true,
        "config_write": true,
        "full_disk_access": false
      }
    },
    "config": {
      "status": "pass",
      "details": {
        "env_file_exists": true,
        "imsg_path_set": true,
        "my_email_set": true,
        "workspace_root_accessible": true
      }
    },
    "routes": {
      "status": "pass",
      "details": [
        {
          "label": "acme/ops",
          "workspace_path": "/Users/admin/msgcode-workspaces/acme/ops",
          "tmux_running": true,
          "last_activity_minutes_ago": 5
        },
        {
          "label": "clientA",
          "workspace_path": "/Users/admin/msgcode-workspaces/clientA",
          "tmux_running": false,
          "last_activity_minutes_ago": 120
        }
      ]
    },
    "connections": {
      "status": "warning",
      "details": {
        "imsg_rpc_connected": true,
        "tmux_sessions_running": 1,
        "tmux_sessions_total": 2
      }
    },
    "resources": {
      "status": "pass",
      "details": {
        "disk_free_gb": 128,
        "memory_used_mb": 512,
        "memory_total_mb": 16384,
        "log_size_mb": 2.3
      }
    }
  }
}
```

## Implementation

### Phase 1: Probe 接口定义
```typescript
// src/probe/types.ts
export interface ProbeResult {
  status: "pass" | "warning" | "error" | "skip";
  message: string;
  details?: Record<string, unknown>;
}

export interface ProbeCategory {
  name: string;
  probes: ProbeResult[];
  status: "pass" | "warning" | "error";
}

export interface StatusReport {
  version: string;
  timestamp: string;
  summary: {
    status: "pass" | "warning" | "error";
    warnings: number;
    errors: number;
  };
  categories: Record<string, ProbeCategory>;
}
```

### Phase 2: 各模块探针实现
```typescript
// src/probe/probes/environment.ts
export async function probeEnvironment(): Promise<ProbeResult> {
  // 检查 macOS 版本、Node.js、imsg、Claude CLI
}

// src/probe/probes/permissions.ts
export async function probePermissions(): Promise<ProbeResult> {
  // 检查各种权限
}

// src/probe/probes/config.ts
export async function probeConfig(): Promise<ProbeResult> {
  // 检查配置文件和环境变量
}

// src/probe/probes/routes.ts
export async function probeRoutes(): Promise<ProbeResult> {
  // 检查路由状态
}

// src/probe/probes/connections.ts
export async function probeConnections(): Promise<ProbeResult> {
  // 检查连接状态
}

// src/probe/probes/resources.ts
export async function probeResources(): Promise<ProbeResult> {
  // 检查资源使用
}
```

### Phase 3: CLI 命令实现
```typescript
// src/commands/status.ts
export async function statusCommand(options: {
  format: "text" | "json";
}): Promise<void> {
  const report = await runAllProbes();

  if (options.format === "json") {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatStatusText(report));
  }
}

export async function probeCommand(options: {
  category?: string;
  format: "text" | "json";
}): Promise<void> {
  // 运行特定探针或所有探针
}
```

### Phase 4: 集成到现有代码
- [x] listener.ts：主链路可观测（日志 + cursor）
- [x] CLI：添加 `msgcode status` 和 `msgcode probe` 命令

## Commands

### CLI 命令
```bash
# 查看完整状态报告
msgcode status

# 输出 JSON 格式
msgcode status --format json

# 运行特定探针
msgcode probe --category environment
msgcode probe --category permissions
```

### 群组命令
```bash
/status           # 查看系统状态（快捷方式）
/status json      # JSON 格式输出
```

## Technical Details

### 探针执行顺序
1. 环境（最快，先过滤明显问题）
2. 配置（验证基础设置）
3. 权限（常见问题源）
4. 连接（依赖外部服务）
5. 路由（业务逻辑）
6. 资源（最后检查）

### 超时控制
```typescript
const PROBE_TIMEOUT = 5000; // 5 秒超时
const CONNECTION_TIMEOUT = 2000; // 2 秒连接超时
```

### 错误处理
- 单个探针失败不影响其他探针
- 连接超时视为警告而非错误
- 异常捕获并记录，不中断整个流程

## Usage Examples

### 场景 1：快速健康检查
```bash
$ msgcode status
环境: ✅ 通过
配置: ✅ 通过
...
总结: 无问题
```

### 场景 2：调试权限问题
```bash
$ msgcode probe --category permissions
权限: ❌ 错误
  ~/Library/Messages: ❌ 无访问权限
  建议：授予"完全磁盘访问权限"
```

### 场景 3：JSON 解析（自动化）
```bash
$ msgcode status --format json | jq '.summary.status'
"warning"
```

## Acceptance Criteria
- [x] `msgcode status` 命令可用
- [x] `msgcode probe` 命令可用
- [x] 支持文本和 JSON 两种输出格式
- [x] 覆盖 6 大类探针
- [x] 探针失败不影响其他探针
- [x] 状态报告易于阅读
- [x] JSON 输出符合 schema（probe 输出）

## Related Epics
- E02: iMessage Provider 改造
- E08: 控制面（群绑定）
- E14: 收消息游标
