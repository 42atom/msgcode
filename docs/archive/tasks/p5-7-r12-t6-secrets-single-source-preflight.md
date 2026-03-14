# 任务单：P5.7-R12-T6（Secrets 单源化与 Preflight 闭环）

优先级：P1

## 目标（冻结）

1. 密钥读取路径单源化（优先本地安全存储，再回退 env）。  
2. 后端切换后，链路上所有模型调用都使用同一套鉴权解析。  
3. `preflight` 输出可执行修复建议，不再只报缺失。

## 可行性依据（代码现状）

1. 目前 API key 读取分散在 `agent-backend/config.ts`、`capabilities.ts`、`cli/gen-*`。  
2. `src/deps/preflight.ts` 已有依赖检查框架，可扩展“修复建议”。  
3. CLI 启动已有 env bootstrap，可与 secrets resolver 融合。

## 范围（冻结）

涉及文件（预期）：

1. `/Users/admin/GitProjects/msgcode/src/security/secrets.ts`（新建）
2. `/Users/admin/GitProjects/msgcode/src/agent-backend/config.ts`
3. `/Users/admin/GitProjects/msgcode/src/capabilities.ts`
4. `/Users/admin/GitProjects/msgcode/src/cli/gen-image.ts`
5. `/Users/admin/GitProjects/msgcode/src/cli/gen-audio.ts`
6. `/Users/admin/GitProjects/msgcode/src/deps/preflight.ts`
7. `/Users/admin/GitProjects/msgcode/test/p5-7-r12-t6-secrets-single-source.test.ts`（新建）

## 范围外（冻结）

1. 不引入第三方托管 Secret 网关。  
2. 不修改现有命令合同字段（只改内部解析与诊断）。  
3. 不强制用户迁移所有 .env（保留兼容回退）。

## 设计约束（冻结）

1. 解析优先级固定：`Keychain -> process.env -> ~/.config/msgcode/.env -> .env`。  
2. 新增统一 API：
   - `resolveSecret(name, aliases)`
   - `resolveBackendCredentials(backendId)`  
3. preflight 对缺失项必须输出“下一步修复动作”（示例命令或配置路径）。

## 实施步骤（每步一提交）

1. `feat(p5.7-r12-t6): add unified secrets resolver with keychain fallback`
   - 封装 secrets 读取与缓存
2. `refactor(p5.7-r12-t6): migrate backend and gen commands to unified resolver`
   - 清理散落读取逻辑
3. `feat(p5.7-r12-t6): enhance preflight with actionable remediation hints`
   - 对关键缺失项输出修复建议
4. `test(p5.7-r12-t6): add secrets and preflight regression locks`
   - 单源解析锁
   - 后端切换一致性锁
   - preflight 提示锁

## 验收门（冻结）

1. `npx tsc --noEmit`
2. `npm test`（0 fail）
3. `npm run docs:check`
4. 真实证据：
   - 切换 `local-openai/minimax/gemini/openai` 不再出现“同机不同链路缺 key”
   - preflight 输出可执行修复建议

## 依赖关系

1. 前置：R12-T5（预算与 provider 口径已统一）  
2. 后置：R12 收口完成，可进入下一阶段能力扩展

## 风险与缓解

1. 风险：Keychain 读取失败导致启动阻塞  
   缓解：失败自动回退 env，不阻塞启动。  
2. 风险：过多提示造成 preflight 噪音  
   缓解：仅对 required/active backend 依赖输出强提示。
