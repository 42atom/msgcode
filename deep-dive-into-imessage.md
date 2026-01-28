# 深入 iMessage 底层：一个 Agent 是如何诞生的

**作者**: LingJueYa
**发布日期**: 2025年11月19日

## 前言

在 Photon AI，我们始终在思考：未来的 AI 与 Agent 应该是什么样子？难道我们会去浏览器输入一个一个网址使用 Agent，或下载 App 与所谓的 AI 男友/女友聊天吗？这听起来不仅不酷，也与我们在所有 Sci-Fi 中看到的未来完全不一样。

我们相信在未来世界里，AI 不应该以"功能"或"工具"的形态出现，而应该像一种生命，深度融入社会结构。我们的孩子看到 AI 时，不会像我们一样惊讶，更不会将其视作冷冰冰的程序。他们会像看向自己的朋友、同学那样看向 AI，是我们社会中的 First-Class Citizen。

抱着这样的愿景，我们开始思考，当下的我们应该如何做，才能让 Agent 看起来是我们生活中的一份子。有一天，我们突然灵光一现，为什么不将 Agent 带到 iMessage 中呢。在美国，几乎所有人每天都在使用 iMessage，数以百万计的消息在其中流动。它也许就是这个时代对 Agent 最自然、最原生的交互方式 —— 让 Agent 像朋友一样出现在你的对话列表里，甚至加入你的群聊。

于是，我们开始把这个设想从灵感变成现实，研发一个能让 AI 以真正"社交化方式"存在的基础设施。最终，我们构建了 imessage-kit —— 一个基于 TypeScript 的开源 iMessage 控制框架，让开发者能够以代码方式发送、接收、操控 iMessage 消息。

在构建 `imessage-kit` 的过程中，我们突破了众多技术难点，也重新想象了 AI 如何与人类沟通。

## 一、了解 iMessage 数据架构

### 1.1 数据库位置与结构

iMessage 的所有消息数据都存储在一个 SQLite 数据库中，位置就在这里：

```bash
~/Library/Messages/chat.db
```

这个数据库从 iMessage 诞生之日起就存在了。如果你是老用户，数据库文件可能已经膨胀到几百 MB，甚至超过 1GB。

**核心表结构：**

`chat.db` 包含以下关键表：

- `message` - 消息主表
- `chat` - 会话表（群聊/单聊）
- `handle` - 联系人标识表（手机号/邮箱）
- `attachment` - 附件表
- `chat_message_join` - 消息-会话关联表
- `chat_handle_join` - 会话-联系人关联表
- `message_attachment_join` - 消息-附件关联表

### 1.2 时间戳转换：Mac 纪元时间

数据库里的时间戳可不是我们常见的 Unix 时间戳。比如：

```
408978598
```

如果你直接用 `new Date(408978598)` 去转换，得到的时间肯定是错的。

**关键点：macOS 用的是自己的纪元时间（Epoch），起点是 2001-01-01，而不是 Unix 的 1970-01-01。**

正确的转换方法是这样的：

```tsx
const MAC_EPOCH = new Date('2001-01-01T00:00:00Z').getTime()
function convertMacTimestamp(timestamp: number): Date {
    // macOS 存储的是纳秒，需要除以 1000000
    return new Date(MAC_EPOCH + timestamp / 1000000)
}
```

这是 macOS 和 iOS 系统的标准时间表示方式（Core Data timestamp），习惯了就很简单。

### 1.3 消息内容的编码：NSAttributedString

iMessage 的消息文本存储在两个字段里：

- `message.text`：纯文本消息
- `message.attributedBody`：富文本消息（以二进制 plist 格式存储的 NSAttributedString）

在 `imessage-kit` 项目中，我们用了两种策略来解析 `attributedBody`：

**策略 1：直接字符串匹配（快，但有点糙）**

```tsx
const bufferStr = buffer.toString('utf8')
// 匹配可读字符（ASCII + 中文）
const readableMatches = bufferStr.match(/[\x20-\x7E\u4e00-\u9fff]{5,}/g)
```

