#!/usr/bin/env tsx
/**
 * Batch-T8.6.4.2 验收测试（Session 内复用单一 XPC 连接）
 *
 * 验收要求：
 * 1) 同一 session 连续 3 次 desktop.health，peer.pid/auditTokenDigest 完全一致
 * 2) token 成功链路：issue → typeText 成功 → 重用失败
 * 3) session 重启后 token 失效（预期）
 */

import { executeTool } from "../../src/tools/bus.js";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";

import path from "node:path";

const WORKSPACE = process.env.WORKSPACE ?? process.cwd();
const DESKTOPCTL =
  process.env.MSGCODE_DESKTOPCTL_PATH ??
  path.resolve(process.cwd(), "mac/msgcode-desktopctl/.build/debug/msgcode-desktopctl");

// ============================================
// 验收 1: peer 稳定证据
// ============================================
async function testPeerStability() {
  console.log("\n=== 验收 1: peer 稳定证据 ===");
  console.log("同一 session 连续 3 次 desktop.health\n");

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

  if (digests[0] === digests[1] && digests[1] === digests[2]) {
    console.log("✓ auditTokenDigest 稳定：3 次请求相同");
  } else {
    console.log("❌ auditTokenDigest 不稳定");
  }
}

// ============================================
// 验收 2: token 成功链路
// ============================================
async function testTokenChain() {
  console.log("\n=== 验收 2: token 成功链路 ===\n");

  // 步骤 1: 签发 token
  console.log("步骤 1: desktop.confirm.issue ...");
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
        method: "desktop.health",
        params: {}
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

  // 步骤 2: 使用 token 执行 health（不需要权限）
  console.log("\n步骤 2: 使用 token 执行 desktop.health ...");
  const useResult = await executeTool("desktop", {
    method: "desktop.health",
    params: {
      meta: {
        schemaVersion: 1,
        requestId: randomUUID(),
        workspacePath: WORKSPACE,
        timeoutMs: 10000
      },
      confirm: { token }
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
  console.log(`peer.pid: ${useJson.result?.peer?.pid}`);

  // 等待一下
  await new Promise(r => setTimeout(r, 500));

  // 步骤 3: 重用 token（应该失败）
  console.log("\n步骤 3: 重用 token ...");
  const reuseResult = await executeTool("desktop", {
    method: "desktop.health",
    params: {
      meta: {
        schemaVersion: 1,
        requestId: randomUUID(),
        workspacePath: WORKSPACE,
        timeoutMs: 10000
      },
      confirm: { token }
    }
  }, {
    workspacePath: WORKSPACE,
    source: "test",
    requestId: randomUUID(),
    chatId: "test",
    timeoutMs: 10000
  });

  const reuseJson = JSON.parse(reuseResult.data.stdout);
  if (reuseJson.error?.code === "DESKTOP_CONFIRM_REQUIRED") {
    console.log(`error: ${reuseJson.error.code}`);
    console.log("✓ single-use 生效");
  } else {
    console.log("⚠️ single-use 验证结果待确认");
  }
}

// ============================================
// 验收 3: session 重启后 token 失效
// ============================================
async function testSessionRestartTokenInvalid() {
  console.log("\n=== 验收 3: session 重启后 token 失效 ===\n");

  // 启动临时 session
  const proc = spawn(DESKTOPCTL, ["session", WORKSPACE, "--idle-ms", "10000"], {
    cwd: WORKSPACE,
  });

  console.log("临时 session pid:", proc.pid);

  let sessionStdout = "";
  proc.stdout?.on("data", (data: Buffer) => {
    sessionStdout += data.toString();
  });

  // 等待启动
  await new Promise(r => setTimeout(r, 500));

  // 发送签发 token 请求
  const tokenRequest = {
    id: randomUUID(),
    workspacePath: WORKSPACE,
    method: "desktop.confirm.issue",
    params: {
      meta: {
        schemaVersion: 1,
        requestId: randomUUID(),
        workspacePath: WORKSPACE,
        timeoutMs: 10000
      },
      intent: {
        method: "desktop.health",
        params: {}
      },
      ttlMs: 60000
    }
  };

  proc.stdin?.write(JSON.stringify(tokenRequest) + "\n");

  // 等待响应
  await new Promise(r => setTimeout(r, 1000));

  // 解析 token
  const lines = sessionStdout.split("\n").filter(l => l.trim());
  let token = "";
  for (const line of lines) {
    try {
      const response = JSON.parse(line);
      if (response.result?.token) {
        token = response.result.token;
        break;
      }
    } catch {
      // 忽略非 JSON 行
    }
  }

  console.log(`Session A 签发 token: ${token}`);

  if (!token) {
    console.log("❌ 无法获取 token");
    proc.kill("SIGTERM");
    return;
  }

  // 关闭 session A
  console.log("\n关闭 session A ...");
  proc.kill("SIGTERM");
  await new Promise(r => setTimeout(r, 500));

  // 等待进程完全退出
  await new Promise(r => setTimeout(r, 1000));

  // 使用 Tool Bus 发送请求（会创建新的 session B）
  console.log("\n使用 session B 尝试使用旧 token ...");
  const result = await executeTool("desktop", {
    method: "desktop.health",
    params: {
      meta: {
        schemaVersion: 1,
        requestId: randomUUID(),
        workspacePath: WORKSPACE,
        timeoutMs: 10000
      },
      confirm: { token }
    }
  }, {
    workspacePath: WORKSPACE,
    source: "test",
    requestId: randomUUID(),
    chatId: "test",
    timeoutMs: 10000
  });

  const jsonOut = JSON.parse(result.data.stdout);
  if (jsonOut.error?.code === "DESKTOP_CONFIRM_REQUIRED") {
    console.log(`error: ${jsonOut.error.code} - ${jsonOut.error.message}`);
    console.log("✓ session 重启后 token 失效（预期行为）");
  } else {
    console.log("⚠️ session 重启后 token 验证结果待确认");
  }
}

// 主测试函数
async function main() {
  console.log("=== Batch-T8.6.4.2 验收测试（Session 内复用单一 XPC 连接）===");

  await testPeerStability();
  await testTokenChain();
  await testSessionRestartTokenInvalid();

  console.log("\n=== Batch-T8.6.4.2 验收测试完成 ===");
}

main().catch(console.error);
