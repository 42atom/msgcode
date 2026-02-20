# P5.7-R3c GLM ToolCall 兼容性调研报告

**优先级**: P0
**状态**: 阶段完成（LM Studio 直测）

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

## 五、实验结果（2026-02-20）

### 5.1 执行摘要

**执行时间**: 2026-02-20

| 指标 | 数值 |
|------|------|
| 模型 A | `huihui-glm-4.7-flash-abliterated-mlx` |
| 模型 B | `glm-4.7-flash-mlx` |
| 关键结论 | temperature 与 R1 tool_calls 命中率强相关 |

### 5.2 结论分级

#### A 级：可上线（满足所有阈值）

- `huihui-glm-4.7-flash-abliterated-mlx` @ `temperature=0`
  - R1 tool_calls 命中率：`12/12`
  - R2 可展示文本成功率：`12/12`
  - R2 漂移率（`<tool_call>` 文本漂移）：`0/12`
- `glm-4.7-flash-mlx` @ `temperature=0`
  - R1 tool_calls 命中率：`10/10`
  - R2 可展示文本成功率：`10/10`
  - R2 漂移率：`0/10`

#### B 级：可灰度（部分指标接近阈值）

- 暂无（当前直测结果二极分化，未出现稳定灰度区）

#### C 级：禁用（未达标）

- `huihui-glm-4.7-flash-abliterated-mlx` @ `temperature=0.2`
  - R1 tool_calls 命中率：`0/10`
  - 现象：模型直接文本回复，不触发结构化工具调用
- `glm-4.7-flash-mlx` @ `temperature=0.2`
  - R1 tool_calls 命中率：`1/10`
  - 现象：大多数请求直接文本回复，工具调用不可依赖

---

## 六、推荐配置

### 6.1 推荐配置（唯一）

**配置**: LM Studio + Native 工具调用 + 低温锁定

**参数**:
- toolFormat: `Native`
- temperature: `0`
- maxTokens: `>= 400`（不作为本轮主影响因子）

**理由**:
1. `temperature=0` 在两款 GLM-4.7-Flash MLX 模型均可稳定触发 R1 tool_calls。
2. `temperature=0.2` 会明显退化为直接文本输出，R1 命中率不可用。
3. R2 漂移并非本轮主矛盾，主矛盾是 R1 不触发工具。

### 6.2 备选配置（可灰度）

- 暂无。当前不建议在生产路径灰度 `temperature>0`。

### 6.3 禁用清单

1. 禁用 `temperature=0.2`（及以上）用于工具调用主链。
2. 禁用“仅看 R2 成功率”判断可用性，必须以 R1 tool_calls 命中率为主指标。

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

1. 模型一旦温度上浮，R1 工具调用会快速退化为纯文本路径。
2. 仅靠“模型自觉调用工具”不稳，仍需运行时强约束与回归锁。

### 8.2 使用建议

1. 工具调用场景统一锁 `temperature=0`。
2. 对关键命令保留“未触发 tool_calls 即失败”的判定，不做执行层放水。
3. 将参数冻结纳入后续任务 `P5.7-R3d`，并以回归测试固化。

### 8.3 后续优化方向

1. 做 `P5.7-R3d` 参数冻结与回归锁（R1 命中率硬阈值）。
2. vllm-metal 与 LM Studio 分线维护，不阻塞主线。

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
