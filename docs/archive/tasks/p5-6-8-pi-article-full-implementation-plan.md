# P5.6.8：Pi 文章能力对齐完整开发计划（总控版）

## 1. 任务定位

目标：把当前 direct 管道收敛到 Pi 核心范式，确保语义清晰且可验证：

- `pi off`：普通 direct 聊天 + 记忆注入（不暴露 Pi 四工具）
- `pi on`：Pi 核心循环（while tool loop）+ 四基础工具（`read_file/write_file/edit_file/bash`）
- `tmux`：忠实转发，不注入 SOUL/记忆/私有编排

本计划是 P5.6.8 全量总控，覆盖 R3/R4/R5/R6 的执行顺序、验收门、风险控制与回滚策略。

---

## 2. 冻结决策（已确认）

1. 工具命名采用 Pi 风格：`read_file/write_file/edit_file/bash`
2. `edit_file` 先走最小可用补丁语义（`oldText/newText`），不引入 diff 库
3. `run_skill` 不做过渡：R3 直接删除
4. direct/tmux 双管道边界固定，不允许语义串线
5. 测试期默认保持 `pi.enabled=true`、`tooling.mode=autonomous`

---

## 3. Pi 要点到当前系统的落地矩阵

| Pi 要点 | 当前状态 | 目标状态 | 对应阶段 |
|---|---|---|---|
| while 循环 + 多轮 tool calls | 单次两段式为主 | 多轮 while + budget 守卫 | R3 |
| 四基础工具 | 仍有旧工具命名与混合工具面 | 仅四工具暴露（pi on） | R3 |
| Bash 即技能执行底座 | 仍存在 `run_skill` 专用链 | 技能索引提示 + bash/read 自主执行 | R5 |
| steer/followUp 实时干预 | 有入队，主链消费弱 | loop 内消费，语义可测 | R3/R6 |
| 结构化上下文压缩 | window/summary 有基础 | 与 Pi loop 一致接线 + 阈值策略 | R4/R6 |
| 记忆系统 | listener 注入可用，但主链观测分散 | direct 主链稳定注入 + 可观测 | R4 |
| SOUL | 目前仍有占位实现 | workspace/global 真读取 + /reload 真回执 | R4 |

---

## 4. 执行顺序（唯一时间线）

## R3：Pi Core Switch（执行内核切换，一步到位）

### R3a 执行链单一化

目标：工具执行单一真相源（Tool Bus）。

实施：
- `src/lmstudio.ts` 只做协议适配/loop 编排/输出清洗
- 移除 `lmstudio.ts` 内置工具执行分叉，统一调用 `src/tools/bus.ts`

验收：
- `rg "async function runTool\(" src/lmstudio.ts` 无命中
- `npx tsc --noEmit` ✅
- `npm test` 0 fail ✅
- `npm run docs:check` ✅

### R3b PI on/off 语义硬分叉

目标：同一代码面支持 `pi off` 与 `pi on` 的可预测行为。

实施：
- `handlers` 在 direct 路径按 `pi.enabled` 分叉
- `pi off`：不向 LLM 暴露 tools
- `pi on`：仅暴露四工具

验收：
- `pi off` 请求 payload `tools=[]`
- `pi on` 请求 payload 仅四工具
- 回归测试覆盖 on/off 两条路径

### R3c 四工具落地

目标：工具面与 Pi 文档完全一致。

实施：
- 新增/收敛 `read_file/write_file/edit_file/bash`
- `edit_file`：`[{oldText,newText}]` 顺序替换，失败返回明确错误

验收：
- 工具 schema 冻结
- `edit_file` 成功/找不到/多处命中策略均有测试

### R3d 干预队列接线

目标：`/steer`、`/next` 在 Pi loop 真正生效。

实施：
- loop 每次工具执行后消费 steer（可跳过剩余工具）
- 回合结束后消费 followUp（进入下一轮）

验收：
- `/steer` 可中断后续工具调用
- `/next` 在本轮完成后生效

### R3e 遗留硬切

目标：不留兼容壳，直接与历史路径切割。

实施：
- 删除 `run_skill` 与 `/skill run` 全链路
- 删除旧工具暴露名 `list_directory/read_text_file/append_text_file`
- 新增禁回流静态锁（主链文件）

