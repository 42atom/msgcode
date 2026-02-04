## src/output（输出抽取）

目标：把“执行臂”（Claude/Codex）产生的输出，稳定抽取为可回发到 iMessage 的纯文本。

### 文件

- `reader.ts`：Claude（tmux）JSONL 读取器（按 workspace 读增量）。
- `parser.ts`：Claude JSONL 解析器（抽取 assistant 文本、完成标志）。
- `codex-reader.ts`：Codex JSONL 读取器（来源 `~/.codex/sessions/**/rollout-*.jsonl`，按 `session_meta.payload.cwd==projectDir` 过滤，按字节 offset 增量读取）。
- `codex-parser.ts`：Codex JSONL 解析器（抽取 `response_item.payload.role=assistant` 的 `content[].type=output_text`）。
- `buffer.ts` / `throttler.ts`：输出缓冲与节流（通用工具）。

### 关联模块

- `src/tmux/responder.ts`：负责发送消息到 tmux，并用“快慢轮询 + 稳定计数”收口一次请求-响应。

