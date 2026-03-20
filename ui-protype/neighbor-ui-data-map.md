# 邻居页面数据对应

对应计划：

- [/Users/admin/GitProjects/msgcode/docs/plan/pl0291.pss.agent.neighbor-coworker-optional-module.md](/Users/admin/GitProjects/msgcode/docs/plan/pl0291.pss.agent.neighbor-coworker-optional-module.md)

## 页面块与数据来源

### 左侧：模块开关

- UI：邻居模块开关
- 计划对应：第一阶段骨架 / 节点侧 / 邻居模块开关
- 数据来源建议：
  - `workspace/.msgcode/neighbor/config.json`
  - 字段：`enabled`

### 左侧：当前节点

- UI：`sam@acme-ops`
- 计划对应：第一阶段骨架 / 节点侧 / 身份声明
- 数据来源建议：
  - 全局默认对外身份
  - 不从工作区人物表取
  - 建议字段：
    - `nodeId`
    - `publicIdentity`

### 左侧：局域网可见 / 最近探测 / 未读

- UI：节点头部状态摘要
- 计划对应：
  - 第一阶段目标 / 最近可达性探针（health）
  - 第一阶段消息 / 异步邮箱
- 数据来源建议：
  - `summary`：
    - `unreadCount`
    - `lastMessageAt`
    - `lastProbeAt`
    - `reachableCount`

注意：

- 这里不能写“最近活跃”
- 只能写“最近探测”或“最近握手”

### 左侧：已发现节点列表

- UI：节点卡片列表
- 计划对应：发现与联系人
- 数据来源建议：
  - `neighbors.json`
  - 每项最小字段：
    - `nodeId`
    - `displayName`
    - `state` (`discovered|known|contact`)
    - `lastMessageAt`
    - `lastProbeAt`
    - `lastProbeOk`
    - `latencyMs`

注意：

- 第一阶段只需要节点级数据
- 不需要“一个节点住几个人”的内部角色视角

### 右侧：聊天记录 / 审计日志

- UI：从“我”的视角看的紧凑记录流
- 计划对应：
  - 第一阶段：邮箱级消息
  - 第二阶段：聊天记录式查看

第一阶段可用收法：

- 先把它当成“异步邮箱记录流”
- 消息类型只允许：
  - `hello`
  - `handshake`
  - `message`
  - `delivery`

- 每条最小字段：
  - `at`
  - `nodeId`
  - `direction`
  - `type`
  - `summary`
  - `unread`

第二阶段才长成：

- 线程
- artifact 引用
- patch/review/handoff

注意：

- 第一阶段 UI 可以长得像聊天记录
- 但底层不要先要求线程系统

### 右侧：artifact 标签

- UI：`summary.md`、`refund-spike.png`
- 计划对应：第二阶段 / 结果交换 / artifact
- 结论：
  - 现在可以保留原型表达
  - 真实现时应放到第二阶段
  - 第一阶段若要保留，只能把它当消息附件引用，不要做 thread owner 语义

## 当前原型需要遵守的边界

1. 不显示“最近活跃”
2. 只显示“最近探测 / 最近握手 / 最近通讯”
3. 只做节点级联系人，不做节点内多角色社交
4. 右侧记录流第一阶段按邮箱记录理解，不按完整线程系统理解
5. `health` 只代表可达性，不代表业务忙闲

## 最小落地真相源建议

第一阶段只需要三份：

1. `neighbor/config.json`
- `enabled`
- `public_identity`

2. `neighbor/neighbors.json`
- 发现到的节点和联系人三态

3. `neighbor/mailbox.jsonl`
- 邮箱级消息记录

这样邻居页面的大部分数据都能落住，不需要先上线程系统。