通过正则表达式直接从二进制数据里提取可读文本，然后过滤掉 plist 关键字（比如 `NSAttributedString`、`NSDictionary` 之类）。

**策略 2：借助 plutil 工具（精准，但慢一些）**

```bash
plutil -convert xml1 -o - "temp.plist"
```

macOS 自带的 `plutil` 工具能把二进制 plist 转成 XML 格式，然后我们从 XML 里提取 `<string>` 标签的内容。

这两种方法各有千秋：

- 方法 1 速度快，但偶尔会提取到乱七八糟的字符串
- 方法 2 很准确，但需要创建临时文件，还要调用系统命令

在实际项目中，`imessage-kit` 先试方法 1，如果不行再退回到方法 2，算是一个比较好的折中方案。

## 二、突破 macOS 的安全防护

### 2.1 Full Disk Access：必需的通行证

从 macOS Mojave（10.14）开始，Apple 对隐私保护下了狠手。`~/Library/Messages` 目录被列为受保护资源，没授权的程序根本进不去。

**症状：**

```bash
$ sqlite3 ~/Library/Messages/chat.db
Error: unable to open database "chat.db": Operation not permitted
```

**解决办法：**

1. 打开 **系统设置 → 隐私与安全性 → 完全磁盘访问权限**
2. 点击 "+" 号，添加你常用的终端或 IDE（比如 Terminal、iTerm、VS Code、Cursor）
3. **重启应用**（这一步很重要，很多人忘了重启，结果权限没生效）

建议开发工具和终端都添加权限，确保在不同环境中都能正常运行。

### 2.2 SQLite WAL 模式的特殊性

iMessage 数据库用的是 SQLite 的 WAL（Write-Ahead Logging）模式，所以你会看到三个文件：

```
chat.db
chat.db-shm   # 共享内存文件
chat.db-wal   # 预写日志文件
```

**重要特性：**新消息一来，`chat.db-wal` 会立刻更新，但主数据库文件 `chat.db` 可能会拖个几秒甚至几分钟才更新（得等检查点触发）。

这对实时消息监控影响挺大。如果你直接盯着 `chat.db` 文件的变化，延迟会很明显。更好的做法是：

1. 用定时轮询（polling）数据库，而不是监听文件变化
2. **以只读模式打开数据库，让 SQLite 自己处理 WAL 文件**

```tsx
// 正确的做法
const db = new Database(path, { readonly: true })
```

### 2.3 并发访问注意事项

SQLite 支持多读，但写操作会锁住数据库。`imessage-kit` 特意以只读模式 (`readonly: true`) 打开数据库，避免冲突。

## 三、发送消息：AppleScript 的艺术与妥协

### 3.1 为什么是 AppleScript？

Apple 没有给 iMessage 提供官方 API。作为开发者，我们唯一能用的官方自动化工具就是 AppleScript—— 这门 1993 年诞生的古老脚本语言。

**一个简单的发送例子：**

```shell
tell application "Messages"
    set targetBuddy to buddy "+1234567890"
    send "Hello from automation!" to targetBuddy
end tell
```

但实际用起来，里面门道可不少。

### 3.2 字符转义问题

AppleScript 对特殊字符特别挑剔，必须老老实实转义：

```tsx
// 错误的做法
const text = 'He said "Hello"'
const script = `send "${text}" to targetBuddy`
// 会直接报语法错误！

// 正确的做法
function escapeAppleScriptString(str: string): string {
    return str
        .replace(/\\/g, '\\\\')  // 反斜杠
        .replace(/"/g, '\\"')    // 双引号
        .replace(/\n/g, '\\n')   // 换行
        .replace(/\r/g, '\\r')   // 回车
        .replace(/\t/g, '\\t')   // 制表符
}
```

### 3.3 沙盒限制的绕过方案

如果你想发送文件附件，会遇到一个更头疼的问题：macOS 的沙盒限制。

**问题：** Messages.app 运行在沙盒里，只能访问特定目录（比如 Documents、Downloads、Pictures）。如果你的文件在别的地方，发送会直接失败。

