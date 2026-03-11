# Notes: MiniMax Provider Compatibility

## Sources

### Source 1: API Overview
- URL: https://platform.minimax.io/docs/api-reference/api-overview
- Key points:
  - Anthropic API Compatible is marked Recommended
  - Text generation supports HTTP, Anthropic SDK, OpenAI SDK

### Source 2: Compatible Anthropic API
- URL: https://platform.minimax.io/docs/api-reference/text-anthropic-api
- Key points:
  - Base URL: `https://api.minimax.io/anthropic`
  - Multi-turn function call must append full assistant response
  - Supports `thinking`, `text`, `tool_use`, `tool_result`

### Source 3: Compatible OpenAI API
- URL: https://platform.minimax.io/docs/api-reference/text-openai-api
- Key points:
  - OpenAI-compatible path requires preserving full `response_message`
  - `reasoning_split=True` separates reasoning into `reasoning_details`
  - If not split, `<think>` remains in `content`

### Source 4: Tool Use & Interleaved Thinking
- URL: https://platform.minimax.io/docs/guides/text-m2-function-call
- Key points:
  - Best practice is returning full response each round
  - Anthropic path appends full `response.content`
  - OpenAI path appends full `response_message`

### Source 5: Claude Code
- URL: https://platform.minimax.io/docs/coding-plan/claude-code
- Key points:
  - Claude Code uses `ANTHROPIC_BASE_URL=https://api.minimax.io/anthropic`
  - Model `MiniMax-M2.5`

## Local Findings

1. `src/agent-backend/config.ts` currently resolves `minimax` to `MINIMAX_BASE_URL` and treats it as generic backend runtime.
2. `src/agent-backend/tool-loop.ts` always calls `/v1/chat/completions`.
3. `src/providers/openai-compat-adapter.ts` does not support:
   - `reasoning_split`
   - `reasoning_details`
   - Anthropic content blocks
4. Current local env uses:
   - `MINIMAX_BASE_URL=https://api.minimax.chat/v1`
   - `MINIMAX_MODEL=MiniMax-M2.5`

## Synthesized Findings

### Root Cause

- MiniMax tool use failures in msgcode come from protocol mismatch, not model incapability.
- Claude Code / Alma likely work because they use official recommended Anthropic-compatible path or equivalent provider adaptation.

### Minimal Correct Fix

- Add MiniMax-specific Anthropic provider
- Keep mainline entry unchanged
- Do not add content-based tool-call recovery
