# OMLX 延迟基准报告 260311

## 结论

- 用户本机 `http://127.0.0.1:8000` 可访问，`Authorization: Bearer 1234` 可用。
- 当前模型 `Qwen3.5-27B-Claude-4.6-Opus-Distilled-MLX-4bit` 已完成 5 轮暖态延迟测试。
- 若按“首个推理文本”口径看，平均约 `1.268s`。
- 若按“最终回答首 token”口径看，平均约 `6.378s`。
- 非流式完整响应总耗时平均约 `6.331s`。

## 测试环境

- 时间：2026-03-11 13:29:36 +08
- 端点：`http://127.0.0.1:8000/v1/chat/completions`
- 模型：`Qwen3.5-27B-Claude-4.6-Opus-Distilled-MLX-4bit`
- 提示词：`请用一句中文确认你正在进行延迟测试。`
- 采样参数：`temperature=0`

## 方法

### 口径 A：流式

- 轮次：5
- `max_tokens=64`
- 统计项：
  - `first_event_s`：首个模型事件时间，不含 HTTP keep-alive 的误导口径
  - `first_text_s`：首个文本片段时间，可能是 `reasoning_content`
  - `total_s`：流式完成总耗时

### 口径 B：非流式

- 轮次：5
- `max_tokens=64`
- 统计项：
  - `total_s`：完整响应返回耗时

### 口径 C：区分推理与最终回答

- 轮次：3
- `max_tokens=128`
- 统计项：
  - `first_reasoning_s`：首个 `reasoning_content` 时间
  - `first_answer_s`：首个最终 `content` 时间
  - `total_s`：流式完成总耗时

## 结果

### 流式 5 轮

| run | first_event_s | first_text_s | total_s | finish_reason |
| --- | ---: | ---: | ---: | --- |
| 1 | 0.032 | 1.710 | 6.684 | length |
| 2 | 0.001 | 1.160 | 6.043 | length |
| 3 | 0.002 | 1.135 | 6.089 | length |
| 4 | 0.002 | 1.204 | 6.359 | length |
| 5 | 0.001 | 1.133 | 6.080 | length |

汇总：

- `first_event_s` 平均 `0.008s`，这基本只是协议级首事件，不适合代表真实首 token 体验
- `first_text_s` 平均 `1.268s`
- `total_s` 平均 `6.251s`

### 非流式 5 轮

| run | total_s | finish_reason | prompt_tokens | completion_tokens |
| --- | ---: | --- | ---: | ---: |
| 1 | 6.264 | length | 19 | 64 |
| 2 | 6.309 | length | 19 | 64 |
| 3 | 6.208 | length | 19 | 64 |
| 4 | 6.512 | length | 19 | 64 |
| 5 | 6.363 | length | 19 | 64 |

汇总：

- `total_s` 平均 `6.331s`
- 最小 `6.208s`
- 最大 `6.512s`

### 推理流 vs 最终回答 3 轮

| run | first_reasoning_s | first_answer_s | total_s | finish_reason |
| --- | ---: | ---: | ---: | --- |
| 1 | 1.708 | 6.708 | 7.216 | stop |
| 2 | 1.156 | 6.141 | 6.643 | stop |
| 3 | 1.202 | 6.284 | 6.820 | stop |

汇总：

- `first_reasoning_s` 平均 `1.355s`
- `first_answer_s` 平均 `6.378s`
- `total_s` 平均 `6.893s`

## 观察

- 服务会先发 `: keep-alive`，所以不能直接把 `curl` 的 `time_starttransfer` 当成首 token。
- 该模型当前明显是“先长推理，后短回答”的输出模式。
- 在这个提示词下，用户体感上的“看到最终答案”接近总耗时，而不是接近 `1.3s`。
- `max_tokens=64` 时多次出现 `finish_reason=length`，说明回答窗口被推理内容占掉了不少。

## 风险与解释边界

- 本次是暖态测试，不代表冷启动装载时延。
- 本次只测了一个短中文提示词，不代表长上下文、多轮、多工具调用场景。
- `first_answer_s` 更接近终端用户看到最终回答的时间；`first_reasoning_s` 更接近模型开始产出思维流的时间。

## 复现命令

```bash
python3 - <<'PY'
# 基于 http.client 逐行读取 SSE，统计 first_reasoning_s / first_answer_s / total_s
PY
```

## Evidence

- Tests：`GET /v1/models` 返回模型 `Qwen3.5-27B-Claude-4.6-Opus-Distilled-MLX-4bit`
- Tests：`GET /health` 返回 `status=healthy`
- Tests：`POST /v1/chat/completions` 5 轮流式 + 5 轮非流式 + 3 轮分口径流式测试均返回 `200`
