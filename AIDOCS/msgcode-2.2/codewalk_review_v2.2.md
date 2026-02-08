# msgcode v2.2 代码走查（控盘版）

日期：2026-02-04  
目标：在不引入额外复杂度的前提下，确认“主链路稳定 + 配置可控 + 能力可演进”，并把关键技术债显式化。

---

## 1) 系统主叙事（单线）

一句话：iMessage 进来 → 路由到 workspace → 选择执行臂（lmstudio/tmux）→ 产物落盘（attachments/artifacts/logs）→ 回消息（文本/附件）。

关键模块：

- `src/imsg/*`：imsg RPC 订阅与消息适配（把上游 payload 归一为 InboundMessage）
- `src/router.ts` + `src/routes/commands.ts`：chatGuid → workspace 绑定、slash 命令入口（文件系统为真相源）
- `src/listener.ts`：消息处理主循环（去重、游标推进、附件复制、派生流水线、回执、defer）
- `src/handlers.ts`：不同 botType 的消息处理（lmstudio / default(tmux) / image / file …）
- `src/tmux/*`：tmux 会话、发消息、读输出（Claude/Codex runner）
- `src/jobs/*`：jobs store + scheduler + runner（定时唤醒）
- `src/deps/*`：preflight 依赖检查（启动 fail-fast / jobs 警告）

---

## 2) 关键约束是否贯彻

### 2.1 文件系统即真相源

- Workspace 配置：`<WORKSPACE>/.msgcode/config.json`
- Personas：`<WORKSPACE>/.msgcode/personas/*.md`
- Schedules：`<WORKSPACE>/.msgcode/schedules/*.json`（映射到 jobs）

结论：符合。配置重载走 `/reload`，可追踪、可恢复。

### 2.2 风控（local-only vs egress-allowed）

- policy gate：本地模式禁止 codex/claude-code（已实现）
- 探针可观测：`msgcode doctor --json` 可见 runner/policy 状态

结论：符合（但仍建议后续把“高副作用工具确认”统一收口到手机端确认）。

### 2.3 “只读快车道”不抢占长任务

- `/status /where /help`：fast lane 秒回、不抢占
- queue lane：推进游标但不重复回复（竞态窗口也已加保险）

结论：符合。已通过 BDD 场景覆盖。

---

## 3) 最近变更的高风险点（已复核）

### 3.1 IndexTTS 常驻 worker（性能 P0）

实现：
- `scripts/indexts_worker.py`：stdin/stdout JSON RPC，初始化一次加载 IndexTTS2
- `src/runners/tts/backends/indexts-worker.ts`：Node 客户端（串行队列、超时自重启）
- `src/runners/tts/backends/indexts.ts`：默认使用 worker；`TTS_TIMEOUT_MS` 可配置

控盘点：
- daemon stop/restart 必须杀 worker：已在 `src/commands.ts` 的 `killMsgcodeProcesses()` 加入 `indexts_worker.py` 模式。
- 停顿/清洗：`INDEX_TTS_INTERVAL_SILENCE_MS` + `TTS_NORMALIZE_TEXT` + `TTS_TRIM_SILENCE*` 属于体验关键旋钮。

结论：可用、可控，且不再依赖 qwen3。

### 3.2 IndexTTS venv 依赖升级记录（torch/torchaudio 2.10）

背景：为验证 MPS footprint 异常，曾将 `~/Models/index-tts/.venv` 从 `torch/torchaudio 2.8.0` 升级到 `2.10.0`。

关键坑位（已踩过且已修复）：

1. `torchaudio.save()` 新依赖
   - 现象：报错 `TorchCodec is required for save_with_torchcodec`
   - 处理：在 venv 内安装 `torchcodec`（版本示例：`0.10.0`）

2. 生成音频变“杂音/削顶”
   - 根因：`torchaudio>=2.10` 默认走 torchcodec backend，期望输入 waveform 为 **float [-1, 1]**
   - 事故触发：IndexTTS2 原实现用 `wav.type(torch.int16)`（PCM16 量化范围）直接保存 → 被当作 float 超范围 → 全程削顶 → 杂音
   - 修复：在 IndexTTS2 保存前归一化：`(wav.float() / 32767.0)` 再 `torchaudio.save(...)`
   - 修复位置：`~/Models/index-tts/indextts/infer_v2.py`（注意：不在 msgcode 仓库内，属于本机模型目录的热修）

回滚锚点（用于快速回到 torch 2.8.*）：
- `~/Models/index-tts/requirements.before-20260205-110056.txt`

### 3.2 去掉 qwen3（减少分支/误解）

已删除：
- `src/runners/tts/backends/qwen3.ts`
- `scripts/qwen3_tts_cli.py`

并清理：
- 代码/文档中不再出现 qwen3/Serena/VoiceDesign/CustomVoice
- `~/.config/msgcode/.env` 已移除 `QWEN3_TTS_*`

结论：符合“禅意收口”（减少多后端分支）。

---

## 4) 当前已知技术债（按优先级）

### P0（会咬人）

1. **Python worker 可观测性不足**
   - 现状：只有超时会 stop/restart；缺少 `msgcode doctor` 维度的“worker alive/last latency”。
   - 建议：加 `deps` optional probe：`indexts_worker_alive`（ping + 记录最近一次 synth 耗时）。

2. **TTS 长文本分段策略（语速慢时容易超时）**
   - 现状：单段合成可能超过 `TTS_TIMEOUT_MS`。
   - 建议：做“按句切段 + concat”（类似 emo_auto 分段，但不依赖情绪）。

### P1（体验/维护）

1. **preflight 的 env/path 占位符扩展目前只做了 `$INDEX_TTS_ROOT`**
   - 建议：抽一个通用 `expandVars()`（只 allowlist 少量变量），避免未来继续堆 if。

2. ~~**旧版 AIDOCS/msgcode-2.1 文档仍提到 qwen3/paddle**~~
   - ✅ 已修复：移除 paddle/glm-ocr 提及，统一使用 GLM-4.6V 进行 Vision/OCR

---

## 5) 建议的下一步（不加戏版）

1. `doctor --json` 增加 `tts` probe（只读）
   - 输出：backend、worker alive、最近一次 synth durationMs、timeoutMs、speed/normalize/trim 配置

2. `/help` 里补充 2 条 TTS 关键说明
   - “长文本超时：TTS_TIMEOUT_MS=600000”
   - “停顿调小：INDEX_TTS_INTERVAL_SILENCE_MS=120”

3. 做 2 条 BDD：TTS 超时/重启 worker
   - “worker 卡死 → 超时 → 下次请求自动重启”
