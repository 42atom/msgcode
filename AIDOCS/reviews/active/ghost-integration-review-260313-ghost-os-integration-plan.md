# [260313-ghost-os-integration-plan.md](file:///Users/admin/GitProjects/msgcode/AIDOCS/reports/260313-ghost-os-integration-plan.md) 审阅意见

这份《ghost-os 接入方案》方向极佳，它敏锐地察觉到了 **“不要把外部 Provider 嵌进 Core 当亲儿子养”** 这一核心痛点（阶段 0 和重点 4 非常棒）。把原生 `msgcode-desktopctl` 退役，转而用薄通讯层（MCP stido）对接 `ghost-os`，这绝对是符合 Unix 哲学和“系统做薄”大方向的。

**但是，在具体落地的“阶段 3：做 contract adapter”和“阶段 6：暴露给 Agent”中，它依然残留了我们刚才挥刀斩断的“过度兼容病”。**

## 核心病灶剖析：为什么我反对做 “Contract Adapter”？

方案推荐：上层 LLM 依然调用旧的 `desktop.find`，底层由 Adapter 秘密翻译成 `ghost_find`（MCP 工具）。
理由是：“Agent 侧工具集合会剧烈变化”、“现有测试会失效”。

**请用奥卡姆剃刀（Occam's Razor）严酷地逼问自己：这种为了“假意稳定”而增加的翻译层，真的是系统需要的吗？**

1. **欺骗 AI（违背第一性原理）：**  
   我们刚刚在 [AGENTS.md](file:///Users/admin/GitProjects/msgcode/AGENTS.md) 里定下了铁律：“优先提供真实错误、真实能力”。既然底层即将是 `ghost-os` 的 MCP Server 暴露出的 `ghost_click`，凭什么还要在系统大巴（Tool Bus）里造一个叫 `desktop.click` 的假面具罩住它？AI 是最不怕“工具集合剧烈变化”的，只要在 [SKILL.md](file:///Users/admin/GitProjects/msgcode/src/skills/runtime/file/SKILL.md) 里写明白今天改用 `ghost_click`，它瞬间就能学会！用适配器去照顾所谓“遗留肌肉记忆”，是人类旧时代封装 API 的恶习，不适用于大模型执行体。

2. **多此一举的双重维护成本：**  
   如果做 Adapter 映射，每当以后 `ghost-os` 加了一个牛逼功能（比如 `ghost_drag_and_drop` 或者基于视觉的 `ghost_annotate`），难道我们还要先在 `msgcode` 合同里小心翼翼地发明一个 `desktop.drag`、并在 [bus.ts](file:///Users/admin/GitProjects/msgcode/src/tools/bus.ts) 写映射逻辑，然后才敢放行给 AI 吗？**这依然是变相的“中层审批与拦截”！**

3. **掩护了废材测试（因小失大）：**  
   所谓“现有 `desktop` 合同、测试会整体失效”，对不起，如果旧的实现要被扔进垃圾桶，那些专门锁住旧行为逻辑、甚至假定了某条缝隙必定存在（stub）的“遗产测试”，**本来就该爽快地被一锅端掉、重新写一套针对 `ghost-os MCP` 集成的真实链路测试。** 留着兼容层去保全一堆即将过期的测例，纯属本末倒置。

## 对实施顺序（Phase 1~6）的暴走修正建议

如果您认同“做薄就要做到底”，我建议把方案里的阶段 3、4、6 爆改成这样：

*   **真正的“最底层”：** 既然 `ghost-os` 自带 MCP Server（`ghost mcp`），我们需要在 msgcode 里做的**唯一一件事**，就是引入一个健壮但极薄的 **通用 MCP Client 挂载器**。
*   **不要专设 Adapter：** 不需要 `src/runners/desktop-ghost.ts` 去逐个翻译 `click->ghost_click`。直接让 Tool Bus 把 `ghost mcp` 返还的工具列表原始透传给 LLM（暴露原生 `ghost_*`）。并修改 `desktop.provider` 开关逻辑，当开启 ghost 时，直接停用原 `desktop` contract。
*   **解决 Confirm Token 难题：** 如果确实需要在执行高危动作前让用户拦截，系统不应该只为 `desktop` 订制确认流程。可以开发一个基于 MCP 通讯链路的中继拦截（通用工具执行前审批策略），而不是把 Token 审批逻辑硬塞进特定的 `desktop` Adapter 里。

**总结：**
整体方向全对，战略视角极其清醒；但战术落脚点上，**作者依然对“删减带来的剧烈变化”抱有不必要的恐慌，导致他试图在总线里塞一个“翻译大坝”来减震。** 
对于目前的 msgcode 来说：**不要减震！用原汁原味的、带刺的、最新的能力直面大模型！**
