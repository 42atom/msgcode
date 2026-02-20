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
import { getVersion, getVersionInfo, type VersionInfo } from "./version.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CONFIG_DIR = path.join(os.homedir(), ".config/msgcode");
const LOG_DIR = path.join(CONFIG_DIR, "log");
const LOG_FILE = path.join(LOG_DIR, "msgcode.log");
const DAEMON_SCRIPT = path.join(__dirname, "daemon.ts");

function enableDebugProfile(): void {
  process.env.LOG_LEVEL = "debug";
  process.env.MEMORY_DEBUG = "1";
  process.env.DEBUG_TRACE = "1";
  // 默认不落消息正文，避免调试日志泄露敏感文本
  process.env.DEBUG_TRACE_TEXT = process.env.DEBUG_TRACE_TEXT ?? "0";
}

function hasDebugFlag(argv: string[]): boolean {
  return argv.includes("-d") || argv.includes("--debug");
}

if (hasDebugFlag(process.argv.slice(2))) {
  enableDebugProfile();
}

const program = new Command();

program.name("msgcode").description("msgcode - iMessage-based bot (imsg RPC)").version(getVersion());

program
  .command("start [mode]")
  .description("启动 msgcode（debug 模式前台运行，否则后台 daemon；支持 -d 调试全开）")
  .option("-d, --debug", "启用调试全开（LOG_LEVEL=debug + MEMORY_DEBUG=1 + DEBUG_TRACE=1）")
  .action(async (mode: string | undefined, options: { debug?: boolean }) => {
    const normalized = (mode ?? "").toLowerCase();
    if (options.debug) {
      enableDebugProfile();
    }
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
  .description("重启 msgcode（debug 模式前台运行，否则后台 daemon；支持 -d 调试全开）")
  .option("-d, --debug", "启用调试全开（LOG_LEVEL=debug + MEMORY_DEBUG=1 + DEBUG_TRACE=1）")
  .action(async (mode: string | undefined, options: { debug?: boolean }) => {
    const normalized = (mode ?? "").toLowerCase();
    if (options.debug) {
      enableDebugProfile();
    }
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

program
  .command("about")
  .description("显示版本和配置信息")
  .option("-j, --json", "JSON 格式输出（短选项）")
  .action((options) => {
    const versionInfo = getVersionInfo();

    if (options.json) {
      console.log(JSON.stringify(versionInfo, null, 2));
    } else {
      console.log(`msgcode v${versionInfo.appVersion}`);
      console.log(`  Node: ${versionInfo.nodeVersion}`);
      console.log(`  binPath: ${versionInfo.binPath}`);
      console.log(`  cliEntry: ${versionInfo.cliEntry}`);
      console.log(`  configPath: ${versionInfo.configPath}`);
      if (versionInfo.imsgPath) {
        console.log(`  imsgPath: ${versionInfo.imsgPath}`);
      }
      if (versionInfo.workspaceRoot) {
        console.log(`  workspaceRoot: ${versionInfo.workspaceRoot}`);
      }
    }
  });

// Memory 命令组（M2）
async function loadMemoryCommands() {
  const { createMemoryCommand } = await import("./cli/memory.js");
  program.addCommand(createMemoryCommand());
}

// Job 命令组（M3）
async function loadJobCommands() {
  const { createJobCommand } = await import("./cli/jobs.js");
  program.addCommand(createJobCommand());
}

// Preflight 命令（M4-B）
async function loadPreflightCommands() {
  const { createPreflightCommand } = await import("./cli/preflight.js");
  program.addCommand(createPreflightCommand());
}

// Run 命令组（M4-A1）
async function loadRunCommands() {
  const { createRunCommand } = await import("./cli/run.js");
  program.addCommand(createRunCommand());
}

// Skill 命令组（M6）
async function loadSkillCommands() {
  const { createSkillCommand } = await import("./cli/skills.js");
  program.addCommand(createSkillCommand());
}

// File 命令组（P5.7-R1）
async function loadFileCommands() {
  const { createFileCommand } = await import("./cli/file.js");
  program.addCommand(createFileCommand());
}

// Help 命令（P5.7-R1：机器可读帮助）
async function loadHelpCommand() {
  const { createHelpCommand } = await import("./cli/help.js");
  program.addCommand(createHelpCommand());
}

// 主入口（异步）
async function main() {
  // P0: 仅按需加载子命令，避免在"未初始化配置"时也强制 import 导致 CLI 直接崩溃。
  // 例：用户首次使用时需要能运行 `msgcode init` 来生成 ~/.config/msgcode/.env。
  const argv = process.argv.slice(2);
  const top = (argv[0] ?? "").toLowerCase();

  if (top === "memory") {
    await loadMemoryCommands();
  }
  if (top === "job" || top === "jobs") {
    await loadJobCommands();
  }
  if (top === "preflight") {
    await loadPreflightCommands();
  }
  if (top === "run") {
    await loadRunCommands();
  }
  if (top === "skill" || top === "skills") {
    await loadSkillCommands();
  }
  if (top === "file") {
    await loadFileCommands();
  }
  if (top === "help") {
    await loadHelpCommand();
  }

  // 对于 help（无参数或 --help），也加载一遍子命令，让帮助信息完整
  if (!top || top === "-h" || top === "--help" || top === "help") {
    await loadMemoryCommands();
    await loadJobCommands();
    await loadPreflightCommands();
    await loadRunCommands();
    await loadFileCommands();
    await loadHelpCommand();
  }
  program.parse();
}

main().catch((err) => {
  console.error("CLI error:", err);
  process.exit(1);
});

async function launchDaemon(): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });
  await mkdir(LOG_DIR, { recursive: true });

  const versionInfo = getVersionInfo();
  console.log(`msgcode v${versionInfo.appVersion}`);
  console.log(`  binPath: ${versionInfo.binPath}`);
  console.log(`  cliEntry: ${versionInfo.cliEntry}`);
  console.log("");

  // 单实例守护：若已有 daemon 在跑，则不重复启动
  try {
    const { acquireSingletonLock } = await import("./runtime/singleton.js");
    const lock = await acquireSingletonLock("msgcode-daemon");
    if (!lock.acquired) {
      console.log(`msgcode 已在运行 (pid: ${lock.pid ?? "unknown"})`);
      return;
    }
    // 这里不 release：真正的 daemon 进程会重新 acquire 并管理 pidfile
    await lock.release();
  } catch {
    // best-effort：锁机制失败时继续启动（避免误伤）
  }

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
