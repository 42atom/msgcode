# plan-260223-r10-identity-layer-local-first

Issue: [待创建]  
Task: docs/tasks/p5-7-r10-identity-layer-local-first.md

## Problem

当前 Agent 身份能力存在三类结构性问题：
1. 凭据来源分散（`.env`、workspace 配置、工具内各自读取），缺少单一治理层。
2. 高权限密钥存在明文落盘与误泄露风险（日志、报错、调试输出）。
3. 工具调用与凭据绑定关系不透明，缺少最小权限与审计闭环。

这会直接影响真实场景可用性（交易、支付、生产 API）与长期维护成本。

## Decision

采用“本地优先 + 双模式并行”路线：
1. 默认模式为 `local-keychain`（macOS Keychain 托管密钥，明文不落盘）。
2. 保留可选模式 `managed-gateway`（便捷优先场景）。
3. 引入统一凭据引用协议 `secret://<KEY_NAME>`，业务主链不再直接依赖具体环境变量名。
4. 建立身份策略层：`tool -> credential` 显式绑定，未绑定默认拒绝。

## Plan

1. `R10-T1` 合同冻结
   - 冻结 `identity.mode`、`secret://` 协议、错误码与输出 envelope。
   - 定义凭据生命周期：创建、读取（掩码）、删除、迁移、健康检查。

2. `R10-T2` Keychain 适配器与 CLI
   - 提供 `msgcode secret add/list/remove/get/test/migrate`。
   - `list/get` 默认不返回明文；`get --reveal` 受策略控制。

3. `R10-T3` 运行时密钥注入
   - 在 `agent-backend`、`tools`、`gen` 链路统一解析 `secret://`。
   - 注入仅在进程内短时存在，日志与错误输出统一脱敏。

4. `R10-T4` 权限策略层
   - 引入工具凭据映射与风险等级（low/medium/high）。
   - 高风险工具支持确认门禁与执行来源标记。

5. `R10-T5` 审计与观测
   - 新增身份审计字段（`traceId/tool/credentialAlias/result/durationMs`）。
   - 仅记录别名与结果码，不记录明文。

6. `R10-T6` 双模式切换与回退
   - `local-keychain` 与 `managed-gateway` 统一经配置切换。
   - 提供故障回退路径，不改业务调用代码。

7. `R10-T7` 端到端验收
   - 真实 8-case 冒烟（工具调用、定时、记忆、多步编排）。
   - 安全门禁（零明文落盘、日志零泄露）+ 三门全绿后签收。

## Risks

1. 迁移期凭据读取路径并存，可能导致行为分叉。  
   缓解：单源解析函数 + 回归锁覆盖两模式。
2. 旧工具直接读环境变量，绕过身份层。  
   缓解：静态扫描禁止新直读 + 运行时告警。
3. Keychain 可用性差异（权限弹窗、会话态）。  
   缓解：预检命令与降级提示，不静默失败。

## Migration / Rollout

1. 先合同、后接线、再策略，最后切默认值。
2. 发布窗口内保持向后兼容：旧 env 读取仅作 fallback，并记录弃用告警。
3. 全量回归通过后，逐步收紧到“仅 `secret://` + 身份层”。

## Test Plan

1. 每步强制执行：
   - `npx tsc --noEmit`
   - `npm test`
   - `npm run docs:check`
2. 增加回归锁：
   - 明文不落盘锁（仓库与工作区敏感字样扫描）
   - 凭据绑定锁（未绑定工具拒绝执行）
   - 脱敏锁（日志/报错不含密钥值）
   - 模式一致锁（两模式下相同业务输入行为一致）

## Observability

1. 统一日志维度：`traceId`, `identityMode`, `credentialAlias`, `tool`, `errorCode`。
2. 区分失败类型：
   - `IDENTITY_SECRET_NOT_FOUND`
   - `IDENTITY_ACCESS_DENIED`
   - `IDENTITY_RESOLVE_FAILED`
   - `IDENTITY_PROVIDER_UNAVAILABLE`

（章节级）评审意见：[留空,用户将给出反馈]
