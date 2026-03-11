# iMessage 完全移除计划

根据要求，我们将从项目中彻底移除 iMessage (imsg) 传输层，仅保留飞书作为唯一的通信渠道。这符合“架构做薄”的理念，减少多渠道带来的兼容性和维护成本。

## 待移除的核心范围

1.  **整个 `src/imsg/` 目录**：包含 adapter、client、index、types 等。
2.  **`src/config.ts` 中的 imsg 配置**：`IMSG_PATH`, `IMSG_DB_PATH`, `MSGCODE_TRANSPORTS` 等概念。
3.  **探针检查 (`src/probe/probes/`)**：移除对 `imsg` 二进制可用性和全盘访问权限的检查。
4.  **CLI 相关命令代码**：如 `msgcode file send` 对 iMessage 的强绑定等。
5.  **废弃 `vendor/imsg`**：在文档中明确不再需要编译/维护 Rust 版本的 imsg 驱动。

---

## 具体修改清单

### 1. 核心目录删除
*   #### [DELETE] `src/imsg/` (整个目录)

### 2. 配置层精简
*   #### [MODIFY] `src/config.ts`
    *   移除 `MSGCODE_TRANSPORTS` 解析，固定底层概念为仅飞书。
    *   移除 `imsgPath` 和 `imsgDbPath` 配置项及验证逻辑。
*   #### [MODIFY] `src/config/workspace.ts`
    *   清理注释中关于 `imsg` 的描述（如 `normalizeChatId` 的例子）。
*   #### [MODIFY] `.env.example`
    *   移除 `IMSG_PATH`、`MSGCODE_TRANSPORTS` 等全部 iMessage 相关注释和示例。

### 3. 环境探针 (Probes)
*   #### [MODIFY] `src/probe/probes/connections.ts`
    *   移除 `imsg RPC` 连接检查（`imsg --version`）。
*   #### [MODIFY] `src/probe/probes/permissions.ts`
    *   移除 Full Disk Access (FDA) 中关于 `chat.db` 的强校验（不再是必须项）。
*   #### [MODIFY] `src/probe/probes/environment.ts`
    *   移除检查 `config.imsgPath` 的逻辑。
*   #### [MODIFY] `src/probe/probes/config.ts`
    *   移除 `imsg_path_set` 的状态报告。

### 4. 运行时与任务队列 (Jobs & Runner)
*   #### [MODIFY] `src/jobs/runner.ts`
    *   移除 `imsgSend` 上下文参数及相关的 `delivery` 回退逻辑。任务现在默认只向挂接到 JobQueue 的通道（即飞书）返回。
*   #### [MODIFY] `src/jobs/types.ts`
    *   移除只为 iMessage 设计的 `deliveryStrategy` 或回发策略。

### 5. CLI 命令
*   #### [MODIFY] `src/cli.ts`
    *   清理 `--help` 和全局描述中的 `iMessage-based bot (imsg RPC)` 字样。
*   #### [MODIFY] `src/cli/file.ts`
    *   移除或重写 `file send` 命令。如果该命令紧耦合 iMessage，考虑整体标为废弃或移除。
*   #### [MODIFY] `src/cli/jobs.ts`
    *   移除 `--no-delivery` (不发送回 iMessage) 的选项。

### 6. 输出过滤与媒体处理
*   #### [MODIFY] `src/output/parser.ts` & `src/output/codex-parser.ts`
    *   移除为 iMessage 定制的“格式化友好”逻辑（如长度截断），因为飞书支持长文本富媒体。
*   #### [MODIFY] `src/attachments/vault.ts`
    *   清理关于 iMessage `.caf` 语音文件扩展名兜底等遗留逻辑。

### 7. README 及文档
*   #### [MODIFY] `README.md`
    *   删除关于 iMessage、`IMSG_PATH` 的环境要求和配置说明。
    *   删除 `Known Limits` 里关于 iMessage 的局限性声明。

---

## 验证计划 (Verification Plan)

### Automated Tests (自动化测试)
因本修改会大面积影响配置读取和探针的已有测试，需要同步清理/修复测试套件：
1.  **清理失效测试**：全仓搜索 `p5-7-r29-feishu-first-transport-default.test.ts`、`p5-7-r30-...` 等测试，删除专门测试“imsg 回退”或“MSGCODE_TRANSPORTS 优先级”的断言。
2.  **重跑全量回归**：
    ```bash
    npm run test
    ```
    预期在修完受影响的 `.test.ts` 后，全仓应全绿。

### Manual Verification (手动验证)
1.  **启动检查**：
    `npm run dev start`
    确认应用不仅飞书模式下能正常启动，且后台没有任何因为找不到 `imsgPath` 而报出的警告。
2.  **探针检查**：
    `npm run dev info`
    确认诊断输出里不再包含任何关于 imsg executable、`chat.db` 权限等探针结果。