**解决办法：** 把文件临时复制到 `~/Pictures` 目录

```applescript
-- 绕过沙盒：复制到 Pictures 目录
set picturesFolder to POSIX path of (path to pictures folder)
set targetPath to picturesFolder & "imsg_temp_1234567890_file.pdf"
do shell script "cp " & quoted form of "/restricted/path/file.pdf" & " " & quoted form of targetPath

-- 发送文件
set theFile to (POSIX file targetPath) as alias
send theFile to targetBuddy

-- 延迟确保上传完成（尤其是 iMessage）
delay 3
```

而我们则在 `imessage-kit` 中专门做了个 `TempFileManager`，会自动扫描并清理 `~/Pictures` 下的 `imsg_temp_*` 文件。

### 3.4 文件发送延迟

不同大小的文件需要不同的延迟时间，确保 iMessage 能顺利上传到 iCloud：

```tsx
function calculateFileDelay(filePath: string): number {
    const sizeInMB = getFileSizeInMB(filePath)
    if (sizeInMB < 1) return 2      // < 1MB: 2 秒
    if (sizeInMB < 10) return 3     // 1-10MB: 3 秒
    return 5                         // > 10MB: 5 秒
}
```

### 3.5 群组消息的 ChatId 处理

给群聊发消息比单聊复杂得多，因为得用 `chatId`：

```applescript
tell application "Messages"
    set targetChat to chat id "chat45e2b868ce1e43da89af262922733382"
    send "Hello group!" to targetChat
end tell
```

**怎么获取 chatId？**

直接从数据库的 `chat` 表里查：

```sql
SELECT
    chat.guid AS chat_id,
    chat.display_name AS name,
    (SELECT COUNT(*) FROM chat_handle_join
     WHERE chat_id = chat.ROWID) > 1 AS is_group
FROM chat
WHERE is_group = 1
```

**ChatId 格式说明：**

- 群聊：用 GUID（比如 `chat45e2b868ce1e43da...`）
- 单聊：可能是 `iMessage;+1234567890` 或直接是 `+1234567890`
- AppleScript 格式：`iMessage;+;chat45e2b868...`（需要标准化处理）

为了方便开发者使用，我们在 `imessage-kit` 内置了智能的 chatId 标准化逻辑，能自动处理这些格式差异。

## 四、实时监控：轮询与性能优化

区别传统的 iMessage 自动化，iMessage Agent 需要我们能够及时获取 iMessage 消息，并让 Agent 进行回复。根据研究显示，500 毫秒左右的延迟就会被人类感知到，并产生不适的感觉。在实际实践过程中，我们发现了实时监控消息中的许多"坑"，最终选择了通过轮询和增量查询。

### 4.1 为什么选轮询而不是事件监听？

很多人问：为什么不用文件系统监听（比如 `fs.watch`）来检测新消息？

**原因有几点：**

1. WAL 模式导致 `chat.db` 更新有延迟
2. 文件监听会触发太多误报（数据库内部操作也会改文件）
3. 轮询结合时间戳查询更靠谱

**最佳轮询间隔：**

```tsx
// 太快：浪费 CPU
pollInterval: 500
// 太慢：延迟明显
pollInterval: 10000
// 甜点：2 秒
pollInterval: 2000  // 默认值
```

2 秒是在我们开发 `imessage-kit` 中尝试了多次，在响应速度和系统负载之间找到的平衡点。

### 4.2 增量查询与去重

每次轮询只查上次检查之后的新消息：

```tsx
// 重叠时间动态调整：取 1 秒和轮询间隔的较小值
const overlapMs = Math.min(1000, this.pollInterval)
const since = new Date(lastCheckTime.getTime() - overlapMs)
const { messages } = await db.getMessages({
    since,
    excludeOwnMessages: false  // 先获取所有消息（包括自己的）
})

// 用 Map 去重
const seenMessageIds = new Map<string, number>()
const newMessages = messages.filter(msg => !seenMessageIds.has(msg.id))
```

