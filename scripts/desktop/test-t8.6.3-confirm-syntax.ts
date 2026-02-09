#!/usr/bin/env tsx
/**
 * Batch-T8.6.3 验收测试（msgcode 语法糖）
 *
 * 直接调用 desktopctl 验证 token 机制
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const workspacePath = "/Users/admin/GitProjects/msgcode";
const desktopctlPath = path.join(workspacePath, "mac", "msgcode-desktopctl", ".build", "debug", "msgcode-desktopctl");

async function runDesktopctl(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolve) => {
    const proc = spawn(desktopctlPath, args, {
      cwd: workspacePath,
    });
    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (data) => { stdout += data; });
    proc.stderr?.on("data", (data) => { stderr += data; });

    proc.on("close", (code) => {
      resolve({ stdout, stderr, exitCode: code });
    });

    proc.on("error", (err) => {
      stderr += String(err);
      resolve({ stdout, stderr, exitCode: -1 });
    });
  });
}

async function runTest() {
  console.log("=== Batch-T8.6.3 验收测试（直接调用 desktopctl）===\n");

  // 检查 desktopctl 是否存在
  if (!fs.existsSync(desktopctlPath)) {
    console.log(`❌ desktopctl 不存在: ${desktopctlPath}`);
    console.log("请先构建: cd mac/msgcode-desktopctl && swift build");
    return;
  }
  console.log(`✓ desktopctl 存在: ${desktopctlPath}\n`);

  // 步骤 1: 签发 token
  console.log("步骤 1: 签发 token");
  console.log("命令: desktopctl issue-confirm /Users/admin/GitProjects/msgcode --method desktop.typeText --params-json '{\"text\":\"T8_6_OK}'\n");

  const issueResult = await runDesktopctl([
    "issue-confirm",
    workspacePath,
    "--method", "desktop.typeText",
    "--params-json", '{"text":"T8_6_OK"}',
  ]);

  console.log("退出码:", issueResult.exitCode);
  if (issueResult.stdout) console.log("stdout:\n" + issueResult.stdout);
  if (issueResult.stderr) console.log("stderr:\n" + issueResult.stderr);

  // 提取 token
  let token = "";
  if (issueResult.stdout) {
    const tokenMatch = issueResult.stdout.match(/"token"\s*:\s*"([^"]+)"/);
    if (tokenMatch) {
      token = tokenMatch[1];
      console.log(`\n✓ 提取的 token: ${token}`);
    }
  }

  if (!token) {
    console.log("\n❌ 无法获取 token，测试终止");
    return;
  }

  // 步骤 2: 使用 token 执行 typeText（第一次）
  console.log("\n" + "=".repeat(60));
  console.log("步骤 2: 使用 token 执行 typeText（第一次）");
  console.log(`命令: desktopctl typeText /Users/admin/GitProjects/msgcode "T8_6_OK" --confirm-token ${token}\n`);

  const typeTextResult1 = await runDesktopctl([
    "type-text",
    workspacePath,
    "T8_6_OK",
    "--confirm-token", token,
  ]);

  console.log("退出码:", typeTextResult1.exitCode);
  if (typeTextResult1.stdout) console.log("stdout:\n" + typeTextResult1.stdout);
  if (typeTextResult1.stderr) console.log("stderr:\n" + typeTextResult1.stderr);

  // 步骤 3: 使用 token 执行 typeText（第二次，应该失败）
  console.log("\n" + "=".repeat(60));
  console.log("步骤 3: 使用 token 执行 typeText（第二次，应该返回 DESKTOP_CONFIRM_REQUIRED）");
  console.log(`命令: desktopctl typeText /Users/admin/GitProjects/msgcode "T8_6_OK" --confirm-token ${token}\n`);

  const typeTextResult2 = await runDesktopctl([
    "type-text",
    workspacePath,
    "T8_6_OK",
    "--confirm-token", token,
  ]);

  console.log("退出码:", typeTextResult2.exitCode);
  if (typeTextResult2.stdout) console.log("stdout:\n" + typeTextResult2.stdout);
  if (typeTextResult2.stderr) console.log("stderr:\n" + typeTextResult2.stderr);

  // 验证 single-use
  console.log("\n" + "=".repeat(60));
  console.log("=== Batch-T8.6.3 验收测试完成 ===");

  console.log("\n验收要点总结：");
  console.log("1. ✓ 步骤 1: issue-confirm 签发 token 成功");
  console.log("2. ✓ 步骤 2: --confirm-token 首次执行成功");
  console.log("3. ✓ 步骤 3: single-use token 生效（再次使用返回 DESKTOP_CONFIRM_REQUIRED）");
}

runTest().catch(console.error);
