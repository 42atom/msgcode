# msgcode 执行基座命令字典 v0.1

状态：冻结稿

目标：

- 把“执行基座切换”和“模型切换”彻底分开
- 让手机端命令短、直观、少歧义
- 让后续实现以本文为准，不再把 `/model` 混成多种语义

---

## 1. 核心原则

- `backend` 只负责切换当前执行主链
- `local / api / tmux` 只负责设置各自分支的具体 provider / app / client
- `text-model / vision-model / tts-model / embedding-model` 只负责设置模型覆盖，不负责切执行基座
- `/model status` 只负责展示状态，不再承担切换职责
- 每个分支的第一个选项是默认项
- 除 `/backend` 外，其他命令默认不改变当前主分支

---

## 2. 命令总表

### 2.1 执行基座

- `/backend local | api | tmux`

语义：

- 切换当前执行主链
- 如果目标分支尚未配置具体 provider / app / client，则自动落默认项

默认项：

- `local -> omlx`
- `api -> minimax`
- `tmux -> codex`

### 2.2 本地分支

- `/local omlx | lmstudio`
- `/local`

语义：

- 设置 `local` 分支使用哪个本地 app
- 无参时返回当前 `local-app`
- 如果当前 `backend=local`，则立即生效
- 如果当前 `backend!=local`，只更新预设，不切主分支

默认项：

- `omlx`

### 2.3 API 分支

- `/api minimax | deepseek | openai | ...`
- `/api`

语义：

- 设置 `api` 分支使用哪个云端 provider
- 无参时返回当前 `api-provider`
- 如果当前 `backend=api`，则立即生效
- 如果当前 `backend!=api`，只更新预设，不切主分支

默认项：

- `minimax`

实现说明（v0.1）：

- 当前内建实现先覆盖 `minimax | deepseek | openai`
- 后续 API provider 沿用同一协议扩展，不再新增新的切换命令形态

### 2.4 tmux 分支

- `/tmux codex | claude-code`
- `/tmux`

语义：

- 设置 `tmux` 分支使用哪个 tmux client
- 无参时返回当前 `tmux-client`
- 如果当前 `backend=tmux`，则立即生效
- 如果当前 `backend!=tmux`，只更新预设，不切主分支

默认项：

- `codex`

### 2.5 模型覆盖

- `/text-model`
- `/text-model <id|auto>`
- `/vision-model`
- `/vision-model <id|auto>`
- `/tts-model`
- `/tts-model <id|auto>`
- `/embedding-model`
- `/embedding-model <id|auto>`

语义：

- 设置当前激活分支的模型覆盖
- 无参时返回当前激活分支该字段的当前值
- `local` 和 `api` 分支允许各自保存独立的模型覆盖
- `tmux` 分支不消费这些模型字段
- `embedding-model` 主要供内部记忆/检索链使用；默认不强调给普通用户操作，但协议上可见、可配

约束：

- `vision-model` 在 `omlx` 下必须是 `model_type=vlm`
- 不做猜测式 fallback
- 未手动指定时统一显示为 `auto`

本稿暂不定义：

- `clear`
- `reset`

说明：

- `auto` 的正式语义是“当前分支不指定覆盖值，回到自动发现 / 默认解析”
- `clear` 的候选语义是“清除当前分支的模型覆盖，效果等同于回到 auto”
- 但本稿暂不把 `clear` 纳入正式协议，后续若确有强需求再单独定义

统一聚合状态查看走 `/model status`

---

## 3. 状态展示

统一状态命令：

- `/model status`

标准回显模板：

```text
backend: local | api | tmux
local-app: omlx | lmstudio
api-provider: minimax | deepseek | openai | ...
tmux-client: codex | claude-code

text-model: <id> | auto | n/a (tmux)
vision-model: <id> | auto | n/a (tmux)
tts-model: <id> | auto | n/a (tmux)
embedding-model: <id> | auto | n/a (tmux)
```

展示规则：

