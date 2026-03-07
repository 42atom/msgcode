# Plan: 飞书文件发送收口到 workspace 当前会话上下文

## Problem

当前飞书文件发送同时依赖提示词推理和运行时降级补丁：模型被要求从 session 文件名提取 chatId，而工具链在文件上传失败后还能因为文本回退返回成功。这样既增加模型理解负担，也破坏了“文件是否真正送达”的判断。

## Occam Check

- 不加它，系统具体坏在哪？
  当前请求无法稳定拿到所属 chatId，只能让模型解析文件名；真实日志里还出现了上传 400 但工具记成功的假阳性。
- 用更少的层能不能解决？
  能。直接把当前会话写入现有 `.msgcode/config.json`，再让 tool/prompt 读取这份单一真相源，不新增会话裁判层。
- 这个改动让主链数量变多了还是变少了？
  变少了。chatId 来源从“session 文件名推断 + ctx.chatId + 手填参数”收口成“workspace 当前会话上下文 + 显式参数覆盖”。

## Decision

采用“请求入口写入 workspace 当前会话上下文，工具与 prompt 回读 config”的最小方案。

关键理由：
1. 复用现有 `.msgcode/config.json`，不新增存储层。
2. 把 chatId 解析从模型推理移回系统状态，降低误判。
3. 保持 transport 主链不变，只修正 file send 的真实成功语义。

## Plan

1. 在 `src/config/workspace.ts` 增加 `runtime.current_transport/current_chat_id/current_chat_guid` 与写入函数；验收点：config 能落盘这三个字段。
2. 在 `src/listener.ts` 路由完成后写入当前请求上下文；验收点：飞书消息进入后默认 workspace config 更新。
3. 在 `src/tools/bus.ts`、`src/tools/manifest.ts`、`prompts/agents-prompt.md` 收口 `chatId` 来源与合同；验收点：工具可缺省 `chatId`，提示词不再提 session 文件名。
4. 在 `src/feishu/transport.ts`、`src/tools/feishu-send.ts` 修复 `file_type`、大小限制、成功判定与诊断信息；验收点：上传失败不得返回成功。
5. 在 `test/p5-7-r12-feishu-send-file.test.ts` 增加回归锁；验收点：测试覆盖当前会话写入、缺省 chatId 回填、失败不伪装成功。

## Risks

1. 每次请求都会写 `.msgcode/config.json`，可能增加少量 IO；回滚/降级：移除 `listener` 写入逻辑，保留显式传参路径。
2. `chatId` 缺省回填可能把“最近一次会话”用于脱离上下文的手动调用；回滚/降级：恢复 `chatId` 必填，仅保留 config 供 prompt 读取。

## Alternatives

1. 继续让模型解析 `.msgcode/sessions/*.jsonl` 文件名。
缺点：状态分叉，模型需要做字符串推断，且对 session 文件组织形式耦合过深。

2. 新增独立 session registry / current-session store。
缺点：重复造状态层，超出当前问题所需。

## Test Plan

- 运行 `bun test test/p5-7-r12-feishu-send-file.test.ts`
- 若通过，再补 `npm test -- test/p5-7-r12-feishu-send-file.test.ts` 等价验证（按仓库脚本口径）

## Observability

- 保留并增强飞书上传/发送错误信息，确保日志能区分：
  - 文件上传失败
  - 文件消息发送失败
  - 文本降级发送成功

（章节级）评审意见：[留空,用户将给出反馈]
