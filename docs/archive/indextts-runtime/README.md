# IndexTTS Runtime Archive

本目录存放已退出正式主链的 IndexTTS 历史脚本，仅用于追溯，不再作为当前 `msgcode` 的可执行入口。

## 文件

- `indexts_cli.py`
- `indexts_worker.py`

## 说明

1. 当前正式 TTS 主链已经收口为 Qwen-only。
2. 这些脚本保留在归档区，方便回看历史实现，不应再被 `/tts`、probe、doctor 或依赖清单引用。
3. 若未来确需复盘历史行为，应以归档代码阅读为主，而不是重新接回主链。
