# MLX Lab - GLM4.7 Flash Autonomous 工具闭环实验

> **目的**: 验证 `mlx_lm.server` 是否能稳定支持本地 autonomous 工具闭环（重点看 `role=tool` 回灌）

**边界**: 不改当前主线默认策略（保持 `explicit`）；本任务仅新增实验脚本、实验文档、实验结果。

---

## 实验目的

验证 GLM4.7 Flash (MLX) 在 `mlx_lm.server` 后端下是否能稳定支持：

1. **基础响应**: 能正确响应简单指令
2. **Tool Role 处理**: 能正确理解 `role=tool` 的消息
3. **工具闭环**: 能完成两轮工具调用闭环（模拟 autonomous 工具编排）

---

## 模型配置

- **模型**: GLM4.7 Flash (MLX)
- **模型路径**: `/Users/admin/Models/glm-4.7-flash-chat-mlxf16/`（示例，需根据实际调整）
- **服务器**: `mlx_lm.server`
- **默认地址**: `http://127.0.0.1:18000`

---

## 快速开始

### 1. 设置环境变量

```bash
# 设置模型路径（必填）
export MLX_MODEL_PATH=/Users/admin/Models/glm-4.7-flash-chat-mlxf16/

# 可选：自定义端口
export MLX_BASE_URL=http://127.0.0.1:18000

# 可选：设置最大 tokens
export MLX_MAX_TOKENS=512
```

### 2. 启动服务

```bash
bash scripts/mlx-lab/start-server.sh
```

### 3. 健康检查

```bash
bash scripts/mlx-lab/check-health.sh
```

### 4. 执行验收测试

```bash
# 基础响应测试
bash scripts/mlx-lab/probe-basic.sh

# Tool Role 回灌测试
bash scripts/mlx-lab/probe-tool-role.sh

# 工具闭环测试
bash scripts/mlx-lab/probe-tool-loop.sh
```

### 5. 停止服务

```bash
bash scripts/mlx-lab/stop-server.sh
```

---

## 三类验收命令

### 1. 基础响应测试 (`probe-basic.sh`)

连续 5 次请求，Prompt：要求"只输出 OK"

**通过门槛**: `basic_pass >= 5/5`

```bash
bash scripts/mlx-lab/probe-basic.sh
```

### 2. Tool Role 回灌测试 (`probe-tool-role.sh`)

连续 10 次请求，消息包含：
- `system`: "你只能回答 TOOL= 后面的值，不能猜。"
- `tool`: `TOOL=42`
- `user`: "值是多少？只输出数字"

**通过门槛**: `tool_role_pass >= 9/10`

```bash
bash scripts/mlx-lab/probe-tool-role.sh
```

### 3. 工具闭环测试 (`probe-tool-loop.sh`)

模拟两轮闭环（10 次）：
- 第 1 轮：给"请调用工具读取值"并允许工具描述
- 本地脚本模拟工具执行结果（固定 `{"value":42}`）
- 第 2 轮：把 tool 结果以 `role=tool` 回灌，要求模型总结并仅输出 `42`

**通过门槛**: `tool_loop_pass >= 9/10`

```bash
bash scripts/mlx-lab/probe-tool-loop.sh
```

---

## 通过门槛（硬标准）

所有三项测试必须同时满足：

1. `basic_pass >= 5/5`
2. `tool_role_pass >= 9/10`
3. `tool_loop_pass >= 9/10`
4. 用户可见输出中不出现 `` ``` ``、`<function_calls>` 污染

**任一不达标**：判定"不可迁移 autonomous"，主线继续 `explicit`。

---

## 回滚策略

1. **服务回滚**: 执行 `bash scripts/mlx-lab/stop-server.sh`
2. **配置回滚**: 主线 `tooling.mode` 保持 `explicit`（未修改）
3. **结果归档**: 实验结果存放在 `results/<timestamp>.md`，可随时追溯

---

## 实验结果

查看 `results/` 目录中的实验结果文件：

```bash
ls -la AIDOCS/msgcode-2.2/mlx-lab/results/
```

---

## 注意事项

1. **主线安全**: 本实验不修改主线配置，不影响生产环境
2. **资源占用**: MLX 模型加载后占用大量内存，建议在空闲时运行
3. **端口冲突**: 确保 18000 端口未被占用
4. **模型路径**: 确保模型路径正确，MLX 需要完整的模型文件

---

## Tool Bus 集成（真实工具）

MLX Provider 已集成 Tool Bus，支持以下真实工具：

| 工具 | 描述 | Tool Bus 映射 |
|------|------|---------------|
| `shell(command)` | 执行 shell 命令 | `executeTool("shell", { command })` |
| `list_dir(path, limit?)` | 列出目录内容 | `executeTool("shell", { command: "ls -la <path> \|\| head -n <limit>" })` |
| `read_text_file(path)` | 读取文本文件 | `executeTool("shell", { command: "cat <path>" })` |

### System Prompt 增强

Tool Loop 模式使用增强的系统提示词：

```
You are a helpful assistant with access to tools.

IMPORTANT: When you need filesystem information or want to execute commands,
you MUST call the appropriate tools first:
- Use "shell" tool to execute commands (ls, cat, pwd, find, grep, etc.)
- Use "list_dir" tool to explore directory contents
- Use "read_text_file" tool to read file contents

Do NOT claim you don't have permissions or cannot access files.
Use the tools to gather information first, then provide your summary.
```

### 错误回灌机制

工具执行失败时，错误信息会以 `role=tool` 回灌给模型：

```json
{
  "success": false,
  "error": "Command failed: No such file or directory"
}
```

模型收到错误后会进行二次总结，而不是直接暴露原始错误。

---

## 已知限制

| 限制 | 影响 | 备注 |
|------|------|------|
| **URL 解析** | `MLX_BASE_URL` 必须使用 `protocol://host:port` 格式 | 不支持 IPv6（如 `http://[::1]:18000`），不支持无端口 URL |
| **模型 ID** | 依赖 `/v1/models` 接口返回模型列表 | 若后端不支持该接口，需手动设置 `MLX_MODEL_ID` |
| **超时时间** | 默认 30 秒，复杂推理可能超时 | 可通过 `CURL_TIMEOUT` 环境变量调整 |

### URL 解析限制详情

`start-server.sh` 使用字符串切分解析 URL：

```bash
# 当前实现：简单字符串切分
URLWithoutProto="${MLX_BASE_URL#*://}"
URL_HOST="${URLWithoutProto%:*}"
URL_PORT="${URLWithoutProto#*:}"
```

**支持的格式**:
- ✅ `http://127.0.0.1:18000`
- ✅ `http://localhost:8080`

**不支持的格式**:
- ❌ `http://[::1]:18000` (IPv6)
- ❌ `http://127.0.0.1` (无端口)
- ❌ `https://example.com` (HTTPS + 无端口)

如需支持以上格式，需改用更健壮的 URL 解析工具（如 Python/Node.js）。

---

## 脚本说明

| 脚本 | 功能 |
|------|------|
| `start-server.sh` | 启动 `mlx_lm.server` 后台服务 |
| `stop-server.sh` | 停止服务（幂等） |
| `check-health.sh` | 健康检查，验证服务可用 |
| `probe-basic.sh` | 基础响应测试（5 轮） |
| `probe-tool-role.sh` | Tool Role 回灌测试（10 轮） |
| `probe-tool-loop.sh` | 工具闭环测试（10 轮） |
