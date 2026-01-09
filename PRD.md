# matcode-mac 产品需求文档 (PRD)

## 一、项目背景

### 1.1 现状
原 Matcode 系统基于 Matrix 协议，需要：
- Synapse + MAS + Postgres + Caddy 服务器组件
- master bot (bot0) + 多个 worker bot 架构
- 复杂的项目管理和 worker 调度

### 1.2 目标
用 iMessage 替代 Matrix，**极简架构**：
- 单一 Bot 进程
- .env 配置即控制
- 每个群组 = 一个独立的 Claude 会话

### 1.3 核心愿景
**iMessage = 远程终端窗口**

在任何设备上通过 iMessage 与 Claude Code 对话：
- iPhone/iPad/Mac 随时访问
- 发送消息 → Claude 处理 → 回复到群
- 发送文件 → Claude 分析

### 1.4 价值
- **极简运维**：无服务器组件，.env 配置一切
- **原生体验**：iMessage 系统级应用
- **轻量高效**：单进程，本地运行
- **随时随地**：任意设备通过 iMessage 访问

---

## 二、系统架构

### 2.1 账户模型

```
┌─────────────────────────────────────────────────────────────────┐
│                        账户结构                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  账户 A (你的主账户)                                             │
│  └── iPhone/iPad/Mac 上使用，发送消息给 Bot                      │
│                                                                  │
│  账户 B (Bot 账户)                                               │
│  └── Mac 服务器上运行 matcode-mac，接收/回复消息                  │
│                                                                  │
│  账户 C (辅助账户，可选)                                         │
│  └── 仅用于建群（iMessage 建群需要 3 人），建群后可退出           │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 群组模型

```
┌─────────────────────────────────────────────────────────────────┐
│                        群组 = 项目                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  群1: "Work"              群2: "Personal"      群3: "Side"       │
│  ├── 你 (A)               ├── 你 (A)           ├── 你 (A)        │
│  └── Bot (B)              └── Bot (B)          └── Bot (B)       │
│      ↓                        ↓                    ↓             │
│  project: work            project: personal    project: side     │
│  dir: ~/work              dir: ~/personal      dir: ~/side       │
│  tmux: work_claude        tmux: personal_      tmux: side_       │
│                           claude               claude             │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 2.3 单进程架构

```
┌─────────────────────────────────────────────────────────────────┐
│                     matcode-mac (单一进程)                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  .env 配置                                                       │
│  ├── GROUP_WORK=any;+;xxx:/Users/admin/work                     │
│  ├── GROUP_PERSONAL=any;+;yyy:/Users/admin/personal             │
│  └── GROUP_SIDE=any;+;zzz:/Users/admin/side                     │
│                                                                  │
│  运行时                                                          │
│  ├── 监听所有配置的群组                                          │
│  ├── 根据 chatId 路由到对应项目目录                              │
│  ├── 每个项目独立的 tmux 会话                                    │
│  └── Claude 输出回传到对应群组                                   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 2.4 对比原 Matcode

| 原 Matcode | matcode-mac |
|:---|:---|
| bot0 (master) + worker bots | **单一 Bot 进程** |
| Matrix Room | **iMessage 群组** |
| projects.json + master.db | **.env 配置** |
| 动态添加/管理 bot | **改配置 + 重启** |
| 多进程调度 | **单进程多会话** |
| 复杂的 worker 状态 | **简化为 tmux 状态** |

---

## 三、双向通道

### 3.1 输入流（用户 → Claude）

```
1. 你在 iMessage 群组发消息
        ↓
2. matcode-mac 轮询检测新消息
        ↓
3. 根据 chatId 路由到对应项目
        ↓
4. 判断消息类型
   ├── 命令 (/start, /stop) → 执行命令
   ├── 附件 → 构造文件分析 prompt
   └── 普通消息 → 直接转发
        ↓
5. tmux send-keys 发送到 Claude
```

### 3.2 输出流（Claude → 用户）

```
1. Claude 处理完成，输出写入 JSONL
        ↓
2. matcode-mac 检测文件变化
        ↓
3. 增量读取新内容
        ↓
4. 解析 assistant 消息
        ↓
5. AppleScript 回传到对应群组
        ↓
6. 你在任意设备收到回复
```

### 3.3 附件处理

```
1. 你发送文件到群组
        ↓
2. 文件自动下载到 Mac
   ~/Library/Messages/Attachments/...
        ↓
3. matcode-mac 读取 message.attachments
        ↓
4. 构造 prompt: "请分析这个文件: {path}"
        ↓
5. 发送给 Claude
```

---

## 四、配置即控制

### 4.1 .env 配置格式

```bash
# ============================================
# 白名单（你的主账户）
# ============================================
MY_EMAIL=your_main_account@icloud.com

