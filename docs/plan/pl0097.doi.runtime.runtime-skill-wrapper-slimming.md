# Runtime Skill Wrapper 瘦身计划

Issue: 0097

## Problem

`msgcode` 当前的 runtime skill 层有一个明显结构漂移：

- skill 本来应该首先是说明书（`SKILL.md`）
- `main.sh` 本来应该只是少数真实脚本/跨语言桥接入口

但现在 `src/skills/runtime/` 里混进了大量纯 `exec msgcode ...` 的 alias wrapper：

- `memory/main.sh`
- `file/main.sh`
- `thread/main.sh`
- `todo/main.sh`
- `media/main.sh`
- `gen/main.sh`
- `patchright-browser/main.sh`

另外还有两类特殊情况：

- 真桥接：
  - `banana-pro-image-gen/main.sh`
  - `local-vision-lmstudio/main.sh`
- 假壳：
  - `vision-index/main.sh` 只是打印说明再提示去读 `SKILL.md`

这带来的问题不是“CLI 被调用了”本身，而是 skill 边界被写乱了：

- 模型会误以为“wrapper 才是主入口”
- `runtime/index.json` 会把 wrapper 暴露成技能入口，掩盖真正的说明书
- 一堆薄壳文件、同步规则和测试锁只是在维护重复合同
- 仓库明明写着“`main.sh` 不是必选项”，但实际 runtime skills 却默认在长 wrapper

## Occam Check

1. 不加它，系统具体坏在哪？
   - runtime skill 层会继续把纯说明书、真桥接、CLI alias wrapper 混成一层；模型和维护者都更难判断 canonical 入口，wrapper 数量也会继续增长。
2. 用更少的层能不能解决？
   - 能。不是再造“内部短路层”，而是直接删掉没有价值的 wrapper，让 skill 回到 `SKILL.md` 主体；只保留真正必要的桥接脚本。
3. 这个改动让主链数量变多了还是变少了？
   - 变少了。当前是 `SKILL.md -> main.sh -> msgcode CLI` 的多层入口；收口后会回到 `SKILL.md -> 直接工具/直接 CLI` 或 `SKILL.md -> 真桥接脚本`。

## Decision

采用 **“skill 默认是说明书，wrapper 只保留给真桥接”** 的方案。

冻结三类 runtime skill：

1. **纯说明书 skill**
   - canonical 入口：`SKILL.md`
   - 可以通过 `bash`/工具/直接 CLI 执行
   - 不额外提供 `main.sh`

2. **脚本桥接 skill**
   - canonical 入口：`SKILL.md`
   - `main.sh` 只在确实需要跨语言/外部脚本/环境归一化时保留

3. **CLI alias wrapper**
   - 如果 `main.sh` 只是 `exec msgcode ...`
   - 默认进入退役候选，不再当正式长期形态

同时明确拒绝一个方向：

- **不做 Node 内部“短路匹配”**
  - 不根据意图偷偷绕过 CLI 再走另一条 TS 入口
  - 避免再次制造双真相源和隐藏主链

## Alternatives

### 方案 A：保持现状，接受 wrapper 泛滥

- 优点：不改 skill 合同
- 缺点：wrapper 会继续增长，skill 边界继续漂移

### 方案 B：运行时做内部短路匹配

- 优点：理论上减少进程启动开销
- 缺点：会引入隐藏调用链；对外一套 CLI 合同，对内一套短路路径，容易再次形成双真相源

### 方案 C：先清 skill 层 wrapper，再把 CLI 逻辑下沉（推荐）

- 优点：顺序正确，先把入口边界理顺，再做 CLI 去事务化
- 缺点：不能一步解决所有 CLI 膨胀问题，但风险最低

## 分类与范围

### A. 继续保留 `main.sh` 的 skill

这些 `main.sh` 属于真实桥接，不是纯 alias：

- `banana-pro-image-gen`
  - `main.sh -> node scripts/banana-pro-client.js`
- `local-vision-lmstudio`
  - `main.sh -> python3 scripts/analyze_image.py`

这类入口具备明确价值：

- 跨语言桥接
- 固定脚本入口
- 本地环境依赖归一化

### B. 退役 `main.sh` 候选：纯 alias wrapper

这些当前主要是 `exec msgcode ...`：

