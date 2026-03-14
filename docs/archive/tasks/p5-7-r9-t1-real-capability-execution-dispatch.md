# 任务单：P5.7-R9-T1（真实能力验收执行单，Opus 并行）

优先级：P0（`R9` 首单，后续能力扩展前置硬门）

执行角色（冻结）：

1. Opus：主执行（真机场景跑测 + 证据回填 + 缺陷修复）
2. Codex：复核（口径检查 + Gate 验收 + 回归锁补齐）

## 目标（冻结）

1. 在真实运行环境完成 `R9` 八项能力验收并留痕。
2. 把“工具调用成功（R1）/可展示回答（R2）/端到端成功（E2E）”分离记录，禁止伪成功。
3. 输出可复现的失败分类：`模型问题 / 后端配置问题 / 工具协议问题 / 工具策略问题`。

## 范围

1. `scripts/r9-real-smoke.ts`
2. `AIDOCS/reports/r9-real-smoke-*.md`
3. `AIDOCS/reports/r9-real-smoke-*.json`
4. 真实运行日志：`/Users/admin/.config/msgcode/log/msgcode.log`
5. 必要缺陷修复（仅限为通过 `R9` 门禁所需的最小改动）

## 非范围

1. 不新增新业务命令。
2. 不做大规模架构改造。
3. 不放宽错误码和合同口径。

## 执行步骤（每步一提交）

1. `chore(p5.7-r9-t1): generate real capability smoke evidence baseline`
   - 重启并预检：`msgcode restart -d && msgcode status`
   - 生成验收模板：
     - `npx tsx scripts/r9-real-smoke.ts --format md --out AIDOCS/reports/r9-real-smoke-template.md`
     - `npx tsx scripts/r9-real-smoke.ts --format json --out AIDOCS/reports/r9-real-smoke-template.json`
2. `test(p5.7-r9-t1): execute 8 real capability scenarios with evidence`
   - 按 `docs/tasks/p5-7-r9-real-capability-gate.md` 逐项执行 8 场景
   - 每项回填：输入、工具证据、输出、产物路径、PASS/FAIL
3. `fix(p5.7-r9-t1): patch blocking defects found in real capability gate`
   - 仅修复阻断项（最小改动）
   - 失败必须带错误码和根因分类，不得“口头通过”
4. `test(p5.7-r9-t1): add or update regression locks for fixed blockers`
   - 为本单修复项补回归锁（行为断言）
   - 禁止源码字符串断言

## 硬验收（冻结）

1. `npx tsc --noEmit`
2. `npm test`（0 fail）
3. `npm run docs:check`
4. `R9` 八项能力全部有证据
5. 三重点必须 PASS：
   - 记忆存储与召回
   - 任务编排
   - 定时触发

## 输出物（冻结）

1. `AIDOCS/reports/r9-real-smoke-template.md`（回填后的最终版）
2. `AIDOCS/reports/r9-real-smoke-template.json`（机器可读）
3. `R9-T1 验收报告`（三门结果 + 八项结论 + 阻断项清单）

## 失败分类口径（冻结）

1. `MODEL_FAILURE`：模型未按指令调用工具/编排偏离
2. `BACKEND_FAILURE`：后端配置或路由异常（如模型 ID、baseUrl、鉴权）
3. `TOOL_PROTOCOL_FAILURE`：tool_calls/回灌/收口协议异常
4. `TOOL_POLICY_FAILURE`：fs_scope、权限、路径策略拦截导致失败

## 提交纪律（冻结）

1. 禁止 `git add -A`
2. 每步隔离提交，只提交当前步骤文件
3. 发现非本单改动，先汇报再继续

