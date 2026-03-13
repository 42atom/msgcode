#!/usr/bin/env tsx
/**
 * 调试 Session stdio
 */

import { spawn } from "node:child_process";

import path from "node:path";

const WORKSPACE = process.env.WORKSPACE ?? process.cwd();
const DESKTOPCTL =
  process.env.MSGCODE_DESKTOPCTL_PATH ??
  path.resolve(process.cwd(), "mac/msgcode-desktopctl/.build/debug/msgcode-desktopctl");

async function testSessionStdio() {
  console.log("=== 调试 Session stdio ===\n");

  // 启动 session（带 stdio: 'pipe'）
  const proc = spawn(DESKTOPCTL, ["session", WORKSPACE, "--idle-ms", "10000"], {
    cwd: WORKSPACE,
    stdio: ["pipe", "pipe", "pipe"],  // 确保 pipe 模式
  });

  console.log("Session 进程已启动");
  console.log("pid:", proc.pid);
  console.log("stdio:", proc.stdio ? "存在" : "不存在");
  console.log("stdout:", proc.stdout ? "存在" : "不存在");
  console.log("stderr:", proc.stderr ? "存在" : "不存在");
  console.log("stdin:", proc.stdin ? "存在" : "不存在");

  // 设置编码
  proc.stdout?.setEncoding("utf8");
  proc.stderr?.setEncoding("utf8");

  let receivedStdout = false;

  proc.stdout?.on("data", (data: Buffer | string) => {
    console.log("\n[stdout 触发] 类型:", typeof data, "长度:", data.length);
    console.log("[stdout 内容]", data.toString().substring(0, 200));
    receivedStdout = true;
  });

  proc.stderr?.on("data", (data: Buffer | string) => {
    console.log("\n[stderr 触发]", data.toString().trim());
  });

  proc.on("error", (err) => {
    console.error("\n[进程错误]", err);
  });

  proc.on("close", (code, signal) => {
    console.log(`\n[进程关闭] code=${code}, signal=${signal}`);
  });

  // 等待进程启动
  console.log("\n等待进程启动...");
  await new Promise(r => setTimeout(r, 1000));

  // 发送请求
  const request = {
    id: "test-stdio-1",
    workspacePath: WORKSPACE,
    method: "desktop.health",
    params: {},
    timeoutMs: 10000
  };

  const requestJson = JSON.stringify(request) + "\n";
  console.log("\n发送请求...");
  console.log("[请求]", requestJson.trim());

  try {
    const result = proc.stdin?.write(requestJson);
    console.log("[写入结果]", result);
  } catch (err) {
    console.error("[写入错误]", err);
  }

  // 等待响应
  console.log("\n等待响应...");
  await new Promise(r => setTimeout(r, 3000));

  console.log("\n是否收到 stdout:", receivedStdout ? "是" : "否");

  // 清理
  console.log("\n关闭进程...");
  proc.kill("SIGTERM");
  await new Promise(r => setTimeout(r, 500));

  console.log("\n测试完成");
}

testSessionStdio().catch(console.error);
