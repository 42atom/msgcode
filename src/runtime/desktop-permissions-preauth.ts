/**
 * msgcode: macOS 桌面权限预授权（best-effort）
 *
 * 目标：
 * - 避免用户第一次调用桌面能力时才卡在“未授权/无提示”的失败体验
 * - 启动时就把系统设置页打开，让用户能立刻完成授权
 *
 * 原则：
 * - 只做“触发入口 + 记录事实”，不做拦截/代决/审批层
 * - best-effort：失败不影响 daemon 启动
 * - 默认只在 launchd daemon 宿主下做一次（可 env 强制）
 */

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { existsSync } from "node:fs";
import { logger } from "../logger/index.js";
import { resolveLaunchAgentPlistPath } from "./launchd.js";

const FLAGS_DIR = "flags";
const MARKER_FILE = "desktop-permissions-preauth.v1.json";

function shouldRun(): boolean {
  if (process.platform !== "darwin") return false;
  if (process.env.MSGCODE_DESKTOP_PREAUTH === "0") return false;
  const force = process.env.MSGCODE_DESKTOP_PREAUTH_FORCE === "1";
  if (force) return true;
  // 默认只在 launchd daemon 宿主下做一次预热，避免 debug/开发模式频繁扰动。
  return process.env.MSGCODE_DAEMON_SUPERVISOR === "launchd";
}

function markerPath(): string {
  const configDir = process.env.MSGCODE_CONFIG_DIR ?? path.join(os.homedir(), ".config", "msgcode");
  return path.join(configDir, FLAGS_DIR, MARKER_FILE);
}

async function writeMarker(payload: Record<string, unknown>): Promise<void> {
  const filePath = markerPath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");
}

async function openUri(uri: string): Promise<void> {
  await new Promise<void>((resolve) => {
    const proc = spawn("open", [uri], { stdio: "ignore" });
    proc.on("close", () => resolve());
    proc.on("error", () => resolve());
  });
}

async function tryTriggerScreenCapturePrompt(): Promise<void> {
  // 只做一次轻触发：尝试让当前宿主进程触发一次屏幕截图调用，以便系统弹出授权提示。
  // 注意：macOS 的“屏幕录制”权限不可程序化授予，最终仍需用户在系统设置中勾选。
  const outDir = path.join(os.homedir(), ".config", "msgcode", "artifacts", "permission-probe");
  const outPath = path.join(outDir, `screencapture-${Date.now()}.png`);
  try {
    await fs.mkdir(outDir, { recursive: true });
  } catch {
    // ignore
  }

  await new Promise<void>((resolve) => {
    const proc = spawn("screencapture", ["-x", outPath], { stdio: "ignore" });
    proc.on("close", () => resolve());
    proc.on("error", () => resolve());
  });

  // 若成功生成文件，立即清理（只为触发授权，不留脏物）。
  try {
    await fs.unlink(outPath);
  } catch {
    // ignore
  }
}

export async function maybeRequestDesktopPermissionsPreauth(): Promise<void> {
  if (!shouldRun()) return;

  const filePath = markerPath();
  if (existsSync(filePath) && process.env.MSGCODE_DESKTOP_PREAUTH_FORCE !== "1") {
    return;
  }

  const accessibilityUri = "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility";
  const screenCaptureUri = "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture";

  logger.info("desktop permissions preauth", {
    module: "runtime/desktop-permissions-preauth",
    hostExecPath: process.execPath,
    launchAgentPlistPath: resolveLaunchAgentPlistPath(),
    accessibilityUri,
    screenCaptureUri,
  });

  // 1) 直接打开系统设置入口，降低用户找不到开关的概率
  await openUri(accessibilityUri);
  await openUri(screenCaptureUri);

  // 2) best-effort 尝试触发一次屏幕录制权限提示（宿主进程为当前 node/daemon）
  await tryTriggerScreenCapturePrompt();

  // 3) 写 marker（Everything is a file）
  await writeMarker({
    timestamp: new Date().toISOString(),
    hostExecPath: process.execPath,
    pid: process.pid,
    daemonSupervisor: process.env.MSGCODE_DAEMON_SUPERVISOR ?? "",
  });
}

