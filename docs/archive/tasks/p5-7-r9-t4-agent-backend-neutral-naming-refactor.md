# 任务单：P5.7-R9-T4（`lmstudio` 命名去耦与 `agent-backend` 中性重命名）

优先级：P0（高风险重构，独立执行）

## 背景（冻结）

1. 当前主链核心文件与函数命名仍是 `lmstudio` 语义（如 `src/lmstudio.ts`、`runLmStudioRoutedChat`）。  
2. 但系统已经支持多后端/多模型切换（`local-openai/openai/minimax`），旧命名会持续误导维护与扩展。  
3. 这是结构性坏味道：**语义与实现能力不一致**。

## 目标（冻结）

1. 把“执行后端”主语统一为 `agent-backend`（或 `agent`），消除 `lmstudio` 专有命名对认知的误导。  
2. 文件名、函数名、日志字段、命令文案对齐中性语义。  
3. 在稳定基础上迁移：禁止一次性暴力替换导致回退。

## 配置驱动原则（冻结）

1. 后端与模型切换一律走配置，不走代码分支切换。  
2. 业务主链禁止出现“按具体模型名判断逻辑”（如 `if model === "xxx"`）。  
3. 配置解析单源化：`AGENT_BACKEND` + `AGENT_MODEL` 为主入口；后端专属变量仅作覆盖层。  
4. 任何新增后端必须先接入统一配置解析，再接入执行链路。  
5. 测试口径：切换配置后，分类/执行/总结三段必须使用同一解析结果，不允许遗漏链路。

## 依赖前置（冻结）

1. `R9-T2` 已通过（上下文预算与 compact 主链稳定）。  
2. `R9-T3` 已通过（记忆默认开启 + `/clear` 边界锁稳定）。  
3. 收敛分支执行：`codex/p5-7-r9-mainline-convergence`。

## 风险评估（冻结）

高风险点：

1. 大量测试直接读取 `src/lmstudio.ts` 或断言 `runLmStudio*` 字符串。  
2. 文档中存在大量 `lmstudio` 路径与函数名硬编码。  
3. 若一次性重命名，极易触发大面积冲突与回退。

控制策略：

1. 三阶段迁移（先桥接、再迁移、后收口）。  
2. 每阶段独立提交并跑三门。  
3. 只允许行为断言，不新增源码字符串强匹配。

## 实施步骤（每步一提交）

1. `feat(p5.7-r9-t4): introduce neutral agent-backend entry and aliases`  
   - 新建中性入口文件：`src/agent-backend.ts`（主实现承载）  
   - `src/lmstudio.ts` 先降级为兼容 re-export 层（薄封装）  
   - 先不改行为，只改入口拓扑

2. `refactor(p5.7-r9-t4): rename exported APIs to neutral naming`  
   - 目标函数命名示例：  
     - `runLmStudioRoutedChat` -> `runAgentRoutedChat`  
     - `runLmStudioToolLoop` -> `runAgentToolLoop`  
     - `runLmStudioChat` -> `runAgentChat`  
   - 保留旧名别名一段过渡期（同实现）

3. `refactor(p5.7-r9-t4): migrate callsites to neutral APIs`  
   - 迁移 `handlers/routes/tests` 的主调用到新名字  
   - 日志字段从 `lmstudio` 语义改为 `agent-backend` 语义（必要兼容保留）  
   - 校正配置读取：业务链路只消费统一解析后的 runtime，不直读散落环境变量

4. `test(p5.7-r9-t4): replace brittle source-string locks with behavior locks`  
   - 清理对 `src/lmstudio.ts` 路径/文本强依赖测试  
   - 改为行为断言（输入输出、路由、工具调用、错误码）

5. `docs(p5.7-r9-t4): sync task/docs/help wording to agent-backend`  
   - 同步 `docs/tasks`、`help-docs --json`、用户可见文案  
   - 明确：`lmstudio` 仅作为历史别名，不再是主语

6. `chore(p5.7-r9-t4): finalize convergence and deprecate lmstudio shim`  
   - 若回归全绿，评估是否移除 `src/lmstudio.ts` 兼容壳  
   - 若暂保留壳，必须在文件头写明“兼容层，禁止新代码依赖”

## 验收门（冻结）

1. `npx tsc --noEmit`
2. `npm test`（0 fail）
3. `npm run docs:check`
4. 关键验收：
   - 新入口 `src/agent-backend.ts` 为主调用入口  
   - 对外主文案不再把 `lmstudio` 作为系统主语  
   - 模型切换、工具调用、记忆链路行为不回退

## 产物（冻结）

1. 重命名迁移清单（文件/函数/文案）  
2. 兼容别名清单（保留项与计划移除时间）  
3. 回归报告（关键链路：no-tool/tool/complex-tool + memory + clear）

## 非范围

1. 不在本单新增后端能力。  
2. 不改业务策略（仅做语义去耦和命名收敛）。  
3. 不在本单重写 Tool Loop 协议。
