# plan-260311-backend-command-lanes-v1

## Problem

`/model` 现在同时承担“切执行基座、切本地 backend、切 tmux client、查状态”四种语义，导致命令面混乱。用户已经确认新的目标协议是 `backend lanes`：先选执行主分支，再选该分支内的 provider/app/client，模型覆盖另走独立命令，`/model` 只保留为状态页与兼容入口。

## Occam Check

1. 不加它，系统具体坏在哪？
   - 用户执行 `/model omlx`、`/model minimax`、`/model codex` 时，很难判断自己切的是“当前主链”还是“分支预设”；`api-provider` 也无法在当前 local/tmux 状态下独立保存，切换意图经常被隐藏状态吞掉。
2. 用更少的层能不能解决？
   - 能。只需要收口命令协议和少量配置真相源，不需要新控制面、不需要调度器、不需要新的 supervisor。
3. 这个改动让主链数量变多了还是变少了？
   - 变少了。旧 `/model` 的多重语义被拆成一条清晰主链：`/backend` 选 lane，`/local|/api|/tmux` 选分支预设，`/model status` 只读。

## Decision

采用最小可删方案：

1. 保留现有 `runtime.kind` 与本地 backend 注册表，不新造运行时控制层
2. 新增单独的 API provider 预设真相源，避免“当前 active provider”和“API 分支预设”耦合
3. 让模型覆盖按 `local/api` 分支分别存储
4. `/model` 退化为：
   - `/model status`
   - 旧 alias 兼容入口
5. 当前实现覆盖：
   - backend lanes: `local | api | tmux`
   - local app: `omlx | lmstudio`
   - api provider: `minimax | deepseek | openai`
   - tmux client: `codex | claude-code`

## Alternatives

### 方案 A：继续在 `/model` 上追加子命令

优点：

- 改动表面更少

缺点：

- `/model` 继续承担多种语义
- 用户心智不会变清楚
- 状态页和切换动作仍会混在一起

不推荐。

### 方案 B：新造统一控制面对象

优点：

- 看起来完整

缺点：

- 过度设计
- 状态层变重
- 与“做薄、单一主链”的原则冲突

不推荐。

### 方案 C：backend lanes + 兼容 alias（推荐）

优点：

- 对外协议清楚
- 对内改动小
- 兼容旧工作流

## Plan

1. 冻结协议文档
   - 更新 `AIDOCS/design/command-dictionary-260311-backend-lanes-v1.md`
   - 新建 `issues/0080-backend-command-lanes-v1.md`
2. 收口配置真相源
   - `src/config/workspace.ts`
   - 新增按分支存储的模型字段与 getter/setter
   - 新增 API provider 预设读取/写入逻辑
3. 重写命令层
   - `src/routes/commands.ts`
   - `src/routes/cmd-model.ts`
   - 新增 `/backend /local /api /tmux /text-model /vision-model /tts-model /embedding-model`
   - `/model` 只保留 `status` 与兼容 alias
4. 同步用户可见文案
   - `src/routes/cmd-info.ts`
   - `src/routes/cmd-bind.ts`
   - `src/runtime/session-orchestrator.ts`
   - `src/handlers.ts`
5. 补测试与 changelog
   - `test/routes.commands.test.ts`
   - 新增/更新命令协议专项测试
   - `docs/CHANGELOG.md`

## Result

已按最小可删版本落地：

1. 新协议命令已接入：
   - `/backend`
   - `/local`
   - `/api`
   - `/tmux`
   - `/text-model`
   - `/vision-model`
   - `/tts-model`
   - `/embedding-model`
   - `/model status`
2. `api-provider` 现在有独立预设真相源，当前 backend 不再吞掉 API 分支预设
3. 模型覆盖已按 `local/api` 分支分别存储，`/model status` 只显示当前分支模型值
4. 旧 `/model minimax|omlx|codex|...` 继续可用，但已退化为兼容 alias
5. 本轮还顺手补齐了 `deepseek` API provider 直连能力
6. `tts-model` 已真接到当前分支的 TTS 执行链：
   - `qwen` -> `strict:qwen`
   - `indextts` -> `strict:indextts`
   - `auto` -> `fallback:qwen->indextts`
   并且 `/mode` 会回显当前分支的 `tts-model`

## Risks

1. 如果 API provider 预设没有独立真相源，`/api xxx` 在当前 `backend=local|tmux` 时会偷偷切主链。
   - 回滚/降级：恢复旧 `/model` 入口，但保留新协议文档，停止继续扩实现。
2. 如果模型覆盖不按分支存储，切回 local/api 时会复用错误模型值。
   - 回滚/降级：保留只读状态页，暂停模型覆盖写入口。
3. 旧 `/model xxx` 兼容处理不完整，会造成现有工作流断裂。
   - 回滚/降级：优先保证 alias 兼容；必要时延后帮助文案切换。

## Test Plan

至少覆盖：

1. `/backend` 无参/有参行为
2. `/local /api /tmux` 无参查看与有参写入预设
3. `/model status` 只显示当前分支模型
4. `/text-model auto` 会回到自动解析
5. 旧 `/model minimax|omlx|codex` 仍按旧语义切换
6. 路由解析能识别新命令集合
7. `tts-model` 的当前分支配置应优先于 `TTS_BACKEND` 环境变量

## Observability

本轮不新增重日志；至少保证用户可见状态输出稳定：

- `backend`
- `local-app`
- `api-provider`
- `tmux-client`
- 当前分支模型覆盖

（章节级）评审意见：[留空,用户将给出反馈]
