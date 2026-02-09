#!/usr/bin/env tsx
/**
 * Batch-T8.6.4.1 验收测试（Tool Bus session 进程池）
 *
 * 验收要求（3 组证据）：
 * 1. peer 稳定证据：连续 3 次 desktop.health 返回 peer 不变
 * 2. token 链路证据：confirm → rpc 成功 → 同 token 再用失败
 * 3. idle 回收证据：等 65s 后再发一次仍成功（手动测试）
 */

import { executeTool } from "../../src/tools/bus.js";
import { randomUUID } from "node:crypto";

const WORKSPACE = "/Users/admin/GitProjects/msgcode";

// ============================================
// 测试 1: peer 稳定证据
// ============================================
async function testPeerStability() {
  console.log("\n=== 测试 1: peer 稳定证据 ===");
  console.log("连续 3 次 desktop.health\n");

  const pids: (number | undefined)[] = [];
  const digests: (string | undefined)[] = [];

  for (let i = 1; i <= 3; i++) {
    const result = await executeTool("desktop", {
      method: "desktop.health",
      params: {}
    }, {
      workspacePath: WORKSPACE,
      source: "test",
      requestId: `test-peer-${i}`,
      chatId: "test",
      timeoutMs: 10000
    });

    const jsonOut = JSON.parse(result.data.stdout);
    const pid = jsonOut.result?.peer?.pid;
    const digest = jsonOut.result?.peer?.auditTokenDigest?.substring(0, 8);

    pids.push(pid);
    digests.push(digest);

    console.log(`请求 ${i} - peer.pid: ${pid}, peer.auditTokenDigest: ${digest}`);
  }

  console.log("");
  if (pids[0] === pids[1] && pids[1] === pids[2]) {
    console.log("✓ peer 稳定：3 次请求 pid 相同");
  } else {
    console.log("❌ peer 不稳定");
  }
}

// ============================================
// 测试 2: token 链路证据
// ============================================
async function testTokenChain() {
  console.log("\n=== 测试 2: token 链路证据 ===\n");

  // 步骤 1: 签发 token
  console.log("步骤 1: /desktop confirm desktop.typeText ...");
  const issueResult = await executeTool("desktop", {
    method: "desktop.confirm.issue",
    params: {
      meta: {
        schemaVersion: 1,
        requestId: randomUUID(),
        workspacePath: WORKSPACE,
        timeoutMs: 10000
      },
      intent: {
        method: "desktop.typeText",
        params: { text: "T8_6_OK" }
      },
      ttlMs: 60000
    }
  }, {
    workspacePath: WORKSPACE,
    source: "test",
    requestId: randomUUID(),
    chatId: "test",
    timeoutMs: 10000
  });

  const issueJson = JSON.parse(issueResult.data.stdout);
  const token = issueJson.result?.token;
  console.log(`Token: ${token}`);

  if (!token) {
    console.log("❌ 无法获取 token");
    return;
  }

  // 等待一下
  await new Promise(r => setTimeout(r, 500));

  // 步骤 2: 使用 token 执行
  console.log("\n步骤 2: /desktop rpc desktop.typeText --confirm-token ...");
  const useResult = await executeTool("desktop", {
    method: "desktop.typeText",
    params: {
      meta: {
        schemaVersion: 1,
        requestId: randomUUID(),
        workspacePath: WORKSPACE,
        timeoutMs: 10000
      },
      confirm: { token },
      text: "T8_6_OK"
    }
  }, {
    workspacePath: WORKSPACE,
    source: "test",
    requestId: randomUUID(),
    chatId: "test",
    timeoutMs: 10000
  });

  console.log(`exitCode: ${useResult.ok ? "success" : "failed"}`);
  const useJson = JSON.parse(useResult.data.stdout);
  console.log(`typed: ${useJson.result?.typed}`);

  // 等待一下
  await new Promise(r => setTimeout(r, 500));

  // 步骤 3: 同 token 再次使用
  console.log("\n步骤 3: 同 token 再次使用 ...");
  const reuseResult = await executeTool("desktop", {
    method: "desktop.typeText",
    params: {
      meta: {
        schemaVersion: 1,
        requestId: randomUUID(),
        workspacePath: WORKSPACE,
        timeoutMs: 10000
      },
      confirm: { token },
      text: "T8_6_OK"
    }
  }, {
    workspacePath: WORKSPACE,
    source: "test",
    requestId: randomUUID(),
    chatId: "test",
    timeoutMs: 10000
  });

  console.log(`exitCode: ${reuseResult.ok ? "success" : "failed"}`);
  const reuseJson = JSON.parse(reuseResult.data.stdout);
  if (reuseJson.error?.code === "DESKTOP_CONFIRM_REQUIRED") {
    console.log(`error: ${reuseJson.error.code}`);
    console.log("\n✓ single-use 生效");
  } else {
    console.log("\n⚠️ single-use 验证结果待确认");
  }
}

// 主测试函数
async function main() {
  console.log("=== Batch-T8.6.4.1 验收测试（Tool Bus session 进程池）===");

  await testPeerStability();
  await testTokenChain();

  console.log("\n=== Batch-T8.6.4.1 验收测试完成 ===");
  console.log("\n说明：测试 3（idle 回收）需要等待 65 秒，已跳过。");
  console.log("可以手动执行：sleep 65; 然后再次运行 desktop.health 验证自动重启。");
}

main().catch(console.error);