- `file`
- `gen`
- `media`
- `thread`
- `patchright-browser`

这类 skill 的推荐方向：

- 保留 `SKILL.md`
- 文案里直接教模型调用 `msgcode ...`
- 不再额外保留一层 `main.sh`

### C. 需要单独判断的 wrapper：薄归一化层

这些 wrapper 虽然也走 CLI，但带少量归一化逻辑：

- `memory`
  - 自动补 `--workspace "$PWD"`
- `todo`
  - 自动补 `--workspace "$PWD"`
- `scheduler`
  - 兼容别名、补默认 `tz`、整理参数

这类不建议第一刀全删。正确顺序是：

1. 先判断这些归一化是否应该沉回 CLI/domain
2. 若沉回后 wrapper 只剩 alias，再退役

### D. 已经不是 CLI 主入口的 skill

- `feishu-send-file`
  - 主入口已经是 `feishu_send_file`
  - `main.sh` 只是一个 `current-chat-id` 辅助脚本，不应再被归类成“msgcode file send 的 wrapper”
- `vision-index`
  - 本质是索引说明书
  - `main.sh` 只是打印文案，应进入 Phase 1 退役
- `plan-files`
- `character-identity`
  - 本来就是纯说明书 skill

## Phase Plan

### Phase 1：删掉最没有价值的壳

目标：

- `vision-index/main.sh` 退役
- `runtime/index.json` 不再把它们错误地强调成 wrapper 主入口
- 收紧仓库口径：skill 默认看 `SKILL.md`

优先清理：

- `vision-index/main.sh`
- `file/main.sh`
- `gen/main.sh`
- `media/main.sh`
- `thread/main.sh`
- `patchright-browser/main.sh`

前提：

- `SKILL.md` 里的调用示例改成直接 `msgcode ...`
- runtime index 的 `entry` 统一指向 `SKILL.md`

### Phase 2：处理薄归一化 wrapper

目标：

- 重新判断 `memory` / `todo` / `scheduler` 的归一化逻辑归属

推荐顺序：

1. 能沉到 CLI/domain 的归一化，先沉回去
2. `main.sh` 若只剩 alias，再退役

### Phase 3：CLI 去事务化（单独 issue）

这不是本轮范围，但本轮要为它铺路。

下游方向：

- 把 `src/cli/*.ts` 的业务逻辑继续下沉到共享 domain/service
- 让 CLI 真正变成薄壳
- 但不新增“内部短路匹配”层

## 具体改动范围

本轮计划涉及：

- `src/skills/runtime/*/SKILL.md`
- `src/skills/runtime/*/main.sh`
- `src/skills/runtime/index.json`
- `src/skills/README.md`
- 与 runtime skill 入口同步强绑定的测试

本轮不涉及：

- `src/cli/*.ts` 业务内核重写
- `src/agent-backend/tool-loop.ts` 增加内部短路逻辑
- `src/tools/*` 协议改造
- 人类用户 CLI 合同删除或改名

## Risks

### 风险 1：模型失去稳定入口，调用成功率下降

应对：

- 退役 wrapper 前，先把 `SKILL.md` 调整到足够具体
- 直接给出 canonical `msgcode ...` 示例

### 风险 2：测试还在锁 `main.sh` 存在

应对：

- 同步修改 runtime skill sync / help-contract 类测试
- 验证索引与 skill 文案一致，而不是锁壳文件名

### 风险 3：过早删除 `memory/todo/scheduler` wrapper，丢掉有价值的归一化

应对：

- 这三类延后到 Phase 2
- 先判断归一化是否应该沉回 CLI/domain

### 回滚/降级

- wrapper 退役优先移动到 `.trash/`
- 若某个 skill 成功率明显下降，可单独恢复该 wrapper，不影响整体策略

## Test Plan

最小验收：

1. runtime index 的 `entry` 与 skill 真实 canonical 入口一致
2. 被退役 skill 的 `SKILL.md` 能直接指导模型执行 `msgcode ...`
3. 现有 runtime skill 文档同步测试改为锁 canonical 入口，而不是锁 `main.sh`
4. `banana-pro-image-gen`、`local-vision-lmstudio` 这类真桥接 skill 不受影响

## 评审意见

[留空,用户将给出反馈]
