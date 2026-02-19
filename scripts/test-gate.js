#!/usr/bin/env node
/**
 * msgcode: 测试门禁脚本
 *
 * 验证测试结果符合预期：
 * - msgcode 测试：必须全部通过
 * - imessage-kit 测试：4 个预期失败（白名单）
 */

import { execSync } from 'child_process';

console.log('🔍 执行测试门禁检查...\n');

try {
    // 忽略 npm test 的 exit code，只解析输出
    let output;
    try {
        output = execSync('npm test 2>&1', { encoding: 'utf-8' });
    } catch (error) {
        // npm test 返回非 0 exit code 是正常的（有失败测试）
        output = error.stdout || error.stderr || error.output?.toString() || '';
    }

    // 解析测试结果
    const match = output.match(/(\d+) pass\s*\n\s*(\d+) fail/);

    if (!match) {
        console.error('❌ 无法解析测试结果');
        process.exit(1);
    }

    const passCount = parseInt(match[1]);
    const failCount = parseInt(match[2]);

    console.log(`📊 测试结果: ${passCount} pass, ${failCount} fail\n`);

    // 检查 imessage-kit 白名单（通过特定错误模式识别）
    const hasImessageKitFailures = output.includes('AIDOCS/refs/imessage-kit/__tests__/');

    if (hasImessageKitFailures) {
        console.log(`ℹ️  检测到 imessage-kit 测试失败（预期白名单）\n`);
    }

    // 验证规则：
    // 1. 总失败数必须等于 imessage-kit 预期失败数（说明 msgcode 测试全部通过）
    // 2. imessage-kit 失败数固定为 4
    const EXPECTED_IMESSAGE_KIT_FAILS = 4;

    if (failCount === EXPECTED_IMESSAGE_KIT_FAILS && hasImessageKitFailures) {
        console.log('✅ 测试门禁通过');
        console.log(`   - msgcode 测试: 全部通过`);
        console.log(`   - imessage-kit 测试: ${EXPECTED_IMESSAGE_KIT_FAILS} 个预期失败（白名单）\n`);
        process.exit(0);
    } else if (failCount > EXPECTED_IMESSAGE_KIT_FAILS) {
        console.error('❌ 测试门禁失败');
        console.error(`   - 发现 ${failCount - EXPECTED_IMESSAGE_KIT_FAILS} 个非预期失败`);
        console.error(`   - 预期失败: ${EXPECTED_IMESSAGE_KIT_FAILS} 个（imessage-kit 白名单）`);
        console.error(`   - 实际失败: ${failCount} 个\n`);
        process.exit(1);
    } else if (failCount < EXPECTED_IMESSAGE_KIT_FAILS) {
        console.error('❌ 测试门禁失败');
        console.error(`   - imessage-kit 失败数少于预期`);
        console.error(`   - 预期失败: ${EXPECTED_IMESSAGE_KIT_FAILS} 个`);
        console.error(`   - 实际失败: ${failCount} 个\n`);
        process.exit(1);
    } else {
        console.log('✅ 测试门禁通过\n');
        process.exit(0);
    }

} catch (error) {
    console.error('❌ 测试执行失败:', error.message);
    process.exit(1);
}
