#!/usr/bin/env python3
"""
msgcode: IndexTTS CLI Wrapper with Emotion Vector Support

Wrapper script for IndexTTS that exposes emotion vector parameters
which are not available in the original cli.py.

Environment variables:
- INDEX_TTS_ROOT: Root directory of IndexTTS (default: ~/Models/index-tts)
- INDEX_TTS_MODEL_DIR: Model checkpoints directory
- INDEX_TTS_CONFIG: Config file path
- INDEX_TTS_DEVICE: Device to use (cpu/cuda/mps/xpu)

Usage:
    python indexts_cli.py --text "你好世界" --voice-prompt voice.wav --out output.wav \
        --emo-vector "[0.1,0,0,0,0,0,0,0.9]" --emo-alpha 0.6
"""

import argparse
import json
import os
import sys
import warnings


# 避免把 transformers 的 advisory/deprecation 输出当成“致命错误”
# 这些是 warning（不影响正常生成），但会污染 stderr，影响上层错误判定与用户体验。
warnings.filterwarnings("ignore", message=r"GPT2InferenceModel has generative capabilities.*")
warnings.filterwarnings("ignore", message=r"Passing a tuple of `past_key_values` is deprecated.*")


def parse_emotion_vector(vec_str: str) -> list:
    """Parse emotion vector string to list of floats.

    Supports formats:
    - "[0.1,0,0,0,0,0,0,0.9]"
    - "0.1,0,0,0,0,0,0,0.9"
    - "[0.1 0 0 0 0 0 0 0.9]"
    """
    vec_str = vec_str.strip()
    # Remove brackets if present
    vec_str = vec_str.strip("[](){}")
    # Replace various separators with comma
    for sep in [" ", "\t", ";"]:
        vec_str = vec_str.replace(sep, ",")
    # Parse floats
    try:
        vector = [float(x.strip()) for x in vec_str.split(",")]
        if len(vector) != 8:
            raise ValueError(f"Expected 8 emotion values, got {len(vector)}")
        return vector
    except ValueError as e:
        raise argparse.ArgumentTypeError(f"Invalid emotion vector format: {e}")


