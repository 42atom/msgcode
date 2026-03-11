# 任务单：P5.7-R6b（`image read` + LM Studio 模型生命周期）

优先级：P1（R6 主线后插入，先写单后实施）

## 目标（冻结）

1. 新增命令：`msgcode image read --path <image> [--query <text>] [--json]`。
2. 视觉推理固定走本地 LM Studio Vision 模型（默认 `glm-4.6v`，可由 `LMSTUDIO_VISION_MODEL` 覆盖）。
3. 模型生命周期冻结为：**需要时加载（JIT）+ 空闲 1 小时自动卸载（TTL=3600s）**。
4. 输出合同固定，失败错误码可断言，`help-docs --json` 可发现。

## Provider 与生命周期口径（冻结）

1. `image read` 仅走 LM Studio Vision 路径，不接 Banana Pro / MiniMax。
2. 模型按需加载：依赖 LM Studio JIT model loading。
3. 自动卸载：请求级显式传 `ttl=3600`（秒）。
4. 若运行环境不支持请求级 TTL，则回退到 LM Studio App 默认 Idle TTL=60 分钟（文档配置）。

## 范围

- `/Users/admin/GitProjects/msgcode/src/cli/image.ts`（新建）
- `/Users/admin/GitProjects/msgcode/src/runners/vision.ts`（接入 TTL 参数）
- `/Users/admin/GitProjects/msgcode/src/deps/preflight.ts`（补充可观测提示）
- `/Users/admin/GitProjects/msgcode/src/cli/help.ts`（合同导出）
- `/Users/admin/GitProjects/msgcode/test/*p5-7-r6b*`
- `/Users/admin/GitProjects/msgcode/docs/tasks/README.md`

## 非范围

1. 不改 `gen image/selfie`（仍按 R6 冻结走 Banana Pro + `GEMINI_API_KEY`）。
2. 不改工具路由策略（R3l/R3k 不在本单改动）。
3. 不做多模型自动挑选（只做 vision 单模型路径）。

## 错误码（冻结）

1. `IMAGE_READ_FAILED`：识图主流程失败兜底。
2. `IMAGE_NOT_FOUND`：输入图片不存在。
3. `IMAGE_QUERY_EMPTY`：`--query` 传入空串（仅当显式传参时触发）。
4. `LMSTUDIO_VISION_MODEL_UNAVAILABLE`：LM Studio 未加载可用 Vision 模型且无法完成请求。

## 执行步骤（每步一提交）

1. `feat(p5.7-r6b): add image read command contract`
2. `feat(p5.7-r6b): add vision ttl and model lifecycle handling`
3. `test(p5.7-r6b): add image-read regression lock and help-docs sync`

## 硬验收（必须全过）

1. `npx tsc --noEmit`
2. `npm test`（0 fail）
3. `npm run docs:check`
4. `help-docs --json` 可发现 `image read` 合同
5. 真实成功证据：本地图像识别成功（返回文本路径/摘要）
6. 真实失败证据：图片不存在 / LM Studio 模型不可用错误码可断言
7. 无新增 `.only/.skip`

## 验收证据字段（冻结）

1. `modelId`：本次使用模型 ID。
2. `ttlSeconds`：本次请求 TTL（应为 `3600`）。
3. `source`：`lmstudio-vision`。
4. `durationMs`：识图耗时。

## 外部依据（实现前校核）

1. LM Studio 支持 JIT loading / Auto-Evict（Idle TTL）。
2. LM Studio API 支持请求级 `ttl` 字段（秒）。
