# 任务单：P5.7（CLI-First Skill 能力扩充总纲）

优先级：P0（作为后续所有能力扩充的统一口径）

## 目标（冻结）

1. 采用 Unix 风格的 **CLI-First** 能力扩展路径：模型先读能力清单，再调用命令。
2. 将 msgcode 的能力扩展统一为 `domain/action` 命令合同，避免隐式链路漂移。
3. 以 Skill 作为“使用指引层”，以 CLI 作为“执行合同层”，实现可测、可回归、可派单。
4. Alma 仅作能力清单设计参考样例，不是协议来源，也不是实现约束。

## 基座边界（新增冻结）

1. `msgcode` 只负责提供稳定、完备、可观测的本地 CLI 能力，不替模型做任务决策。
2. Skill 编排策略属于模型侧，不进入 `msgcode` 基座实现。
3. 能力接口优先采用 Unix 风格命令与参数约定，降低模型调用学习成本。
4. 能力暴露优先“做强能力面”，但必须满足安全底线与真实可执行。

## 统一原则（全系列必须遵守）

1. 模型调用流程固定：`msgcode help --json -> bash 调 msgcode 子命令 -> 读取结构化结果`。
2. Skill 只做指引，不承载通道私有实现细节。
3. 每个能力必须有明确错误码，不允许“文本猜测成功”。
4. 每个能力必须有回归锁：命令存在、参数校验、成功路径、失败路径。
5. 禁止回流 `run_skill`、禁止新增第二执行链。
6. 禁止“合同壳验收”：命令名与行为必须一致，不能只校验参数/大小就宣告成功。
7. 每个能力必须提供至少 1 条真实执行成功证据（非 mock、非静态断言）。
8. 每个能力必须提供至少 1 条真实失败证据（真实错误码与错误消息）。

## 系列拆分（P5.7-R1 ~ R8）

### R1（P0）：文件发送先跑通

- 任务单：`p5-7-r1-cli-first-file-send.md`
- 目标：`msgcode file send` + `msgcode help --json` 首次打通。
- 产物合同：
  - `msgcode file send --path <path> [--caption] [--mime]`

### R1b（P0）：文件发送真实交付闭环

- 任务单：`p5-7-r1b-file-send-real-delivery.md`
- 目标：`msgcode file send` 从“合同层”升级为“真发送”，必须可指定目标并通过现有 iMessage 通道送达。
- 产物合同：
  - `msgcode file send --path <path> --to <chat-guid> [--caption] [--mime] [--json]`

### R1c（P0）：CLI 基座能力硬门（稳定性+安全底线）

- 任务单：`p5-7-r1c-cli-substrate-capability-baseline.md`
- 目标：统一 P5.7 后续能力的“真执行 + 可观测 + 安全底线”门禁，不允许仅合同通过。
- 基线要求：
  - 命令语义与行为一致
  - 至少 1 条真实成功与 1 条真实失败证据
  - 统一错误码和日志字段

### R2（P0）：实时信息三件套

- 建议能力：
  1. `msgcode web search --q <query>`
  2. `msgcode web fetch --url <url>`
  3. `msgcode system info [--json]`
- 参考样例映射（Alma）：`web-search`、`web-fetch`、`system-info`

### R3（P1）：文件管理能力

- 建议能力：
  1. `msgcode file find ...`
  2. `msgcode file move ...`
  3. `msgcode file rename ...`
  4. `msgcode file zip ...`
- 参考样例映射（Alma）：`file-manager`

### R4（P1）：记忆与线程检索

- 建议能力：
  1. `msgcode memory add|search|stats ...`
  2. `msgcode thread list|info|switch ...`
- 参考样例映射（Alma）：`memory-management`、`thread-management`

### R5（P1）：任务编排

- 建议能力：
  1. `msgcode todo add|list|done ...`
  2. `msgcode schedule add|list|run ...`
- 参考样例映射（Alma）：`todo`、`scheduler`

### R6（P1）：可视化取证与媒体辅助

- 建议能力：
  1. `msgcode screen shot --out <path>`
  2. `msgcode voice tts ...`（若已有命令则做合同化）
- 参考样例映射（Alma）：`screenshot`、`voice`

### R7（P2）：浏览器自动化

- 建议能力：
  1. `msgcode browser open|click|type|snapshot ...`
- 参考样例映射（Alma）：`agent-browser`、`browser`

### R8（P2）：编码子代理委派

- 建议能力：
  1. `msgcode agent code run --dir <path> "<task>"`
- 参考样例映射（Alma）：`coding-agent`

## 每个子任务统一验收（硬门）

1. `npx tsc --noEmit`
2. `npm test`（0 fail）
3. `npm run docs:check`
4. `msgcode help --json` 含新增能力合同
5. 至少 1 条真实成功冒烟（必须可复现）
6. 至少 1 条真实失败冒烟（错误码可验证）
7. 无新增 `.only/.skip`

## 派单模板（P5.7 子任务复用）

```md
# 任务单：P5.7-Rx（<能力名>）

优先级：P0/P1/P2
分支：codex/<branch-name>
基线：<commit-sha>

## 目标（冻结）
1. <能力目标1>
2. <能力目标2>
3. 模型调用路径固定为：help --json -> bash -> msgcode 子命令

## 范围
- <src 文件>
- <test 文件>
- <docs 文件>

## 非范围
1. 不改 <无关模块>
2. 不引入 <第二执行链>

## 命令合同（单一真相）
- 命令：`msgcode <domain> <action> [flags]`
- 输入：<参数定义>
- 输出：<结构化结果定义>
- 错误码：<固定枚举>

## 执行步骤（每步一提交）
1. <step-1>（commit: <name>）
2. <step-2>（commit: <name>）
3. <step-3>（commit: <name>）
4. <step-4>（commit: <name>）

## 硬验收
1. npx tsc --noEmit
2. npm test（0 fail）
3. npm run docs:check
4. msgcode help --json 包含能力合同
5. 至少 1 条真实成功冒烟（非 mock）
6. 至少 1 条真实失败冒烟（非 mock）
7. 无新增 .only/.skip
```
