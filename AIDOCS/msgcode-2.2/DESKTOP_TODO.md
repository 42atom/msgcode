# Desktop Bridge TODO（2026-02-10）

## 今日完成（Batch-T8.6.4.1 + T8.6.4.2）✅

### T8.6.4.1: Tool Bus Session 进程池
- ✅ SessionPool 类实现（~400 行，bus.ts）
- ✅ NDJSON stdout 逐行解析
- ✅ Single-flight 队列（避免并发乱序）
- ✅ 60s 空闲超时自动清理
- ✅ 崩溃自愈（自动重启重试 1 次）
- ✅ peer 稳定性证据（3 次请求 peer 相同）

### T8.6.4.2: Session 内 XPC 连接复用
- ✅ SessionClient 缓存单一 NSXPCConnection
- ✅ peer.pid/auditTokenDigest 稳定
- ✅ token 验证 peer 绑定机制
- ✅ Session 重启后 token 失效（预期）

### P0.5 补丁
- ✅ desktop.doctor 返回 peer 信息
- ✅ Contract 文档更新

### 测试验收
- ✅ peer 稳定性测试（test-t8.6.4.2-xpc-reuse.ts）
- ✅ token 链路测试（issue → 使用 → 重用失败）
- ✅ session 重启测试（token 失效）
- ✅ 崩溃自愈测试（test-session-crash-recovery.ts）
- ✅ 所有单元测试通过（417 pass, 0 fail）

---

## 代码已提交
- Commit: `1b979a8`
- 消息: `feat(desktop): Batch-T8.6.4.1 + T8.6.4.2 完成 - Session 进程池 + XPC 连接复用`

---

## 明日待办（等待工作单）

### P0 待分配
- [ ] 等待用户分配下一阶段任务（T8.6.5 或其他）

### 技术债务（非阻断）
- [ ] bus.ts 错误处理可以更细化（区分不同失败场景）
- [ ] SessionPool 可以增加 metrics（请求数、成功率、延迟）
- [ ] XPC 连接断线重连可以更优雅（目前是 invalidateHandler 简单清理）

### 遗留问题（无）
- 当前无遗留问题，所有 P0 验收通过

---

## 关键文件位置

### 代码
- `src/tools/bus.ts` - SessionPool 实现
- `mac/msgcode-desktopctl/Sources/msgcode-desktopctl/main.swift` - Session 命令
- `mac/MsgcodeDesktopHost/BridgeServer.swift` - XPC Bridge

### 测试
- `scripts/desktop/test-t8.6.4.2-xpc-reuse.ts` - peer 稳定性测试
- `scripts/desktop/test-session-crash-recovery.ts` - 崩溃自愈测试

### 文档
- `AIDOCS/msgcode-2.2/desktop_bridge_contract_v2.2.md` - API 契约
- `AIDOCS/msgcode-2.2/desktop_session_tasks_v2.2_T8.6.4.md` - 原始任务单

---

## 快速验证命令

```bash
# peer 稳定性测试
npx tsx scripts/desktop/test-t8.6.4.2-xpc-reuse.ts

# 崩溃自愈测试
npx tsx scripts/desktop/test-session-crash-recovery.ts

# 健康检查
npx tsx src/cli.ts /desktop health

# 诊断（含 peer 信息）
npx tsx src/cli.ts /desktop doctor
```

---

## 架构决策记录

### 为什么用 Session 进程池
- **问题**：每次 spawn 新进程 → 每次 peer 变化 → token 验证失败
- **方案**：Tool Bus 维护持久化 session 池，按 workspacePath 键控
- **收益**：peer 稳定 → token 验证可靠 → 性能更好（无进程创建开销）

### 为什么 Session 内复用 XPC 连接
- **问题**：每次请求创建新 NSXPCConnection → peer 变化
- **方案**：SessionClient 缓存单一 XPC 连接
- **收益**：peer.pid/auditTokenDigest 稳定 → token peer 绑定有效

### 为什么用 NDJSON
- **简洁**：每行一个 JSON，无需长度前缀
- **兼容**：Node.js spawn stdin/stdout 天然支持
- **可扩展**：未来可支持流式事件

---

**备注**: 本文档由 Claude 自动生成，记录 Desktop Bridge 开发进度。下次继续工作时，先查看 `desktop_session_tasks_v2.2_T8.6.4.md` 获取下一阶段任务。
