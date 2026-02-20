# P5.7-R3c GLM ToolCall 兼容性调研报告

**优先级**: P0
**状态**: 进行中

---

## 一、背景与目标

### 1.1 背景

确认本地 GLM 模型（`huihui-glm-4.7-flash-abliterated-i1`）在 LM Studio 下能否稳定完成 `tool_calls -> 工具执行 -> 二轮可展示文本` 全链路。

### 1.2 目标

- 评估 GLM 模型在不同配置下的 tool call 稳定性
- 输出推荐配置（唯一）、备选配置（可灰度）、禁用清单
- 为生产环境部署提供数据支撑

---

## 二、实验设计

### 2.1 测试矩阵

| 配置组 | 模型 | toolFormat | temperature | maxTokens |
|--------|------|------------|-------------|-----------|
| C1 | huihui-glm-4.7-flash-abliterated-i1 | Native | 0 | 400 |
| C2 | huihui-glm-4.7-flash-abliterated-i1 | Native | 0 | 800 |
| C3 | huihui-glm-4.7-flash-abliterated-i1 | Native | 0.2 | 400 |
| C4 | huihui-glm-4.7-flash-abliterated-i1 | Native | 0.2 | 800 |
| C5 | huihui-glm-4.7-flash-abliterated-i1 | Default | 0 | 400 |
| C6 | huihui-glm-4.7-flash-abliterated-i1 | Default | 0 | 800 |
| C7 | huihui-glm-4.7-flash-abliterated-i1 | Default | 0.2 | 400 |
| C8 | huihui-glm-4.7-flash-abliterated-i1 | Default | 0.2 | 800 |

**说明**: toolFormat 需在 LM Studio 中手动切换，其他参数由脚本控制。

### 2.2 测试用例集

| 用例 ID | 工具 | Prompt |
|---------|------|--------|
| T1 | read_file | 读取 docs/README.md 的前 10 行 |
| T2 | bash | 执行 pwd 命令，告诉我当前工作目录 |
| T3 | bash | 执行 ls -la AIDOCS，列出前 5 个文件 |
| T4 | write_file | 将 "test content from p5-7-r3c" 写入 /tmp/p5-7-r3c-test.txt |

### 2.3 采样策略

- 每组配置 × 每用例：30 次采样
- 总测试数：8 配置 × 4 用例 × 30 次 = 960 次

---

## 三、统计指标

### 3.1 核心指标

| 指标 | 计算方式 | 通过阈值 |
|------|----------|----------|
| R1 tool_calls 命中率 | 有结构化 tool_calls 的比例 | >= 98% |
| R2 可展示文本成功率 | 最终返回非空文本的比例 | >= 95% |
| R2 漂移率 | content 含 tool_call 标签但 tool_calls=[] | <= 1% |
| 空响应率 | 最终 answer 为空的比例 | <= 1% |
| JSON 参数可解析率 | JSON.parse(arguments) 成功的比例 | >= 99% |

### 3.2 延迟指标

- 平均耗时：R1 + R2 总耗时的平均值
- P95 耗时：95 分位耗时

### 3.3 失败分类

| 分类 | 说明 |
|------|------|
| NO_TOOL_CALL | R1 未返回结构化 tool_calls |
| ARGS_PARSE_ERROR | JSON arguments 格式错误无法解析 |
| EMPTY_RESPONSE | R2 返回空文本 |
| EXCEPTION | 请求异常/超时 |
| API_ERROR | LM Studio API 返回错误 |

---

## 四、实验执行

### 4.1 运行命令

```bash
# 步骤 1: 运行矩阵测试（约 30-60 分钟）
bun run scripts/p5-7-r3c-matrix-runner.ts

# 步骤 2: 生成分析报告
bun run scripts/p5-7-r3c-data-analyzer.ts
```

### 4.2 数据位置

- 原始数据：`AIDOCS/p5-7-r3c-data/raw-results.csv`
- 失败日志：`AIDOCS/p5-7-r3c-data/failure-logs/`
- 汇总报告：`AIDOCS/p5-7-r3c-data/summary.md`

