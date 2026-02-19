# P5.6.8-R5a：artifact→send 回传桥接（发送保持内核能力）

## 背景

在 Pi 范式下，模型只应负责产出文件（`read_file/write_file/edit_file/bash`），不应直接持有发送 API。  
当前缺口是：模型产出 artifact 后，如何稳定触发 iMessage 文件回传。

## 目标（冻结）

1. **发送不 skill 化**：发送动作仅由运行时执行（listener/imsg）。
2. **模型不感知发送 API**：模型只产出 artifact 和回传意图。
3. **可自动回传**：用户语义命中“发给我/发送给我”时，运行时从 artifact 中选择文件并发送。

## 实施范围

- `src/lmstudio.ts`
- `src/tools/bus.ts`
- `src/handlers.ts`
- `src/listener.ts`
- `test/*`

## 实施项

1. **Artifact 契约统一**
   - 工具执行结果统一携带 `artifactPaths`（或可等价映射字段）。
   - `bash`/文件工具产出的目标文件可被上游读取。
2. **发送决策桥接**
   - 在 direct 主链新增“发送意图判定”（仅判定，不发送）。
   - 命中发送意图时，把目标 artifact 转成 `result.file.path`。
3. **通道执行发送**
   - 保持 `listener` 作为唯一发送执行点（`imsgClient.send`）。
   - 不在 skill 或 tool 层直接发送消息。
4. **回归锁**
   - 模型输出触发 artifact 发送时，实际走 `result.file.path -> listener.send`。
   - 不允许新增第二条发送链。

## 验收

- `npx tsc --noEmit` ✅
- `npm test` ✅（msgcode 0 fail；imessage-kit 按白名单）
- `npm run docs:check` ✅
- 冒烟：`pi on` 下“把这个文件发给我”可回传附件，且日志可见 artifact->send 链路

## 非范围

- 不新增发送类工具给模型
- 不在 skill 脚本内调用发送 API
- 不改 tmux 忠实转发协议