**为什么要重叠时间？** 防止在时间边界上丢消息（时钟精度和数据库写入顺序的问题）。

## 五、跨运行时支持：Bun vs Node.js

### 5.1 数据库驱动的选择

`imessage-kit` 有一个很巧妙的设计，能自动检测运行时环境：

```tsx
async function initDatabase() {
    if (typeof Bun !== 'undefined') {
        // Bun 运行时 - 使用内置 SQLite
        const bunSqlite = await import('bun:sqlite')
        Database = bunSqlite.Database
    } else {
        // Node.js 运行时 - 使用 better-sqlite3
        const BetterSqlite3 = await import('better-sqlite3')
        Database = BetterSqlite3.default
    }
}
```

**不同的运行时各有各的特点：**

- **Bun (bun)**：内置驱动，零依赖，启动更快，内存占用更小
- **Node.js (better-sqlite3)**：成熟稳定，社区支持好，生态完善

### 5.2 Bun 的零依赖优势

用 Bun 最大的好处就是：零外部依赖。

```json
// Node.js
"dependencies": {
    "better-sqlite3": "^11.0.0"
}

// Bun
"dependencies": {}  // 完全零依赖！
```

对于喜欢极简风格的项目，这是个不小的优势。

## 六、真实场景与应用案例

在开发完 `imessage-kit`，Photon AI 团队内部也用它做了一些小尝试，我们甚至用它接管了我们的 iMessage 账号，给投资人介绍我们的公司。在使用过程中，我们又为 `imessage-kit` 加入了许多更贴近开发者习惯的能力，例如更直观的语法与链式调用。下面是一些使用 `imessage-kit` 可以实现的功能案例。

### 6.1 自动化回复机器人

基于消息内容的智能回复（当然可以连上 Agent，实现真正的智能回复）：

```tsx
// 启动监听
await sdk.startWatching({
    onDirectMessage: async (message) => {
        await sdk.message(message)
            .ifFromOthers()
            .matchText(/紧急|urgent/i)
            .replyText('收到！我会尽快处理。')
            .execute()
    }
})
```

### 6.2 消息数据分析

用 SDK 做消息数据分析特别方便：

```tsx
const result = await sdk.getMessages({
    since: new Date('2024-01-01'),
    limit: 10000
})

// 统计最活跃的联系人
const senderCounts = new Map()
for (const msg of result.messages) {
    senderCounts.set(
        msg.sender,
        (senderCounts.get(msg.sender) || 0) + 1
    )
}

// 按发送次数排序
const sorted = Array.from(senderCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
console.log('Top 10 最活跃联系人：', sorted)
```

你还可以进一步分析消息的时间分布、群聊活跃度、附件类型统计等等。

### 6.3 Webhook 集成

把 iMessage 通知转发到其他系统（比如 Slack、Discord）：

```tsx
const sdk = new IMessageSDK({
    webhook: {
        url: '<YOUR_WEBHOOK_URL>',
    },
})
await sdk.startWatching()
```

这对团队协作或者监控重要消息特别有用。

### 6.4 发送消息追踪机制

`imessage-kit` 实现了 `OutgoingMessageManager` 来追踪发送的消息。通过启动 watcher，可以在发送后立即获取消息对象：

```tsx
// 启动 watcher
await sdk.startWatching()

// 发送消息并获取确认
const result = await sdk.send('+1234567890', 'Hello!')
if (result.message) {
    console.log('消息 ID:', result.message.id)
    console.log('发送时间:', result.message.date)
}
```

**工作原理：**

1. 发送前创建 `MessagePromise`，记录发送时间、内容、chatId
2. AppleScript 执行发送
3. Watcher 轮询检测到新消息后，通过时间戳和内容匹配
4. 匹配成功后 resolve Promise，返回完整的 Message 对象

匹配逻辑考虑了 chatId 的多种格式（`iMessage;-;recipient` vs `recipient`），自动提取核心标识符进行匹配。

### 6.5 临时文件自动清理

为了绕过沙盒限制，发送附件时会临时复制文件到 `~/Pictures`。`TempFileManager` 负责自动清理这些文件：

