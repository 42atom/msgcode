# P5.7-R3c 数据目录

GLM ToolCall 兼容性调研的原始数据和报告存储目录。

---

## 文件结构

```
AIDOCS/p5-7-r3c-data/
├── README.md              # 本文件
├── raw-results.csv        # 原始测试数据（运行后生成）
├── summary.md             # 汇总报告（分析后生成）
└── failure-logs/          # 失败日志（失败时生成）
    ├── C1_T1_1.json       # 配置 C1, 用例 T1, 第 1 次运行
    ├── C1_T1_2.json
    └── ...
```

---

## 快速开始

### 步骤 1: 准备环境

确保 LM Studio 已启动并加载目标模型：

```bash
# 检查 LM Studio 是否运行
curl http://127.0.0.1:1234/v1/models
```

### 步骤 2: 运行矩阵测试

```bash
cd /Users/admin/GitProjects/msgcode

# 运行完整矩阵测试（约 30-60 分钟）
bun run scripts/p5-7-r3c-matrix-runner.ts
```

**输出示例**:
```
P5.7-R3c GLM ToolCall 兼容性矩阵测试
============================================================
模型：huihui-glm-4.7-flash-abliterated-i1
Base URL: http://127.0.0.1:1234
每组采样：30 次
配置组数：8
测试用例：4
总测试数：960
============================================================

配置 C1: toolFormat=Native, temp=0, maxTokens=400
  T1 (read_file): .............................. [30/960 3.1%]
  T2 (bash): ..............................
  ...
```

### 步骤 3: 生成分析报告

```bash
# 分析数据并生成报告
bun run scripts/p5-7-r3c-data-analyzer.ts
```

**输出示例**:
```
P5.7-R3c GLM ToolCall 兼容性数据分析
============================================================
读取数据：AIDOCS/p5-7-r3c-data/raw-results.csv
解析行数：960
计算统计数据...
生成推荐...
生成报告...
报告已保存：AIDOCS/p5-7-r3c-data/summary.md

============================================================
摘要
============================================================
A 级（可上线）: 2 组
  推荐：C2
B 级（可灰度）: 3 组
C 级（禁用）: 3 组
```

---

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `LMSTUDIO_MODEL` | `huihui-glm-4.7-flash-abliterated-i1` | 模型名称 |
| `LMSTUDIO_BASE_URL` | `http://127.0.0.1:1234` | LM Studio API 地址 |
| `R3C_SAMPLES` | `30` | 每组采样次数 |

---

## 数据格式

### raw-results.csv

| 列名 | 类型 | 说明 |
|------|------|------|
| configId | string | 配置组 ID (C1-C8) |
| testCaseId | string | 测试用例 ID (T1-T4) |
| runIndex | number | 运行序号 (1-30) |
| timestamp | string | ISO8601 时间戳 |
| r1HasToolCall | boolean | R1 是否有 tool_calls |
| r1ToolName | string | R1 工具名称 |
| r1ArgsValid | boolean | R1 参数是否可解析 |
| r1LatencyMs | number | R1 延迟 (毫秒) |
| r2HasAnswer | boolean | R2 是否有回答 |
| r2AnswerLength | number | R2 回答长度 |
| r2IsDrifted | boolean | R2 是否格式漂移 |
| r2LatencyMs | number | R2 延迟 (毫秒) |
| totalLatencyMs | number | 总延迟 (毫秒) |
| success | boolean | 是否成功 |
| failureType | string | 失败类型 |

### failure-logs/*.json

失败时的完整响应日志，包含：
- 请求参数
- R1 原始响应
- R2 原始响应
- 错误信息

---

## 清理数据

```bash
# 删除所有测试数据
rm -rf AIDOCS/p5-7-r3c-data/*

# 重新生成空目录
mkdir -p AIDOCS/p5-7-r3c-data/failure-logs
```

---

## 故障排查

### 问题 1: 所有测试都失败

**可能原因**:
1. LM Studio 未启动
2. 模型未加载
3. Base URL 配置错误

**检查步骤**:
```bash
# 检查 LM Studio 是否响应
curl http://127.0.0.1:1234/v1/models

# 检查模型列表
curl http://127.0.0.1:1234/v1/models | jq
```

### 问题 2: NO_TOOL_CALL 比例高

**可能原因**:
1. temperature 过高导致随机性增加
2. 模型不支持 tool call 格式
3. toolFormat 配置不匹配

**建议**:
- 尝试降低 temperature (0 -> 0.2)
- 切换 toolFormat (Native <-> Default)
- 检查 system prompt 是否清晰

### 问题 3: 漂移率高

**可能原因**:
- 模型在第二轮继续输出工具调用标记而非总结

**建议**:
- 增加 maxTokens
- 检查是否触发了 stop token

---

*最后更新：2026-02-20*
