#!/usr/bin/env tsx
/**
 * 简单 Session 测试
 */

import { spawn } from "node:child_process";

const WORKSPACE = "/Users/admin/GitProjects/msgcode";
const DESKTOPCTL = "/Users/admin/GitProjects/msgcode/mac/msgcode-desktopctl/.build/debug/msgcode-desktopctl";

async function testSession() {
  console.log("=== 简单 Session 测试 ===\n");

  // 启动 session
  const proc = spawn(DESKTOPCTL, ["session", WORKSPACE, "--idle-ms", "10000"], {
    cwd: WORKSPACE,
  });

  console.log("Session 进程已启动, pid:", proc.pid);

  let stdoutData = "";
  let stderrData = "";

  proc.stdout?.on("data", (data: Buffer) => {
    const chunk = data.toString();
    console.log("[stdout]", chunk);
    stdoutData += chunk;
  });

  proc.stderr?.on("data", (data: Buffer) => {
    const chunk = data.toString();
    console.log("[stderr]", chunk.trim());
    stderrData += chunk;
  });

  // 等待进程启动
  await new Promise(r => setTimeout(r, 500));

  // 发送请求
  const request = {
    id: "test-simple-1",
    workspacePath: WORKSPACE,
    method: "desktop.health",
    params: {},
    timeoutMs: 10000
  };

  const requestJson = JSON.stringify(request) + "\n";
  console.log("\n[stdin] 写入请求:", requestJson.trim());

  const written = proc.stdin?.write(requestJson);
  console.log("[stdin] 写入结果:", written);

  // 等待响应
  await new Promise(r => setTimeout(r, 2000));

  // 解析响应
  const lines = stdoutData.split("\n").filter(l => l.trim());
  console.log("\n收到的完整行数:", lines.length);
  for (const line of lines) {
    console.log("行:", line.substring(0, 100));
    try {
      const parsed = JSON.parse(line);
      console.log("解析结果:", JSON.stringify(parsed, null, 2).substring(0, 500));
    } catch {
      console.log("无法解析为 JSON");
    }
  }

  // 清理
  proc.kill("SIGTERM");
  await new Promise(r => setTimeout(r, 500));
  console.log("\n测试完成");
}

testSession().catch(console.error);
