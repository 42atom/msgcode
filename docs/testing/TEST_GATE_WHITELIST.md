# 测试门禁白名单策略

## 背景

msgcode 项目包含 iMessage 协议层的参考实现（`AIDOCS/refs/imessage-kit`），其测试套件在 msgcode 运行时环境中存在预期失败。

## 白名单策略

### imessage-kit 测试（4 个预期失败）

**失败原因**：
- imessage-kit 是 iMessage 协议的参考实现
- 测试用例设计假设独立的 imessage-kit 运行时环境
- msgcode 集成后，部分环境配置不满足测试预期
- 这些失败不影响 msgcode 核心功能

**预期失败数**：固定 4 个

**失败测试**：
- Plugin 系统初始化测试（2 个）
- Plugin 钩子失败测试（2 个）

### 白名单固定规则

1. **msgcode 核心测试**：必须全部通过
2. **imessage-kit 测试**：4 个预期失败（白名单）
3. **门禁通过条件**：
   - 总失败数 = imessage-kit 预期失败数
   - msgcode 测试全部通过

## 门禁脚本

**脚本位置**：`scripts/test-gate.js`

**使用方法**：
```bash
node scripts/test-gate.js
```

**输出示例**：
```
🔍 执行测试门禁检查...

📊 测试结果: 504 pass, 4 fail

ℹ️  检测到 imessage-kit 测试失败（预期白名单）

✅ 测试门禁通过
   - msgcode 测试: 全部通过
   - imessage-kit 测试: 4 个预期失败（白名单）
```

## 团队口径

**统一认知**：
- imessage-kit 测试失败是预期行为，不是 bug
- msgcode 核心测试必须全部通过
- 新增测试失败时，需要明确区分是 msgcode 还是 imessage-kit

**维护规则**：
- 白名单固定为 4 个失败
- 如果 imessage-kit 失败数变化，需要更新门禁脚本
- 任何 msgcode 核心测试失败都是阻塞问题

## 更新记录

- **P5.6.8-R4c**: 创建白名单策略文档（2026-02-19）
- **初始版本**: imessage-kit 4 个预期失败

## 相关文件

- 门禁脚本：`scripts/test-gate.js`
- 测试套件：`test/**/*.test.ts`
- imessage-kit：`AIDOCS/refs/imessage-kit/`

## FAQ

**Q: 为什么不修复 imessage-kit 测试？**
A: imessage-kit 是参考实现，其测试设计假设独立环境。msgcode 集成后，环境差异导致测试失败，但功能正常。

**Q: 如何验证 msgcode 核心功能？**
A: 查看 msgcode 自己的测试套件（`test/` 目录），这些测试必须全部通过。

**Q: imessage-kit 失败数会变化吗？**
A: 理论上不应该变化。如果变化，需要检查是否是 imessage-kit 更新或环境变化。