验收：
- 主链代码无 `run_skill`、`/skill run`、旧三工具名
- 三门 gate 全绿

---

## R4：SOUL + Memory 主链闭环

### R4a SOUL 真读取

目标：消除 SOUL 占位实现，恢复真实路径优先级。

实施：
- 读取优先级：`<workspace>/.msgcode/SOUL.md` > `~/.config/msgcode/souls/*`
- `/reload` 输出真实来源与条目数

验收：
- 替换占位逻辑（不再固定返回 default）
- `/reload` 在三工作区输出正确路径

### R4b 短期记忆接线

目标：window/summary 在 direct Pi 路径有效。

实施：
- `loadWindow` + summary 注入进入 loop 上下文
- `/clear` 只清 `window+summary`，不清 `memory`

验收：
- 对话跨轮能保持短期上下文
- `/clear` 后 memory 仍可检索

### R4c 长期记忆注入稳态化

目标：记忆注入策略可控且可观测。

实施：
- 保持 listener 注入链路
- 统一日志字段（注入命中、注入长度、来源路径）

验收：
- 关键词命中、force、空命中三类测试通过
- 日志字段完整

### R4d 三工作区冒烟

目标：在真实工作区验证 SOUL + 记忆 + Pi on/off。

范围：
- `/Users/admin/msgcode-workspaces/medicpass`
- `/Users/admin/msgcode-workspaces/charai`
- `/Users/admin/msgcode-workspaces/game01`

验收：
- `/reload` 正确
- 自然语言触发 skill 时走 `bash/read_file` 路径
- `pi on/off` 行为符合定义

---

## R5：Skill 资产化收口（Pi 范式）

目标：在 `R3e` 已完成硬切基础上，把能力完全收敛为 skill 文件资产。

实施：
- 保留 skill 索引提示（告诉模型去哪里找 `SKILL.md`）
- 能力脚本统一由 skill 文件声明与管理
- 主链保持“仅四工具 + 模型自主编排”

验收：
- skill 触发来自 `bash/read_file` 自主编排
- 不出现专用 skill 执行入口回流

### R5a Artifact 回传桥接（发送保持内核能力）

目标：模型产出文件后，可通过运行时稳定回传给用户；发送动作不进入 skill。

实施：
- 统一 artifact 输出契约（工具执行可提取目标文件路径）
- 新增 artifact->send 桥接逻辑（命中“发给我/发送给我”语义时转 `result.file.path`）
- 发送仍只在 `listener/imsgClient.send` 执行

验收：
- `pi on` 下“发送文件给我”可回传附件
- 代码面无 skill 直接发送 API

---

## R6：回归锁与发布门

目标：防回流、防漂移。

实施：
- 静态锁：禁止主链重新引入旧命名工具和 `run_skill` 专用执行链
- 行为锁：`pi off` 不暴露 tools；`pi on` 只四工具；tmux 不注入私有语义
- 文档锁：README 与 `/help` 口径一致

最终门禁：
- `npx tsc --noEmit` ✅
- `npm test` 0 fail ✅
- `npm run docs:check` ✅
- 三工作区冒烟清单 ✅

---

## 5. 非范围（本计划不做）

- 不改 tmux 忠实转发实现
- 不新增命令面（只收敛语义）
- 不引入 diff 第三方库（后续再评估）

---

## 6. 风险与回滚

主要风险：
1. `lmstudio.ts` 与 Tool Bus 双链收敛时行为漂移
2. `pi on/off` 分叉导致历史测试断言失效
3. SOUL 路径切换引发旧 workspace 兼容问题

控制策略：
- 小步提交（每子阶段独立 commit）
- 每阶段都跑三门 gate
- 先加回归锁再改行为

回滚策略：
- 阶段性 tag：`p5-6-8-r3-checkpoint`、`p5-6-8-r4-checkpoint`
- 出现漂移时回滚到最近 checkpoint，再最小修复重试

---

## 7. 交付物清单

- 任务文档：本文件（总控）
- 各阶段子任务单：`docs/tasks/p5-6-8-r3*.md`、`p5-6-8-r4*.md`、`p5-6-8-r5*.md`
- 回归测试：按阶段新增静态锁 + 行为锁
- 冒烟清单：三工作区运行时验证记录
