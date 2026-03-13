/**
 * msgcode: Ghost CLI 命令
 *
 * 原则：
 * - 只输出事实 + 打开系统设置入口，不做“代决/拦截/恢复”。
 * - macOS TCC 权限是按宿主进程绑定的：daemon(launchd) 与 Terminal 不是同一个宿主。
 */

import { Command } from "commander";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Diagnostic } from "../memory/types.js";
import { createEnvelope } from "./command-runner.js";
import {
  readLaunchAgentRuntime,
  resolveLaunchAgentLabel,
  resolveLaunchAgentPlistPath,
  resolveGuiDomain,
} from "../runtime/launchd.js";

type PlistJson = Record<string, unknown>;

function trimOrEmpty(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

async function runCommand(cmd: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return await new Promise((resolve) => {
    const proc = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (chunk) => { stdout += chunk.toString(); });
    proc.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
    proc.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
    proc.on("error", (error) => resolve({ code: 1, stdout, stderr: error.message }));
  });
}

async function readPlistAsJson(plistPath: string): Promise<PlistJson | null> {
  if (!existsSync(plistPath)) return null;
  const out = await runCommand("plutil", ["-convert", "json", "-o", "-", plistPath]);
  if (out.code !== 0) return null;
  try {
    return JSON.parse(out.stdout) as PlistJson;
  } catch {
    return null;
  }
}

function pickProgramArguments(plistJson: PlistJson | null): string[] | null {
  if (!plistJson) return null;
  const programArgs = plistJson.ProgramArguments;
  if (!Array.isArray(programArgs)) return null;
  const args = programArgs.map((item) => trimOrEmpty(item)).filter(Boolean);
  return args.length > 0 ? args : null;
}

async function openSystemSettingsPrivacyPane(pane: "Accessibility" | "ScreenCapture"): Promise<void> {
  const uri = pane === "Accessibility"
    ? "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
    : "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture";
  await runCommand("open", [uri]);
}

export function getGhostPermissionsContract(): Record<string, unknown> {
  return {
    name: "ghost permissions",
    description: "输出 ghost-os 权限事实（daemon 宿主）并可一键打开系统设置页",
    options: {
      optional: {
        "--open": "打开 Accessibility + Screen Recording 两个系统设置页面",
        "--open-accessibility": "仅打开 Accessibility 系统设置页",
        "--open-screen-recording": "仅打开 Screen Recording 系统设置页",
        "--json": "JSON 格式输出",
      },
    },
    output: {
      daemon: {
        label: "ai.msgcode.daemon",
        plistPath: "<string>",
        guiDomain: "gui/<uid>",
        programArguments: ["<string>"],
      },
      hint: {
        screenRecordingHostBinary: "<string>",
      },
    },
    errorCodes: ["GHOST_PERMISSIONS_UNEXPECTED_ERROR"],
  };
}

export function createGhostCommand(): Command {
  const cmd = new Command("ghost");
  cmd.description("ghost-os 相关诊断与入口（只输出事实，不做代决）");

  cmd
    .command("permissions")
    .description("查看 daemon 宿主的 TCC 权限信息，并可打开系统设置页")
    .option("--open", "打开 Accessibility + Screen Recording")
    .option("--open-accessibility", "仅打开 Accessibility")
    .option("--open-screen-recording", "仅打开 Screen Recording")
    .option("--json", "JSON 格式输出")
    .action(async (options: { open?: boolean; openAccessibility?: boolean; openScreenRecording?: boolean; json?: boolean }) => {
      const startTime = Date.now();
      const command = "msgcode ghost permissions";
      const warnings: Diagnostic[] = [];
      const errors: Diagnostic[] = [];

      try {
        const label = resolveLaunchAgentLabel();
        const plistPath = resolveLaunchAgentPlistPath();
        const guiDomain = resolveGuiDomain();
        const runtime = await readLaunchAgentRuntime();

        const plistJson = await readPlistAsJson(plistPath);
        const programArguments = pickProgramArguments(plistJson) ?? [];
        const screenRecordingHostBinary = programArguments[0] || "";

        const data = {
          daemon: {
            label,
            guiDomain,
            installed: runtime.installed,
            loaded: runtime.loaded,
            status: runtime.status,
            pid: runtime.pid,
            plistPath,
            programArguments: programArguments.length > 0 ? programArguments : undefined,
          },
          hint: {
            // 事实口径：哪个宿主二进制在发起屏幕录制调用（通常是 launchd 里的 node）
            screenRecordingHostBinary: screenRecordingHostBinary || undefined,
          },
        };

        if (options.open || options.openAccessibility) {
          await openSystemSettingsPrivacyPane("Accessibility");
        }
        if (options.open || options.openScreenRecording) {
          await openSystemSettingsPrivacyPane("ScreenCapture");
        }

        const envelope = createEnvelope(command, startTime, "pass", data, warnings, errors);

        if (options.json) {
          console.log(JSON.stringify(envelope, null, 2));
          process.exit(0);
        }

        console.log("ghost permissions (daemon host facts)");
        console.log("");
        console.log(`[daemon] label=${label}`);
        console.log(`[daemon] plistPath=${plistPath}`);
        console.log(`[daemon] guiDomain=${guiDomain}`);
        console.log(`[daemon] installed=${runtime.installed ? "yes" : "no"}`);
        console.log(`[daemon] loaded=${runtime.loaded ? "yes" : "no"}`);
        console.log(`[daemon] status=${runtime.status}`);
        if (typeof runtime.pid === "number") {
          console.log(`[daemon] pid=${runtime.pid}`);
        }
        if (programArguments.length > 0) {
          console.log("");
          console.log("[daemon] ProgramArguments:");
          for (const arg of programArguments) {
            console.log(`  - ${arg}`);
          }
        }
        console.log("");
        console.log("要点（事实）：");
        console.log("- macOS 屏幕录制/辅助功能权限按宿主进程绑定。你在 Terminal 授权，不等于 launchd 里跑的 daemon 宿主也被授权。");
        if (screenRecordingHostBinary) {
          console.log(`- Screen Recording 里需要勾选的宿主通常是：${screenRecordingHostBinary}`);
        } else {
          console.log("- 没能从 plist 解析出 ProgramArguments[0]（宿主二进制）。你可以用 plutil 查看 plist 里的 ProgramArguments。");
        }
        console.log("");
        console.log("打开系统设置：");
        console.log("- msgcode ghost permissions --open");
        console.log("  或分别打开：--open-accessibility / --open-screen-recording");

        process.exit(0);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push({
          code: "GHOST_PERMISSIONS_UNEXPECTED_ERROR",
          message,
        });
        const envelope = createEnvelope(command, startTime, "error", {}, warnings, errors);
        if (options.json) {
          console.log(JSON.stringify(envelope, null, 2));
        } else {
          console.error(`错误: ${message}`);
        }
        process.exit(1);
      }
    });

  return cmd;
}

