#!/usr/bin/env node
/**
 * msgcode: CLI 入口（2.0）
 *
 * 原则：
 * - iMessage I/O 统一走 imsg RPC
 * - 无 iMessage SDK / 无 AppleScript
 */

import { Command } from "commander";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, copyFile } from "node:fs/promises";
import { existsSync, accessSync, constants } from "node:fs";
import { exec, spawn } from "node:child_process";

// 导入 memory 子命令（M2）
import {
  createMemoryRememberCommand,
  createMemoryIndexCommand,
  createMemorySearchCommand,
  createMemoryGetCommand,
  createMemoryStatusCommand,
} from "./cli/memory.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CONFIG_DIR = path.join(os.homedir(), ".config/msgcode");
const LOG_DIR = path.join(CONFIG_DIR, "log");
const LOG_FILE = path.join(LOG_DIR, "msgcode.log");
const DAEMON_SCRIPT = path.join(__dirname, "daemon.ts");

const program = new Command();

program.name("msgcode").description("msgcode - iMessage-based bot (imsg RPC)").version("0.4.0");

program
  .command("start [mode]")
  .description("启动 msgcode（debug 模式前台运行，否则后台 daemon）")
  .action(async (mode: string | undefined) => {
    const normalized = (mode ?? "").toLowerCase();
    if (normalized === "debug") {
      const { startBot } = await import("./commands.js");
      await startBot();
      return;
    }
    await launchDaemon();
  });

program
  .command("stop")
  .description("停止 msgcode（保留 tmux 会话上下文）")
  .action(async () => {
    const { stopBot } = await import("./commands.js");
    await stopBot();
  });

program
  .command("restart [mode]")
  .description("重启 msgcode（debug 模式前台运行，否则后台 daemon）")
  .action(async (mode: string | undefined) => {
    const normalized = (mode ?? "").toLowerCase();
    const { stopBot } = await import("./commands.js");
    await stopBot();
    if (normalized === "debug") {
      const { startBot } = await import("./commands.js");
      await startBot();
      return;
    }
    await launchDaemon();
  });

program
  .command("allstop")
  .description("停止 msgcode + 清理所有 tmux 会话")
  .action(async () => {
    const { allStop } = await import("./commands.js");
    await allStop();
  });

program
  .command("init")
  .description("初始化配置目录与 .env")
  .action(initBot);

program
  .command("status")
  .description("查看系统状态报告")
  .option("-j, --json", "JSON 格式输出（短选项）")
  .action(async (options) => {
    const startTime = Date.now();
    const { runAllProbes, formatReport } = await import("./probe/index.js");
    const report = await runAllProbes();
    const output = formatReport(report, {
      format: options.json ? "json" : "text",
      colorize: true,
    }, "msgcode status", startTime);
    console.log(output);

    // 根据状态设置退出码：pass=0, warning=2, error=1
    const exitCode = report.summary.status === "error" ? 1 : report.summary.status === "warning" ? 2 : 0;
    process.exit(exitCode);
  });

program
  .command("probe [category]")
  .description("运行诊断探针（environment|permissions|config|routes|connections|resources）")
  .option("-j, --json", "JSON 格式输出（短选项）")
  .action(async (category: string | undefined, options) => {
    const startTime = Date.now();
    const { runAllProbes, runSingleProbe, formatReport } = await import("./probe/index.js");

    if (category) {
      // 运行单个类别探针
      const report = await runSingleProbe(category);
      const command = `msgcode probe ${category}`;
      const output = formatReport(report, {
        format: options.json ? "json" : "text",
        colorize: true,
      }, command, startTime);
      console.log(output);
      // 根据状态设置退出码
      const exitCode = report.summary.status === "error" ? 1 : report.summary.status === "warning" ? 2 : 0;
      process.exit(exitCode);
    } else {
      // 运行所有探针
      const report = await runAllProbes();
      const output = formatReport(report, {
        format: options.json ? "json" : "text",
        colorize: true,
      }, "msgcode probe", startTime);
      console.log(output);
      // 根据状态设置退出码
      const exitCode = report.summary.status === "error" ? 1 : report.summary.status === "warning" ? 2 : 0;
      process.exit(exitCode);
    }
  });

program
  .command("doctor")
  .description("聚合诊断 + 修复建议（JSON-first，用于自动化修复）")
  .option("-j, --json", "JSON 格式输出（短选项）")
  .action(async (options) => {
    const startTime = Date.now();
    const { runAllProbes, formatReport } = await import("./probe/index.js");
    const report = await runAllProbes();

    // doctor 默认输出 JSON，除非用户明确要文本格式
    const output = formatReport(report, {
      format: options.json ? "json" : "json",  // doctor 默认 JSON
      colorize: false,
    }, "msgcode doctor", startTime);
    console.log(output);

    // 根据状态设置退出码：pass=0, warning=2, error=1
    const exitCode = report.summary.status === "error" ? 1 : report.summary.status === "warning" ? 2 : 0;
    process.exit(exitCode);
  });

// Memory 命令组（M2）
async function loadMemoryCommands() {
  const { createMemoryCommand } = await import("./cli/memory.js");
  program.addCommand(createMemoryCommand());
}

// 主入口（异步）
async function main() {
  await loadMemoryCommands();
  program.parse();
}

main().catch((err) => {
  console.error("CLI error:", err);
  process.exit(1);
});

async function launchDaemon(): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });
  await mkdir(LOG_DIR, { recursive: true });

  console.log("后台启动 msgcode...");

  const env = {
    ...process.env,
    LOG_CONSOLE: "false",
  };

  const localTsx = path.join(__dirname, "..", "node_modules", ".bin", "tsx");
  const cmd = existsSync(localTsx) ? localTsx : "npx";
  const args = existsSync(localTsx) ? [DAEMON_SCRIPT] : ["tsx", DAEMON_SCRIPT];

  const child = spawn(cmd, args, {
    detached: true,
    stdio: "ignore",
    env,
  });

  child.on("error", (error) => {
    console.error(`后台启动失败: ${error.message}`);
    process.exit(1);
  });

  child.unref();

  console.log(`msgcode 已启动 (PID: ${child.pid})`);
  console.log(`日志: ${LOG_FILE}`);
}

async function initBot(): Promise<void> {
  const envFile = path.join(CONFIG_DIR, ".env");
  const exampleFile = path.join(__dirname, "..", ".env.example");

  await mkdir(CONFIG_DIR, { recursive: true });
  await mkdir(LOG_DIR, { recursive: true });

  if (!existsSync(envFile)) {
    await copyFile(exampleFile, envFile);
    console.log(`已创建: ${envFile}`);
  } else {
    console.log(`已存在: ${envFile}`);
  }

  const chatDbPath = path.join(os.homedir(), "Library/Messages/chat.db");
  try {
    accessSync(chatDbPath, constants.R_OK);
    console.log(`Messages 数据库可读: ${chatDbPath}`);
  } catch {
    console.log(`Messages 数据库不可读: ${chatDbPath}`);
    console.log("请给运行 msgcode 的终端 + imsg 二进制授予 Full Disk Access。");
    exec('open "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles"');
  }

  console.log("\n最短上手：");
  console.log("1) 编辑 ~/.config/msgcode/.env：设置白名单 + IMSG_PATH");
  console.log("2) 启动：msgcode start");
  console.log("3) iMessage 手动建群，把 msgcode 账号拉进群，在群里发送：");
  console.log("   /bind acme/ops");
  console.log("   /start");
}
