# 任务单：P5.7-R10-3（gen image 提供方降级与诊断）

优先级：P1

## 目标（冻结）

1. `gen image/selfie` 在主提供方失败（如区域限制）时可自动降级到备用提供方。
2. 若无可降级路径，返回明确错误码与可执行提示，不再只给原始供应商报错文本。
3. 全链路日志包含“主提供方、失败原因、降级目标、最终结果”。

## 涉及文件（预期）

- `/Users/admin/GitProjects/msgcode/src/cli/gen.ts`
- `/Users/admin/GitProjects/msgcode/src/config/workspace.ts`（如需 provider 优先级配置）
- `/Users/admin/GitProjects/msgcode/test/p5-7-r6-2-gen-image-contract.test.ts`
- `/Users/admin/GitProjects/msgcode/test/p5-7-r6-4-media-gen-regression-lock.test.ts`

## 范围外（冻结）

1. 不改 `gen tts/music` 链路。
2. 不变更现有 API Key 命名（`GEMINI_API_KEY` / `MINIMAX_API_KEY`）。
3. 不引入托管网关。

## 实施要求（冻结）

1. 提供方策略配置化（建议）：
   - `gen.image.providers = gemini,minimax`（按顺序尝试）
2. 仅在可识别的可恢复错误触发降级（如区域限制、provider 不可用）。
3. 新增固定错误码（示例）：
   - `GEN_PROVIDER_REGION_UNSUPPORTED`
   - `GEN_PROVIDER_FALLBACK_EXHAUSTED`
4. `help-docs --json` 同步合同与错误码。

## 提交建议

1. `feat(p5.7-r10-3): add image provider fallback and diagnostics`
2. `test(p5.7-r10-3): add gen-image fallback regression lock`

## 验收标准（冻结）

1. 主提供方触发区域限制时，若备用可用则任务成功并产出文件。
2. 无备用或全部失败时，返回固定错误码与明确 hint。
3. 日志可追踪每一步提供方决策。
4. 三门全绿：`tsc` / `test` / `docs:check`。
