# 任务单：P5.7-R12-T7（模型服务生命周期验收与 10 分钟空闲释放）

优先级：P1

## 目标（冻结）

1. 验证 Whisper 与其他本地模型服务在任务结束后是否错误常驻。  
2. 建立统一策略：服务在“最后一次使用后”保活 10 分钟，再自动释放。  
3. 补齐可观测字段与回归锁，防止后续改动导致“常驻泄漏”或“过早释放”。

## 可行性依据（代码现状）

1. `src/runners/asr.ts` 目前以命令调用 `mlx-whisper`，缺少统一生命周期管理。  
2. `src/agent-backend/chat.ts` 已存在 `Model unloaded` 重试分支，说明本地模型加载/卸载已是链路事实。  
3. `src/tools/bus.ts` 已有 `idle timeout` 会话池模式，可复用“空闲回收”设计思路。

## 范围（冻结）

涉及文件（预期）：

1. `/Users/admin/GitProjects/msgcode/src/runtime/model-service-lease.ts`（新建）
2. `/Users/admin/GitProjects/msgcode/src/runners/asr.ts`
3. `/Users/admin/GitProjects/msgcode/src/media/pipeline.ts`
4. `/Users/admin/GitProjects/msgcode/src/agent-backend/chat.ts`
5. `/Users/admin/GitProjects/msgcode/test/p5-7-r12-t7-model-service-idle-release.test.ts`（新建）

## 范围外（冻结）

1. 不改模型能力与推理质量（仅处理生命周期与资源回收）。  
2. 不引入外部进程编排器（systemd/supervisor 等）。  
3. 不改变现有命令合同（`run asr`、`agent chat` 输入输出保持兼容）。
4. 主对话模型（agent-backend 主模型）允许常驻，不纳入本单空闲释放策略。

## 设计约束（冻结）

1. 默认空闲释放阈值固定：`MODEL_SERVICE_IDLE_TTL_MS = 600000`（10 分钟）。  
2. 必须支持环境变量覆盖（仅用于测试/调试）：`MSGCODE_MODEL_IDLE_MS`。  
3. 不允许释放正在执行中的服务（in-flight 期间禁止回收）。  
4. 观测字段至少包含：
   - `serviceName`
   - `lastUsedAt`
   - `idleMs`
   - `releaseReason`
   - `released`

## 实施步骤（每步一提交）

1. `feat(p5.7-r12-t7): add model service lease manager with 10m idle ttl`
   - 新增统一生命周期管理模块（touch/use/release）
2. `refactor(p5.7-r12-t7): wire whisper and local model paths to lease manager`
   - 接入 ASR 与 agent-backend 本地模型链路
3. `test(p5.7-r12-t7): add idle release and keepalive regression locks`
   - 保活窗口锁（<10 分钟复用）
   - 自动释放锁（>=10 分钟回收）
   - in-flight 保护锁（执行中不释放）
4. `docs(p5.7-r12-t7): sync lifecycle policy and observability fields`
   - 回填任务单证据与日志字段口径

## 验收门（冻结）

1. `npx tsc --noEmit`
2. `npm test`（0 fail）
3. `npm run docs:check`
4. 真实证据：
   - 同一服务在 10 分钟内二次请求命中复用（无冷启动）
   - 超过 10 分钟空闲后自动释放，再次请求可冷启动恢复成功
   - 执行中不会被 idle 任务误回收

## 依赖关系

1. 前置：R12-T1/T2（唤醒与调度底座稳定）  
2. 建议后置：R12-T6（secrets 单源闭环后执行，便于排障归因）

## 风险与缓解

1. 风险：释放过早导致频繁冷启动，影响响应时延  
   缓解：固定 10 分钟默认阈值，并允许环境变量覆盖验证。  
2. 风险：释放过晚造成资源长期占用  
   缓解：强制记录 `idleMs/releaseReason`，并加回归锁断言释放行为。