**工作流程：**

1. **文件命名规则**：所有临时文件以 `imsg_temp_` 为前缀
2. **启动时清理**：SDK 初始化时清理遗留的旧文件
3. **定期清理**：每 5 分钟扫描一次，删除超过 10 分钟的文件
4. **销毁时清理**：SDK 关闭时清理所有临时文件

```tsx
// TempFileManager 配置
const DEFAULT_CONFIG = {
    maxAge: 10 * 60 * 1000,           // 文件保留 10 分钟
    cleanupInterval: 5 * 60 * 1000,   // 每 5 分钟清理一次
}
```

这个机制确保了即使程序异常退出，临时文件也会在下次启动时被清理。

### 6.6 消息去重机制

Watcher 使用 `Map<string, number>` 记录已处理的消息 ID，防止重复处理：

```tsx
private seenMessageIds = new Map<string, number>()
// 每次检查时
const newMessages = messages.filter(msg => !this.seenMessageIds.has(msg.id))
// 标记为已处理
for (const msg of newMessages) {
    this.seenMessageIds.set(msg.id, Date.now())
}
// 定期清理（保留最近 1 小时的记录）
if (this.seenMessageIds.size > 10000) {
    const hourAgo = Date.now() - 3600000
    for (const [id, timestamp] of this.seenMessageIds.entries()) {
        if (timestamp < hourAgo) {
            this.seenMessageIds.delete(id)
        }
    }
}
```

**关键点：**

- 使用 Map 而非 Set，存储时间戳用于清理
- 阈值触发清理（超过 10000 条记录时）
- 只保留最近 1 小时的记录，防止内存泄漏
- 轮询时设置重叠时间（1秒）防止边界丢失

## 七、踩过的坑与解决方案

### 7.1 发送消息后立即获取的问题

**问题：** 调用 `send()` 后没法马上拿到发送的消息对象，返回值是 `undefined`。

**原因：** AppleScript 发送消息是异步的，消息写入数据库得花点时间。

**解决办法：**

```tsx
// 启动 watcher
await sdk.startWatching()

// 发送消息（watcher 会捕获并返回）
const result = await sdk.send('+1234567890', 'Hello!')
if (result.message) {
    console.log('消息 ID:', result.message.id)
}
```

`imessage-kit` 做了一个 `OutgoingMessageManager`，通过时间戳和内容匹配来关联发送的消息。

### 7.2 附件路径的 ~ 符号

数据库里存的附件路径可能带 `~`：

```
~/Library/Messages/Attachments/abc/def/IMG_1234.heic
```

**解决办法：**

```tsx
import { homedir } from 'os'

const fullPath = rawPath.startsWith('~')
    ? rawPath.replace(/^~/, homedir())
    : rawPath
```

## 八、性能优化

### 8.1 数据库查询优化

**慢查询例子：**

```sql
-- 糟糕：全表扫描
SELECT * FROM message WHERE text LIKE '%关键词%'
```

**优化后：**

```sql
-- 用索引 + 限制时间范围
SELECT * FROM message
WHERE date >= ? AND text LIKE '%关键词%'
ORDER BY date DESC
LIMIT 100
```

### 8.2 并发发送控制

同时发多条消息时，用信号量（Semaphore）限制并发：

```tsx
class Semaphore {
    private running = 0
    private waiting: Array<() => void> = []
    constructor(private readonly limit: number) {}
    async acquire(): Promise<() => void> {
        while (this.running >= this.limit) {
            await new Promise<void>(resolve => this.waiting.push(resolve))
        }
        this.running++
        // 返回 release 函数
        return () => {
            this.running--
            const next = this.waiting.shift()
            if (next) next()
        }
    }
    async run<T>(fn: () => Promise<T>): Promise<T> {
        const release = await this.acquire()
        try {
            return await fn()
        } finally {
            release()
        }
    }
}
// 使用方式
const sem = new Semaphore(5)
// 最多 5 个并发
await sem.run(() => sendMessage(...))
```

