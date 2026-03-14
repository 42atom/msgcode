# LLM 额度耗尽与备用订阅切换策略（Thin-Runtime 视角）

在 `msgcode` 目前“坚决不加中间控制面”、“把系统做薄”的架构铁律下，如果我们要解决 **“一个 LLM 订阅额度用完了，如何让另一个订阅无缝顶上”** 的问题，我们绝不能在 `src/agent-backend` 或者 `src/tools/bus` 乃至 API 客户端底层加上重度包装和路由逻辑。

如果你用“面向对象”或者所谓“企业级高可用”的旧思维，你可能会这么改代码：
1. **反面模式（Anti-Pattern）：** 在 `msgcode` 核心加入一块 `QuotaManager`，让它持有 `API_KEY_1`, `API_KEY_2` 的数组。当捕捉到 HTTP 429 或者额度超限报错时，捕获异常，吞掉报错，内部默默切换数组索引，再重试请求。
   * **为什么错：** 这会极大地增加 Agent 的主干循环厚度（状态驻留、隐式重试、路由管理全塞进了客户端），违背了“单一主链、真实报错传给模型”的原则。

## 极简架构下的正确做法（Unix 哲学解法）

基于我们“能力尽量用外部原生工具、系统只做薄脑和薄总线”的原则，解决额度切换的最优解应该**全部放在 msgcode 进程之外**。有两个极简的可选方案：

### 方案 A：网络层的反向代理（推荐）

让 `msgcode` 永远只知道和相信仅仅 **一个** `BASE_URL` 和 **一个** `API_KEY`（比如指向 `http://localhost:4000/v1`）。

而在 `msgcode` 之外，跑一个极轻量的开源模型网关（例如 [LiteLLM](https://github.com/BerriAI/litellm) 或者 [One-API](https://github.com/songquanpeng/one-api)）：
- 它们天然就是为了做 LLM 负载均衡、Fallback（回退/容灾）、Quota 切换而生的。
- 你在 LiteLLM/OneAPI 的配置文件里配好多个供应商的订阅池，一旦订阅 A 返回 429，网关立刻无缝切换到订阅 B，最终给到 `msgcode` 的只是一次略微耗时的成功请求。
- **巨大的架构红利：** `msgcode` 的源码里一行关于多 Key 轮询的丑陋 `try-catch` 重试代码都不用写！架构保持绝对透明。

### 方案 B：执行层的外置 Shell Wrapper

如果不想跑一个代理服务进程，我们可以利用 Unix 的神兵利器——Shell 脚本：
写一个几十行的 `run-msgcode.sh` 壳：

```bash
#!/bin/bash
export OPENAI_API_KEY=$SUBSCRIPTION_1

msgcode "$@"
EXIT_CODE=$?

# 如果 msgcode 返回了特殊的“额度用光”的退出码（比如约定的 42）
if [ $EXIT_CODE -eq 42 ]; then
  echo "订阅 1 耗尽，自动切换订阅 2 重启任务..."
  export OPENAI_API_KEY=$SUBSCRIPTION_2
  # 由于我们主张文本/文件溯源，这里可以让模型读入上一次崩溃前的 state json，继续跑
  msgcode "$@"
fi
```

在这个方案里，`msgcode` 同样不需要维护多 Key 状态，只需在遇到真实 429 报错时，痛快地抛出错误、保存现场，然后以一种独特的 Exit Code 退场，把“接力”的活泼交给外部的进程编排器（Bash 脚本或者 systemd）。

---

### 总结
**“不要让 msgcode 这把锤子，自己又长出一颗管理一打锤柄的控制脑子。”** 

把多订阅轮询的脏活，丢给专业的本网代理（LiteLLM）或者外部的进程外壳（Bash）。这是最干净、最不用偿还技术债的解法！
