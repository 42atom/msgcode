#!/usr/bin/env python3
"""
Qwen3 TTS (MLX) CLI

目标：
- 给 msgcode 提供一个稳定、可脚本化的 TTS 入口
- 只生成音频文件，不启动 UI

依赖：
- /Users/admin/Models/qwen3-tts/venv/qwen3-tts 里的 mlx-audio
"""

from __future__ import annotations

import argparse
import os
from pathlib import Path

from mlx_audio.tts.utils import load_model
from mlx_audio.tts.generate import generate_audio


def _resolve_model_id(value: str) -> str:
    v = (value or "").strip()
    if not v:
        return "mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-bf16"

    # 允许传入 preset key
    if v.lower() in ["customvoice", "custom", "cv"]:
        p = Path("/Users/admin/Models/qwen3-tts/models/Qwen3-TTS-12Hz-1.7B-CustomVoice-bf16")
        return str(p) if p.exists() else "mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-bf16"
    if v.lower() in ["base", "b"]:
        p = Path("/Users/admin/Models/qwen3-tts/models/Qwen3-TTS-12Hz-1.7B-Base-bf16")
        return str(p) if p.exists() else "mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16"
    if v.lower() in ["voicedesign", "vd"]:
        p = Path("/Users/admin/Models/qwen3-tts/models/Qwen3-TTS-12Hz-1.7B-VoiceDesign-bf16")
        return str(p) if p.exists() else "mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-bf16"

    # 允许本地路径或 HuggingFace repo id
    return v


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--text", required=True)
    parser.add_argument("--voice", default="Serena")
    parser.add_argument("--model", default="CustomVoice")
    parser.add_argument("--instruct", default="", help="风格/音色描述（用于 VoiceDesign 等模式）")
    parser.add_argument("--ref-audio", default="", help="参考音频路径（用于自定义音色/音色迁移）")
    parser.add_argument("--ref-text", default="", help="参考音频对应文字（可选）")
    parser.add_argument("--out", required=True, help="输出音频路径（含扩展名，如 .wav/.mp3）")
    parser.add_argument("--lang", default="zh")
    parser.add_argument("--speed", type=float, default=1.0)
    parser.add_argument("--max-tokens", type=int, default=1024)
    parser.add_argument("--temperature", type=float, default=0.0)
    args = parser.parse_args()

    out_path = Path(args.out).expanduser().resolve()
    out_dir = out_path.parent
    out_dir.mkdir(parents=True, exist_ok=True)

    # 让模型缓存落在 ~/Models/huggingface
    os.environ.setdefault("HF_HOME", str(Path.home() / "Models" / "huggingface"))
    os.environ.setdefault("HUGGINGFACE_HUB_CACHE", str(Path.home() / "Models" / "huggingface" / "hub"))

    model_id = _resolve_model_id(args.model)
    model = load_model(model_id)

    # mlx_audio 需要 output_path(目录) + file_prefix(前缀)
    audio_format = out_path.suffix.lstrip(".") or "wav"
    file_prefix = out_path.stem

    ref_audio = None
    if (args.ref_audio or "").strip():
        p = Path(args.ref_audio).expanduser().resolve()
        if p.exists():
            ref_audio = str(p)

    ref_text = None
    if (args.ref_text or "").strip():
        ref_text = args.ref_text.strip()

    generate_audio(
        model=model,
        text=args.text,
        max_tokens=args.max_tokens,
        voice=args.voice,
        instruct=args.instruct or None,
        speed=args.speed,
        lang_code=args.lang,
        cfg_scale=None,
        ddpm_steps=None,
        ref_audio=ref_audio,
        ref_text=ref_text,
        stt_model=None,
        output_path=str(out_dir),
        file_prefix=file_prefix,
        audio_format=audio_format,
        join_audio=True,
        play=False,
        verbose=False,
        temperature=args.temperature,
    )

    # 输出最终路径（给调用方解析）
    print(str(out_path))


if __name__ == "__main__":
    main()