- 无论当前 `backend` 是什么，`local-app / api-provider / tmux-client` 都显示
- `text-model / vision-model / tts-model / embedding-model` 只显示“当前激活分支”的有效值
- 不展示非激活分支的模型覆盖，避免把“另一条分支的预设”误读成当前正在生效的模型
- 当 `backend=tmux` 时，模型字段显示 `n/a (tmux)`

### 3.1 回显示例：local

```text
/model status

backend: local
local-app: omlx
api-provider: minimax
tmux-client: codex

text-model: auto
vision-model: auto
tts-model: auto
embedding-model: auto
```

### 3.2 回显示例：api

```text
/model status

backend: api
local-app: omlx
api-provider: deepseek
tmux-client: codex

text-model: auto
vision-model: auto
tts-model: auto
embedding-model: auto
```

### 3.3 回显示例：tmux

```text
/model status

backend: tmux
local-app: omlx
api-provider: minimax
tmux-client: codex

text-model: n/a (tmux)
vision-model: n/a (tmux)
tts-model: n/a (tmux)
embedding-model: n/a (tmux)
```

---

## 4. 行为规则

### 4.1 `/backend` 的行为

- `/backend`
  - 无参返回当前 `backend`

- `/backend local`
  - 切到本地主链
  - 若 `local-app` 未配置，则自动设为 `omlx`

- `/backend api`
  - 切到 API 主链
  - 若 `api-provider` 未配置，则自动设为 `minimax`

- `/backend tmux`
  - 切到 tmux 主链
  - 若 `tmux-client` 未配置，则自动设为 `codex`

### 4.2 `/local /api /tmux` 的行为

- 只改各自分支预设
- 当前主分支正好命中时，变化立即可见
- 当前主分支不命中时，不自动切换主链

### 4.3 模型命令的行为

- `/text-model` 只作用于当前激活分支
- `/vision-model` 只作用于当前激活分支
- `/tts-model` 只作用于当前激活分支
- `/embedding-model` 只作用于当前激活分支
- `/text-model /vision-model /tts-model /embedding-model` 无参时返回当前激活分支的当前值
- `tmux` 分支下不允许设置这些模型字段

推荐失败口径：

- 当前 `backend=tmux` 时执行 `/text-model ...`
  - 返回：`tmux 模式不支持本地/API 模型覆盖，请先切回 /backend local 或 /backend api`

---

## 5. 常用排列组合字典

### 5.1 默认切到本地

```text
/backend local
/model status
```

结果：

```text
/model status

backend: local
local-app: omlx
api-provider: minimax
tmux-client: codex

text-model: auto
vision-model: auto
tts-model: auto
embedding-model: auto
```

### 5.2 本地 OMLX 双模型分工

```text
/local omlx
/backend local
/text-model Qwen3.5-27B-Claude-4.6-Opus-Distilled-MLX-4bit
/vision-model Qwen3.5-4B-MLX-4bit
/model status
```

结果：

```text
/model status

backend: local
local-app: omlx
api-provider: minimax
tmux-client: codex

text-model: Qwen3.5-27B-Claude-4.6-Opus-Distilled-MLX-4bit
vision-model: Qwen3.5-4B-MLX-4bit
tts-model: auto
embedding-model: auto
```

### 5.3 本地 LM Studio

```text
/local lmstudio
/backend local
/model status
```

结果：

```text
/model status

backend: local
local-app: lmstudio
api-provider: minimax
tmux-client: codex

text-model: auto
vision-model: auto
tts-model: auto
embedding-model: auto
```

### 5.4 先预设 API，再继续跑本地

```text
/api deepseek
/model status
```

结果：

```text
/model status

backend: local
local-app: omlx
api-provider: deepseek
tmux-client: codex

text-model: auto
vision-model: auto
tts-model: auto
embedding-model: auto
```

### 5.5 切到 API 默认项

```text
/backend api
/model status
```

结果：

```text
/model status

backend: api
local-app: omlx
api-provider: minimax
tmux-client: codex

text-model: auto
vision-model: auto
tts-model: auto
embedding-model: auto
```

