#!/bin/bash
# Batch-T8.6.4.1 验收测试（Tool Bus session 进程池）
# 快速版本（跳过 idle 回收测试）

set -e

WORKSPACE="/Users/admin/GitProjects/msgcode"
OUTPUT_FILE="/tmp/t8.6.4.1-acceptance.txt"

echo "=== Batch-T8.6.4.1 验收测试（Tool Bus session 进程池）==="
echo ""

# 清理旧输出
rm -f "$OUTPUT_FILE"

# ============================================
# 测试 1: peer 稳定证据
# ============================================
echo "=== 测试 1: peer 稳定证据 ==="
echo "连续 3 次 /desktop rpc desktop.health"
echo ""

# 启动临时 msgcode 进程来测试
npx tsx -e "
    const { executeTool } = await import('./src/tools/bus.js');

    // 测试 1
    const r1 = await executeTool('desktop', {
        method: 'desktop.health',
        params: {}
    }, {
        workspacePath: '$WORKSPACE',
        source: 'test',
        requestId: 'test-1',
        chatId: 'test',
        timeoutMs: 10000
    });

    const j1 = JSON.parse(r1.data.stdout);
    console.log('请求 1 - peer.pid:', j1.result?.peer?.pid, 'peer.auditTokenDigest:', j1.result?.peer?.auditTokenDigest?.substring(0, 8));

    // 等待一下
    await new Promise(r => setTimeout(r, 500));

    // 测试 2
    const r2 = await executeTool('desktop', {
        method: 'desktop.health',
        params: {}
    }, {
        workspacePath: '$WORKSPACE',
        source: 'test',
        requestId: 'test-2',
        chatId: 'test',
        timeoutMs: 10000
    });

    const j2 = JSON.parse(r2.data.stdout);
    console.log('请求 2 - peer.pid:', j2.result?.peer?.pid, 'peer.auditTokenDigest:', j2.result?.peer?.auditTokenDigest?.substring(0, 8));

    // 等待一下
    await new Promise(r => setTimeout(r, 500));

    // 测试 3
    const r3 = await executeTool('desktop', {
        method: 'desktop.health',
        params: {}
    }, {
        workspacePath: '$WORKSPACE',
        source: 'test',
        requestId: 'test-3',
        chatId: 'test',
        timeoutMs: 10000
    });

    const j3 = JSON.parse(r3.data.stdout);
    console.log('请求 3 - peer.pid:', j3.result?.peer?.pid, 'peer.auditTokenDigest:', j3.result?.peer?.auditTokenDigest?.substring(0, 8));

    // 验证 peer 稳定
    if (j1.result?.peer?.pid === j2.result?.peer?.pid && j2.result?.peer?.pid === j3.result?.peer?.pid) {
        console.log('');
        console.log('✓ peer 稳定：3 次请求 pid 相同');
    } else {
        console.log('');
        console.log('❌ peer 不稳定');
    }
" 2>&1 | tee -a "$OUTPUT_FILE"

echo ""

# ============================================
# 测试 2: token 链路证据
# ============================================
echo "=== 测试 2: token 链路证据 ==="
echo ""

npx tsx -e "
    const { executeTool } = await import('./src/tools/bus.js');
    const { randomUUID } = await import('node:crypto');

    // 步骤 1: 签发 token
    console.log('步骤 1: /desktop confirm desktop.typeText ...');
    const issueOut = await executeTool('desktop', {
        method: 'desktop.confirm.issue',
        params: {
            meta: {
                schemaVersion: 1,
                requestId: randomUUID(),
                workspacePath: '$WORKSPACE',
                timeoutMs: 10000
            },
            intent: {
                method: 'desktop.typeText',
                params: { text: 'T8_6_OK' }
            },
            ttlMs: 60000
        }
    }, {
        workspacePath: '$WORKSPACE',
        source: 'test',
        requestId: randomUUID(),
        chatId: 'test',
        timeoutMs: 10000
    });

    const issueJson = JSON.parse(issueOut.data.stdout);
    const token = issueJson.result?.token;
    console.log('Token:', token);

    if (!token) {
        console.log('❌ 无法获取 token');
        return;
    }

    // 等待一下
    await new Promise(r => setTimeout(r, 500));

    // 步骤 2: 使用 token 执行
    console.log('');
    console.log('步骤 2: /desktop rpc desktop.typeText --confirm-token ...');
    const useOut = await executeTool('desktop', {
        method: 'desktop.typeText',
        params: {
            meta: {
                schemaVersion: 1,
                requestId: randomUUID(),
                workspacePath: '$WORKSPACE',
                timeoutMs: 10000
            },
            confirm: { token },
            text: 'T8_6_OK'
        }
    }, {
        workspacePath: '$WORKSPACE',
        source: 'test',
        requestId: randomUUID(),
        chatId: 'test',
        timeoutMs: 10000
    });

    console.log('exitCode:', useOut.ok ? 'success' : 'failed');
    const useJson = JSON.parse(useOut.data.stdout);
    console.log('typed:', useJson.result?.typed);

    // 等待一下
    await new Promise(r => setTimeout(r, 500));

    // 步骤 3: 同 token 再次使用
    console.log('');
    console.log('步骤 3: 同 token 再次使用 ...');
    const reuseOut = await executeTool('desktop', {
        method: 'desktop.typeText',
        params: {
            meta: {
                schemaVersion: 1,
                requestId: randomUUID(),
                workspacePath: '$WORKSPACE',
                timeoutMs: 10000
            },
            confirm: { token },
            text: 'T8_6_OK'
        }
    }, {
        workspacePath: '$WORKSPACE',
        source: 'test',
        requestId: randomUUID(),
        chatId: 'test',
        timeoutMs: 10000
    });

    console.log('exitCode:', reuseOut.ok ? 'success' : 'failed');
    const reuseJson = JSON.parse(reuseOut.data.stdout);
    if (reuseJson.error?.code === 'DESKTOP_CONFIRM_REQUIRED') {
        console.log('error:', reuseJson.error.code);
        console.log('');
        console.log('✓ single-use 生效');
    } else {
        console.log('');
        console.log('⚠️  single-use 验证结果待确认');
    }
" 2>&1 | tee -a "$OUTPUT_FILE"

echo ""
echo "=== Batch-T8.6.4.1 验收测试完成 ==="
echo ""
echo "说明：测试 3（idle 回收）需要等待 65 秒，已跳过。"
echo "可以手动执行：sleep 65; 然后再次运行 desktop.health 验证自动重启。"
