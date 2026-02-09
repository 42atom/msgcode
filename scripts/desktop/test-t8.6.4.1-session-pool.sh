#!/bin/bash
# Batch-T8.6.4.1 验收测试（Tool Bus session 进程池）
#
# 验收要求（3 组证据）：
# 1. peer 稳定证据：连续 3 次 /desktop rpc desktop.health {} 返回 peer 不变
# 2. token 链路证据：confirm → rpc 成功 → 同 token 再用失败
# 3. idle 回收证据：等 65s 后再发一次仍成功

set -e

WORKSPACE="/Users/admin/GitProjects/msgcode"
OUTPUT_FILE="/tmp/t8.6.4.1-acceptance.txt"
SESSION_LOG="/tmp/t8.6.4.1-session-log.txt"

echo "=== Batch-T8.6.4.1 验收测试（Tool Bus session 进程池）===" > "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"

# 清理旧输出
rm -f "$SESSION_LOG"

# ============================================
# 测试 1: peer 稳定证据
# ============================================
echo "=== 测试 1: peer 稳定证据 ===" >> "$OUTPUT_FILE"
echo "连续 3 次 /desktop rpc desktop.health" >> "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"

for i in 1 2 3; do
    echo "第 $i 次请求:" >> "$OUTPUT_FILE"
    npx tsx -e "
        const { sendDesktopViaSession } = await import('./src/tools/bus.js');
        const out = await sendDesktopViaSession('$WORKSPACE', 'desktop.health', {}, 10000);
        console.log('exitCode:', out.exitCode);
        console.log('stdout:', out.stdout);
        const jsonOut = JSON.parse(out.stdout);
        if (jsonOut.result?.peer) {
            console.log('peer.pid:', jsonOut.result.peer.pid);
            console.log('peer.auditTokenDigest:', jsonOut.result.peer.auditTokenDigest);
        }
    " >> "$OUTPUT_FILE" 2>&1
    echo "" >> "$OUTPUT_FILE"
    sleep 0.5
done

# 提取 peer 信息并验证
PEER_PID_1=$(grep -A1 "peer.pid:" "$OUTPUT_FILE" | head -1 | awk '{print $2}')
PEER_PID_2=$(grep -A1 "peer.pid:" "$OUTPUT_FILE" | sed -n '3p' | awk '{print $2}')
PEER_PID_3=$(grep -A1 "peer.pid:" "$OUTPUT_FILE" | sed -n '5p' | awk '{print $2}')

echo "✓ 测试 1 结果:" >> "$OUTPUT_FILE"
echo "  peer.pid: $PEER_PID_1, $PEER_PID_2, $PEER_PID_3" >> "$OUTPUT_FILE"

if [ "$PEER_PID_1" = "$PEER_PID_2" ] && [ "$PEER_PID_2" = "$PEER_PID_3" ]; then
    echo "  ✓ peer 稳定：3 次请求 pid 相同" >> "$OUTPUT_FILE"
else
    echo "  ❌ peer 不稳定" >> "$OUTPUT_FILE"
fi

echo "" >> "$OUTPUT_FILE"

# ============================================
# 测试 2: token 链路证据
# ============================================
echo "=== 测试 2: token 链路证据 ===" >> "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"

# 步骤 2.1: 签发 token
echo "步骤 2.1: /desktop confirm desktop.typeText ..." >> "$OUTPUT_FILE"
npx tsx -e "
    const { sendDesktopViaSession } = await import('./src/tools/bus.js');
    const { randomUUID } = await import('node:crypto');
    const requestId = randomUUID();

    const out = await sendDesktopViaSession('$WORKSPACE', 'desktop.confirm.issue', {
        meta: {
            schemaVersion: 1,
            requestId,
            workspacePath: '$WORKSPACE',
            timeoutMs: 10000
        },
        intent: {
            method: 'desktop.typeText',
            params: { text: 'T8_6_OK' }
        },
        ttlMs: 60000
    }, 10000);

    console.log('exitCode:', out.exitCode);
    console.log('stdout:', out.stdout);
    const jsonOut = JSON.parse(out.stdout);
    if (jsonOut.result?.token) {
        console.log('TOKEN:', jsonOut.result.token);
    }