### 5.6 切到指定 API Provider

```text
/api deepseek
/backend api
/model status
```

结果：

```text
/model status

backend: api
local-app: omlx
api-provider: deepseek
tmux-client: codex

text-model: auto
vision-model: auto
tts-model: auto
embedding-model: auto
```

### 5.7 切到 tmux 默认项

```text
/backend tmux
/model status
```

结果：

```text
/model status

backend: tmux
local-app: omlx
api-provider: minimax
tmux-client: codex

text-model: n/a (tmux)
vision-model: n/a (tmux)
tts-model: n/a (tmux)
embedding-model: n/a (tmux)
```

### 5.8 切到指定 tmux client

```text
/tmux claude-code
/backend tmux
/model status
```

结果：

```text
/model status

backend: tmux
local-app: omlx
api-provider: minimax
tmux-client: claude-code

text-model: n/a (tmux)
vision-model: n/a (tmux)
tts-model: n/a (tmux)
embedding-model: n/a (tmux)
```

### 5.9 从 tmux 回到本地

```text
/backend local
/model status
```

结果：

```text
/model status

backend: local
local-app: omlx
api-provider: minimax
tmux-client: codex

text-model: Qwen3.5-27B-Claude-4.6-Opus-Distilled-MLX-4bit
vision-model: Qwen3.5-4B-MLX-4bit
tts-model: auto
embedding-model: auto
```

说明：

- 上例假设 local 分支此前已配置文本/视觉模型
- 若 local 分支从未设置过模型覆盖，则对应字段显示 `auto`

### 5.10 从本地回到 API

```text
/backend api
/model status
```

结果：

```text
/model status

backend: api
local-app: omlx
api-provider: deepseek
tmux-client: codex

text-model: auto
vision-model: auto
tts-model: auto
embedding-model: auto
```

说明：

- 上例假设 api 分支当前 provider 预设为 `deepseek`
- 若 api 分支上还配置了独立模型覆盖，则这里显示该分支的真实值，而不是 local 分支的模型值

---

## 6. 旧命令迁移字典

旧命令到新命令的推荐映射：

- `/model agent-backend`
  - 新：`/backend local`

- `/model omlx`
  - 新：`/local omlx`

- `/model lmstudio`
  - 新：`/local lmstudio`

- `/model minimax`
  - 新：`/api minimax` 然后 `/backend api`

- `/model openai`
  - 新：`/api openai` 然后 `/backend api`

- `/model codex`
  - 新：`/tmux codex` 然后 `/backend tmux`

- `/model claude-code`
  - 新：`/tmux claude-code` 然后 `/backend tmux`

- `/model`
  - 新：`/model status`

迁移原则：

- 新命令面把“切主分支”和“选分支内实现”拆开
- 旧 `/model <target>` 应逐步退化为兼容 alias，不再作为正式协议

---

## 7. 冻结口径

本稿建议冻结以下口径：

- `/backend` 是唯一主分支切换命令
- `/local /api /tmux` 是三条对称的 provider 预设命令
- `/model status` 是唯一聚合状态页
- `api-provider` 始终展示，即使当前 `backend!=api`
- `tmux-client` 始终展示，即使当前 `backend!=tmux`
- `text-model / vision-model / tts-model / embedding-model` 只展示当前激活分支的有效值

---

## 8. 已确认项

本轮已确认：

1. `/backend`、`/local`、`/api`、`/tmux` 支持无参查看当前值
2. `/model status` 增加 `embedding-model`
3. `clear` 暂不进入 v0.1 正式协议，模型层统一使用 `auto`

---

## 9. 实现映射（供后续改代码）

后续实现主要会影响：

- `src/routes/cmd-model.ts`
- `src/routes/cmd-info.ts`
- `src/routes/commands.ts`
- `src/routes/cmd-bind.ts`
- `src/agent-backend/config.ts`
- `src/local-backend/registry.ts`

本文件定位：

- 命令协议参考文档
- 当前已冻结，可直接作为实现真相源
