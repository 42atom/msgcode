#!/usr/bin/env python3
"""
msgcode: IndexTTS Worker (stdin/stdout JSON RPC)

目标：
- 常驻进程一次性加载 IndexTTS2（避免每次 /tts 都冷启动）
- 通过 stdin 读 JSON 行请求，通过 stdout 写 JSON 行响应

协议（每行一个 JSON）：
Request:
  {"id":"<uuid>", "method":"ping"}
  {"id":"<uuid>", "method":"synthesize", "params": {...}}
  {"id":"<uuid>", "method":"shutdown"}

Response:
  {"id":"<uuid>", "ok":true, "result": {...}}
  {"id":"<uuid>", "ok":false, "error": {"message":"...", "details": {...}}}

说明：
- stderr 仅用于日志/调试；stdout 只输出 JSON 行（便于上层解析）
- 只做串行处理（单 worker 单请求），上层做队列即可
"""

from __future__ import annotations

import json
import gc
import os
import sys
import time
import traceback
import warnings

# ============================================
# P0: 尽早设置环境变量（在任何 import 之前）
# ============================================
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
os.environ.setdefault("TRANSFORMERS_NO_ADVISORY_WARNINGS", "1")
os.environ.setdefault("TRANSFORMERS_VERBOSITY", "error")
os.environ.setdefault("PYTHONUNBUFFERED", "1")
os.environ.setdefault("PYTHONWARNINGS", "ignore")


def _eprint(*args: object) -> None:
    print(*args, file=sys.stderr, flush=True)