在 `imessage-kit` 中，我们已经为开发者提供了默认的并发限制支持，默认并发上限是 5，防止一次发太多消息把 Messages.app 搞挂。

### 8.3 长时运行的内存管理

对于需要长时间运行的监听服务，`imessage-kit` 在 watcher 里用 Map 记录处理过的消息 ID。项目中实现了自动清理机制：

```tsx
// 当 Map 大小超过阈值时触发清理
if (this.seenMessageIds.size > 10000) {
    const hourAgo = Date.now() - 3600000  // 1 小时前
    for (const [id, timestamp] of this.seenMessageIds.entries()) {
        if (timestamp < hourAgo) {
            this.seenMessageIds.delete(id)
        }
    }
}
```

这个策略在消息量大时能有效控制内存占用，只保留最近 1 小时的消息记录，帮助开发者减轻需要自己控制内存的负担。

## 九、当前方案的限制与解决方案

### 9.1 已知限制

`imessage-kit` 基于 AppleScript 与本地数据库读取实现，作为一个开源 SDK，它已经能完成大部分核心操作。但由于苹果未开放相关 API，它在系统级能力上仍存在一些无法突破的限制，例如：

1. **消息编辑** - 无法编辑已发送的消息
2. **消息撤回** - 无法在 2 分钟内撤回消息
3. **Tapback 反应** - 只能读取反应，无法发送（爱心、点赞、哈哈等）
4. **打字指示器** - 无法发送/接收实时打字状态
5. **消息特效** - 无法发送带特效的消息（烟花、五彩纸屑、气球等）
6. **已读回执** - 无法标记消息为已读/未读
7. **贴纸发送** - 无法发送 iMessage 贴纸
8. **语音消息** - 无法发送带波形显示的语音消息
9. **FaceTime 集成** - 无法创建 FaceTime 链接或监听通话状态

除此之外，AppleScript 天生存在稳定性不足、并发能力弱的问题；并且整个系统依赖用户的 iCloud 账号，也需要部署在一台固定的 Mac 上，限制了扩展性。

### 9.2 Advanced iMessage Kit：突破系统限制的下一代基础设施

在对上述问题进行深入研究后，我们打造了 **Advanced iMessage Kit**。它通过一套全新的技术架构绕过了 AppleScript 的局限，真正实现了几乎所有 iMessage 能力，并通过构建一整套全新的基础设施来承载底层服务，实现更高的并发，以及更稳定的服务。

换而言之，我们给 Agent 配了一台手机。我们开源了 Advanced iMessage Kit 的部分代码，并欢迎更多人将 Agent 带入 iMessage 中。

## 结语

iMessage 自动化是个充满挑战但又特别有意思的技术领域。从底层数据库结构到 AppleScript 脚本编写，从系统权限控制到性能优化，每一个环节都需要深入了解 macOS 的运行机制。

为了让更多开发者能够轻松探索这个领域，我们将上述能力全部封装成了一个开源、免费的 TypeScript SDK。它将复杂的 iMessage 操作简化成易理解、易集成的 API，帮助你在几分钟内完成过去需要数天才能实现的任务。

对于需要更强能力、但又不希望自购 Mac 进行自托管的开发者，我们也提供了更完善的 Advanced iMessage Kit。它不仅解锁了更多系统级功能，也显著降低了部署与配置的复杂度。

我们也在持续探索 AI Agent 交互的更多可能性，包括让 Agent 在 iMessage 中有更流畅，更舒服的体验，主动发送消息，知道什么时候停止，也不会一发就发一长段回复。我们也在内部尝试一些更大胆、更有趣的方向，在成熟后会继续与社区分享。

如果你发现了 imessage-kit 中的任何问题，欢迎在 Github 上面提交 Issue 或者 PR。如果这个项目对你有所帮助，一颗 Star 就足以支持我们继续把这件事做得更好。

---

**About Author**

LingJueYa：Photon AI 工程师，主打全干的INTJ，热爱探索代码、记录生活、打磨产品，做永远的终身学习者。
