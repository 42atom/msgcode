---
owner: 架构同学
assignee: 执行同学
reviewer: @42atom
why: 为解决多节点集群中的单点物理硬件故障导致的网络隔离与数据链断裂问题，防止硬件故障波及逻辑通讯寻址。
scope: `appliance.ts` 初始化域、`profile.json` 生成与运行时环境检测模块。
risk: medium
accept: 物理 Hardware UUID 和逻辑 Appliance ID 的映射关系写入运行时配置，且能通过校验逻辑防止异地克隆。
implicit:
  waiting_for: "CLI `appliance.ts` 中 profile 子命令的重构完成"
  next_check: ""
  stale_since: ""
links: []
---

# Appliance 集群身份绑定架构设计 (Hardware UUID Decoupling)

## 1. 背景与真相
在 Appliance 硬件部署模型下（如使用独立 Mac Mini 作为各部门的专属 AI Agent 节点），直接使用硬件 UUID（如通过机器网卡或主板获取的全球唯一 ID）作为节点在 Neighbor 网络中的通讯 ID，会引发严重的**灾备生命周期灾难**：
- 当机器硬盘损坏，使用 TimeMachine 恢复到新机器时，由于底层主板 UUID 变更，整个网络会将此节点视为非授信的新机器。
- 历史发向该机器的通讯数据和基于节点 ID 的权限映射将全部失效。

**架构核心原则**：必须坚持 File-first，身份应当基于文件（逻辑存在）而定，底层物理硬件只是它的“认证绑定指纹”，而非唯一的法定代号。

## 2. 身份隔离设计 (Appliance ID vs Hardware Fingerprint)

节点身份被拆分为：**逻辑寻址 ID (Appliance ID)** 和 **物理指纹校验 (Hardware Fingerprint)**。

### 架构态真相源 (`.msgcode/profile.json`)
```json
{
  "applianceId": "app_x7k9p2wm",                 // 网络通讯、MCP 路由的唯一逻辑标识
  "hardwareFingerprint": "D3AB957E-F50D-...",  // 绑定的物理机器主板 UUID (校验凭证)
  "alias": "Sales-Cluster-Node-01"               // 人读层面的别名
}
```

## 3. 实现边界与生命周期

### 阶段 A: 初始化绑定 (Installation Phase)
当 `msgcode` 程序在全新环境首次启动时，执行以下策略：
1. 检测 `.msgcode/profile.json` 是否存在。若无，进入初始化引导。
2. 使用 `nanoid` (限定长度，如 8 位 `app_[a-z0-9]{8}`) 生成一个可读性高、抗碰撞的短逻辑 ID，记为 `applianceId`。
3. 执行系统底层调用，获取真实硬件 UUID。
   - **最优获取方案（Node.js / macOS 环境）**：
     ```typescript
     import { execFile } from 'node:child_process';
     import { promisify } from 'node:util';
     const execFileAsync = promisify(execFile);

     export async function getHardwareUuid(): Promise<string> {
       const { stdout } = await execFileAsync('/bin/sh', [
         '-c',
         'ioreg -d2 -c IOPlatformExpertDevice | awk -F\\" \'/IOPlatformUUID/{print $(NF-1)}\''
       ]);
       return stdout.trim();
     }
     ```
4. 将两者共同写入 `profile.json` 落盘。至此，节点获得合法护照。

### 阶段 B: 运行时校验 (Runtime Guard)
在主脑循环（Heartbeat Tick）启动时，注入极薄的前置校验：
1. 读取 `profile.json` 解析 `hardwareFingerprint`。
2. 现场执行 `getHardwareUuid()`。
3. **比对一致**：进程挂载 `applianceId` 进入运行态，监听 Neighbor 网络并派发工作。
4. **比对失败**：系统抛出强类型错误（如 `APPLIANCE_HARDWARE_MISMATCH`），冻结大模型通讯与外围轮询。

### 阶段 C: 灾难恢复与权限漂移 (Disaster Recovery & Rebind)
因硬件损坏或机房搬迁导致的“比对失败”冻结态，需提供显式的“重新认主”机制：
- 提供 CLI 子命令：`msgcode appliance profile rebind` (需提供高阶确认或鉴权)。
- 执行该命令后，系统使用当前的 `Hardware UUID` 覆盖文件中的 `hardwareFingerprint`，此时系统从“冻结抢救态”恢复为“正常运行态”。原有的网络连接历史与逻辑 ID 完美继承。

## 4. 架构收益
1. **防止直接的数据劫持**：将存有 `.msgcode` 状态文件夹的硬盘拔出插入其他机器时，机器因硬件不符会被冻结，防止物理克隆攻击。
2. **极简运维**：Neighbor 服务发现（如 Bonjour / zerotier）只需认短小精干的 `applianceId`，且不怕换件变迁，完全抹平了运维迁移的复杂度负担。