---

## 五、实验结果

### 5.1 执行摘要

**执行时间**: [待填充]

| 指标 | 数值 |
|------|------|
| 总测试数 | [待填充] |
| 总成功数 | [待填充] |
| 总体成功率 | [待填充]% |

### 5.2 结论分级

#### A 级：可上线（满足所有阈值）

[待填充 - 格式示例]
- **C2**: R1 命中率 99.2%, R2 成功率 96.5%, 漂移率 0.3%

#### B 级：可灰度（部分指标接近阈值）

[待填充 - 格式示例]
- **C4**: R1 命中率 95.8%, R2 成功率 91.2%

#### C 级：禁用（未达标）

[待填充 - 格式示例]
- **C1**: R1 命中率 82.1%, R2 成功率 75.0%

---

## 六、推荐配置

### 6.1 推荐配置（唯一）

**配置**: [待填充]

**参数**:
- toolFormat: [Native/Default]
- temperature: [0/0.2]
- maxTokens: [400/800]

**理由**: [待填充]

### 6.2 备选配置（可灰度）

[待填充]

### 6.3 禁用清单

[待填充]

---

## 七、详细统计

### 7.1 各配置组统计

| 配置 | 测试数 | 成功数 | 成功率 | R1 命中率 | R2 成功率 | 漂移率 | P95 延迟 (ms) |
|------|--------|--------|--------|-----------|-----------|--------|---------------|
| C1 | 120 | - | -% | -% | -% | -% | - |
| C2 | 120 | - | -% | -% | -% | -% | - |
| C3 | 120 | - | -% | -% | -% | -% | - |
| C4 | 120 | - | -% | -% | -% | -% | - |
| C5 | 120 | - | -% | -% | -% | -% | - |
| C6 | 120 | - | -% | -% | -% | -% | - |
| C7 | 120 | - | -% | -% | -% | -% | - |
| C8 | 120 | - | -% | -% | -% | -% | - |

### 7.2 失败分类统计

| 配置 | NO_TOOL_CALL | ARGS_PARSE_ERROR | EMPTY_RESPONSE | EXCEPTION | API_ERROR |
|------|--------------|------------------|----------------|-----------|-----------|
| C1 | - | - | - | - | - |
| C2 | - | - | - | - | - |
| C3 | - | - | - | - | - |
| C4 | - | - | - | - | - |
| C5 | - | - | - | - | - |
| C6 | - | - | - | - | - |
| C7 | - | - | - | - | - |
| C8 | - | - | - | - | - |

---

## 八、风险与建议

### 8.1 已知风险

[待填充]

### 8.2 使用建议

[待填充]

### 8.3 后续优化方向

[待填充]

---

## 九、附录

### 9.1 脚本说明

- `scripts/p5-7-r3c-matrix-runner.ts`: 矩阵测试运行器
- `scripts/p5-7-r3c-data-analyzer.ts`: 数据分析与报告生成

### 9.2 环境变量

```bash
# 可选：自定义模型名
export LMSTUDIO_MODEL=huihui-glm-4.7-flash-abliterated-i1

# 可选：自定义 Base URL
export LMSTUDIO_BASE_URL=http://127.0.0.1:1234

# 可选：自定义采样次数（默认 30）
export R3C_SAMPLES=30
```

### 9.3 通过阈值标准

| 指标 | 阈值 | 说明 |
|------|------|------|
| R1 tool_calls 命中率 | >= 98% | 第一轮必须返回结构化 tool_calls |
| R2 可展示文本成功率 | >= 95% | 第二轮必须返回可展示文本 |
| R2 漂移率 | <= 1% | content 含 tool_call 标签但 tool_calls=[] 的比例 |
| 空响应率 | <= 1% | 最终 answer 为空的比例 |

---

*本报告由 P5.7-R3c 数据分析脚本自动生成*
*最后更新：[待填充]*