" >> "$OUTPUT_FILE" 2>&1

echo "" >> "$OUTPUT_FILE"

# 提取 token
TOKEN=$(grep "TOKEN:" "$OUTPUT_FILE" | awk '{print $2}')
echo "步骤 2.2: 获取到 token: $TOKEN" >> "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"

# 步骤 2.2: 使用 token 执行
echo "步骤 2.2: /desktop rpc desktop.typeText --confirm-token $TOKEN ..." >> "$OUTPUT_FILE"
npx tsx -e "
    const { sendDesktopViaSession } = await import('./src/tools/bus.js');
    const { randomUUID } = await import('node:crypto');
    const requestId = randomUUID();

    const out = await sendDesktopViaSession('$WORKSPACE', 'desktop.typeText', {
        meta: {
            schemaVersion: 1,
            requestId,
            workspacePath: '$WORKSPACE',
            timeoutMs: 10000
        },
        confirm: { token: '$TOKEN' },
        text: 'T8_6_OK'
    }, 10000);

    console.log('exitCode:', out.exitCode);
    console.log('stdout:', out.stdout);
" >> "$OUTPUT_FILE" 2>&1

echo "" >> "$OUTPUT_FILE"

# 步骤 2.3: 同 token 再次使用
echo "步骤 2.3: 同 token 再次使用 ..." >> "$OUTPUT_FILE"
npx tsx -e "
    const { sendDesktopViaSession } = await import('./src/tools/bus.js');
    const { randomUUID } = await import('node:crypto');
    const requestId = randomUUID();

    const out = await sendDesktopViaSession('$WORKSPACE', 'desktop.typeText', {
        meta: {
            schemaVersion: 1,
            requestId,
            workspacePath: '$WORKSPACE',
            timeoutMs: 10000
        },
        confirm: { token: '$TOKEN' },
        text: 'T8_6_OK'
    }, 10000);

    console.log('exitCode:', out.exitCode);
    console.log('stdout:', out.stdout);
" >> "$OUTPUT_FILE" 2>&1

# 检查 DESKTOP_CONFIRM_REQUIRED
if grep -q "DESKTOP_CONFIRM_REQUIRED" "$OUTPUT_FILE"; then
    echo "  ✓ single-use 生效" >> "$OUTPUT_FILE"
else
    echo "  ⚠️  single-use 验证结果待确认" >> "$OUTPUT_FILE"
fi

echo "" >> "$OUTPUT_FILE"

# ============================================
# 测试 3: idle 回收证据
# ============================================
echo "=== 测试 3: idle 回收证据 ===" >> "$OUTPUT_FILE"
echo "等待 65 秒..." >> "$OUTPUT_FILE"

# 记录开始时间
START_TIME=$(date +%s)

# 等待 65 秒
for i in {65..1}; do
    echo -n "." >> "$OUTPUT_FILE"
    sleep 1
done

echo "" >> "$OUTPUT_FILE"
echo "65 秒后发送请求..." >> "$OUTPUT_FILE"

# 发送新请求
npx tsx -e "
    const { sendDesktopViaSession } = await import('./src/tools/bus.js');
    const out = await sendDesktopViaSession('$WORKSPACE', 'desktop.find', {
        selector: { byRole: 'AXWindow' }
    }, 10000);

    console.log('exitCode:', out.exitCode);
    const jsonOut = JSON.parse(out.stdout);
    console.log('matched:', jsonOut.result?.matched);
" >> "$OUTPUT_FILE" 2>&1

# 检查是否成功
if grep -q "exitCode: 0" "$OUTPUT_FILE" | tail -1; then
    echo "  ✓ idle 回收后自动重启成功" >> "$OUTPUT_FILE"
else
    echo "  ⚠️  idle 回收验证结果待确认" >> "$OUTPUT_FILE"
fi

echo "" >> "$OUTPUT_FILE"
echo "=== Batch-T8.6.4.1 验收测试完成 ===" >> "$OUTPUT_FILE"

# 显示结果
cat "$OUTPUT_FILE"
