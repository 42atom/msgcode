# TTS Backends

This directory contains concrete TTS backend adapters used by `src/runners/tts.ts`.

## Files

- `types.ts`: shared backend contracts (`TtsBackend`, `TtsOptions`, `TtsResult`).
- `qwen.ts`: Qwen3-TTS local adapter (Apple Silicon path, custom voice + ref-audio clone).
- `indexts.ts`: IndexTTS adapter (legacy/fallback path).
- `indexts-worker.ts`: IndexTTS worker process client.

## Runtime Selection

- Default order when unset: `qwen -> indextts` (fallback mode).
- `TTS_BACKEND=qwen` means strict qwen only.
- `TTS_BACKEND=indextts` means strict indextts only.
- Qwen default mode is CustomVoice (`--voice` + `--instruct`).
- Qwen clone mode is enabled only when `refAudioPath` or `QWEN_TTS_REF_AUDIO` is set.
- If `QWEN_TTS_REF_AUDIO` is set but invalid, fallback is aborted and returns explicit config error.

## Boundary

- `src/runners/tts.ts` is the only selection/orchestration entry.
- Backend files must not leak provider-specific details outside `TtsResult`.
