# plan-260311-local-backend-control-plane-mvp

## Problem

`msgcode` 现在已经有 `minimax/openai/local-openai` 三类顶层 provider，但“本地 provider 内部到底连的是 LM Studio 还是 oMLX”还没有独立真相源，导致本地 backend 差异继续漏进 `chat`、`vision`、`embedding` 和 `capabilities` 各处。用户现在希望主链先回到 `minimax`，同时把本地 backend 做成可手动切换、可插拔替换的薄控制面。

## Occam Check

1. 不加它，系统具体坏在哪？
   - 本地 backend 继续散落在多处 `LMSTUDIO_*` 假设里，切 oMLX 时必须到处补洞，未来每加一个本地后端都要再改一轮主链代码。
2. 用更少的层能不能解决？
   - 能。只加一个“本地 backend 注册表 + 单一配置真相源”，不加新 supervisor、不加自动编排。
3. 这个改动让主链数量变多了还是变少了？
   - 变少了。本地 provider 差异从多处散落判断收口成一处解析。

## Decision

采用最小可删方案：

1. 全局主后端先切回 `minimax`
2. 新增单独的本地 backend 注册表，先支持 `lmstudio` / `omlx`
3. 顶层 `AGENT_BACKEND` 继续表达“当前主 provider”
4. 本地 backend 的具体选择单独收口，供 `chat / vision / embedding / capabilities` 共用
5. 本轮只做手动切换，不做自动故障切换

## Alternatives

### 方案 A：把 `omlx` 直接当新的顶层 provider 到处接

优点：

- 短期好像最快

缺点：

- 会把“云端 provider”与“本地 backend 实现”混成一层
- `vision` / `embedding` / `capabilities` 仍要各自再分叉

不推荐。

### 方案 B：做重控制面，统一调度本地/云端和 fallback

优点：

- 看起来完整

缺点：

- 明显过度设计
- 会新增控制层、恢复层、裁判层

不推荐。

### 方案 C：薄注册表 + 单独本地 backend 真相源（推荐）

优点：

- 改动小
- 主链收口
- 便于后续继续加本地 backend

## Plan

1. 切回全局主后端
   - 更新 `~/.config/msgcode/.env`
   - `AGENT_BACKEND=minimax`
2. 新增本地 backend 注册表
   - 新增 `src/local-backend/*` 或等价薄模块
   - 统一描述 `lmstudio` / `omlx` 的 baseUrl、apiKey、model、nativeApiEnabled、探测路径
3. 更新配置入口
   - `src/routes/cmd-model.ts`
   - 支持手动选择本地 backend
   - status 文案显式展示当前本地 backend
4. 更新执行链路
   - `src/agent-backend/config.ts`
   - `src/capabilities.ts`
   - `src/runners/vision.ts`
   - `src/memory/embedding.ts`
   - OMLX 视觉请求必须先通过 `/v1/models/status` 确认 `model_type=vlm`
5. 补测试与变更说明
   - `test/*`
   - `docs/CHANGELOG.md`

## Result

已按最小可删版本落地：

1. 全局主后端已切回 `minimax`
2. 新增 `src/local-backend/registry.ts`，收口 `lmstudio / omlx`
3. `/model` 现支持：
   - `/model minimax|openai|agent-backend`
   - `/model lmstudio|omlx`
4. `chat / tool-loop / capabilities / vision / embedding` 已统一接到本地 backend 注册表
5. `omlx` 本地聊天支持通过 `/v1/models` 自动发现模型；不会再误走 LM Studio 的 reload 生命周期
6. OMLX 视觉链现在只会向 `model_type=vlm` 的模型发图；运行环境已固定 `OMLX_MODEL=27B 文本`、`OMLX_VISION_MODEL=4B 视觉`

## Risks

1. 若把“主 provider”与“本地 backend”边界写糊，后面仍会继续漂移。
   - 回滚/降级：保持 `AGENT_BACKEND` 语义不动，只回退本地 backend 注册表与调用点接线。
2. `vision` / `embedding` 仍残留 `LMSTUDIO_*` 假设会导致行为半切换。
   - 回滚/降级：以统一 registry 为唯一配置入口，逐一收口调用点。
3. 自动 fallback 容易诱发新控制层。
   - 回滚/降级：本轮明确不做自动 fallback，只保留手动切换。
4. 历史 `artifacts/vision/*.txt` 缓存可能仍包含旧文本模型时代的结果。
   - 回滚/降级：若出现旧摘要污染，手动清理对应 workspace 下的 `artifacts/vision/` 后重跑。

## Test Plan

至少覆盖：

1. `/model minimax` 仍写全局 `AGENT_BACKEND=minimax`
2. 手动切换本地 backend 时，会写入单独的本地 backend 真相源
3. 本地 backend 为 `omlx` 时，runtime config 走 `OMLX_*` 与 `/v1/models`
4. 本地 backend 为 `lmstudio` 时，runtime config 保持现有 `LMSTUDIO_*` 与 `/api/v1/models`

## Observability

本轮不新增重日志；至少让状态输出能显示：

- 当前主 provider
- 当前本地 backend（若处于本地模式）

（章节级）评审意见：[留空,用户将给出反馈]
