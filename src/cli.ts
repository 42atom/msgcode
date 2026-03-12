#!/usr/bin/env node
/**
 * msgcode: CLI 入口（2.0）
 *
 * 原则：
 * - 主通道已收口为 Feishu-only
 * - CLI 只暴露真实可运行主链，不制造 transport 幻觉
 */

import { Command } from "commander";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import dotenv from "dotenv";
import { getVersion, getVersionInfo, type VersionInfo } from "./version.js";
import { logger } from "./logger/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CONFIG_DIR = path.join(os.homedir(), ".config/msgcode");
const LOG_DIR = path.join(CONFIG_DIR, "log");
const LOG_FILE = path.join(LOG_DIR, "msgcode.log");
const DAEMON_SCRIPT = path.join(__dirname, "daemon.ts");

/**
 * CLI 启动时预加载环境变量（不校验）
 *
 * 目标：让 preflight/status 等非 config.ts 路径也能自动读取 ~/.config/msgcode/.env
 * 规则：
 * - 不覆盖已存在的进程环境变量
 * - 优先读取用户配置，再回退到当前项目 .env
 */
function bootstrapEnvForCli(): void {
  if (process.env.MSGCODE_ENV_BOOTSTRAPPED === "1") return;

  const userConfig = path.join(os.homedir(), ".config/msgcode/.env");
  const projectConfig = path.join(process.cwd(), ".env");

  if (existsSync(userConfig)) {
    dotenv.config({ path: userConfig, override: false });
  }
  if (existsSync(projectConfig)) {
    dotenv.config({ path: projectConfig, override: false });
  }

  process.env.MSGCODE_ENV_BOOTSTRAPPED = "1";
}

bootstrapEnvForCli();

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

program.name("msgcode").description("msgcode - personal agent runtime on macOS").version(getVersion());

function normalizeLegacyCliArgs(argv: string[]): string[] {
  if (argv.length < 2) return argv;

  const [top, subcommand, ...rest] = argv;
  if (top === "memory" && subcommand === "remember") {
    return [top, "add", ...rest];
  }
  if (top === "memory" && subcommand === "status") {
    return [top, "stats", ...rest];
  }

  return argv;
}

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
    if (process.platform === "darwin") {
      await stopManagedDaemon();
      return;
    }
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
    if (normalized === "debug") {
      const { stopBot } = await import("./commands.js");
      await stopBot();
      const { startBot } = await import("./commands.js");
      await startBot();
      return;
    }
    if (process.platform === "darwin") {
      await restartManagedDaemon();
      return;
    }
    const { stopBot } = await import("./commands.js");
    await stopBot();
    await launchDaemon();
  });

program
  .command("allstop")
  .description("停止 msgcode + 清理所有 tmux 会话")
  .action(async () => {
    if (process.platform === "darwin") {
      await stopManagedDaemon();
      const { killMsgcodeTmuxSessions } = await import("./commands.js");
      const sessions = await killMsgcodeTmuxSessions();
      if (sessions.length > 0) {
        console.log(`已停止 tmux 会话: ${sessions.join(", ")}`);
      }
      return;
    }
    const { allStop } = await import("./commands.js");
    await allStop();
  });

program
  .command("init")
  .description("初始化配置目录与 .env")
  .option("--overwrite-skills", "强制覆盖已存在的技能文件（默认仅首次创建）")
  .action(async (options: { overwriteSkills?: boolean }) => {
    await initBot(options);
  });

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

// Help-Docs 命令（P5.7-R1：机器可读帮助）
async function loadHelpDocsCommand() {
  const { createHelpDocsCommand } = await import("./cli/help.js");
  program.addCommand(createHelpDocsCommand());
}

// Web 命令组（P5.7-R2）
async function loadWebCommands() {
  const { createWebCommand } = await import("./cli/web.js");
  program.addCommand(createWebCommand());
}

// System 命令组（P5.7-R2）
async function loadSystemCommands() {
  const { createSystemCommand } = await import("./cli/system.js");
  program.addCommand(createSystemCommand());
}

// Thread 命令组（P5.7-R4-2）
async function loadThreadCommands() {
  const { createThreadCommand } = await import("./cli/thread.js");
  program.addCommand(createThreadCommand());
}

