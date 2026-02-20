# 任务单：P5.7-R1b（file send 真实交付闭环）

优先级：P0（阻塞后续能力扩充可信度）

## 目标（冻结）

1. 将 `msgcode file send` 从“合同层”升级为“真实发送”。
2. 命令必须显式指定目标群：`--to <chat-guid>`。
3. 固定发送通道：复用现有 iMessage RPC 发送链路（不新增第二发送链）。
4. 验收必须包含真实成功与真实失败两条链路证据。

## 背景（问题本质）

`P5.7-R1` 已完成合同化，但当前 `file send` 仅执行本地校验并返回结果，尚未真正发送。  
这会造成“命令语义与行为不一致”，影响后续 P5.7 全系列验收可信度。

## 命令合同（单一真相）

- 命令：
  - `msgcode file send --path <path> --to <chat-guid> [--caption "..."] [--mime "..."] [--json]`
- 输入：
  - `path`：待发送文件路径
  - `to`：目标 chat_guid（必填）
  - `caption`：可选文本
  - `mime`：可选 MIME 提示（透传，不做强校验）
- 输出（结构化）：
  - 成功：`{ ok: true, sendResult: "OK", path, to, fileSizeBytes }`
  - 超限：`{ ok: false, sendResult: "SIZE_EXCEEDED", fileSizeBytes, limitBytes }`
  - 失败：`{ ok: false, sendResult: "SEND_FAILED", errorCode, errorMessage }`

## 范围

- `/Users/admin/GitProjects/msgcode/src/cli/file.ts`
- `/Users/admin/GitProjects/msgcode/src/cli/help.ts`（合同字段同步）
- `/Users/admin/GitProjects/msgcode/src/imsg/rpc-client.ts`（仅复用，不改协议）
- `/Users/admin/GitProjects/msgcode/test/p5-7-r1-file-send.test.ts`
- 必要时新增：`/Users/admin/GitProjects/msgcode/test/p5-7-r1b-file-send-delivery.test.ts`
- `/Users/admin/GitProjects/msgcode/docs/tasks/README.md`（索引同步）

## 非范围

1. 不改 tmux 发送链路。
2. 不新增 slash 命令。
3. 不改 memory / tool loop / provider 架构。
4. 不引入路径边界策略（沿用当前口径：仅限制大小）。

## 执行步骤（每步一提交）

### R1：命令参数与发送接线

提交建议：`file-send-to-and-delivery-wireup`

1. `file send` 增加必填 `--to`。
2. 在命令执行链中调用 `ImsgRpcClient.send({ chat_guid: to, text, file })`。
3. 失败返回统一 `SEND_FAILED`，携带 `errorCode/errorMessage`。

### R2：help-docs 合同同步

提交建议：`file-send-help-contract-sync`

1. `msgcode help-docs --json` 更新 `file send` 必填参数与输出结构。
2. 明确 `--to` 为必填。

### R3：回归锁

提交建议：`file-send-real-delivery-regression-lock`

1. 覆盖命令存在与参数校验。
2. 覆盖成功/超限/失败路径。
3. 增加“无 `--to` 必失败”锁。

### R4：真实链路冒烟

提交建议：`file-send-real-smoke-evidence`

1. 真实成功：对可用 chat_guid 发送小文件成功。
2. 真实失败：错误 chat_guid 或不可达场景，返回 `SEND_FAILED`。
3. 保存日志证据（命令输出 + 关键日志字段）。

## 硬验收（必须全过）

1. `npx tsc --noEmit`
2. `npm test`（0 fail）
3. `npm run docs:check`
4. `msgcode help-docs --json` 含 `file send --to` 合同
5. 真实成功链路 1 条（非 mock）
6. 真实失败链路 1 条（非 mock）
7. 无新增 `.only/.skip`

## 提交纪律

1. 禁止 `git add -A`
2. 单提交变更文件数 > 20 回滚重做
3. 仅提交本单范围文件

## 验收回传模板（固定口径）

```md
# P5.7-R1b 验收报告（file send 真实交付闭环）

## 提交
- <sha> <message>

## 变更文件
- <path>

## Gate
- npx tsc --noEmit:
- npm test:
- npm run docs:check:

## 合同证据
- help-docs --json:
- file send 参数（--to 必填）:

## 真实链路证据（非 mock）
- 成功链路:
- 失败链路:

## 风险与遗留
- 风险:
- 遗留:
```
