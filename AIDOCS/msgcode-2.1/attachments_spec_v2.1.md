# msgcode Attachments 设计草案（v2.1）

## 一句话目标
让 msgcode 把 iMessage 的“附件输入/输出”变成稳定能力：**可搬运、可落盘、可隔离、可被 skill 使用**。其中语音消息（audio）是第一优先级体验。

## 定位与边界

### msgcode 做什么
- 接收附件元信息（来自 `imsg rpc watch.subscribe`）
- 将附件 **复制** 到对应 workspace（避免原始路径失效/缺失）
- 以“线协议”的方式把附件交给 tmux 会话（不做内容理解）
- 可选：把附件写入 memory 的结构化引用（仅记录路径/摘要，不存内容）
- 支持把本地生成的文件作为附件回发到 iMessage（`imsg rpc send --file`）

### msgcode 不做什么（2.1）
- 不做 ASR/TTS/图像理解（这些由外部 skill/agent 完成）
- 不把附件内容写入日志/诊断输出
- 不做跨 workspace 附件共享（默认严格隔离）

---

## 输入：从 iMessage 收附件

### 数据来源
`imsg rpc` 的 watch 消息里包含：
- `attachments[]`（含 `mime_type` / `uti` / `original_path` / `missing` 等）

msgcode 统一抽象为：
```ts
type Attachment = {
  filename?: string;
  mime?: string;
  path?: string;
  missing?: boolean;
};
```

### 语音消息（Audio message）
语音消息通常表现为 `attachments`：
- `mime_type` 可能是 `audio/*`（或由 `uti` 指示音频）
- `original_path` 指向 Messages 附件目录下的文件

**现状**：`src/listener.ts` 对 `text` 为空的消息直接忽略，所以语音会被丢掉。  
**目标**：当 `text` 为空但存在音频附件时，仍然触发处理。

---

## 核心机制：Attachment Vault（workspace 内落盘）

### 目录结构（每个 workspace）
```
<WORKSPACE>/
└── attachments/
    ├── inbox/                 # 从 iMessage 收到的原始附件副本（只追加）
    │   └── 2026-02-01/
    │       └── <msgId>_<name>.<ext>
    └── outbox/                # 待回发/已回发的产物（可选）
```

### 为什么必须 copy
- `original_path` 可能会在系统清理/权限变化后变成 `missing=true`
- 只要 copy 到 workspace，就能：
  - 让 agent/skill 稳定读取
  - 让记忆系统引用（路径可追溯）
  - 让 jobs/工作流重复利用

### Copy 策略（2.1）
- 复制而不是移动（不破坏系统文件）
- 文件名策略：
  - 优先使用 `message.guid` + 原始文件名/transfer_name
  - 无文件名时用 digest：`sha256-<12>` 作为稳定名
- 去重：
  - 若目标文件已存在且 hash 相同 → 跳过
  - 否则追加一个 `-v2/-v3` 后缀

---

## 路由：附件如何进入 tmux/skill

### 最小协议（2.1）
msgcode 不做内容理解，只把附件“描述+路径”送给 agent：

建议向 tmux 发送一条结构化文本（JSON 行也行，但先保持纯文本）：
```
[attachment]
type=audio
mime=audio/m4a
path=<WORKSPACE>/attachments/inbox/2026-02-01/<...>.m4a
```

然后由 workspace 内运行的客户端（claude/codex/自定义）自行决定：
- 用本地 ASR 转写
- 或仅把文件交给用户/工具

### 触发策略（避免误伤）
- 若 `text` 存在：按现有逻辑处理，并把附件作为补充（已支持 attachments 传入 tmux sender）。
- 若 `text` 为空但存在附件：
  - 仅当附件类型在 allowlist（audio/image/pdf 等）时触发
  - 否则忽略（避免 sticker/表情导致刷屏）

---

## 输出：把产物作为附件回发到 iMessage

### 能力
`imsg rpc send` 支持 `file` 参数。

### 建议（2.1）
- 回发附件前做 size 上限（避免巨文件卡死/发不出去）
- 回发时默认不附带敏感路径信息
- 回发失败的错误码要可机器解析（对齐 CLI Contract）

---

## 隐私与安全

### 默认不落正文/内容
- 日志/探针只记录：
  - `mime`
  - `filename`
  - `byteSize`（可选）
  - `digest`
  - `workspaceId/chatGuid`（脱敏）

### 隔离
- 附件落盘路径必须在绑定的 workspace 下
- 群内命令只能访问当前 workspace 的 attachments（禁止跨群读取）

---

## CLI（建议，v2.1 后续实现）

> CLI 用于排障与手工搬运，不用于内容理解。

- `msgcode attachments status --json --workspace <id>`
- `msgcode attachments list --json --workspace <id> [--limit N]`
- `msgcode attachments get --json --workspace <id> --id <attachmentId>`
- `msgcode attachments send --json --chatGuid <...> --file <path>`（owner-only）

---

## 与 Memory/Jobs 的联动（默认关闭）

### Memory 引用（可选）
当用户显式 `/remember` 时，允许写入一个“附件引用”条目：
```md
- 附件：audio m4a（path=attachments/inbox/2026-02-01/...，digest=sha256:...）
```

### Jobs
jobs 可以定时触发“索引附件元数据”或“清理策略”（默认关闭，需显式启用）。

---

## 验收（v2.1）

P0：
1) 用户发语音给 bot：msgcode 不丢弃，能复制到 workspace
2) 复制后的路径被发送到 tmux，会话能看到并处理（哪怕只是回显）
3) `missing=true` 的附件不会导致崩溃（只记录 warning）

P1：
1) bot 能把一个音频文件作为附件回发到 iMessage（`send --file`）
2) 基础 CLI status/list 可用于排障

---

## P0 落地建议：语音 → 文本（mlx_whisper runner）

> 你现在的条件非常成熟：本机已安装 `mlx_whisper`，并且模型集中在 `~/Models`。

### 推荐模型与路径
- `MODEL_ROOT=~/Models`（建议作为 msgcode 的统一模型根目录）
- Whisper 模型：`$MODEL_ROOT/whisper-large-v3-mlx`（你本机已存在）

### 标准执行命令（可直接封装成 runner）
输入：`<WORKSPACE>/attachments/inbox/.../voice.m4a`  
输出：`<WORKSPACE>/artifacts/asr/<msgId>.txt`（或 json）

示例：
```bash
mlx_whisper \
  --model "$HOME/Models/whisper-large-v3-mlx" \
  --output-format txt \
  --output-dir "<WORKSPACE>/artifacts/asr" \
  --output-name "<msgId>" \
  --language zh \
  "<WORKSPACE>/attachments/inbox/2026-02-01/<msgId>_voice.m4a"
```

建议：
- 先用 `ffmpeg` 统一转码到 `wav`（可选）：避免部分 m4a 编码导致的边缘问题。
- 默认只把“转写结果”注入 tmux；是否回发 iMessage 由用户配置决定（避免刷屏）。