// Todo 命令组（P5.7-R5-1）
async function loadTodoCommands() {
  const { createTodoCommand } = await import("./cli/todo.js");
  program.addCommand(createTodoCommand());
}

// Schedule 命令组（P5.7-R5-2）
async function loadScheduleCommands() {
  const { createScheduleCommand } = await import("./cli/schedule.js");
  program.addCommand(createScheduleCommand());
}

// Media 命令组（P5.7-R6-1）
async function loadMediaCommands() {
  const { createMediaCommand } = await import("./cli/media.js");
  program.addCommand(createMediaCommand());
}

// Gen Image 命令组（P5.7-R6-2）
async function loadGenImageCommands() {
  const { createGenImageCommandGroup } = await import("./cli/gen-image.js");
  program.addCommand(createGenImageCommandGroup());
}

// Gen Audio 命令组（P5.7-R6-3）
async function loadGenAudioCommands() {
  const { createGenAudioCommandGroup } = await import("./cli/gen-audio.js");
  program.addCommand(createGenAudioCommandGroup());
}

// Browser 命令组（P5.7-R7A）
async function loadBrowserCommands() {
  const { createBrowserCommand } = await import("./cli/browser.js");
  program.addCommand(createBrowserCommand());
}

// Gen 命令组（P5.7-R6 命令入口统一）
async function loadGenCommands() {
  const { createGenImageCommand, createGenSelfieCommand } = await import("./cli/gen-image.js");
  const { createGenTtsCommand, createGenMusicCommand } = await import("./cli/gen-audio.js");

  const cmd = new Command("gen");
  cmd.description("AI 生成能力（image/selfie/tts/music）");
  cmd.addCommand(createGenImageCommand());
  cmd.addCommand(createGenSelfieCommand());
  cmd.addCommand(createGenTtsCommand());
  cmd.addCommand(createGenMusicCommand());

  program.addCommand(cmd);
}

// 主入口（异步）
async function main() {
  // P0: 仅按需加载子命令，避免在"未初始化配置"时也强制 import 导致 CLI 直接崩溃。
  // 例：用户首次使用时需要能运行 `msgcode init` 来生成 ~/.config/msgcode/.env。
  const argv = normalizeLegacyCliArgs(process.argv.slice(2));
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
  if (top === "web") {
    await loadWebCommands();
  }
  if (top === "system") {
    await loadSystemCommands();
  }
  if (top === "thread") {
    await loadThreadCommands();
  }
  if (top === "todo") {
    await loadTodoCommands();
  }
  if (top === "schedule") {
    await loadScheduleCommands();
  }
  if (top === "media") {
    await loadMediaCommands();
  }
  if (top === "gen") {
    await loadGenCommands();
  }
  if (top === "gen-image") {
    await loadGenImageCommands();
  }
  if (top === "gen-audio") {
    await loadGenAudioCommands();
  }
  if (top === "browser") {
    await loadBrowserCommands();
  }
  if (top === "help-docs") {
    await loadHelpDocsCommand();
  }

  // 对于 help（无参数或 --help），也加载一遍子命令，让帮助信息完整
  if (!top || top === "-h" || top === "--help") {
    await loadMemoryCommands();
    await loadJobCommands();
    await loadPreflightCommands();
    await loadRunCommands();
    await loadFileCommands();
    await loadWebCommands();
    await loadSystemCommands();
    await loadThreadCommands();
    await loadTodoCommands();
    await loadScheduleCommands();
    await loadMediaCommands();
    await loadGenCommands();
    await loadGenImageCommands();
    await loadGenAudioCommands();
    await loadBrowserCommands();
    await loadHelpDocsCommand();
  }
  program.parse([process.argv[0], process.argv[1], ...argv]);
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

  if (process.platform === "darwin") {
    await startManagedDaemon();
    return;
  }

  // 非 macOS 仍保留旧 detached child 模式
  try {
    const { acquireSingletonLock } = await import("./runtime/singleton.js");
    const lock = await acquireSingletonLock("msgcode-daemon");
    if (!lock.acquired) {
      console.log(`msgcode 已在运行 (pid: ${lock.pid ?? "unknown"})`);
      return;
    }
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

function isPidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 1) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForPidExit(pid: number, timeoutMs = 4000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isPidAlive(pid)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return !isPidAlive(pid);
}

async function stopStandaloneDaemon(skipPid?: number): Promise<number | null> {
  const { readSingletonPid } = await import("./runtime/singleton.js");
  const pid = await readSingletonPid("msgcode");
  if (!pid || pid === skipPid) {
    return null;
  }

  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return null;
  }

  const exited = await waitForPidExit(pid);
  if (!exited && isPidAlive(pid)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // ignore
    }
    await waitForPidExit(pid, 1000);
  }
  return pid;
}

