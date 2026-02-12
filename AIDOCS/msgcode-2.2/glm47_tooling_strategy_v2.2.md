# GLM-4.7 Flash 工具化策略（v2.2）

> 目的：让本地 GLM-4.7 Flash "能用工具"，支持模型自主编排调用工具。

当前策略一句话：**v2.2 默认 Explicit 模式（稳态）：只允许显式命令触发工具，避免依赖 tool_calls 玄学。**

---

## 1. 当前默认：Explicit 显式模式（稳态）

### 1.1 模式定义

**explicit（默认）**: 只允许显式命令触发工具

- 用户通过 `/tts`、`/asr`、`/vision` 等命令触发工具
- 模型不主动调用工具
- 适用于多用户/高安全要求场景
- 避免依赖 tool_calls 的稳定性问题

**autonomous（可选）**: 模型可自主编排调用所有工具（TTS/ASR/OCR/Mem/Shell/Browser）

- 模型通过 tool_calls 主动调用工具
- 不要求用户显式命令触发
- 默认全信任，不要求确认
- 适用于单机单 AI 使用场景

**tool-calls（预留）**: 标准 tool_calls 模式（未启用）

### 1.2 切换模式

```bash
# 查看当前模式
/tool allow list

# 切换到 autonomous 模式（如需自主编排）
# 编辑 .msgcode/config.json: "tooling.mode": "autonomous"
/reload
```

---

## 2. P0：显式意图触发工具（当前默认）

定义：**只在用户明确表达"我要你做这个工具动作"时才触发工具**

- `/tts <text>`：把文本转语音
- `/asr <file>` 或 "发语音"触发的自动 ASR
- `/vision <question>`：读图/解释

P0 的好处：

- 最稳：不依赖模型是否能稳定输出 `tool_calls`
- 最可控：不会因为模型"误判需要工具"而触发副作用
- 最适合 iMessage：用户心智清晰（命令式）

---

## 2.2 Autonomous（可选）：模型自主编排工具

定义：按 OpenAI 标准协议实现工具调用闭环，允许模型自主决定调用工具

Autonomous 的前提：

- 你使用的推理后端必须稳定支持 `tools/tool_calls`，并且不把 reasoning 当作答案。
- 若 LM Studio/MLX 路径无法保证，建议把 4.7 放到更"工具友好"的 OpenAI-compatible server（比如 llama.cpp server 的 jinja 模板路径）。

Autonomous 的风险：

- 可靠性和一致性不够时，会回到我们已经踩过的坑（元叙事、循环、超时、崩溃）。

---

## 3. v2.2 的推荐落点（策略）

### 3.1 默认策略（稳态）

- **默认走 Explicit**：只允许显式命令触发工具（/tts、/asr、/vision）
- **自动流水线继续做"媒体预处理"**：ASR/附件落盘/去重/证据块注入
- **Autonomous 可选**：如需自主编排，可手动切换模式

### 3.2 模式与 LMStudio 模板绑定（必须）

- `tooling.mode = explicit`
  - 模板：`AIDOCS/msgcode-2.1/lmstudio_prompts/glm-4.7_prompt_template_min_v1.jinja2`
  - 目标：纯文本稳态，不依赖 `role=tool` 回灌
- `tooling.mode = autonomous`
  - 模板：`AIDOCS/msgcode-2.1/lmstudio_prompts/glm-4.7_prompt_template_tools_v1.jinja2`
  - 目标：支持 `role=tool` 回灌，保证工具闭环可用

切换步骤：
1. 修改 `<WORKSPACE>/.msgcode/config.json` 的 `"tooling.mode"`
2. LMStudio 替换对应模板并重载模型
3. 执行“基础回答 + role=tool 回灌”两条验收命令
4. 执行 `npm run test:all`
### 3.3 P1 的启用方式（未来）

引入 workspace 级开关（文件系统真相源）：

`<WORKSPACE>/.msgcode/config.json`

```json
{
  "tooling.mode": "explicit",        // explicit | tool-calls
  "tooling.allow": ["tts", "asr"],   // allowlist
  "tooling.require_confirm": ["shell", "browser"]
}
```

说明：

- `explicit`：只认命令（P0）
- `tool-calls`：允许 tool_calls（P1）
- allowlist 是安全边界：工具能力越强，默认越要收口

---

## 4. 能力边界：工具 vs Skill vs Schedule

为了保持“禅意”，我们把概念压到 3 个：

- **工具（Tool）**：通用能力（TTS/ASR/读图/读文件/发消息），输入输出明确，可验收。
- **技能（Skill）**：场景化组合（比如“报税”“周报”“PR review”），本质是“调用工具的脚本/模板/规则集合”。
- **定时（Schedule）**：唤醒机制（cron），触发“技能/工具/消息发送”。

核心原则：

- **工具是底座**（稳定、可测、可追踪）
- **技能是组合**（可编辑、可开关、文件系统托管）
- **定时是触发器**（不做智能，做确定性）

---

## 5. 输入结构：把“操作元信息”与“语义证据”分离

我们已经吃过亏：把 `[attachment] path/mime/digest` 这类元信息喂给 4.7，会触发元叙事。

因此 v2.2 的规范是：

- LLM 输入只包含：
  - 用户问题（自然语言）
  - 证据块（可读文本）：`[图片文字]`、`[语音转写]`、`[记忆] snippet` 等
- 调试/可观测性留在日志与 artifacts，不进入模型上下文（或只在 debug 模式进入）

---

## 6. 验收（Release Gate）

### P0（显式工具）验收

- `/help`：能看到工具命令示例（至少 `/tts`）
- `/tts`：可生成音频附件并回发
- 自动 ASR：发语音能落盘 + 产出转写证据块（即使 tmux 不在也不崩）
- 读图：发图能产出证据块并回答（不出现“用户上传了一张图片…”元叙事）

### P1（tool_calls）验收（未来）

- `tools/tool_calls` 闭环可稳定跑完 10 次，不出现：
  - tool_calls 格式错误
  - reasoning_content 当答案
  - 死循环/超时

---

## 7. 下一步任务单（给 Opus）

### P0（v2.2/本周）

1) 文档对齐：/help + README + spec 中明确“显式命令触发工具”
2) 工具能力收口：Tool allowlist + sideEffects 分级（只读/本地写/消息发送/进程控制）
3) 证据块规范：所有工具产物必须落盘到 `artifacts/`，并可追溯（digest/路径）

### P1（v2.3/下阶段）

1) 加入 `tooling.mode=tool-calls`
2) 选择稳定后端（优先 OpenAI-compatible 且 tool_calls 质量可控）
3) 实现 tool bus（统一 schema + 错误码 + 观测）