def main():
    parser = argparse.ArgumentParser(
        description="IndexTTS CLI Wrapper with Emotion Vector Support",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Emotion vector format: 8 floats representing [happy, angry, sad, afraid, disgusted, melancholic, surprised, calm]
Example values:
- Neutral/Calm:    [0, 0, 0, 0, 0, 0, 0, 1.0]
- Happy:          [0.8, 0, 0, 0, 0, 0, 0.2, 0]
- Sad:            [0, 0, 0.8, 0.1, 0, 0.2, 0, 0]
- Excited:        [0.9, 0, 0, 0.3, 0, 0, 0.5, 0]

Environment variables:
  INDEX_TTS_ROOT       IndexTTS root directory (default: ~/Models/index-tts)
  INDEX_TTS_MODEL_DIR  Model checkpoints directory (default: $INDEX_TTS_ROOT/checkpoints)
  INDEX_TTS_CONFIG     Config file path (default: $INDEX_TTS_ROOT/checkpoints/config.yaml)
  INDEX_TTS_DEVICE     Device to use (auto-detected if not set)
        """
    )

    # Required arguments
    parser.add_argument("--text", type=str, required=True, help="Text to be synthesized")
    parser.add_argument("--voice-prompt", "--voice", type=str, required=True, help="Path to the voice prompt audio file (wav format)")

    # Output
    parser.add_argument("--out", "--output", type=str, required=True, help="Path to the output wav file")

    # Model configuration
    parser.add_argument("--config", type=str, help="Path to the config file (default: $INDEX_TTS_ROOT/checkpoints/config.yaml)")
    parser.add_argument("--model-dir", type=str, help="Path to the model directory (default: $INDEX_TTS_ROOT/checkpoints)")
    parser.add_argument("--device", type=str, choices=["cpu", "cuda", "cuda:0", "cuda:1", "mps", "xpu"], help="Device to run the model on (auto-detected if not set)")

    # Emotion control
    parser.add_argument("--emo-vector", type=parse_emotion_vector, help="Emotion vector as 8 floats: [happy, angry, sad, afraid, disgusted, melancholic, surprised, calm]")
    parser.add_argument("--emo-alpha", type=float, default=0.6, help="Emotion strength (0.0-1.0, default: 0.6)")
    parser.add_argument("--emo-text", type=str, help="Emotion text description (alternative to emo-vector, uses built-in Qwen emotion model)")

    # Other options
    default_speed = 1 if os.environ.get("INDEX_TTS_SPEED", "1") == "1" else 0
    parser.add_argument("--speed", type=int, default=default_speed, choices=[0, 1], help=f"Speech speed: 0=normal, 1=fast (default: {default_speed})")
    parser.add_argument("--fp16", action="store_true", help="Use FP16 for inference (may improve performance on GPU)")
    parser.add_argument("--torch-compile", action="store_true", help="Enable torch.compile optimization")
    parser.add_argument("--interval-silence", type=int, default=200, help="Silence duration between segments in ms (default: 200)")
    parser.add_argument("--verbose", action="store_true", help="Enable verbose output")

    args = parser.parse_args()

    # Validate text
    if len(args.text.strip()) == 0:
        print("ERROR: Text is empty.", file=sys.stderr)
        parser.print_help()
        sys.exit(1)

    # Resolve paths from environment variables
    index_tts_root = os.environ.get("INDEX_TTS_ROOT", os.path.expanduser("~/Models/index-tts"))

    if not os.path.isdir(index_tts_root):
        print(f"ERROR: INDEX_TTS_ROOT directory not found: {index_tts_root}", file=sys.stderr)
        sys.exit(1)

    # Add indextts module to path
    sys.path.insert(0, index_tts_root)

    model_dir = args.model_dir or os.environ.get("INDEX_TTS_MODEL_DIR", os.path.join(index_tts_root, "checkpoints"))
    config_path = args.config or os.environ.get("INDEX_TTS_CONFIG", os.path.join(index_tts_root, "checkpoints", "config.yaml"))

    # Validate voice prompt
    voice_prompt = os.path.expanduser(args.voice_prompt)
    if not os.path.isfile(voice_prompt):
        print(f"ERROR: Voice prompt file not found: {voice_prompt}", file=sys.stderr)
        sys.exit(1)

    # Validate config
    if not os.path.isfile(config_path):
        print(f"ERROR: Config file not found: {config_path}", file=sys.stderr)
        sys.exit(1)

    # Create output directory if needed
    output_path = os.path.expanduser(args.out)
    output_dir = os.path.dirname(output_path)
    if output_dir and not os.path.isdir(output_dir):
        os.makedirs(output_dir, exist_ok=True)

    try:
        from indextts.infer_v2 import IndexTTS2
    except ImportError as e:
        print(f"ERROR: Failed to import IndexTTS2: {e}", file=sys.stderr)
        print(f"Make sure INDEX_TTS_ROOT is correct: {index_tts_root}", file=sys.stderr)
        sys.exit(1)

    # Initialize IndexTTS2
    try:
        tts = IndexTTS2(
            cfg_path=config_path,
            model_dir=model_dir,
            use_fp16=args.fp16,
            device=args.device,
            use_torch_compile=args.torch_compile,
        )
    except Exception as e:
        print(f"ERROR: Failed to initialize IndexTTS2: {e}", file=sys.stderr)
        sys.exit(1)

    # Run inference
    try:
        tts.infer(
            spk_audio_prompt=voice_prompt,
            text=args.text.strip(),
            output_path=output_path,
            emo_vector=args.emo_vector,
            emo_alpha=args.emo_alpha,
            use_emo_text=bool(args.emo_text),
            emo_text=args.emo_text,
            interval_silence=args.interval_silence,
            verbose=args.verbose,
        )
        print(f">> TTS output saved to: {output_path}")
    except Exception as e:
        print(f"ERROR: TTS inference failed: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
