# msgcode Local Runners 设计草案（v2.1）

## 一句话目标
把“本地可运行但未服务化”的模型能力（TTS/生图/视频/ASR 等）统一包装为可配置的 **Runner**：msgcode 负责调度与落盘，模型实现由本机命令行/脚本承担。

## 为什么要 Runner
- 你现在的能力现状是：能跑（本地）但形态不统一（Python 脚本/CLI/慢模型）。
- v2.1 的正确策略：**先统一接口与产物落盘**，不强求服务化。
- 这样未来迁移到别人电脑，只要把 `MODEL_ROOT` + runner 配置复制过去即可。

---

## 总原则
- **模型集中**：默认 `MODEL_ROOT=~/Models`（可通过 env 覆盖）。
- **产物集中**：所有 runner 输出必须落到 workspace：
  - `<WORKSPACE>/artifacts/audio/`（TTS）
  - `<WORKSPACE>/artifacts/images/`（生图）
  - `<WORKSPACE>/artifacts/video/`（视频）
  - `<WORKSPACE>/artifacts/asr/`（语音转写）
- **可观测**：runner 运行记录写入 `runs.jsonl`（仅元数据：digest/size/duration/exitCode）。
- **隐私**：默认不把 prompt/输出正文写入日志；仅记录 digest/长度/路径。
- **失败可理解**：退出码 + 标准错误码（对齐 `cli_contract_v2.1`）。

---

## 配置：Runner Registry（建议）

位置建议：
- `~/.config/msgcode/runners.json`（或后续合入统一 config）

结构示例：
```jsonc
{
  "version": 1,
  "modelRoot": "/Users/admin/Models",
  "runners": {
    "asr.mlx_whisper": {
      "kind": "exec",
      "command": "mlx_whisper",
      "args": [
        "--model", "{{MODEL_ROOT}}/whisper-large-v3-mlx",
        "--output-format", "txt",
        "--output-dir", "{{WORKSPACE}}/artifacts/asr",
        "--output-name", "{{MSG_ID}}",
        "--language", "zh",
        "{{INPUT}}"
      ],
      "timeoutMs": 300000
    },
    "tts.indextts": {
      "kind": "exec",
      "command": "{{MODEL_ROOT}}/index-tts/.venv/bin/python",
      "cwd": "{{MODEL_ROOT}}/index-tts",
      "args": [
        "scripts/indexts_cli.py",
        "--model-root", "{{MODEL_ROOT}}",
        "--text", "{{TEXT}}",
        "--out", "{{OUTPUT}}"
      ],
      "timeoutMs": 300000
    },
    "image.z": {
      "kind": "exec",
      "command": "python3",
      "cwd": "{{MODEL_ROOT}}/z-image",
      "args": ["z_image_cli.py", "--prompt", "{{PROMPT}}", "--out", "{{OUTPUT}}"],
      "timeoutMs": 900000
    }
  }
}
```

说明：
- `{{MODEL_ROOT}}`：统一模型根
- `{{WORKSPACE}}`：当前群绑定 workspace 绝对路径
- `{{INPUT}}`：输入文件（语音/图像）
- `{{OUTPUT}}`：输出文件路径（msgcode 预先分配）
- `{{TEXT}}` / `{{PROMPT}}`：文本输入（谨慎：默认不落盘）
- `{{MSG_ID}}`：消息/作业 id（用于输出文件命名）

---

## Runner 类型（v2.1 只做一种就够）

### exec runner（推荐唯一实现）
- 通过 `spawn(command, args, { cwd, env })` 执行
- 捕获 stdout/stderr（默认不写入 log；debug 模式下可落盘到 `<WORKSPACE>/logs/runner-*.log`）
- 支持 timeout（超时 kill 子进程）

后续（2.2+）才考虑：
- `http` runner（服务化）
- `python-venv` runner（自动激活 venv）

---

## Runner 运行协议（与 msgcode 现有能力结合）

### 入口（建议）
1) 群内命令（项目内）：
- `/asr`：对最近一次音频附件做转写
- `/tts <text>`：生成语音并回发（可选）
- `/image <prompt>`：生成图片并回发（可选）

2) CLI（owner-only）：
- `msgcode run asr --workspace <id> --input <file> --json`
- `msgcode run tts --workspace <id> --text "<...>" --json`
- `msgcode run image --workspace <id> --prompt "<...>" --json`

> v2.1 可以先从 CLI 开始，群内命令后置，避免误触发。

### 输出（统一 envelope + planned sideEffects）
- `--dry-run` 输出 planned：
  - 将写入哪些 output 文件
  - 将调用哪个 runner（command+args 摘要）
- 实跑输出 data：
  - `outputPath`
  - `outputDigest`
  - `durationMs`
  - `exitCode`

---

## 跟 Jobs 的关系（自动化）
Jobs v2.1 可以把 payload 扩展为：
- `payload.kind="runRunner"`
- `payload.runnerId="asr.mlx_whisper"|"tts.indextts"|...`
- `payload.args`（结构化参数）

这会让 “定时生成日报配音 / 每晚跑一次视频” 变成纯配置。

---

## 对你当前环境的落地建议（最短闭环）

### P0：ASR（mlx_whisper）
- 你已具备：`/opt/homebrew/bin/mlx_whisper` + `~/Models/whisper-large-v3-mlx`
- 建议先把语音消息打通（见 `attachments_spec_v2.1`），ASR runner 作为第一条本地能力。

### P1：TTS / 生图 / LTX-2
- 现阶段不要求 LM Studio 接管；直接 runner 执行脚本即可。
- 当你把“跑通命令”固化成 `runners.json`，迁移到别人电脑只需要：
  - 同样的 `MODEL_ROOT`
  - 安装同样的依赖（python/venv）
  - msgcode 自动落盘与回发
