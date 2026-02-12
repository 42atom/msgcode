#!/usr/bin/env tsx
/**
 * 调试 Session 进程启动
 */

import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { existsSync } from "node:fs";

const WORKSPACE = process.env.WORKSPACE ?? process.cwd();

// 查找 desktopctl
let desktopctlPath = "";
const debugPath = resolve(WORKSPACE, "mac", "msgcode-desktopctl", ".build", "debug", "msgcode-desktopctl");
if (existsSync(debugPath)) {
    desktopctlPath = debugPath;
}

console.log("desktopctl path:", desktopctlPath);

// 启动 session
const proc = spawn(desktopctlPath, ["session", WORKSPACE, "--idle-ms", "60000"], {
    cwd: WORKSPACE,
    env: { ...process.env, PWD: WORKSPACE },
});

console.log("Session process started, pid:", proc.pid);

proc.stdout?.on("data", (data) => {
    console.log("stdout:", data.toString());
});

proc.stderr?.on("data", (data) => {
    console.log("stderr:", data.toString());
});

proc.on("close", (code) => {
    console.log("Session closed, exit code:", code);
});

// 发送测试请求
setTimeout(() => {
    console.log("Sending test request...");
    const request = {
        id: "test-1",
        workspacePath: WORKSPACE,
        method: "desktop.health",
        params: {}
    };
    proc.stdin?.write(JSON.stringify(request) + "\n");
}, 500);

// 等待响应
setTimeout(() => {
    console.log("Closing session...");
    proc.kill("SIGTERM");
}, 5000);

// 保持运行
setTimeout(() => {
    console.log("Exiting...");
    process.exit(0);
}, 10000);
