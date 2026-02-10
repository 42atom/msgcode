#!/usr/bin/env tsx
/**
 * 非阻断健壮性测试：session 崩溃自愈
 *
 * 场景：手动 kill 掉 session 子进程后，再发一次请求，应自动重启并成功
 * 预期：peer.pid 会变化（新 session），但请求成功
 */

import { executeTool } from "../../src/tools/bus.js";
import { spawn } from "node:child_process";

const WORKSPACE = process.env.WORKSPACE ?? process.cwd();

async function testSessionCrashRecovery() {
  console.log("=== Session 崩溃自愈测试 ===\n");

  // 步骤 1: 发起请求，创建 session
  console.log("步骤 1: 创建初始 session...");
  const result1 = await executeTool("desktop", {
    method: "desktop.health",
    params: {}
  }, {
    workspacePath: WORKSPACE,
    source: "test",
    requestId: "test-crash-1",
    chatId: "test",
    timeoutMs: 10000
  });

  const json1 = JSON.parse(result1.data.stdout);
  const pid1 = json1.result?.peer?.pid;
  const digest1 = json1.result?.peer?.auditTokenDigest?.substring(0, 8);
  console.log(`初始 session - peer.pid: ${pid1}, auditTokenDigest: ${digest1}`);

  // 步骤 2: 找到并 kill 掉 session 子进程
  console.log("\n步骤 2: 查找并 kill session 子进程...");

  // 查找 desktopctl session 进程
  const findProc = spawn("pgrep", ["-f", "msgcode-desktopctl.*session"]);
  let sessionPid = "";

  findProc.stdout?.on("data", (data: Buffer) => {
    const pids = data.toString().trim().split("\n");
    for (const pid of pids) {
      if (pid) {
        sessionPid = pid;
        console.log(`找到 session 进程: ${pid}`);

        // kill 掉 session
        try {
          process.kill(Number.parseInt(pid), "SIGKILL");
          console.log(`已 kill 掉 session 进程 ${pid}`);
        } catch (err) {
          console.log(`Kill 失败: ${err}`);
        }
      }
    }
  });

  await new Promise<void>(resolve => {
    findProc.on("close", resolve);
    setTimeout(resolve, 2000); // 最多等 2 秒
  });

  // 等待进程完全退出
  await new Promise(r => setTimeout(r, 1000));

  // 步骤 3: 发起新请求，应自动重启 session
  console.log("\n步骤 3: 发起新请求（应自动重启 session）...");
  const result2 = await executeTool("desktop", {
    method: "desktop.doctor",
    params: {}
  }, {
    workspacePath: WORKSPACE,
    source: "test",
    requestId: "test-crash-2",
    chatId: "test",
    timeoutMs: 15000
  });

  const json2 = JSON.parse(result2.data.stdout);
  const pid2 = json2.result?.peer?.pid;
  const digest2 = json2.result?.peer?.auditTokenDigest?.substring(0, 8);

  console.log(`新 session - peer.pid: ${pid2}, auditTokenDigest: ${digest2}`);

  // 验证结果
  console.log("\n=== 验证结果 ===");

  if (pid1 && pid2) {
    if (pid1 !== pid2) {
      console.log(`✓ peer 变化：${pid1} → ${pid2}（预期，新 session）`);
    } else {
      console.log(`⚠️  peer 未变：${pid1}（可能原 session 未被 kill）`);
    }
  }

  if (digest1 && digest2 && digest1 !== digest2) {
    console.log(`✓ auditTokenDigest 变化（新 XPC 连接）`);
  }

  if (result2.ok) {
    console.log("✓ 请求成功（session 自动恢复）");
  } else {
    console.log("❌ 请求失败（session 自愈失败）");
  }

  // 步骤 4: 再次验证稳定性
  console.log("\n步骤 4: 验证新 session 稳定性...");
  const result3 = await executeTool("desktop", {
    method: "desktop.health",
    params: {}
  }, {
    workspacePath: WORKSPACE,
    source: "test",
    requestId: "test-crash-3",
    chatId: "test",
    timeoutMs: 10000
  });

  const json3 = JSON.parse(result3.data.stdout);
  const pid3 = json3.result?.peer?.pid;

  if (pid3 === pid2) {
    console.log(`✓ 新 session 稳定：peer.pid 保持 ${pid3}`);
  } else {
    console.log(`⚠️  peer 又变化了：${pid2} → ${pid3}`);
  }

  console.log("\n=== Session 崩溃自愈测试完成 ===");
}

testSessionCrashRecovery().catch(console.error);
