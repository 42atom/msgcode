# msgcode 全链路排查文档

**日期**: 2026-02-08
**版本**: v2.2.0
**模型**: Huihui-GLM-4.7-Flash-abliterated-mlx-4bit

---

## 问题总结

### 1. GLM-4.7-Flash 循环问题 ⚠️ **严重**

**现象**:
- 第2条回复重复 "what mess are we fixing" 138次
- 第7条回复重复 "OH HONEY NO" 30次
- "Okay, wait, wait, WAIT" 重复 1次
- 会话文件大小: 16.5 KB (16573 字节)

**根本原因**:
根据 Unsloth 文档 (GLM-4.7-Unsloth-Docs.md:152):
> **JAN 21 UPDATE: llama.cpp fixed a bug specifying the wrong** `"scoring_func": "softmax"` **that caused looping and poor outputs (should be sigmoid)**

**当前配置**:
```json
{
  "mlx.temperature": 0.7,
  "mlx.topP": 1,
  "mlx.maxTokens": 2048
}
```

**问题分析**:
1. ✅ 温度 0.7 (工具调用推荐值)
2. ✅ top_p 1.0 (工具调用推荐值)
3. ❌ maxTokens 2048 太大，给了模型更多循环的空间
4. ❓ MLX 格式模型是否受 "scoring_func" bug 影响？

**已修复**:
- `repetition_penalty: 1.0` (所有请求)

---

### 2. TTS 情绪分析失败 ⚠️ **中等**

**现象**:
```
[emotion] MLX batch call failed: MLX API error: 404 Not Found
```

**根本原因**:
1. 情绪分析使用的 `model: ""` (空字符串)
2. 情绪分析从 `process.env.WORKSPACE_ROOT` 读取配置
3. 实际配置在 `/Users/admin/msgcode-workspaces/charai/.msgcode/config.json`

**代码位置**:
`src/runners/tts/emotion.ts:482`
```typescript
model: config.modelId || "",
```

**配置路径**:
- 情绪分析读取: `/Users/admin/msgcode-workspaces/.msgcode/config.json` (错误)
- 实际配置路径: `/Users/admin/msgcode-workspaces/charai/.msgcode/config.json`

---

### 3. 响应时间过长 ⚠️ **中等**

**日志分析**:
- 第一次请求: 09:02:21 → 09:03:13 (52秒)
- 第二次请求: 09:13:14 → 09:14:30 (76秒)

**原因**:
1. maxTokens = 2048 太大
2. 模型进入循环，输出过长
3. 上下文累积，每次请求更慢

---

## 修复方案

### 方案 1: 降低 maxTokens ⭐ **优先**

**当前**: 2048
**建议**: 500

**理由**:
- 限制输出长度
- 减少循环空间
- 提升响应速度

### 方案 2: 修复情绪分析路径

**当前**: 从 `/Users/admin/msgcode-workspaces/.msgcode/config.json` 读取
**建议**: 从实际工作区读取配置

**代码修改**:
```typescript
// src/runners/tts/emotion.ts
// 获取当前工作区路径 (从 handlers 传入)
const workspacePath = getCurrentWorkspacePath(); // 需要添加
const config = await getMlxConfig(workspacePath);
```

### 方案 3: 添加循环检测

**在 runMlxChat 和 runMlxToolLoop 中添加**:
1. 检测重复短语
2. 限制最大长度
3. 超过阈值，强制停止

---

## 待修复文件

1. `/Users/admin/msgcode-workspaces/charai/.msgcode/config.json`
   - 降低 maxTokens 到 500

2. `src/runners/tts/emotion.ts`
   - 修复配置路径问题

3. `src/providers/mlx.ts`
   - 添加循环检测

---

## 4. tmux 路由绑定问题 ✅ **已修复**

**现象**:
- `runner.default = "mlx"` 时，tmux 无法正确识别
- 显示 "已就绪" 但实际不是

**根本原因**:
1. RunnerType 类型只包含 "claude" | "codex" | "claude-code"
2. resolveRunner 逻辑将非 codex 的都转为 "claude"
3. MLX 是本地 provider，不是 tmux runner

**已修复**:
- 添加 "local" 类型到 RunnerType
- resolveRunner 正确识别非 tmux runners
- mxl/lmstudio 返回 "local"

---

## 测试验证

**测试步骤**:
1. 修改配置
2. 重启 msgcode
3. 发送测试消息
4. 检查会话文件大小
5. 验证响应时间

**成功标准**:
- 会话文件 < 5KB
- 响应时间 < 30秒
- 无循环现象
