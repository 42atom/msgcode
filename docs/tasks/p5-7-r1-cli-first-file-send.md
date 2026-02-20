# 任务单：P5.7-R1（CLI-First 文件发送先跑通）

优先级：P0（先打通能力链路）

## 目标（冻结）

1. 新增可调用能力命令：`msgcode file send --path <path> [--caption "..."] [--mime "..."]`。
2. 新增机器可读帮助：`msgcode help --json`，让模型可先读能力再执行。
3. 固定模型调用流程：`help --json -> bash 调 CLI -> 返回发送结果 -> 继续下一任务`。
4. 口径固定：系统不做路径/可读/workspace 边界校验，只限制文件大小不超过 `1GB`。

## 背景（问题本质）

当前“发文件”能力依赖隐式链路，模型不容易稳定调用。  
要先把发送能力收敛为单一 CLI 合同，后续扩展其他能力时复用同一模式。

## 设计口径（单一真相）

### 1) 命令合同（固定）

- 命令：
  - `msgcode file send --path <path> [--caption "..."] [--mime "..."]`
- 输入：
  - `path`：文件路径（按本单口径，不做路径边界校验）
  - `caption`：可选文案
  - `mime`：可选 MIME 提示
- 输出（结构化）：
  - 成功：`{ ok: true, sendResult: "OK", path, fileSizeBytes }`
  - 超限：`{ ok: false, sendResult: "SIZE_EXCEEDED", fileSizeBytes, limitBytes }`
  - 失败：`{ ok: false, sendResult: "SEND_FAILED", errorMessage }`

### 2) 约束（固定）

1. 仅校验大小上限：`<= 1GB`。
2. 不添加路径白名单校验。
3. 不添加 workspace 归属校验。
4. 不添加可读性预检查。

### 3) 帮助合同（固定）

- `msgcode help --json` 必须包含：
  - `file send` 命令名
  - 必填/可选参数
  - 成功与失败示例
  - 错误码枚举（`OK/SIZE_EXCEEDED/SEND_FAILED`）

## 范围

- `/Users/admin/GitProjects/msgcode/src/cli.ts`
- `/Users/admin/GitProjects/msgcode/src/commands.ts`（如需注册）
- `/Users/admin/GitProjects/msgcode/src/listener.ts`（发送接线）
- `/Users/admin/GitProjects/msgcode/test/*file-send*`
- `/Users/admin/GitProjects/msgcode/test/*cli*`
- `/Users/admin/GitProjects/msgcode/docs/tasks/README.md`

## 非范围

1. 不新增 slash 命令。
2. 不改 tmux 协议。
3. 不恢复 `run_skill`。
4. 不引入路径安全边界策略（按本单冻结口径执行）。

## 实施步骤（每步一提交）

### R1：CLI 发送命令

提交建议：`cli-send-command`

1. 接入 `msgcode file send` 命令和参数解析。
2. 走现有发送通道能力，返回结构化结果。

### R2：机器可读帮助

提交建议：`help-json-contract`

1. 实现 `msgcode help --json`。
2. 将 `file send` 合同落入 JSON 帮助输出。

### R3：大小限制

提交建议：`size-limit-only`

1. 增加 `1GB` 上限判断。
2. 超限统一返回 `SIZE_EXCEEDED`。

### R4：回归锁

提交建议：`regression-lock`

1. `help --json` 含 `file send` 合同。
2. 小文件发送成功。
3. `>1GB` 返回 `SIZE_EXCEEDED`。
4. 不新增 `.only/.skip`。

## 硬验收（必须全过）

1. `npx tsc --noEmit`
2. `npm test`（0 fail）
3. `npm run docs:check`
4. 冒烟：
   - `msgcode help --json` 可见 `file send`
   - `msgcode file send` 小文件成功
   - 大文件触发 `SIZE_EXCEEDED`

## 风险提示（已确认）

当前口径不做路径边界校验，存在本机任意路径尝试发送风险。  
本单按确认口径执行，不做额外安全拦截。

## 验收回传模板（固定口径）

```md
# P5.7-R1 验收报告（CLI-First file send）

## 提交
- <sha> <message>

## 变更文件
- <path>

## Gate
- npx tsc --noEmit:
- npm test:
- npm run docs:check:

## 关键证据
- help --json 包含 file send:
- 小文件发送:
- 大文件超限:

## 风险与遗留
- 风险:
- 遗留:
```

## 通用模板（后续能力扩充复用）

```md
# 任务单：<Phase-编号> <能力名>（CLI-First）

优先级：P0/P1/P2
分支：codex/<branch-name>
基线：<commit-sha>

## 目标（冻结）
1. <能力目标1>
2. <能力目标2>
3. <模型调用路径：help --json -> bash -> msgcode 子命令>

## 范围
- <src 文件>
- <test 文件>
- <docs 文件>

## 非范围
1. <不改语义>
2. <不改架构点>

## 能力合同（单一真相）
- 命令：`msgcode <domain> <action> [flags]`
- 输入：<参数定义>
- 输出：<结构化结果定义>
- 错误码：<固定枚举>

## 实施步骤（每步一提交）
1. <step-1>（commit: <name>）
2. <step-2>（commit: <name>）
3. <step-3>（commit: <name>）
4. <step-4>（commit: <name>）

## 硬验收（必须全过）
1. npx tsc --noEmit
2. npm test（0 fail）
3. npm run docs:check
4. 无新增 .only/.skip

## 提交纪律
1. 禁止 git add -A
2. 单提交变更文件数 > 20 回滚重做
3. 只提交本单范围文件
```