async function startManagedDaemon(): Promise<void> {
  const {
    readLaunchAgentRuntime,
    ensureLaunchAgentStarted,
  } = await import("./runtime/launchd.js");

  const current = await readLaunchAgentRuntime(process.env);
  if (current.status === "running") {
    console.log(`msgcode 已由 launchd 运行 (PID: ${current.pid ?? "unknown"})`);
    console.log(`日志: ${current.stdoutPath}`);
    return;
  }

  await stopStandaloneDaemon(current.pid);
  const runtime = await ensureLaunchAgentStarted(process.env);
  console.log(`msgcode 已由 launchd 启动 (PID: ${runtime.pid ?? "unknown"})`);
  console.log(`LaunchAgent: ${runtime.plistPath}`);
  console.log(`日志: ${runtime.stdoutPath}`);
}

async function stopManagedDaemon(): Promise<void> {
  const {
    readLaunchAgentRuntime,
    stopLaunchAgent,
  } = await import("./runtime/launchd.js");

  const current = await readLaunchAgentRuntime(process.env);
  if (current.loaded) {
    await stopLaunchAgent(process.env);
    await waitForPidExit(current.pid ?? -1, 3000);
  }

  await stopStandaloneDaemon(current.pid);
  console.log("msgcode 已停止");
}

async function restartManagedDaemon(): Promise<void> {
  const {
    readLaunchAgentRuntime,
    ensureLaunchAgentStarted,
    restartLaunchAgent,
  } = await import("./runtime/launchd.js");

  const current = await readLaunchAgentRuntime(process.env);
  let runtime;

  if (current.installed || current.loaded) {
    if (!current.pid) {
      await stopStandaloneDaemon();
    }
    runtime = await restartLaunchAgent(process.env);
  } else {
    await stopStandaloneDaemon();
    runtime = await ensureLaunchAgentStarted(process.env);
  }

  console.log(`msgcode 已重启 (PID: ${runtime.pid ?? "unknown"})`);
  console.log(`LaunchAgent: ${runtime.plistPath}`);
  console.log(`日志: ${runtime.stdoutPath}`);
}

async function initBot(options: { overwriteSkills?: boolean } = {}): Promise<void> {
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

  await copySkillsToUserConfig(options.overwriteSkills === true);

  console.log("\n最短上手：");
  console.log("1) 编辑 ~/.config/msgcode/.env：设置白名单 + FEISHU_APP_ID + FEISHU_APP_SECRET");
  console.log("2) 先跑：msgcode preflight");
  console.log("3) 再启动：msgcode start");
  console.log("4) 把机器人拉进飞书群，在群里发送：");
  console.log("   /bind acme/ops");
  console.log("   /start");
}

/**
 * 复制内置技能到用户配置目录
 *
 * 原则：
 * - 幂等：仅首次创建，已存在文件不覆盖
 * - 显式覆盖：--overwrite-skills 强制覆盖
 *
 * @param overwrite 是否强制覆盖已存在的文件
 */
async function copySkillsToUserConfig(overwrite: boolean = false): Promise<void> {
  const { syncRuntimeSkills } = await import("./skills/runtime-sync.js");
  const userSkillsDir = path.join(CONFIG_DIR, "skills");
  const result = await syncRuntimeSkills({
    overwrite,
    userSkillsDir,
  });

  if (result.copiedFiles > 0) {
    console.log(`已复制 ${result.copiedFiles} 个托管技能文件到：${userSkillsDir}`);
  }
  if (result.skippedFiles > 0) {
    console.log(`已跳过 ${result.skippedFiles} 个已存在的技能文件（使用 --overwrite-skills 强制覆盖）`);
  }
  if (result.indexUpdated) {
    console.log(`已更新 skills 索引：${path.join(userSkillsDir, "index.json")}`);
  }
}
