# IndexTTS（本地 TTS）优化备忘（msgcode v2.2）

日期：2026-02-05  
范围：msgcode 的 IndexTTS 接入 + IndexTTS 上游（`~/Models/index-tts`）的可控优化分支  
目标：更快、更稳、更可控（尤其是 MPS/统一内存占用与长文本超时）

---

## 0) 当前基线（我们已经踩过的坑）

### 0.1 torch/torchaudio 2.10 的保存语义变化（已修复）

- 现象：
  - 报错：`TorchCodec is required for save_with_torchcodec`
  - 或：输出音频变成“杂音/削顶”
- 根因：
  - `torchaudio>=2.10` 默认使用 torchcodec backend
  - 期望输入 waveform 是 **float [-1, 1]**
  - IndexTTS2 原实现用 PCM16 量化范围（`int16`/≈[-32767,32767]）直接 `torchaudio.save()` → 会被当成超范围 float → 削顶成噪声
- 修复（已在本机模型目录热修）：
  - 文件：`~/Models/index-tts/indextts/infer_v2.py`
  - 保存前归一化：`(wav.float() / 32767.0)` 再 `torchaudio.save(...)`
- 回滚锚点：
  - `~/Models/index-tts/requirements.before-20260205-110056.txt`

---

## 1) 性能与内存：我们还能优化什么（不等 2.5 权重）

> 结论：论文里宣称的 2.5 提速，核心来自“更短序列/更少步骤/更轻路径”。即使没有 2.5 权重，我们也能在 2.x 上做一部分“工程侧确定性优化”。

### 1.1 最大头的慢：避免走 `use_emo_text → QwenEmotion` 路径

在 IndexTTS2（`indextts/infer_v2.py`）里：
- `use_emo_text=True` 会走 `QwenEmotion.inference()`（内部是一个 CausalLM generate）
- 这条链路很重：不仅慢，而且会引发额外显存/统一内存波动

落地状态（msgcode v2.2）：✅ 已执行
- 默认不把“风格描述”当作 IndexTTS 的 `emotionText` 透传（避免触发内置 QwenEmotion）
- `/mode style <desc>` 与 `/tts 风格:文本` 的 `instruct` 仅作为 **emoAuto 的 styleHint**（由 LM Studio 解析情绪向量），不再触发 IndexTTS 内置 emo_text
- 如确有需要，才通过 `emotionText`（显式字段）走 IndexTTS 内置路径（不作为默认交互）

### 1.2 MPS footprint 暴涨：把 “cache 预分配” 做成可配置并下调

IndexTTS2 初始化阶段有硬编码缓存预分配：
- `setup_caches(max_batch_size=1, max_seq_length=8192)`

这在 unified memory 下非常危险：
- 基线占用大
- 运行中遇到不同形状/更长序列可能继续增长
- Activity Monitor/`vmmap` 的 `Physical footprint` 会一路抬高

建议（IndexTTS 分支内改）：
- 加环境变量：`INDEX_TTS_MAX_SEQ_LENGTH`（默认 4096 或 2048）
- 低于默认阈值时一律用分段 concat 兜底（见 1.4）

落地状态（IndexTTS 分支 msgcode-opt-v2.2）：✅ 已执行
- 通过环境变量控制：`INDEX_TTS_MAX_SEQ_LENGTH`（默认 8192，建议从 4096 起试）

### 1.3 直接提速（有质量风险）：减少 diffusion / beam

在 `infer()` 内部（可做成 env）：
- `diffusion_steps`：25 → 15/20（通常近似线性提速）
- `num_beams`：3 → 1（更快但可能牺牲稳定性/清晰度）

建议（IndexTTS 分支内改）：
- `INDEX_TTS_DIFFUSION_STEPS`（默认 25）
- `INDEX_TTS_NUM_BEAMS`（默认 3）

落地状态（IndexTTS 分支 msgcode-opt-v2.2）：✅ 已执行
- `INDEX_TTS_DIFFUSION_STEPS`（默认 25；建议 15/20 A/B）
- `INDEX_TTS_NUM_BEAMS`（默认 3；建议 1/2 A/B）

### 1.4 长文本稳态：msgcode 侧按句切段 + concat

问题：
- 单段长文本更容易超时、也更容易触发 MPS 缓存/shape 扩张

建议（msgcode 侧）：
- 文本 > N 字（比如 240/400/800）时，按句号/问号/叹号/换行切段
- 每段单独 synthesize，最后 concat（我们已有 concat 工具链）

好处：
- 更稳（不靠单次大推理）
- 内存更可控（避免一次推爆）

落地状态（msgcode v2.2）：✅ 已执行
- 环境变量：`TTS_LONG_TEXT_SEGMENT_CHARS`
  - 为 0/不设置：关闭（默认）
  - 设置为正整数：当文本长度超过阈值且 **非 emoAuto** 时，按句切段 → synthesize → concat

---

## 2) 我们的“优化版”怎么落地（分工与边界）

### 2.1 分支策略（上游模型仓库）

仓库：`~/Models/index-tts`  
分支：`msgcode-opt-v2.2`（已创建，用于承载“可控改动”）

原则：
- 所有“改变上游代码”的修复都进入该分支（可回滚、可对比）
- msgcode 仓库只负责“调用方式/超时/分段/后处理”，不把上游改动散落在各处

### 2.2 msgcode 仓库侧（调用策略）

P0 要做（建议按顺序）：
1. `doctor --json` 增加 tts probe（只读快）：配置齐全性 + worker 是否在跑 + 关键 env
2. 长文本分段（非情绪）：>N 自动切段 + concat
3. BDD：worker 超时后自动重启；长文本分段可稳定完成

补充（已落地，稳定性关键）：
4. 自动语音回复必须串行（Auto TTS Lane）
   - 背景：defer TTS 如果并发，会导致 worker 内存暴涨、音频乱序/重复发送
   - 策略：全局单 lane + per-chat 最新覆盖（旧任务完成后不发送旧音频）
   - 相关 env：
     - `TTS_AUTO_TIMEOUT_MS`：自动语音回复专用超时（默认 120000）

5. 情绪 per-segment 合成的“成本上限”
   - 长文本仍做情绪分析，但超过阈值改用 averageVector 单次合成（更稳更快）
   - 相关 env：
     - `TTS_EMO_SEGMENT_SYNTH_MAX_CHARS`（默认 700）
     - `TTS_EMO_MAX_SEGMENTS`（默认 4）
     - `INDEX_TTS_WORKER_RECYCLE_RSS_MB`（默认 4500）

---

## 3) 最小 A/B 基准（每次改动都要跑）

### 3.1 统一输入（固定变量）

- voice prompt：同一个（避免 cache miss）
- text：两组
  - 短句：`/tts 你好`
  - 中句：`/tts 那真是太好了！保持这种好心情，今天注定会是个充满阳光的日子。`
  - 长句：200–400 字（用于压测）

### 3.2 指标（必须记录）

- 延迟：从请求到音频产物落盘（ms）
- RTF（如果能取到）
- worker 内存：
  - `ps RSS`
  - `vmmap Physical footprint`（重点看 peak 是否继续抬）

---

## 4) 备注：紧急刹车（不建议默认开启）

`INDEX_TTS_MPS_MEMORY_FRACTION`：
- 用于“系统被压爆时”快速止血（限制单进程 MPS 内存比例）
- 代价：更容易 OOM/降速/不稳定
- 当前策略：默认空；仅在 footprint 单边上涨时启用
