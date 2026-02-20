# 任务单：P5.7-R2（实时信息三件套：web search / web fetch / system info）

优先级：P0（能力面扩充第一批）

## 目标（冻结）

1. 新增三项 CLI 能力：
   - `msgcode web search --q <query>`
   - `msgcode web fetch --url <url>`
   - `msgcode system info [--json]`
2. 三项能力必须进入 `msgcode help-docs --json` 机器可读合同。
3. 模型调用路径固定：`help-docs --json -> bash 调用 -> 读取结构化结果`。

## 背景（问题本质）

`P5.7-R1` 打通了发送能力入口，但“信息获取能力”仍分散且不稳定。  
先把检索、抓取、系统诊断三件套合同化，后续技能扩展才有稳定底座。

## 设计口径（单一真相）

### 1) web search 合同

- 命令：`msgcode web search --q <query> [--limit <n>] [--json]`
- 输出：
  - 成功：`{ ok: true, query, results: [{title,url,snippet}], count }`
  - 失败：`{ ok: false, errorCode, errorMessage }`

### 2) web fetch 合同

- 命令：`msgcode web fetch --url <url> [--max-bytes <n>] [--json]`
- 输出：
  - 成功：`{ ok: true, url, content, contentType, bytes }`
  - 失败：`{ ok: false, errorCode, errorMessage }`

### 3) system info 合同

- 命令：`msgcode system info [--json]`
- 输出：
  - 成功：`{ ok: true, os, cpu, memory, disk, network }`
  - 失败：`{ ok: false, errorCode, errorMessage }`

### 4) 错误码最小集合（建议）

1. `INVALID_ARGS`
2. `NETWORK_ERROR`
3. `TIMEOUT`
4. `FETCH_FAILED`
5. `UNEXPECTED`

## 范围

- `/Users/admin/GitProjects/msgcode/src/cli.ts`
- `/Users/admin/GitProjects/msgcode/src/commands.ts`（如需）
- `/Users/admin/GitProjects/msgcode/src/probe/*`（如复用探针）
- `/Users/admin/GitProjects/msgcode/test/*web*`
- `/Users/admin/GitProjects/msgcode/test/*system*`
- `/Users/admin/GitProjects/msgcode/docs/tasks/README.md`

## 非范围

1. 不改 `tmux` 透传语义。
2. 不新增 slash 命令。
3. 不接入外部重型服务（本地/轻量优先）。
4. 不改变 `P5.7-R1` 已冻结合同。

## 实施步骤（每步一提交）

### R1：命令接入

提交建议：`cli-realtime-triad-commands`

1. 实现 `web search / web fetch / system info` 子命令。
2. 输出统一结构化结果。

### R2：help 合同同步

提交建议：`help-json-triad-contract`

1. `msgcode help-docs --json` 增加三项能力与参数定义。
2. 补示例调用与错误码说明。

### R3：异常与超时收口

提交建议：`triad-timeout-error-contract`

1. 网络与超时错误统一收口到错误码。
2. 保证失败时不输出“伪成功”文案。

### R4：回归锁

提交建议：`triad-regression-lock`

1. 三命令存在性测试。
2. 参数校验测试。
3. 成功/失败路径测试。
4. `help-docs --json` 合同测试。

## 硬验收（必须全过）

1. `npx tsc --noEmit`
2. `npm test`（0 fail）
3. `npm run docs:check`
4. 冒烟：
   - `msgcode web search --q "msgcode"` 返回结构化结果
   - `msgcode web fetch --url <有效URL>` 返回内容
   - `msgcode system info --json` 返回字段完整

## 提交纪律

1. 禁止 `git add -A`。
2. 每步隔离提交，单提交改动文件数 > 20 拆分重做。
3. 仅提交本单范围文件。

## 验收回传模板（固定口径）

```md
# P5.7-R2 验收报告（实时信息三件套）

## 提交
- <sha> <message>

## 变更文件
- <path>

## Gate
- npx tsc --noEmit:
- npm test:
- npm run docs:check:

## 关键证据
- web search:
- web fetch:
- system info:
- help-docs --json 合同:

## 风险与遗留
- 风险:
- 遗留:
```