def _ok(req_id: str, result: dict) -> None:
    sys.stdout.write(json.dumps({"id": req_id, "ok": True, "result": result}, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def _err(req_id: str, message: str, details: dict | None = None) -> None:
    payload = {"id": req_id, "ok": False, "error": {"message": message}}
    if details:
        payload["error"]["details"] = details
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def _expand_home(path: str) -> str:
    if not path:
        return path
    return os.path.expanduser(path)


def _resolve_paths() -> tuple[str, str, str]:
    root = _expand_home(os.environ.get("INDEX_TTS_ROOT", "~/Models/index-tts"))
    model_dir = _expand_home(os.environ.get("INDEX_TTS_MODEL_DIR", os.path.join(root, "checkpoints")))
    cfg_path = _expand_home(os.environ.get("INDEX_TTS_CONFIG", os.path.join(root, "checkpoints", "config.yaml")))
    return root, model_dir, cfg_path


def _apply_quiet_env() -> None:
    # 关闭不必要的噪音（减少 stderr 污染与性能抖动）
    os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
    os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
    os.environ.setdefault("TRANSFORMERS_NO_ADVISORY_WARNINGS", "1")
    os.environ.setdefault("TRANSFORMERS_VERBOSITY", "error")  # 只显示 error，抑制 warning
    os.environ.setdefault("PYTHONUNBUFFERED", "1")
    os.environ.setdefault("PYTHONWARNINGS", "ignore")

    # 常见 advisory/deprecation（不影响生成，且会污染 stderr）
    # transformers >= 4.50: GPT2InferenceModel 继承问题
    warnings.filterwarnings("ignore", message=r"GPT2InferenceModel has generative capabilities.*")
    # past_key_values deprecation (transformers < 4.53)
    warnings.filterwarnings("ignore", message=r"Passing a tuple of `past_key_values` is deprecated.*")
    # Generation flags 警告
    warnings.filterwarnings("ignore", message=r"The following generation flags are not valid.*")
    # length_penalty 警告
    warnings.filterwarnings("ignore", message=r"length_penalty.*")

def _maybe_apply_mps_memory_fraction(device: str) -> None:
    if device != "mps":
        return

    frac_raw = os.environ.get("INDEX_TTS_MPS_MEMORY_FRACTION", "").strip()
    if not frac_raw:
        return

    try:
        import torch  # type: ignore
    except Exception:
        _eprint("WARN: torch not available; cannot apply INDEX_TTS_MPS_MEMORY_FRACTION")
        return

    try:
        frac = float(frac_raw)
        # 保险：避免 0 或 >1 这种误配置直接把进程搞死
        if frac <= 0.0:
            frac = 0.1
        if frac > 1.0:
            frac = 1.0
        torch.mps.set_per_process_memory_fraction(frac)
        _eprint(f"INFO: applied INDEX_TTS_MPS_MEMORY_FRACTION={frac}")
    except Exception as e:
        _eprint("WARN: failed to apply INDEX_TTS_MPS_MEMORY_FRACTION:", e)


def _mps_stats() -> dict | None:
    try:
        import torch  # type: ignore
    except Exception:
        return None

    if not hasattr(torch, "mps"):
        return None

    try:
        return {
            "currentAllocatedBytes": int(torch.mps.current_allocated_memory()),
            "driverAllocatedBytes": int(torch.mps.driver_allocated_memory()),
            "recommendedMaxBytes": int(torch.mps.recommended_max_memory()),
        }
    except Exception:
        return None


def _post_infer_cleanup(device: str) -> None:
    # 在 macOS 的 unified memory 上，MPS/torch 往往会做 cache/预留，
    # Activity Monitor 看起来像“越跑越大”。这里提供一个可控的清理阀门：
    #
    # - INDEX_TTS_GC_COLLECT=1（默认）: gc.collect()
    # - INDEX_TTS_EMPTY_CACHE=1（默认）: torch.mps.empty_cache()
    #
    # 如果你追求极致速度，可在 env 里关掉这两个开关。
    if os.environ.get("INDEX_TTS_GC_COLLECT", "1") != "0":
        try:
            gc.collect()
        except Exception:
            pass

    if device == "mps" and os.environ.get("INDEX_TTS_EMPTY_CACHE", "1") != "0":
        try:
            import torch  # type: ignore
            torch.mps.empty_cache()
        except Exception:
            pass


def main() -> int:
    _apply_quiet_env()

    # hello（尽早告诉上层：worker 活着）
    sys.stdout.write(json.dumps({"type": "hello", "kind": "indexts_worker", "pid": os.getpid()}, ensure_ascii=False) + "\n")
    sys.stdout.flush()

    root, model_dir, cfg_path = _resolve_paths()
    device = os.environ.get("INDEX_TTS_DEVICE", "mps")
    use_fp16 = os.environ.get("INDEX_TTS_FP16", "0") == "1"
    use_torch_compile = os.environ.get("INDEX_TTS_TORCH_COMPILE", "0") == "1"

    _maybe_apply_mps_memory_fraction(device)

    if not os.path.isdir(root):
        sys.stdout.write(json.dumps({"type": "fatal", "message": f"INDEX_TTS_ROOT directory not found: {root}"}, ensure_ascii=False) + "\n")
        sys.stdout.flush()
        return 2

    sys.path.insert(0, root)

    try:
        from indextts.infer_v2 import IndexTTS2  # type: ignore
    except Exception as e:
        sys.stdout.write(json.dumps({"type": "fatal", "message": f"Failed to import IndexTTS2: {e}"}, ensure_ascii=False) + "\n")
        sys.stdout.flush()
        return 2

    # 初始化（一次）
    t0 = time.time()
    try:
        tts = IndexTTS2(
            cfg_path=cfg_path,
            model_dir=model_dir,
            use_fp16=use_fp16,
            device=device,
            use_torch_compile=use_torch_compile,
        )
    except Exception as e:
        sys.stdout.write(json.dumps({"type": "fatal", "message": f"Failed to initialize IndexTTS2: {e}"}, ensure_ascii=False) + "\n")
        sys.stdout.flush()
        return 2

    sys.stdout.write(json.dumps({"type": "ready", "initMs": int((time.time() - t0) * 1000)}, ensure_ascii=False) + "\n")
    sys.stdout.flush()

    # 主循环：逐行读取请求
    for line in sys.stdin:
        raw = line.strip()
        if not raw:
            continue

        try:
            req = json.loads(raw)
        except Exception:
            # 无 id 的坏输入，只记录，不输出（避免污染协议）
            _eprint("WARN: invalid json line:", raw[:200])
            continue

        req_id = str(req.get("id") or "")
        method = str(req.get("method") or "")
        params = req.get("params") or {}

        if not req_id:
            # 没 id 的请求不响应（协议约定）
            _eprint("WARN: request missing id:", raw[:200])
            continue

        if method == "ping":
            _ok(req_id, {"status": "ready", "mps": _mps_stats()})
            continue

        if method == "shutdown":
            _ok(req_id, {"status": "bye"})
            return 0

        if method != "synthesize":
            _err(req_id, f"Unknown method: {method}")
            continue

        # synthesize
        try:
            # P0: 收到请求 (P0)
            p0_ms = int(time.time() * 1000)

            text = str(params.get("text") or "").strip()
            voice_prompt = _expand_home(str(params.get("voicePrompt") or "")).strip()
            out_wav = _expand_home(str(params.get("outWav") or "")).strip()
            emo_vector = params.get("emotionVector")
            emo_alpha = float(params.get("emotionAlpha") if params.get("emotionAlpha") is not None else 0.6)
            emo_text = str(params.get("emotionText") or "").strip() or None
            interval_silence_ms = int(params.get("intervalSilenceMs") or 200)
            verbose = bool(params.get("verbose") or False)

            # speed:
            # - 兼容历史参数（Node 侧可能会带 speed 字段）
            # - 上游 IndexTTS2 不保证支持 speed 参数；worker 侧不向 infer() 传递
            # - 未来如需"语速控制"，建议在输出 wav 上做后处理（atempo/time-stretch）
            _ = params.get("speed")

            if not text:
                _err(req_id, "Missing text")
                continue
            if not voice_prompt or not os.path.isfile(voice_prompt):
                _err(req_id, "Voice prompt not found", {"voicePrompt": voice_prompt})
                continue
            if not out_wav:
                _err(req_id, "Missing outWav")
                continue

            if emo_vector is not None:
                if not isinstance(emo_vector, list) or len(emo_vector) != 8:
                    _err(req_id, "Invalid emotionVector (expected 8 floats)")
                    continue
                emo_vector = [float(x) for x in emo_vector]
            else:
                emo_vector = None

            # 输出目录
            out_dir = os.path.dirname(out_wav)
            if out_dir and not os.path.isdir(out_dir):
                os.makedirs(out_dir, exist_ok=True)

            # P1: 音频加载前 (即将进入 tts.infer，内部会处理音频)
            p1_ms = int(time.time() * 1000)

            t1 = time.time()
            tts.infer(
                spk_audio_prompt=voice_prompt,
                text=text,
                output_path=out_wav,
                emo_vector=emo_vector,
                emo_alpha=emo_alpha,
                use_emo_text=bool(emo_text),
                emo_text=emo_text,
                interval_silence=interval_silence_ms,
                verbose=verbose,
            )
            dt_ms = int((time.time() - t1) * 1000)

            # P3: 推理结束
            p3_ms = int(time.time() * 1000)

            if not os.path.isfile(out_wav):
                _err(req_id, "TTS output file not generated", {"outWav": out_wav})
                continue

            # P4: 音频写出完成 (tts.infer 内部已写出)
            p4_ms = int(time.time() * 1000)

            _post_infer_cleanup(device)

            # 返回详细计时
            _ok(req_id, {
                "outWav": out_wav,
                "durationMs": dt_ms,
                "mps": _mps_stats(),
                "timing": {
                    "p0_requestReceived": p0_ms,
                    "p1_beforeInfer": p1_ms,
                    "p1_p0_ms": p1_ms - p0_ms,  # 参数解析时间
                    "p3_inferDone": p3_ms,
                    "p3_p1_ms": p3_ms - p1_ms,  # 推理时间 (应与 durationMs 一致)
                    "p4_outputDone": p4_ms,
                    "p4_p3_ms": p4_ms - p3_ms,  # 推理后处理时间
                }
            })
        except Exception as e:
            _eprint("ERROR: synthesize failed:", e)
            tb = traceback.format_exc(limit=5)
            _err(req_id, f"TTS inference failed: {e}", {"trace": tb})
        finally:
            # 即使 synthesize 失败，也尽量做一次 cleanup（避免错误路径累计内存）
            _post_infer_cleanup(device)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
