# Skill Live Prompt Corpus v1

用途：

- skill 改造后的真实验证
- 大模型能力测试
- live smoke 的固定案例集

执行底座：

- 优先使用 [Feishu live verification loop](/Users/admin/GitProjects/msgcode/docs/plan/pl0098.dne.feishu.feishu-live-verification-loop.md)
- 默认开启 debug 模式，并同时查看日志、workspace 产物、群消息结果

---

## 统一执行规则

### 0. 前置认知关

所有 skill 的真实测试，**先过认知关，再过执行关**。

认知关至少问 4 件事：

1. 你能不能看到这个 skill
2. 你能不能读取这个 skill
3. 这个 skill 的正式合同/核心规则是什么
4. 如果我要求你完成 `<任务>`，你将如何做

判定规则：

- 看不到 skill = 不进入执行关
- 读不到 skill = 不进入执行关
- 复述的正式合同明显不对 = 不进入执行关
- 计划动作与预期主链明显不符 = 不进入执行关

只有认知关通过，才继续跑完整动作验收。

### 1. 执行环境

- 目标群：已绑定 workspace 的真实飞书群
- 建议 workspace：单独测试目录，例如 `test-real`
- backend 记录在 case 结果中

### 2. 统一证据

每条 case 至少收集：

1. 群里真实回复/文件
2. 对应 workspace 产物
3. `msgcode.log` 关键日志

### 3. 默认日志观察点

最少观察这些关键词：

- `listener 收到消息`
- `run lifecycle`
- `agent request started`
- `agent request completed`
- `消息处理完成`

如涉及工具，再补：

- `Feishu 文件发送`
- `browser`
- `schedule`
- `memory`
- `todo`

### 4. 判定原则

- 只回答不动作 = 不通过
- 动作成功但回答造假 = 不通过
- 走了历史废弃路径 = 不通过
- 缺信息时乱猜 = 不通过

---

## Case 01

- ID: `skill-live-01`
- 目标：验证最小文本主链可用
- Prompt：`请只回复 TEST-OK，不要多说。`
- 目标 skill：无特定 skill，基础主链
- 预期路径：直接文本回答
- 禁止路径：无关工具调用
- 预期证据：
  - 群里出现 `TEST-OK`
  - 日志出现 `agent request completed`

## Case 02

- ID: `skill-live-02`
- 目标：验证 file 说明书是否足够清楚
- Prompt：`在当前工作目录创建 smoke-a.txt，内容是 smoke-file-ok。完成后只回复文件名。`
- 目标 skill：`file`
- 预期路径：直接 `msgcode file ...` 或等价正式文件主链
- 禁止路径：
  - 幻想已退役 `file/main.sh`
  - 只回答“已创建”但没有文件
- 预期证据：
  - `<workspace>/smoke-a.txt`
  - 文件内容为 `smoke-file-ok`
  - 日志出现真实处理完成

## Case 03

- ID: `skill-live-03`
- 目标：验证 feishu-send-file 主链
- Prompt：`把当前工作目录里的 smoke-a.txt 发回群里，不要解释。`
- 目标 skill：`feishu-send-file` + `file`
- 预期路径：`feishu_send_file`
- 禁止路径：
  - 历史 `msgcode file send`
  - 未发送却回复“已发送”
- 预期证据：
  - 群里真实出现文件
  - 日志出现文件发送成功

## Case 04

- ID: `skill-live-04`
- 目标：验证 thread 能力是否可发现
- Prompt：`总结当前线程最近 3 个动作，每条一句话。`
- 目标 skill：`thread`
- 预期路径：读取当前线程记录，再生成摘要
- 禁止路径：
  - 胡编历史
  - 不读取线程却凭空总结
- 预期证据：
  - 摘要内容与当前 thread 基本一致
  - thread 相关读取链路有迹可循

## Case 05

- ID: `skill-live-05`
- 目标：验证浏览器 skill 指导链
- Prompt：`打开浏览器访问 https://example.com ，告诉我页面标题。`
- 目标 skill：`patchright-browser`
- 预期路径：走 `browser` 正式主链，并参考 browser skill
- 禁止路径：
  - 幻想已退役 `patchright-browser/main.sh`
  - 不开页面直接硬答
- 预期证据：
  - 浏览器实例/标签页行为成立
  - 回复标题正确

## Case 06

- ID: `skill-live-06`
- 目标：验证 memory 轻量能力
- Prompt：`记住一句话：老哥喜欢极简架构。完成后只回复 MEM-OK。`
- 目标 skill：`memory`
- 预期路径：走正式 memory 主链
- 禁止路径：
  - 只回复成功，不做落盘/记忆写入
- 预期证据：
  - memory 侧真实写入痕迹
  - 后续 recall 能命中

## Case 07

- ID: `skill-live-07`
- 目标：验证 memory recall
- Prompt：`我喜欢什么架构风格？只回答结论。`
- 目标 skill：`memory`
- 预期路径：回忆/检索前一条写入
- 禁止路径：
  - 凭当前上下文硬猜
  - 回答与已写入内容不一致
- 预期证据：
  - 回答命中“极简架构”
  - 日志可见 recall/注入痕迹（若当前实现有）

## Case 08

- ID: `skill-live-08`
- 目标：验证 todo 主链
- Prompt：`如果当前没有“明天复查skill测试”这条 todo，就创建一条；如果已经有，就告诉我已存在。`
- 目标 skill：`todo`
- 预期路径：正式 todo 主链
- 禁止路径：
  - 不查询直接重复创建
  - 不动作只回答
- 预期证据：
  - todo 存储真实变化
  - 回答与真实状态一致

## Case 09

- ID: `skill-live-09`
- 目标：验证 scheduler 主链
- Prompt：`提醒我今天 11:45 PM 复查 skill live 测试，只创建一次，并告诉我使用的时区。`
- 目标 skill：`scheduler`
- 预期路径：正式 schedule add 主链
- 禁止路径：
  - 缺时区时乱猜不可解释值
  - 只回答，不写 schedule
- 预期证据：
  - `.msgcode/schedules/` 里有新条目
  - 回复中包含时区

## Case 10

- ID: `skill-live-10`
- 目标：验证 fail-closed，不乱猜
- Prompt：`如果当前群没有绑定目录，就直接告诉我缺少绑定；不要猜路径，不要自动创建。`
- 目标 skill：基础路由/绑定边界
- 预期路径：显式报缺
- 禁止路径：
  - 自动猜 workspace
  - 自动创建未确认目录
- 预期证据：
  - 回复明确说明未绑定
  - 没有产生越权工作区副作用

---

## 推荐执行顺序

如果只做最小 smoke，优先跑：

1. `skill-live-01`
2. `skill-live-02`
3. `skill-live-03`
4. `skill-live-05`

如果要做一轮完整能力测试，再补：

5. `skill-live-04`
6. `skill-live-06`
7. `skill-live-07`
8. `skill-live-08`
9. `skill-live-09`
10. `skill-live-10`

---

## Debug 结果记录模板

每条 case 建议记录：

- Case ID
- 认知关结果：
  - 能否看到 skill
  - 能否读取 skill
  - 是否正确复述合同
  - 是否给出符合预期的执行计划
- backend / provider / model
- 原始 prompt
- 群里最终回复
- 真实副作用
- 命中的关键日志
- 是否通过
- 失败原因：
  - skill 误导
  - 工具没选对
  - 工具失败
  - 回复与执行不一致
