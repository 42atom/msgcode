# TTS Backends

This directory contains concrete TTS backend adapters used by `src/runners/tts.ts`.

## Files

- `types.ts`: shared backend contracts (`TtsBackend`, `TtsOptions`, `TtsResult`).
- `qwen.ts`: Qwen3-TTS local adapter (Apple Silicon path, custom voice + ref-audio clone).

## Runtime Selection

- Mainline is Qwen-only.
- `TTS_BACKEND=qwen` means strict qwen only.
- unset/legacy values fall back to `auto:qwen`.
- Qwen default mode is CustomVoice (`--voice` + `--instruct`).
- Qwen clone mode is enabled only when `refAudioPath` or `QWEN_TTS_REF_AUDIO` is set.
- If `QWEN_TTS_REF_AUDIO` is set but invalid, synthesis returns explicit config error.

## Boundary

- `src/runners/tts.ts` is the only selection/orchestration entry.
- Backend files must not leak provider-specific details outside `TtsResult`.
