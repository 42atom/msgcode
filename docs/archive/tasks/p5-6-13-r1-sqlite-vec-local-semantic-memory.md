# P5.6.13-R1：本地语义记忆检索（sqlite-vec + FTS，停用 OV 方案）

## 背景

`charai` 的记忆漏召回暴露了两个核心问题：

1. 触发层不稳定：关键词闸门导致自然语言问题（尤其英文）经常不进检索。
2. 检索层能力不足：当前以 FTS5 为主，跨表达召回能力有限。

本单冻结决策：**不再推进 OV Bridge**，改为本地单进程语义检索路线，参考 openclaw 的轻量做法：

- `Node.js 进程内 + SQLite 文件`
- `sqlite-vec` 向量检索 + `FTS5` 关键词检索
- 无 Docker、无外部向量服务依赖

## 目标（冻结）

1. 记忆检索默认走本地 Provider（sqlite-vec + FTS 混合召回）。
2. 保留 Markdown/本地文件为唯一记忆真相源（SoT），不改写入链路。
3. 删除关键词闸门：`memory.inject.enabled=true` 时每轮尝试检索。
4. sqlite-vec 不可用时自动降级到 FTS-only，聊天主链路不中断。
5. 完整可观测：可区分“未检索 / 检索失败 / 0 命中 / 已注入”。

## 模型定案（本单固定）

1. 默认 embedding 模型：`text-embedding-embeddinggemma-300m`（LM Studio 已实测可用）。
2. 默认量化：`Q8_0`（当前本机已加载版本）。
3. 检索相似度：`cosine`。
4. 向量维度：`768`（按当前模型实测返回维度）。
5. 查询前缀：不需要额外 instruction（保持 query 原文）。

## 范围

- `src/memory/store.ts`
- `src/listener.ts`
- `src/cli/memory.ts`（必要状态输出）
- `src/config/workspace.ts`（仅新增必要开关）
- `test/*memory*`
- `docs/tasks/README.md`（索引同步）

## 非范围

- 不接入 OV / OpenViking
- 不引入 Docker 依赖（Qdrant/Milvus/Chroma 均不在范围）
- 不改 PI/Skill/Tool Bus 语义
- 不新增命令面

## 实施步骤

### R0：OpenViking 残留清理（P0）

1. 清理 `README/.env 示例/任务索引` 中 OpenViking 入口与环境变量描述。
2. 明确单一口径：`memory` 仅本地实现（SQLite + FTS + sqlite-vec），无外部服务依赖。
3. 验证清理后文档门禁通过，避免后续执行歧义。

### R1：Schema 与向量存储接线（P0）

1. 在现有 SQLite 索引中新增向量存储结构（如 `chunks_vec`）。
2. 增加 `sqlite-vec` 扩展加载流程（仅本地）。
3. 扩展不可用时：
   - 记录 `vectorAvailable=false`
   - 自动进入 FTS-only 模式

### R2：Embedding 生成与增量更新（P0）

1. 在 `memory index` 与增量更新路径中生成 chunk embedding。
2. 仅对变更 chunk 重建 embedding，避免全量重算。
3. 为 embedding 增加缓存键（`textDigest + model`）以避免重复计算。

### R3：混合检索（P0）

1. 新增 `hybrid search`：
   - `vector recall` + `keyword recall`
   - 融合排序（加权或 RRF）
2. 默认策略：
   - `vectorWeight=0.7`，`textWeight=0.3`
   - 可通过配置微调
3. 当向量不可用时，自动回退到 `FTS-only`。

### R4：listener 接线与触发收口（P0）

1. 删除关键词闸门（坏味道清理）。
2. `memory.inject.enabled=true` 时每轮检索；`--force-mem` 仅做“放宽阈值强制注入”。
3. 注入失败不影响主回答，保持 graceful degradation。

### R5：观测与回归锁（P0）

日志新增字段（至少）：

- `memoryAttempted`
- `memoryMode`（hybrid/vector-only/fts-only）
- `vectorAvailable`
- `memoryHitCount`
- `memoryInjected`
- `memoryInjectedChars`
- `memoryLatencyMs`
- `memorySkipReason`

回归锁（至少）：

1. 英文问名：`what is my name` 命中 `jerry`
2. 中文问名：`我叫什么名字` 命中
3. 无关问题不误注入
4. vector 不可用时自动走 FTS-only
5. `--force-mem` 可覆盖低相关阈值
6. 不新增 `.only/.skip`

## 硬验收

| 验收项 | 命令/检查 | 结果 |
|---|---|---|
| TypeScript 编译 | `npx tsc --noEmit` | ✅ |
| 全量测试 | `npm test`（0 fail） | ✅ |
| 文档同步检查 | `npm run docs:check` | ✅ |
| 运行时验证 | `charai` 问名可稳定命中 | ✅ |
| 降级能力 | sqlite-vec 不可用时 FTS-only 可用 | ✅ |
| 可观测性 | 日志含 8 个字段 | ✅ |

## 提交纪律（至少 4 提交）

1. `sqlite-vec-schema`
2. `embedding-index-pipeline`
3. `hybrid-retrieval-listener`
4. `memory-regression-lock`

## 执行约束

1. 先打通 FTS-only 回退，再上线混合检索，禁止直接替换主链路。
2. 单次提交变更文件数 > 20 直接回滚重做。
3. 禁止 `git add -A`。

## 验收回传模板（固定口径）

```md
# P5.6.13-R1 验收报告（sqlite-vec local）

## 提交清单
- <sha> <message>

## 变更文件
- <path>

## 三门 Gate
- npx tsc --noEmit: pass/fail
- npm test: <pass>/<fail>
- npm run docs:check: pass/fail

## 关键行为验证
- 英文问名:
- 中文问名:
- 无关问题不注入:
- vector 不可用自动降级:
- force-mem:

## 观测字段样例
<粘贴一条 memory 日志，包含 memoryMode/vectorAvailable/hitCount/injected>

## 风险与遗留
- 已知风险:
- 待后续:
```
