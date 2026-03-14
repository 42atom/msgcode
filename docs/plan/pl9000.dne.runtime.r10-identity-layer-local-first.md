# Plan: 统一 Secret 配置文件（薄版）

> 原 `identity layer` 方案在语义和结构上都有做厚风险。
> 本文档将其重定义为：**一个本地 secret 配置文件 + 一个薄运行时注入器 + 一组脱敏规则**。
> 目标不是做身份平台，而是让 GUI 和运行时都能稳定使用同一份 secret 真相源。

Issue: [待创建]  
Task: [待创建]

## Problem

当前项目里的 secret 使用方式存在三个直接问题：

1. 凭据来源分散
   - `.env`
   - shell 环境变量
   - 各 provider / tool 自己读自己的 key

2. GUI 没有稳定的单一落点
   - 如果以后要做 GUI 配置页，`.env` 更适合人工编辑，不适合结构化读写
   - 多处来源并存时，GUI 很难解释“当前到底哪份生效”

3. 泄露面不收口
   - 业务代码直接读环境变量时，日志/报错/调试输出更容易把密钥带出去

真正的问题不是“缺身份平台”，而是**缺一个统一 secret 真相源**。

## Occam Check

1. 不加它，系统具体坏在哪？
   - GUI 没有统一 secret 编辑入口。
   - 运行时继续依赖散落的 `.env` / shell env / provider 私有读取。
   - secret 来源不透明，排障和迁移都费劲。

2. 用更少的层能不能解决？
   - 能。
   - 只要一份 `secrets.json` + 一个统一 loader + 运行时按需转成 env，就够了。
   - 不需要 `secret://` 协议，不需要 keychain/gateway 双模式，不需要权限平台。

3. 这个改动让主链数量变多了还是变少了？
   - 变少了。
   - secret 来源从“多处散读”收口成“一处配置 + 一处注入”。

## Decision

采用 **本地单文件 secret 配置源** 方案：

1. 正式真相源固定为：
   - `~/.config/msgcode/secrets.json`

2. 文件格式固定为 JSON，而不是 `.env`
   - 便于 GUI 做结构化读写
   - 便于后续加元信息（如描述、启用状态）而不破坏格式

3. 运行时统一通过一个薄 loader 读取 secrets
   - provider / tool / 子进程不再各自散读 `.env`
   - 真正执行时，再按需要映射成对应 env

4. 默认只做最小脱敏
   - 日志不打印明文 secret
   - 报错不回显完整 key

5. 明确不做
   - 不做 `secret://<KEY>` 引用协议
   - 不做 keychain / managed-gateway 双模式
   - 不做“工具 -> 凭据”策略平台
   - 不做新的身份控制层

## 最小合同

### 文件路径

- `~/.config/msgcode/secrets.json`

### 文件示例

```json
{
  "OPENAI_API_KEY": "...",
  "MINIMAX_API_KEY": "...",
  "FEISHU_APP_ID": "...",
  "FEISHU_APP_SECRET": "..."
}
```

### 运行时规则

1. `secrets.json` 是正式真相源
2. 迁移期允许旧 env fallback
3. 一旦 `secrets.json` 中存在同名项，以文件值为准
4. provider / tool 侧尽量不直接读散落 env

## Plan

1. 冻结合同
   - 固定 `~/.config/msgcode/secrets.json`
   - 固定 JSON 顶层 `Record<string, string>`
   - 固定迁移期优先级：`secrets.json > 旧 env fallback`

2. 新增薄 loader
   - 建议文件：
     - `src/config/secrets.ts`
   - 责任只包括：
     - 读取 JSON
     - 读取旧 env fallback
     - 返回脱敏安全的查询结果

3. 收运行时注入口
   - provider / tool / 子进程统一改走该 loader
   - 只在真正执行前，把所需字段注入子进程 env

4. 增加最小写入口
   - 优先服务 GUI
   - CLI 如要补，也只做薄命令：
     - `msgcode secrets show`
     - `msgcode secrets set <KEY> <VALUE>`
     - `msgcode secrets remove <KEY>`
   - 本轮不做复杂 secret 管理平台

5. 收脱敏规则
   - logger / error formatter 中屏蔽常见 key 值
   - 禁止在错误消息里直接拼 secret 明文

6. 迁移收尾
   - 保留旧 env fallback 一段时间
   - 待 GUI 和运行时稳定后，再逐步减少散读 env

## Risks

1. `secrets.json` 是明文文件
   - 风险：本地文件泄露
   - 缓解：权限收口到用户目录；默认 `600`；禁止进仓库；日志不回显内容

2. 迁移期双读取会有歧义
   - 风险：用户不知道当前是哪一份生效
   - 缓解：明确优先级固定为 `secrets.json > env fallback`

3. provider 私有读取残留
   - 风险：表面单一真相源，实际还有旁路
   - 缓解：逐步把入口收口到统一 loader，并加源码扫描/回归锁

## Migration / Rollout

1. 先落 `secrets.json` 合同和 loader
2. 再把主路径 provider / tool 改为统一读取
3. GUI 只读写 `secrets.json`
4. 最后再决定是否保留旧 env fallback

## Test Plan

1. loader 测试
   - 有 `secrets.json` 时优先读文件
   - 无文件时兼容旧 env
   - 文件和 env 同名时文件优先

2. 注入测试
   - 子进程能拿到映射后的 env
   - 未声明的 secret 不应被额外注入

3. 脱敏测试
   - 日志不包含原始 key 值
   - 报错不包含原始 key 值

## Observability

最小观测即可：

- `secretSource=file|env-fallback`
- `secretKey=<KEY_NAME>`
- `resolved=true|false`

禁止记录：

- secret 明文
- 完整 token
- 可逆还原的长片段

（章节级）评审意见：[留空,用户将给出反馈]