# ============================================
# 群组路由 = 项目配置
# ============================================
# 格式: GROUP_<名称>=<chatGuid>:<项目目录>
#
# chatGuid 通过 npm run get-chats 获取
# 项目目录是 Claude Code 的工作目录

GROUP_WORK=any;+;abc123:/Users/admin/projects/work
GROUP_PERSONAL=any;+;def456:/Users/admin/projects/personal
GROUP_SIDE=any;+;ghi789:/Users/admin/projects/side

# ============================================
# 可选配置
# ============================================
LOG_LEVEL=info
```

### 4.2 操作方式

| 操作 | 方法 |
|:---|:---|
| 添加新项目 | 新建群组 + 加一行 `GROUP_XXX=...` + 重启 |
| 修改项目目录 | 改 .env 对应行 + 重启 |
| 删除项目 | 删 .env 对应行 + 重启 |
| 查看配置 | `cat .env` |

### 4.3 群组命令

在群组中发送：

| 命令 | 功能 |
|:---|:---|
| `/start` | 启动该群组的 tmux + Claude |
| `/stop` | 关闭该群组的 tmux 会话 |
| `/status` | 查看会话状态 |
| `/snapshot` | 手动获取终端输出 |
| `/esc` | 发送 ESC 键中断 |
| `/clear` | 发送 /clear 清空上下文 |
| 其他消息 | 转发给 Claude |

---

## 五、技术方案

### 5.1 核心依赖

| 库 | 用途 |
|:---|:---|
| `@photon-ai/imessage-kit` | iMessage 读取/发送 |
| `tsx` | TypeScript 运行时 |
| `dotenv` | 环境变量加载 |
| `tmux` | 终端会话管理 |
| `AppleScript` | 群组消息发送 |

### 5.2 Claude Code 输出读取

Claude Code 输出保存在 JSONL 文件：
```
~/.claude/projects/{project_hash}/.claude/cline.{session}.jsonl
```

读取策略：
1. 记录发送前的文件字节偏移
2. 发送消息到 Claude
3. 轮询检测文件变化
4. 读取新增内容，解析 assistant 消息
5. 回传到 iMessage

### 5.3 tmux 会话命名

```
格式: {群组名}_claude
例如: work_claude, personal_claude
```

---

## 六、代码结构

```
matcode-mac/
├── PRD.md               # 产品需求文档
├── README.md            # 项目文档
├── .env.example         # 配置模板
├── .env                 # 实际配置
├── package.json         # 依赖配置
├── tsconfig.json        # TypeScript 配置
├── scripts/
│   └── get-chats.ts     # 获取群组 chatGuid
└── src/
    ├── index.ts         # 主入口
    ├── config.ts        # 配置加载
    ├── listener.ts      # 消息监听
    ├── router.ts        # 群组路由
    ├── security.ts      # 白名单验证
    ├── handlers.ts      # 命令 + 消息处理
    ├── tmux/            # tmux 会话管理
    │   ├── session.ts   # 启动/停止/状态
    │   └── sender.ts    # 发送消息到 Claude
    └── output/          # 输出读取
        ├── reader.ts    # JSONL 增量读取
        └── parser.ts    # assistant 消息解析
```

---

## 七、里程碑

### Phase 1: MVP ✅ 已完成
- [x] 项目结构
- [x] 配置加载
- [x] 消息监听
- [x] 群组路由
- [x] 白名单验证
- [x] 基础命令 (/start, /stop, /status)

### Phase 2: 双向通道（当前）

#### 2.1 Claude 自动启动
- [ ] `/start` 自动运行 `claude` 命令
- [ ] 等待 Claude 就绪

#### 2.2 消息转发
- [ ] 非命令消息 → tmux send-keys
- [ ] 附件处理（路径传递）

#### 2.3 输出读取
- [ ] JSONL 路径解析
- [ ] 增量读取
- [ ] assistant 消息解析
- [ ] 回传 iMessage

#### 2.4 新命令
- [ ] `/snapshot`
- [ ] `/esc`
- [ ] `/clear`

### Phase 3: 优化
- [ ] 文件监听替代轮询
- [ ] 响应速度优化
- [ ] 错误重试

---

## 八、安全设计

### 8.1 白名单
- 仅响应 .env 配置的账户
- 其他人发消息被忽略

### 8.2 权限
- Full Disk Access（读取 iMessage 数据库）
- 本地运行，无网络暴露

### 8.3 隐私
- 日志脱敏
- 无数据外传

---

## 九、验收标准

### MVP 验收
- [ ] 在群组发送 `/start`，Claude 启动
- [ ] 发送普通消息，Claude 收到
- [ ] Claude 回复出现在群组中
- [ ] 发送文件，Claude 能分析
- [ ] `/stop` 关闭会话

### 完整版验收
- [ ] 多群组并行运行
- [ ] 24小时稳定运行
- [ ] 响应延迟 < 5s

---

*版本: v0.4*
*更新日期: 2026-01-09*
